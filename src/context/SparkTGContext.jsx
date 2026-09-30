import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { psri } from '../api/psri';

const SparkTGContext = createContext(null);

const WIDGET_URL = import.meta.env.VITE_SPARKTG_WIDGET_URL || '';

// Strip country code from SparkTG numbers (+919873600063 → 9873600063).
// Handles +91, 91, and 0 prefixes; leaves anything else unchanged.
function normalizePhone(raw) {
  if (!raw) return '';
  const s = (raw || '').replace(/[\s\-()]/g, '');
  if (/^\+91(\d{10})$/.test(s)) return s.slice(3);
  if (/^91(\d{10})$/.test(s))   return s.slice(2);
  if (/^0(\d{10})$/.test(s))    return s.slice(1);
  return s;
}

const POLL_ATTEMPTS = 6
const POLL_DELAY_MS = 3000
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// n8n workflows are stateless request/response — unlike the old always-on
// telephony service, nothing on the backend retries this on its own. The
// browser drives it: wait a few seconds after a call ends for SparkTG to
// finalize the record, poll, and retry a handful of times if it's not
// ready yet. Fire-and-forget from the caller's point of view.
async function pollAndEnrichCall(callId) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_DELAY_MS)
    const res = await psri.pollSparkTG(callId)
    if (res?.found && res.record) {
      const r = res.record
      await psri.enrichCallLog({
        callTxnId: callId,
        disposition: r.disposition || '',
        duration: r.duration,
        recording: r.recording || '',
        ivrData: r.ivrData,
      })
      return
    }
  }
}

// Debug-only: polls the CRM's own stored call_logs row (not SparkTG directly)
// so the debug panel can show exactly what the backend ends up with for a
// call — including fields like direction that the live widget events never
// carry. Separate from pollAndEnrichCall above, which drives the real
// enrichment write; this one only reads and reports back via onUpdate.
async function pollBackendCallLog(callId, onUpdate) {
  onUpdate({ callTxnId: callId, status: 'polling', record: null })
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_DELAY_MS)
    const rows = await psri.getCallLogs({ callTxnId: callId }).catch(() => [])
    if (rows && rows.length > 0) {
      onUpdate({ callTxnId: callId, status: 'found', record: rows[0] })
      return
    }
  }
  onUpdate({ callTxnId: callId, status: 'timeout', record: null })
}

export function SparkTGProvider({ children, agentEmail = '' }) {
  const iframeRef       = useRef(null);
  const pendingOutbound = useRef(false);   // true when we sent click_to_call and await show_dialer back
  const hasAutoSso      = useRef(false);   // prevents re-login after manual Logout in widget
  // Survives dismissCall() clearing callState (e.g. DialerPanel dismisses
  // the popup right after auto-navigating, long before the call itself
  // ends) — so the debug panel can always look up "the last call", not
  // only one that's still actively tracked in callState.
  const lastCallId      = useRef(null);
  const [ready, setReady]               = useState(false);
  const [ssoStatus, setSsoStatus]       = useState('pending');   // 'pending' | 'success' | 'failed'
  const [callState, setCallState]       = useState(null);        // { phone, name, callId, calledTo, direction, ended }
  const [widgetVisible, setWidgetVisible] = useState(false);
  const [dialerPrefill, setDialerPrefill] = useState(null);
  const [rawEvents, setRawEvents]       = useState([]);          // debug: last 20 raw messages
  const [backendCallLog, setBackendCallLog] = useState(null);    // debug: { callTxnId, status, record } for the most recent ended call

  const sendToWidget = useCallback((event, data = {}) => {
    iframeRef.current?.contentWindow?.postMessage({ event, data }, '*');
  }, []);

  const dial = useCallback((phone) => {
    if (!WIDGET_URL) return;
    const dialPhone = /^\d{10}$/.test(phone) ? `+91${phone}` : phone;
    pendingOutbound.current = true;
    sendToWidget('click_to_call', { phone: dialPhone });
    setCallState({ phone: normalizePhone(phone), name: '', callId: null, calledTo: '', direction: 'outbound', ended: false });
    setWidgetVisible(true);
  }, [sendToWidget]);

  const dismissCall = useCallback(() => setCallState(null), []);

  // On-demand debug lookup — click-to-fetch instead of waiting on hide_dialer,
  // which doesn't reliably fire. Looks up the most recent call regardless of
  // whether callState still has it.
  const fetchBackendCallLog = useCallback(() => {
    const callId = lastCallId.current;
    if (!callId) { setBackendCallLog({ callTxnId: null, status: 'timeout', record: null }); return; }
    setBackendCallLog({ callTxnId: callId, status: 'polling', record: null });
    psri.getCallLogs({ callTxnId: callId })
      .then(rows => {
        setBackendCallLog({ callTxnId: callId, status: rows && rows.length > 0 ? 'found' : 'timeout', record: rows?.[0] || null });
      })
      .catch(() => setBackendCallLog({ callTxnId: callId, status: 'timeout', record: null }));
  }, []);

  useEffect(() => {
    if (!WIDGET_URL) return;
    function onMessage(ev) {
      const msg = ev.data;

      // Capture EVERY raw postMessage for the debug panel, even ones that
      // don't match our expected {event, data} shape — otherwise a signal
      // we're not already reading for (e.g. call direction) would be
      // silently dropped before we ever saw it.
      setRawEvents(prev => [{
        ts: new Date().toLocaleTimeString(),
        event: (msg && typeof msg === 'object' && msg.event) ? msg.event : '(unrecognized shape)',
        data: (msg && typeof msg === 'object') ? (msg.data !== undefined ? msg.data : msg) : msg,
      }, ...prev].slice(0, 20));

      if (!msg || typeof msg !== 'object' || !msg.event) return;

      const { event, data } = msg;
      switch (event) {
        case 'ready_for_events':
          setReady(true);
          if (!hasAutoSso.current) {
            // First-time load — auto-login via SSO using the authenticated agent's email
            hasAutoSso.current = true;
            if (agentEmail) sendToWidget('login_sso_email', { email: agentEmail, force: true });
          } else {
            // Widget was reset by a manual Logout click — reflect logged-out state
            // and do NOT re-login automatically. Agent must refresh page to log back in.
            setSsoStatus('pending');
          }
          break;
        case 'login_sso_complete':
          setSsoStatus(data?.status === 'success' ? 'success' : 'failed');
          break;
        case 'show_dialer': {
          // SparkTG sends reason:"incoming_call" for both inbound AND outbound,
          // so we use our own pendingOutbound flag instead.
          const isOutbound = pendingOutbound.current;
          pendingOutbound.current = false;
          const callId    = data?.callId || null;
          const phone     = normalizePhone(data?.caller?.phone || '');
          const calledTo  = normalizePhone(data?.calledTo || data?.did || '');
          const direction = isOutbound ? 'outbound' : 'inbound';
          setCallState(prev => ({
            phone:     phone || prev?.phone || '',
            name:      data?.caller?.name  || prev?.name  || '',
            callId:    callId || prev?.callId || null,
            calledTo:  calledTo || prev?.calledTo || '',
            direction,
            ended:     false,
          }));
          setWidgetVisible(true);
          if (callId) {
            lastCallId.current = callId;
            psri.logCall({ project: 'psri', callTxnId: callId, direction, phone, calledNumber: calledTo, status: 'started', agentEmail });
          }
          break;
        }
        case 'hide_dialer': {
          // Use lastCallId (not callState) — DialerPanel's dismissCall() may
          // have already nulled callState well before the call actually
          // ended, which would otherwise silently skip all of this.
          const endedCallId = lastCallId.current;
          if (endedCallId) {
            psri.logCall({ project: 'psri', callTxnId: endedCallId, status: 'ended', agentEmail });
            pollAndEnrichCall(endedCallId).catch(err => console.warn('[telephony] poll/enrich failed:', err.message));
            pollBackendCallLog(endedCallId, setBackendCallLog).catch(err => console.warn('[telephony] backend call log poll failed:', err.message));
          }
          setCallState(prev => (prev ? { ...prev, ended: true } : null));
          break;
        }
        default:
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendToWidget]);

  return (
    <SparkTGContext.Provider value={{
      hasWidget: !!WIDGET_URL,
      iframeRef,
      ready, ssoStatus,
      callState, dismissCall,
      widgetVisible, setWidgetVisible,
      dial,
      dialerPrefill, setDialerPrefill,
      sendToWidget,
      rawEvents, clearRawEvents: () => setRawEvents([]),
      backendCallLog, fetchBackendCallLog,
    }}>
      {children}
    </SparkTGContext.Provider>
  );
}

export function useSparkTG() {
  const ctx = useContext(SparkTGContext);
  if (!ctx) throw new Error('useSparkTG must be used inside SparkTGProvider');
  return ctx;
}
