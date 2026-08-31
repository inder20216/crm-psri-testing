import { useState, useEffect, useCallback, useMemo } from 'react';
import { psri } from '../api/psri';
import { useUsers } from '../context/UsersContext';
import { buildAgentNumberMap, resolveAgentKey, resolveAgentLabel } from '../projects/psri/agentResolve';
import './Admin.css';

const DAY_OPTIONS = [
  { value: 1, label: 'Today' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
];

function isAnswered(call) {
  const noDuration = !(Number(call.durationSeconds) > 0);
  const isMissed = (call.disposition || '').trim().toUpperCase() === 'MISSED';
  return !noDuration && !isMissed;
}

function fmtMMSS(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDurationLong(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// Same callback-attempt semantics as MissedCallsWidget.jsx's state machine —
// an unanswered inbound call opens a streak, any answered call closes it —
// but here we're measuring how long each streak stayed open (TAT) rather
// than which numbers are still currently missing.
function computeCallbackTATs(rows, nameByNumber) {
  const byPhone = new Map();
  rows.forEach(r => {
    if (!r.phone) return;
    if (!byPhone.has(r.phone)) byPhone.set(r.phone, []);
    byPhone.get(r.phone).push(r);
  });

  const tats = [];
  byPhone.forEach(calls => {
    const chrono = [...calls].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    let missedAt = null;
    for (const c of chrono) {
      if (isAnswered(c)) {
        if (c.direction === 'outbound' && missedAt) {
          tats.push({
            agentKey: resolveAgentKey(c, nameByNumber),
            agentName: resolveAgentLabel(c, nameByNumber),
            tatMs: new Date(c.startedAt) - missedAt,
          });
        }
        missedAt = null;
        continue;
      }
      if (c.direction === 'inbound' && !missedAt) missedAt = new Date(c.startedAt);
    }
  });
  return tats;
}

export default function ProductivityPage() {
  const { users } = useUsers();
  const [days, setDays] = useState(1);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const nameByNumber = useMemo(() => buildAgentNumberMap(users), [users]);

  const refresh = useCallback((d) => {
    setLoading(true);
    setLoadErr('');
    return psri.getCallLogs({ days: d, limit: 5000 })
      .then(setRows)
      .catch(() => setLoadErr('Could not load call data. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(days); }, [days, refresh]);

  const agentRows = useMemo(() => {
    const stats = new Map();
    const ensure = (key, name) => {
      if (!stats.has(key)) {
        stats.set(key, { name, total: 0, inbound: 0, outbound: 0, answered: 0, missed: 0, answeredDurationSum: 0, tatMsSum: 0, tatCount: 0 });
      }
      return stats.get(key);
    };

    rows.forEach(r => {
      const key = resolveAgentKey(r, nameByNumber);
      const name = resolveAgentLabel(r, nameByNumber);
      const s = ensure(key, name);
      s.total++;
      if (r.direction === 'inbound') s.inbound++;
      else if (r.direction === 'outbound') s.outbound++;
      if (isAnswered(r)) {
        s.answered++;
        s.answeredDurationSum += Number(r.durationSeconds) || 0;
      } else {
        s.missed++;
      }
    });

    computeCallbackTATs(rows, nameByNumber).forEach(({ agentKey, agentName, tatMs }) => {
      const s = ensure(agentKey, agentName);
      s.tatMsSum += tatMs;
      s.tatCount++;
    });

    return [...stats.values()]
      .map(s => ({
        ...s,
        aht: s.answered > 0 ? s.answeredDurationSum / s.answered : 0,
        avgTatMs: s.tatCount > 0 ? s.tatMsSum / s.tatCount : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows, nameByNumber]);

  return (
    <div className="admin-page">
      <div className="admin-top">
        <div>
          <h1 className="admin-title">Agent Productivity</h1>
          <p className="admin-subtitle">Call volume, AHT, and missed-call callback TAT per agent</p>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--admin-border)', fontSize: 13, fontWeight: 600 }}>
          {DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {loadErr && <div className="admin-err-banner">{loadErr}</div>}

      <div className="admin-table-wrap">
        {loading ? (
          <div className="admin-table-loading">Loading…</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Total Calls</th>
                <th>Inbound</th>
                <th>Outbound</th>
                <th>Answered</th>
                <th>Missed</th>
                <th>AHT</th>
                <th>Avg Callback TAT</th>
              </tr>
            </thead>
            <tbody>
              {agentRows.map(a => (
                <tr key={a.name}>
                  <td style={{ fontWeight: 700 }}>{a.name}</td>
                  <td>{a.total}</td>
                  <td>{a.inbound}</td>
                  <td>{a.outbound}</td>
                  <td>{a.answered}</td>
                  <td>{a.missed}</td>
                  <td>{fmtMMSS(a.aht)}</td>
                  <td>{a.tatCount > 0 ? fmtDurationLong(a.avgTatMs) : '—'}</td>
                </tr>
              ))}
              {agentRows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>No calls in this range</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
