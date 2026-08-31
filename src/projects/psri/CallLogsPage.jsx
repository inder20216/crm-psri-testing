import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { psri } from '../../api/psri';
import { useUsers } from '../../context/UsersContext';
import { buildAgentNumberMap, resolveAgentLabel } from './agentResolve';
import './Psri.css';

function fmtDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(call) {
  if (call.status === 'started') return 'In progress';
  if (!call.disposition && call.status === 'ended') return 'Ended (awaiting outcome)';
  return call.disposition || call.status || '—';
}

function typeLabel(direction) {
  if (direction === 'inbound') return 'Incoming';
  if (direction === 'outbound') return 'Outgoing';
  return '—';
}

export default function CallLogsPage() {
  const { users } = useUsers();
  const [query, setQuery] = useState('');
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const debounceRef = useRef(null);

  const nameByNumber = useMemo(() => buildAgentNumberMap(users), [users]);
  const agentLabel = (c) => resolveAgentLabel(c, nameByNumber);

  const refresh = useCallback((q) => {
    setLoading(true);
    setLoadErr('');
    return psri.getCallLogs(q)
      .then(async (rows) => {
        // Bulk-fetch the cases linked to these calls in one shot (not one
        // lookup per row) and stitch them back on, so this page becomes the
        // one place to see a call plus what it turned into — recording and
        // case outcome together, whether the case is still Incomplete or
        // already Resolved. A single call can carry several cases (e.g.
        // multiple appointments booked in one call), so group into arrays
        // rather than keeping only the last one seen per call_txn_id.
        const txnIds = [...new Set(rows.filter(c => c.caseId).map(c => c.callTxnId).filter(Boolean))];
        if (txnIds.length) {
          try {
            const res = await psri.getCases({ callTxnIds: txnIds.join(',') });
            const byTxnId = new Map();
            (res.cases || []).forEach(c => {
              const list = byTxnId.get(c.callTxnId) || [];
              list.push(c);
              byTxnId.set(c.callTxnId, list);
            });
            rows.forEach(r => { r.cases = byTxnId.get(r.callTxnId) || []; });
          } catch {
            rows.forEach(r => { r.cases = []; });
          }
        } else {
          rows.forEach(r => { r.cases = []; });
        }
        setCalls(rows);
      })
      .catch(() => setLoadErr('Could not load call logs. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    debounceRef.current = setTimeout(() => refresh(q), q ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [query, refresh]);

  return (
    <div className="psri-page">
      <div className="psri-page-head">
        <div>
          <h1 className="psri-title">Call Logs</h1>
          <p className="psri-subtitle">PSRI Hospital — Full Call History</p>
        </div>
      </div>

      {loadErr && <div className="psri-err-banner">{loadErr}</div>}

      <div className="psri-search-row">
        <input
          className="psri-search-input"
          type="text"
          placeholder="Search by phone, agent, or outcome…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="button" className="psri-btn-ghost" onClick={() => refresh(query.trim())}>↻ Refresh</button>
        <span className="psri-count">{calls.length} call{calls.length !== 1 ? 's' : ''}</span>
      </div>

      {loading && <div className="psri-empty">Loading…</div>}
      {!loading && !loadErr && calls.length === 0 && (
        <div className="psri-empty">No calls found. Try a different search, or check back once calls start coming in.</div>
      )}

      {!loading && calls.length > 0 && (
        <div className="psri-table-wrap">
          <table className="psri-table">
            <thead>
              <tr>
                <th>Call Txn ID</th>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Call Type</th>
                <th>Customer Number</th>
                <th>Virtual Number (DID)</th>
                <th>Disposition</th>
                <th>Duration</th>
                <th>Agent</th>
                <th>Recording</th>
                <th>Contact</th>
                <th>Case</th>
              </tr>
            </thead>
            <tbody>
              {calls.map(c => (
                <tr key={c.callTxnId}>
                  <td className="cp-hint">{c.callTxnId || '—'}</td>
                  <td>{fmtWhen(c.startedAt) || '—'}</td>
                  <td>{fmtWhen(c.endedAt) || '—'}</td>
                  <td>{c.direction === 'inbound' ? '↙ ' : '↗ '}{typeLabel(c.direction)}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.calledNumber || '—'}</td>
                  <td><span className="psri-badge">{statusLabel(c)}</span></td>
                  <td>{fmtDuration(c.durationSeconds)}</td>
                  <td>{agentLabel(c)}</td>
                  <td>
                    {c.recordingUrl
                      ? <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="psri-btn-ghost">▶ Play</a>
                      : <span className="cp-hint">—</span>}
                  </td>
                  <td>{c.contactName || <span className="cp-hint">Unknown</span>}</td>
                  <td className="psri-td-wrap">
                    {c.cases && c.cases.length > 0 ? (
                      c.cases.map((cs, i) => (
                        <div key={cs.id} style={i > 0 ? { marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--psri-border)' } : undefined}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {cs.callFor && <span className="psri-badge">{cs.callFor}</span>}
                            {cs.status && <span className="psri-badge">{cs.status}</span>}
                          </div>
                          {cs.summary && <p className="psri-table-case-summary">{cs.summary}</p>}
                        </div>
                      ))
                    ) : <span className="cp-hint">No case</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
