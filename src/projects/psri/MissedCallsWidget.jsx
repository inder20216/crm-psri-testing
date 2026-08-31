import { useState, useEffect, useCallback, useRef } from 'react';
import { psri } from '../../api/psri';
import { useSparkTG } from '../../context/SparkTGContext';
import './Psri.css';

const STAGE_LABEL = { 1: 'Missed', 2: '2nd Attempt', 3: '3rd Attempt' };
const POLL_INTERVAL_MS = 60000;
const LOOKBACK_DAYS = 30;
const MAX_ATTEMPTS = 3;

// Same callback-attempt state machine that used to run as an n8n Code node:
// an unanswered inbound call starts (or continues) a missed streak; an
// unanswered outbound call against an active streak is a failed callback
// attempt; ANY answered call (either direction) clears the streak entirely;
// 3 failed attempts and the number drops off the list. Runs client-side now
// so n8n only ever serves raw rows, not a per-agent-per-minute computation.
function computeMissedCalls(callLogs) {
  const byPhone = new Map();
  for (const c of callLogs) {
    if (!c.phone) continue;
    if (!byPhone.has(c.phone)) byPhone.set(c.phone, []);
    byPhone.get(c.phone).push(c);
  }

  const results = [];
  for (const [phone, calls] of byPhone) {
    // callLogs arrives newest-first; walk chronologically oldest-first.
    const chrono = [...calls].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

    let streakStart = null;
    let failedAttempts = 0;
    let lastCall = null;

    for (const c of chrono) {
      const noDuration = !(Number(c.durationSeconds) > 0);
      const isMissedDisposition = (c.disposition || '').trim().toUpperCase() === 'MISSED';
      const answered = !noDuration && !isMissedDisposition;
      lastCall = c;
      if (answered) { streakStart = null; failedAttempts = 0; continue; }
      if (c.direction === 'inbound') {
        if (!streakStart) streakStart = c;
      } else if (c.direction === 'outbound' && streakStart) {
        failedAttempts++;
      }
    }

    if (!streakStart) continue;
    if (failedAttempts >= MAX_ATTEMPTS) continue;

    results.push({
      phone,
      stage: failedAttempts + 1,
      missedSince: streakStart.startedAt,
      lastCallTxnId: lastCall.callTxnId,
      lastDirection: lastCall.direction,
      lastStartedAt: lastCall.startedAt,
      lastAgentEmail: lastCall.agentEmail,
      contactId: lastCall.contactId,
      latestCase: null,
    });
  }

  results.sort((a, b) => new Date(b.lastStartedAt) - new Date(a.lastStartedAt));
  return results.slice(0, 100);
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function MissedCallCard({ call, onCallBack }) {
  const c = call.latestCase;
  return (
    <div className="psri-side-result-item" style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{call.phone}</strong>
        <span className="cp-hint" style={{ margin: 0 }}>{timeAgo(call.missedSince)}</span>
      </div>
      {c && (
        <div style={{ marginTop: 4 }}>
          <span className="psri-badge">{c.callFor || '—'}</span>{' '}
          <span className="stg-recent-summary">{String(c.summary || '')}</span>
        </div>
      )}
      {!c && <p className="cp-hint" style={{ margin: '4px 0 0' }}>No prior case on record for this number.</p>}
      <div className="stg-dialer-actions" style={{ marginTop: 8 }}>
        <button type="button" className="psri-btn-primary" onClick={() => onCallBack(call.phone)}>
          📞 Call Back
        </button>
      </div>
    </div>
  );
}

function MissedCallsPanel({ calls, loading, stage, setStage }) {
  const { dial } = useSparkTG();
  const filtered = calls.filter(c => c.stage === stage);

  return (
    <div>
      <div className="psri-lang-toggle" style={{ marginBottom: 10 }}>
        {[1, 2, 3].map(s => (
          <button key={s} type="button" className={stage === s ? 'active' : ''} onClick={() => setStage(s)}>
            {STAGE_LABEL[s]} {calls.filter(c => c.stage === s).length > 0 && `(${calls.filter(c => c.stage === s).length})`}
          </button>
        ))}
      </div>
      {loading && <p className="cp-hint">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="cp-hint">Nothing here right now.</p>}
      {!loading && filtered.length > 0 && (
        <div className="psri-side-results">
          {filtered.map(c => (
            <MissedCallCard key={c.phone} call={c} onCallBack={dial} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MissedCallsWidget() {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState(1);
  const seenPhones = useRef(new Set());
  const firstLoad = useRef(true);

  // Polls in the background regardless of whether the panel is open, so a
  // new missed call surfaces on its own instead of requiring the agent to
  // remember to click and check — same "no manual click needed" pattern
  // the incoming-call DialerPanel already uses. n8n only ever returns raw
  // call_logs rows here; the state machine and the case lookups both run
  // in the browser, so the 60s poll never re-triggers a heavy backend job.
  const refresh = useCallback(() => {
    setLoading(true);
    psri.getCallLogs({ days: LOOKBACK_DAYS, limit: 5000 })
      .then(async (rows) => {
        const missed = computeMissedCalls(rows);

        // Only look up a case for numbers that actually survived the state
        // machine (usually a handful), not every call in the lookback window.
        await Promise.all(missed.map(async (m) => {
          try {
            const res = await psri.getCases(m.phone);
            m.latestCase = (res && res.cases && res.cases[0]) || null;
          } catch {
            m.latestCase = null;
          }
        }));

        setCalls(missed);

        if (firstLoad.current) {
          // Don't auto-pop on initial page load for calls that were already
          // sitting there before this session started — only for ones that
          // newly appear from here on.
          firstLoad.current = false;
          missed.forEach(r => seenPhones.current.add(r.phone));
          return;
        }

        const freshlyMissed = missed.filter(r => r.stage === 1 && !seenPhones.current.has(r.phone));
        missed.forEach(r => seenPhones.current.add(r.phone));

        if (freshlyMissed.length > 0) {
          setStage(1);
          setOpen(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Badge shows only fresh, not-yet-attempted misses — not the total across
  // every stage, since 2nd/3rd-attempt calls have already been surfaced once
  // and re-counting them here would overstate what's actually new.
  const totalCount = calls.filter(c => c.stage === 1).length;

  return (
    <>
      <button
        className={`dr-lookup-toggle-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Missed Calls"
        style={{ right: 112, position: 'fixed' }}
      >
        ☎️
        {totalCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700,
            borderRadius: 10, minWidth: 16, height: 16, lineHeight: '16px',
            padding: '0 4px', textAlign: 'center',
          }}>
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="dr-lookup-panel" style={{ right: 410 }}>
          <div className="dr-lookup-header">
            <span className="dr-lookup-header-title">☎️ Missed Calls</span>
            <button className="dr-lookup-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="dr-lookup-body">
            <MissedCallsPanel calls={calls} loading={loading} stage={stage} setStage={setStage} />
          </div>
        </div>
      )}
    </>
  );
}
