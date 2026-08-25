import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { psri } from '../../api/psri';
import { useUsers } from '../../context/UsersContext';
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

  // SparkTG's webhook only gives us its own agent-number (the extension
  // that placed/answered the call), not the CRM agent's identity — resolve
  // it against the CRM Users list by matching on their contact number.
  const nameByPhone = useMemo(() => new Map(users.filter(u => u.contact).map(u => [u.contact, u.name])), [users]);
  const agentLabel = (c) => {
    if (c.agentEmail) return c.agentEmail;
    if (c.agentNumber) return nameByPhone.get(c.agentNumber) || `Ext. ${c.agentNumber}`;
    return '—';
  };

  const refresh = useCallback((q) => {
    setLoading(true);
    setLoadErr('');
    return psri.getCallLogs(q)
      .then(async (rows) => {
        // Bulk-fetch the cases linked to these calls in one shot (not one
        // lookup per row) and stitch them back on, so this page becomes the
        // one place to see a call plus what it turned into — recording and
        // case outcome together, whether the case is still Incomplete or
        // already Resolved.
        const txnIds = [...new Set(rows.filter(c => c.caseId).map(c => c.callTxnId).filter(Boolean))];
        if (txnIds.length) {
          try {
            const res = await psri.getCases({ callTxnIds: txnIds.join(',') });
            const byTxnId = new Map((res.cases || []).map(c => [c.callTxnId, c]));
            rows.forEach(r => { r.case = byTxnId.get(r.callTxnId) || null; });
          } catch {
            rows.forEach(r => { r.case = null; });
          }
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
                    {c.case ? (
                      <>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {c.case.callFor && <span className="psri-badge">{c.case.callFor}</span>}
                          {c.case.status && <span className="psri-badge">{c.case.status}</span>}
                        </div>
                        {c.case.summary && <p className="psri-table-case-summary">{c.case.summary}</p>}
                      </>
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
