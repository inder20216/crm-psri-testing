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

    results.push({ phone, stage: failedAttempts + 1, missedSince: streakStart.startedAt });
  }
  return results;
}

export default function MissedCallsWidget() {
  const { dial } = useSparkTG();
  const [calls, setCalls] = useState([]);

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

  return (
    <div className="mc-bar" title="Missed Calls — click a stage to call back the oldest one first (FIFO)">
      {[1, 2].map(stage => (
        <button
          key={stage}
          type="button"
          className={`mc-bar-btn mc-bar-btn--${stage}`}
          onClick={() => callFifo(stage)}
          disabled={counts[stage] === 0}
        >
          <span className="mc-bar-label">{STAGE_LABEL[stage]}</span>
          <span className="mc-bar-count">{counts[stage]}</span>
        </button>
      ))}
    </div>
  );
}
