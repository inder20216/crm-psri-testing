import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { psri } from '../../api/psri';
import { useSparkTG } from '../../context/SparkTGContext';
import './Psri.css';

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function IncompleteCasesPage() {
  const navigate = useNavigate();
  const { setDialerPrefill } = useSparkTG();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadErr('');
    return psri.getCases({ status: 'Incomplete' })
      .then(async (res) => {
        const rows = res.cases || [];

        // Only the (usually few) drafts that actually captured a call get a
        // recording lookup — one lookup per row, in parallel.
        await Promise.all(rows.map(async (c) => {
          if (!c.callTxnId) { c.recordingUrl = ''; return; }
          try {
            const logs = await psri.getCallLogs({ callTxnId: c.callTxnId, limit: 1 });
            c.recordingUrl = (logs && logs[0] && logs[0].recordingUrl) || '';
          } catch {
            c.recordingUrl = '';
          }
        }));

        setCases(rows);
      })
      .catch(() => setLoadErr('Could not load incomplete cases. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resume = (c) => {
    setDialerPrefill({ resumeCase: c });
    navigate('/psri/cases');
  };

  return (
    <div className="psri-page">
      <div className="psri-page-head">
        <div>
          <h1 className="psri-title">Incomplete Cases</h1>
          <p className="psri-subtitle">PSRI Hospital — Saved half-way, waiting to be finished</p>
        </div>
        <button type="button" className="psri-btn-ghost" onClick={refresh}>↻ Refresh</button>
      </div>

      {loadErr && <div className="psri-err-banner">{loadErr}</div>}

      {loading && <div className="psri-empty">Loading…</div>}
      {!loading && !loadErr && cases.length === 0 && (
        <div className="psri-empty">Nothing incomplete right now — every started case has been finished.</div>
      )}

      {!loading && cases.length > 0 && (
        <div className="psri-side-results" style={{ maxHeight: 'none' }}>
          {cases.map(c => (
            <div key={c.id} className="psri-side-result-item" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{c.contactName || 'Unknown Contact'}</strong>
                <span className="cp-hint" style={{ margin: 0 }}>{fmtWhen(c.created)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                {c.contactMobile && <span className="cp-hint" style={{ margin: 0 }}>{c.contactMobile}</span>}
                {c.channel && <span className="psri-badge">{c.channel}</span>}
                {c.callFor && <span className="psri-badge">{c.callFor}</span>}
              </div>
              {c.summary && <p className="stg-recent-summary" style={{ marginTop: 6 }}>{c.summary}</p>}
              {c.callTxnId && (
                <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="cp-hint" style={{ margin: 0 }}>Txn ID: {c.callTxnId}</span>
                  {c.recordingUrl && (
                    <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="psri-btn-ghost">▶ Recording</a>
                  )}
                </div>
              )}
              <div className="stg-dialer-actions" style={{ marginTop: 8 }}>
                <button type="button" className="psri-btn-primary" onClick={() => resume(c)}>Resume</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
