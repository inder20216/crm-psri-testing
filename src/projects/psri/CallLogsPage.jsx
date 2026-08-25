import { useState, useEffect, useCallback, useRef } from 'react';
import { psri } from '../../api/psri';
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

export default function CallLogsPage() {
  const [query, setQuery] = useState('');
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const debounceRef = useRef(null);

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
        <div className="psri-side-results" style={{ maxHeight: 'none' }}>
          {calls.map(c => (
            <div key={c.callTxnId} className="psri-side-result-item" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>
                  {c.direction === 'inbound' ? '↙' : '↗'} {c.phone || 'Unknown number'}
                </strong>
                <span className="cp-hint" style={{ margin: 0 }}>{fmtWhen(c.startedAt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                <span className="psri-badge">{statusLabel(c)}</span>
                <span className="cp-hint" style={{ margin: 0 }}>Duration: {fmtDuration(c.durationSeconds)}</span>
                {c.agentEmail && <span className="cp-hint" style={{ margin: 0 }}>Agent: {c.agentEmail}</span>}
                {c.calledNumber && <span className="cp-hint" style={{ margin: 0 }}>DID: {c.calledNumber}</span>}
              </div>
              {c.recordingUrl && (
                <div style={{ marginTop: 6 }}>
                  <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="psri-btn-ghost">▶ Recording</a>
                </div>
              )}
              {c.case && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {c.case.callFor && <span className="psri-badge">{c.case.callFor}</span>}
                    {c.case.status && <span className="psri-badge">{c.case.status}</span>}
                  </div>
                  {c.case.summary && <p className="stg-recent-summary" style={{ marginTop: 4 }}>{c.case.summary}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
