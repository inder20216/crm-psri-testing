import { useState, useEffect, useCallback } from 'react';
import { psri } from '../../api/psri';
import { useSparkTG } from '../../context/SparkTGContext';
import './Psri.css';

const STAGE_LABEL = { 1: 'Recent Missed', 2: '2nd Round', 3: '3rd Round' };
const POLL_INTERVAL_MS = 60000;
const LOOKBACK_DAYS = 30;
const MAX_ATTEMPTS = 3;

// Genuine Indian mobile numbers always start 6-9. call_logs.phone also
// carries internal SparkTG extension/transfer numbers (seen in production:
// 1130611700, 1161426142, 1145048652, ...) that aren't callable customer
// numbers at all — without this filter those pollute the callback queue
// with entries nobody should ever dial back.
const MOBILE_RE = /^[6-9]\d{9}$/;

// Same callback-attempt state machine that used to run as an n8n Code node:
// an unanswered inbound call starts (or continues) a missed streak; an
// unanswered outbound call against an active streak is a failed callback
// attempt; ANY answered call (either direction) clears the streak entirely;
// 3 failed attempts and the number drops off the list. Runs client-side so
// n8n only ever serves raw rows, not a per-agent-per-minute computation.
function computeMissedCalls(callLogs) {
  const byPhone = new Map();
  for (const c of callLogs) {
    if (!c.phone || !MOBILE_RE.test(c.phone)) continue;
    if (!byPhone.has(c.phone)) byPhone.set(c.phone, []);
    byPhone.get(c.phone).push(c);
  }

  const results = [];
  for (const [phone, calls] of byPhone) {
    // callLogs arrives newest-first; walk chronologically oldest-first.
    const chrono = [...calls].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

    let streakStart = null;
    let failedAttempts = 0;

    for (const c of chrono) {
      // duration_seconds is the primary signal (a call that was actually
      // picked up has one, whatever SparkTG calls the outcome) — but proven
      // wrong on its own: SparkTG reports non-zero duration (ring time) even
      // on calls it explicitly disposition-tags "missed" (confirmed against
      // real data: disposition "missed" with durationSeconds 15–45). So an
      // explicit "missed"/"no answer" disposition overrides a non-zero
      // duration. Deliberately a narrow override, not full string-matching
      // against SparkTG's whole vocabulary (Queue Missed, IVR Missed, Agent
      // Missed, NoAnswer, ...) — just the two outcomes proven to coexist
      // with a non-zero duration. Same rule psri-telephony-service already
      // uses server-side — keep in sync.
      const explicitlyMissed = /missed|no.?answer/i.test(c.disposition || '');
      const answered = !explicitlyMissed && Number(c.durationSeconds) > 0;
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
      contactName: streakStart.contactName || '',
    });
  }
  return results;
}

function fmtSince(dt) {
  const d = new Date(dt);
  if (isNaN(d)) return dt;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago (${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})`;
}

export default function MissedCallsWidget() {
  const { dial } = useSparkTG();
  const [calls, setCalls] = useState([]);
  const [listOpen, setListOpen] = useState(false);

  const refresh = useCallback(() => {
    psri.getCallLogs({ days: LOOKBACK_DAYS, limit: 5000 })
      .then(rows => setCalls(computeMissedCalls(rows)));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // FIFO — the oldest missed call in that stage's bucket gets called first,
  // no list to browse or pick from, just dial straight from the count.
  const callFifo = (stage) => {
    const bucket = calls
      .filter(c => c.stage === stage)
      .sort((a, b) => new Date(a.missedSince) - new Date(b.missedSince));
    if (bucket.length === 0) return;
    dial(bucket[0].phone);
  };

  const counts = { 1: 0, 2: 0, 3: 0 };
  calls.forEach(c => { counts[c.stage] = (counts[c.stage] || 0) + 1; });

  const recentMissedList = calls
    .filter(c => c.stage === 1)
    .sort((a, b) => new Date(a.missedSince) - new Date(b.missedSince));

  return (
    <div className="mc-bar" title="Missed Calls — click a stage to call back the oldest one first (FIFO)">
      <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
        <button
          type="button"
          className="mc-bar-btn mc-bar-btn--1"
          onClick={() => callFifo(1)}
          disabled={counts[1] === 0}
        >
          <span className="mc-bar-label">{STAGE_LABEL[1]}</span>
          <span className="mc-bar-count">{counts[1]}</span>
        </button>
        <button
          type="button"
          onClick={() => setListOpen(v => !v)}
          title="View the Recent Missed list"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 4px', color: '#64748b' }}
        >
          {listOpen ? '▲' : '▾'}
        </button>

        {listOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 50,
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', width: 340, maxHeight: 420, overflowY: 'auto',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
              <span>Recent Missed ({recentMissedList.length})</span>
              <button type="button" onClick={() => setListOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>
            {recentMissedList.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Nothing pending — all clear.</div>
            )}
            {recentMissedList.map(c => (
              <div key={c.phone} style={{ padding: '10px 14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{c.contactName || c.phone}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {c.contactName ? c.phone + ' · ' : ''}missed {fmtSince(c.missedSince)}
                  </div>
                </div>
                <button
                  type="button"
                  className="admin-btn-primary"
                  style={{ fontSize: 12, padding: '6px 10px', flexShrink: 0 }}
                  onClick={() => dial(c.phone)}
                >
                  Call
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="mc-bar-btn mc-bar-btn--2"
        onClick={() => callFifo(2)}
        disabled={counts[2] === 0}
      >
        <span className="mc-bar-label">{STAGE_LABEL[2]}</span>
        <span className="mc-bar-count">{counts[2]}</span>
      </button>
    </div>
  );
}
