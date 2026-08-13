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

export function SparkTGProvider({ children, agentEmail = '' }) {
  const iframeRef       = useRef(null);
  const pendingOutbound = useRef(false);   // true when we sent click_to_call and await show_dialer back
  const hasAutoSso      = useRef(false);   // prevents re-login after manual Logout in widget
  const [ready, setReady]               = useState(false);
  const [ssoStatus, setSsoStatus]       = useState('pending');   // 'pending' | 'success' | 'failed'
  const [callState, setCallState]       = useState(null);        // { phone, name, callId, calledTo, direction, ended }
  const [widgetVisible, setWidgetVisible] = useState(false);
  const [dialerPrefill, setDialerPrefill] = useState(null);
  const [rawEvents, setRawEvents]       = useState([]);          // debug: last 20 raw messages

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

  useEffect(() => {
    if (!WIDGET_URL) return;
    function onMessage(ev) {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || !msg.event) return;

      // Capture raw event for debug panel (keep last 20)
      setRawEvents(prev => [{
        ts: new Date().toLocaleTimeString(),
        event: msg.event,
        data: msg.data,
      }, ...prev].slice(0, 20));

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
            psri.logCall({ project: 'psri', callTxnId: callId, direction, phone, calledNumber: calledTo, status: 'started', agentEmail });
          }
          break;
        }
        case 'hide_dialer':
          setCallState(prev => {
            if (prev?.callId) {
              psri.logCall({ project: 'psri', callTxnId: prev.callId, status: 'ended', agentEmail });
            }
            return prev ? { ...prev, ended: true } : null;
          });
          break;
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
