import { useState, useEffect, useCallback } from 'react';
import { psri } from '../../api/psri';
import { useSparkTG } from '../../context/SparkTGContext';
import './Psri.css';

const STAGE_LABEL = { 1: 'Missed', 2: '2nd Attempt', 3: '3rd Attempt' };

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
          <span className="psri-badge">{c.callFor || c.call_for || '—'}</span>{' '}
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

function MissedCallsPanel() {
  const [stage, setStage] = useState(1);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const { dial } = useSparkTG();

  const refresh = useCallback(() => {
    setLoading(true);
    psri.getMissedCalls().then(rows => setCalls(rows)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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

  return (
    <>
      <button
        className={`dr-lookup-toggle-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Missed Calls"
        style={{ right: 112 }}
      >
        ☎️
      </button>

      {open && (
        <div className="dr-lookup-panel" style={{ right: 410 }}>
          <div className="dr-lookup-header">
            <span className="dr-lookup-header-title">☎️ Missed Calls</span>
            <button className="dr-lookup-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="dr-lookup-body">
            <MissedCallsPanel />
          </div>
        </div>
      )}
    </>
  );
}
