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

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PicklistSuggestionsPage() {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState('pending');
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [reviewingId, setReviewingId] = useState(0);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const refresh = useCallback((s) => {
    setLoading(true);
    setLoadErr('');
    return psri.getPicklistSuggestions(s)
      .then(setItems)
      .catch(() => setLoadErr('Could not load suggestions. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(status); }, [status, refresh]);

  const review = async (item, approved) => {
    setReviewingId(item.id);
    try {
      const res = await psri.reviewPicklistSuggestion({
        id: item.id, approved,
        reviewerId: currentUser?.id || '', reviewerName: currentUser?.name || '',
      });
      showToast(res.warning ? res.warning : (approved ? 'Approved — now live in the picklist' : 'Rejected'));
      await refresh(status);
    } catch (err) {
      showToast(err.message || 'Could not save review. Please try again.');
    } finally {
      setReviewingId(0);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-top">
        <div>
          <h1 className="admin-title">Picklist Suggestions</h1>
          <p className="admin-subtitle">New values agents proposed from the Cases form (currently Name of Procedure) — approve to make them selectable for everyone, or reject.</p>
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
      ) : items.length === 0 ? (
        <div className="admin-table-wrap" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
          No {status || ''} suggestions.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>List</th>
                <th>Suggested Value</th>
                <th>Suggested By</th>
                <th>When</th>
                <th>Status</th>
                {status === 'pending' && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{it.listName}</td>
                  <td style={{ fontWeight: 700 }}>{it.value}</td>
                  <td>{it.suggestedByName || it.suggestedBy || '—'}</td>
                  <td>{fmtWhen(it.created)}</td>
                  <td>
                    {it.status === 'pending' && <span style={{ color: '#b45309', fontWeight: 700 }}>Pending</span>}
                    {it.status === 'approved' && <span style={{ color: '#15803d', fontWeight: 700 }}>Approved by {it.reviewedByName}</span>}
                    {it.status === 'rejected' && <span style={{ color: '#b91c1c', fontWeight: 700 }}>Rejected by {it.reviewedByName}</span>}
                  </td>
                  {status === 'pending' && (
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="admin-btn-primary" style={{ background: '#15803d', fontSize: 12, padding: '6px 10px' }} disabled={reviewingId === it.id} onClick={() => review(it, true)}>Approve</button>
                        <button className="admin-btn-danger" style={{ fontSize: 12, padding: '6px 10px' }} disabled={reviewingId === it.id} onClick={() => review(it, false)}>Reject</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="admin-toast">{toast}</div>}
    </div>
  );
}
