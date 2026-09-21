import { useState, useEffect, useCallback, useMemo } from 'react';
import { psri } from '../../api/psri';
import { useUsers } from '../../context/UsersContext';
import { useAuth } from '../../context/AuthContext';
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

// Same country-code stripping SparkTGContext uses on the way in — the
// webhook can hand back a number as +9198…, 9198…, or bare 10-digit, and
// none of those should fail to match the agent's own stored 10-digit number.
function normalizePhone(raw) {
  if (!raw) return '';
  const s = String(raw).replace(/[\s\-()]/g, '');
  if (/^\+91(\d{10})$/.test(s)) return s.slice(3);
  if (/^91(\d{10})$/.test(s))   return s.slice(2);
  if (/^0(\d{10})$/.test(s))    return s.slice(1);
  return s;
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const toInputDate = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const RANGE_OPTIONS = [
  { value: 'all',       label: 'All Time' },
  { value: 'today',     label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7',     label: 'Last 7 Days' },
  { value: 'thisMonth', label: 'Current Month' },
  { value: 'custom',    label: 'Custom Range' },
];

// The backend only understands "give me the last N days" (no arbitrary
// from/to), so every preset below resolves to an exact [start, end]
// boundary for precise client-side filtering, plus a days-back count wide
// enough for the server fetch to actually contain that boundary. 'all'
// omits daysBack entirely so the server applies no day restriction at all
// (just its own row limit).
function resolveRange(rangeType, customFrom, customTo) {
  const now = new Date();
  if (rangeType === 'all') {
    return { start: new Date(0), end: endOfDay(now), daysBack: undefined };
  }
  if (rangeType === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { start: startOfDay(y), end: endOfDay(y), daysBack: 2 };
  }
  if (rangeType === 'last7') {
    const s = new Date(now); s.setDate(s.getDate() - 6);
    return { start: startOfDay(s), end: endOfDay(now), daysBack: 7 };
  }
  if (rangeType === 'thisMonth') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: startOfDay(s), end: endOfDay(now), daysBack: now.getDate() };
  }
  if (rangeType === 'custom') {
    let s = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(now);
    let e = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
    if (e < s) { const t = s; s = e; e = t; }
    const daysBack = Math.min(400, Math.max(1, Math.ceil((endOfDay(now) - s) / 86400000) + 1));
    return { start: s, end: e, daysBack };
  }
  // 'today' and fallback
  return { start: startOfDay(now), end: endOfDay(now), daysBack: 1 };
}

export default function CallLogsPage() {
  const { users } = useUsers();
  const { currentUser, isAdmin } = useAuth();
  const [query, setQuery] = useState('');
  const [rangeType, setRangeType] = useState('all');
  const [customFrom, setCustomFrom] = useState(toInputDate(new Date()));
  const [customTo, setCustomTo] = useState(toInputDate(new Date()));
  const [scope, setScope] = useState('all'); // 'mine' | 'all' — only agents with admin rights can switch this; non-admins are always 'mine'
  const [callType, setCallType] = useState('all'); // 'all' | 'inbound' | 'outbound'
  const [dispositionFilter, setDispositionFilter] = useState('all');
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const nameByNumber = useMemo(() => buildAgentNumberMap(users), [users]);
  const agentLabel = (c) => resolveAgentLabel(c, nameByNumber);

  const { start, end, daysBack } = useMemo(
    () => resolveRange(rangeType, customFrom, customTo),
    [rangeType, customFrom, customTo]
  );

  // A call belongs to the signed-in agent if it was logged under their email
  // (browser-capture path) or their own phone/extension (SparkTG webhook
  // path) — the two capture paths don't share a common field, so both are
  // checked rather than relying on the display-label resolution above.
  const isMine = useCallback((c) => {
    if (!currentUser) return false;
    if (c.agentEmail) return c.agentEmail.toLowerCase() === (currentUser.email || '').toLowerCase();
    if (c.agentNumber) {
      return normalizePhone(c.agentNumber) === normalizePhone(currentUser.contact) || c.agentNumber === currentUser.sparktgExtension;
    }
    return false;
  }, [currentUser]);

  const refresh = useCallback((daysParam) => {
    setLoading(true);
    setLoadErr('');
    return psri.getCallLogs({ days: daysParam, limit: 5000 })
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

  useEffect(() => { refresh(daysBack); }, [daysBack, refresh]);

  // Built from whatever's actually in the loaded rows rather than a fixed
  // list — SparkTG's disposition vocabulary isn't fixed (Queue Missed, IVR
  // Missed, Agent Missed, NoAnswer, ... today, possibly more tomorrow), so
  // hardcoding the option list here would just be the same stale-list bug
  // as the answered/missed classifier, one layer up.
  const dispositionOptions = useMemo(() => {
    const seen = new Set();
    calls.forEach(c => { if (c.disposition) seen.add(c.disposition); });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [calls]);

  // A selected disposition value can disappear from the loaded rows after a
  // refresh or date-range change (e.g. no "Queue Missed" calls in the new
  // range) — rather than silently filtering everything out, treat a
  // selection that's no longer a real option as "all".
  const effectiveDispositionFilter = dispositionOptions.includes(dispositionFilter) ? dispositionFilter : 'all';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter(c => {
      const started = c.startedAt ? new Date(c.startedAt) : null;
      if (!started || started < start || started > end) return false;
      if (!isAdmin || scope === 'mine') { if (!isMine(c)) return false; }
      if (callType !== 'all' && c.direction !== callType) return false;
      if (effectiveDispositionFilter !== 'all' && c.disposition !== effectiveDispositionFilter) return false;
      if (!q) return true;
      return (
        (c.phone || '').includes(q) ||
        (c.contactName || '').toLowerCase().includes(q) ||
        agentLabel(c).toLowerCase().includes(q) ||
        statusLabel(c).toLowerCase().includes(q)
      );
    });
  }, [calls, start, end, query, scope, isAdmin, isMine, callType, effectiveDispositionFilter, nameByNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="psri-page">
      <div className="psri-page-head">
        <div>
          <h1 className="psri-title">Call Logs</h1>
          <p className="psri-subtitle">
            {isAdmin && scope === 'all' ? 'PSRI Hospital — Full Call History' : 'Your Call History'}
          </p>
        </div>
      </div>

      {loadErr && <div className="psri-err-banner">{loadErr}</div>}

      <div className="psri-search-row" style={{ flexWrap: 'wrap', rowGap: 10 }}>
        <input
          className="psri-search-input"
          type="text"
          placeholder="Search by phone, agent, or outcome…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select
          value={rangeType}
          onChange={e => setRangeType(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--psri-border)', fontSize: 13, fontWeight: 600 }}
        >
          {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {rangeType === 'custom' && (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--psri-border)', fontSize: 13 }} />
            <span className="cp-hint">to</span>
            <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--psri-border)', fontSize: 13 }} />
          </>
        )}
        {isAdmin && (
          <select
            value={scope}
            onChange={e => setScope(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--psri-border)', fontSize: 13, fontWeight: 600 }}
          >
            <option value="mine">My Calls</option>
            <option value="all">All Agents</option>
          </select>
        )}
        <select
          value={callType}
          onChange={e => setCallType(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--psri-border)', fontSize: 13, fontWeight: 600 }}
        >
          <option value="all">All Call Types</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <select
          value={effectiveDispositionFilter}
          onChange={e => setDispositionFilter(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--psri-border)', fontSize: 13, fontWeight: 600 }}
        >
          <option value="all">All Dispositions</option>
          {dispositionOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="button" className="psri-btn-ghost" onClick={() => refresh(daysBack)}>↻ Refresh</button>
        <span className="psri-count">{visible.length} call{visible.length !== 1 ? 's' : ''}</span>
      </div>

      {loading && <div className="psri-empty">Loading…</div>}
      {!loading && !loadErr && visible.length === 0 && (
        <div className="psri-empty">No calls found for this range. Try a different search or date range.</div>
      )}

      {!loading && visible.length > 0 && (
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
              {visible.map(c => (
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
