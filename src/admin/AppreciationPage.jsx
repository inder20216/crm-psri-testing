import { useState, useEffect, useCallback } from 'react';
import { psri } from '../api/psri';
import { useAuth } from '../context/AuthContext';
import './Admin.css';

const STATUS_TABS = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: '',         label: 'All' },
];

export default function AppreciationPage() {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState('pending');
  const [cases, setCases]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [reviewingId, setReviewingId] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const refresh = useCallback((s) => {
    setLoading(true);
    setLoadErr('');
    return psri.getAppreciationList(s)
      .then(setCases)
      .catch(() => setLoadErr('Could not load appreciation cases. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(status); }, [status, refresh]);

  const review = async (caseId, approved) => {
    setReviewingId(caseId);
    try {
      await psri.reviewAppreciation({ caseId, approved, reviewedBy: currentUser?.id || '' });
      showToast(approved ? 'Appreciation approved' : 'Appreciation rejected');
      await refresh(status);
    } catch (err) {
      showToast(err.message || 'Could not save review. Please try again.');
    } finally {
      setReviewingId('');
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-top">
        <div>
          <h1 className="admin-title">Appreciation Review</h1>
          <p className="admin-subtitle">Audit the call recording behind each "Appreciation Received" case and approve or reject it.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {STATUS_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={status === t.value ? 'admin-btn-primary' : 'admin-btn-ghost'}
            style={{ fontSize: 13 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadErr && <div className="admin-err-banner">{loadErr}</div>}

      {loading ? (
        <div className="admin-table-loading">Loading…</div>
      ) : cases.length === 0 ? (
        <div className="admin-table-wrap" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
          No {status || ''} appreciation cases.
        </div>
      ) : (
        cases.map(c => (
          <div key={c.id} className="admin-table-wrap" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.contactName} <span style={{ fontWeight: 400, color: '#64748b' }}>({c.contactMobile})</span></div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  {c.id} &middot; {c.created ? new Date(c.created).toLocaleString('en-IN') : ''} &middot; Assigned to {c.assignedTo || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {c.appreciationApproved === null && <span style={{ color: '#b45309', fontWeight: 700, fontSize: 12 }}>Pending Review</span>}
                {c.appreciationApproved === true && <span style={{ color: '#15803d', fontWeight: 700, fontSize: 12 }}>Approved by {c.appreciationReviewedBy}</span>}
                {c.appreciationApproved === false && <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: 12 }}>Rejected by {c.appreciationReviewedBy}</span>}
                {c.appreciationReviewedAt && (
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(c.appreciationReviewedAt).toLocaleString('en-IN')}</div>
                )}
              </div>
            </div>

            {c.appreciationDetails && (
              <p style={{ margin: '8px 0', fontSize: 13, background: '#f8fafc', padding: '10px 12px', borderRadius: 8 }}>
                {c.appreciationDetails}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              {c.recordingUrl ? (
                <audio controls src={c.recordingUrl} style={{ height: 32, maxWidth: 320 }} />
              ) : (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No call recording linked to this case</span>
              )}
              {c.callDurationSeconds != null && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{Math.round(c.callDurationSeconds / 60)}m {c.callDurationSeconds % 60}s</span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="admin-btn-primary"
                  disabled={reviewingId === c.id}
                  onClick={() => review(c.id, true)}
                  style={{ background: '#15803d' }}
                >
                  Yes, Approve
                </button>
                <button
                  className="admin-btn-danger"
                  disabled={reviewingId === c.id}
                  onClick={() => review(c.id, false)}
                >
                  No, Reject
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      {toast && <div className="admin-toast">{toast}</div>}
    </div>
  );
}
