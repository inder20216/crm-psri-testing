import { useState, useEffect, useCallback } from 'react';
import { usePicklists } from '../../context/PicklistsContext';
import { useUsers } from '../../context/UsersContext';
import { useAuth } from '../../context/AuthContext';
import { useSparkTG } from '../../context/SparkTGContext';
import { psri } from '../../api/psri';
import './Psri.css';

const FIELD_LABELS = {
  call_status: 'Call Status',
  lead_status: 'Lead Status',
  final_status: 'Final Status',
  next_call_at: 'Next Call',
  remarks: 'Remarks',
  assigned_to: 'Assigned To',
};

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

// Converts a stored MySQL datetime/timestamp into the value a
// <input type="datetime-local"> needs, and back again.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeActivity(a) {
  switch (a.action) {
    case 'call_attempt': return `${a.agentName || 'Agent'} placed a call`;
    case 'created': return 'Prospect created from a new enquiry';
    case 'linked': return 'Another enquiry linked to this prospect';
    case 'auto_converted': return a.note || 'Lead converted';
    case 'status_change': {
      const label = FIELD_LABELS[a.fieldChanged] || a.fieldChanged;
      return `${a.agentName || 'Agent'} changed ${label}: "${a.oldValue || '—'}" → "${a.newValue || '—'}"`;
    }
    default: return a.note || a.action || 'Updated';
  }
}

const emptyEdit = { callStatus: '', leadStatus: '', finalStatus: '', nextCallAt: '', remarks: '', assignedTo: '' };

export default function ProspectsPage() {
  const { getList } = usePicklists();
  const { users } = useUsers();
  const { currentUser, isAdmin } = useAuth();
  const { dial, hasWidget } = useSparkTG();

  const [prospects, setProspects] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState('');
  const [selected, setSelected]   = useState(null);
  const [edit, setEdit]           = useState(emptyEdit);
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');
  const [toast, setToast]         = useState('');
  const [activity, setActivity]         = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadErr('');
    return psri.getProspects('Followup')
      .then(setProspects)
      .catch(() => setLoadErr('Could not load prospects. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const select = (p) => {
    setSelected(p);
    setEdit({
      callStatus: p.callStatus || '',
      leadStatus: p.leadStatus || '',
      finalStatus: p.finalStatus || '',
      nextCallAt: toLocalInput(p.nextCallAt),
      remarks: p.remarks || '',
      assignedTo: p.assignedTo || '',
    });
    setSaveErr('');
    setActivityOpen(false);
    setActivity([]);
  };

  const loadActivity = (prospectId) => {
    setActivityLoading(true);
    psri.getProspectActivity(prospectId)
      .then(setActivity)
      .finally(() => setActivityLoading(false));
  };

  const toggleActivity = () => {
    if (!activityOpen && selected) loadActivity(selected.id);
    setActivityOpen(o => !o);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveErr('');
    try {
      await psri.updateProspect({
        id: selected.id,
        agentId: currentUser?.id || '',
        agentName: currentUser?.name || '',
        callStatus: edit.callStatus,
        leadStatus: edit.leadStatus,
        finalStatus: edit.finalStatus,
        nextCallAt: edit.nextCallAt ? edit.nextCallAt.replace('T', ' ') + ':00' : '',
        remarks: edit.remarks,
        assignedTo: isAdmin ? edit.assignedTo : selected.assignedTo,
      });
      showToast('Prospect updated');
      await refresh();
      if (activityOpen) loadActivity(selected.id);
    } catch (err) {
      setSaveErr(err.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCall = (p) => {
    dial(p.contactMobile);
    psri.recordProspectCallAttempt({ id: p.id, agentId: currentUser?.id || '', agentName: currentUser?.name || '' });
  };

  return (
    <div className="psri-page">
      {toast && <div className="psri-toast">{toast}</div>}

      <div className="psri-top">
        <div>
          <h1 className="psri-title">Prospects</h1>
          <p className="psri-subtitle">PSRI Hospital — Unconverted Enquiries</p>
        </div>
        <span className="psri-count">{prospects.length} prospect{prospects.length !== 1 ? 's' : ''}</span>
      </div>

      {loadErr && <div className="psri-err-banner">{loadErr}</div>}

      <div className="psri-layout">
        <div className="psri-list">
          {loading && <div className="psri-empty">Loading prospects…</div>}
          {!loading && !loadErr && prospects.length === 0 && (
            <div className="psri-empty">No open prospects right now — every enquiry has been converted or closed out.</div>
          )}
          {!loading && prospects.map(p => (
            <div key={p.id} className={`psri-contact-card ${selected?.id === p.id ? 'active' : ''}`} onClick={() => select(p)}>
              <div className="psri-avatar">{(p.contactName || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}</div>
              <div className="psri-contact-main">
                <div className="psri-contact-name">{p.contactName || 'Unknown Contact'}</div>
                <div className="psri-contact-meta">
                  <span>{p.contactMobile}</span>
                  {p.leadStatus && <span className="psri-badge">{p.leadStatus}</span>}
                  {p.attempts > 0 && <span className="psri-badge">{p.attempts} attempt{p.attempts !== 1 ? 's' : ''}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="psri-detail">
          {!selected ? (
            <div className="psri-detail-empty">
              <div className="psri-detail-empty-icon">🗂️</div>
              <p>Select a prospect to view and work the lead</p>
            </div>
          ) : (
            <div className="psri-detail-card">
              {saveErr && <div className="psri-err-banner">{saveErr}</div>}
              <div className="psri-detail-head">
                <div className="psri-avatar lg">{(selected.contactName || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}</div>
                <div>
                  <div className="psri-detail-name">{selected.contactName || 'Unknown Contact'}</div>
                  <span className="psri-badge">{selected.finalStatus || 'Followup'}</span>
                </div>
                {hasWidget && selected.contactMobile && (
                  <button className="psri-btn-primary" onClick={() => handleCall(selected)}>📞 Call</button>
                )}
              </div>

              <div className="psri-detail-grid">
                <div className="psri-detail-item"><span>Mobile</span><strong>{selected.contactMobile || '—'}</strong></div>
                <div className="psri-detail-item"><span>Enquiries</span><strong>{selected.enquiryCount || 0}{selected.enquiryTypes ? ` — ${selected.enquiryTypes}` : ''}</strong></div>
                <div className="psri-detail-item"><span>First Call Date</span><strong>{fmtDate(selected.firstCallDate)}</strong></div>
                <div className="psri-detail-item"><span>Attempts</span><strong>{selected.attempts || 0}</strong></div>
                <div className="psri-detail-item"><span>Last Call</span><strong>{fmtWhen(selected.lastCallAt)}</strong></div>
              </div>

              <div className="psri-form" style={{ marginTop: 4 }}>
                <div className="psri-form-row">
                  <div className="psri-field">
                    <label>Call Status</label>
                    <select value={edit.callStatus} onChange={e => setEdit(f => ({ ...f, callStatus: e.target.value }))}>
                      <option value="">— Select —</option>
                      {getList('Call Status').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="psri-field">
                    <label>Lead Status</label>
                    <select value={edit.leadStatus} onChange={e => setEdit(f => ({ ...f, leadStatus: e.target.value }))}>
                      <option value="">— Select —</option>
                      {getList('Lead Status').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="psri-field">
                    <label>Final Status</label>
                    <select value={edit.finalStatus} onChange={e => setEdit(f => ({ ...f, finalStatus: e.target.value }))}>
                      {getList('Final Status').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div className="psri-form-row">
                  <div className="psri-field">
                    <label>Next Call Date &amp; Time</label>
                    <input type="datetime-local" value={edit.nextCallAt} onChange={e => setEdit(f => ({ ...f, nextCallAt: e.target.value }))} />
                  </div>
                  {isAdmin && (
                    <div className="psri-field">
                      <label>Assigned To</label>
                      <select value={edit.assignedTo} onChange={e => setEdit(f => ({ ...f, assignedTo: e.target.value }))}>
                        <option value="">— Unassigned —</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="psri-field">
                  <label>Remarks</label>
                  <textarea rows={3} value={edit.remarks} onChange={e => setEdit(f => ({ ...f, remarks: e.target.value }))} placeholder="Notes on this lead — why it hasn't converted, what to try next…" />
                </div>
              </div>

              <div className="psri-form-actions-sticky">
                <button type="button" className="psri-btn-ghost" onClick={toggleActivity}>
                  {activityOpen ? 'Hide History' : '🕘 View History'}
                </button>
                <button type="button" className="psri-btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>

              {activityOpen && (
                <div className="psri-side-card" style={{ marginTop: 16 }}>
                  <div className="psri-side-card-title">Activity Log</div>
                  {activityLoading && <p className="cp-hint">Loading…</p>}
                  {!activityLoading && activity.length === 0 && <p className="cp-hint">No activity recorded yet.</p>}
                  {!activityLoading && activity.length > 0 && (
                    <div className="psri-side-results">
                      {activity.map(a => (
                        <div key={a.id} className="psri-side-result-item" style={{ cursor: 'default' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{describeActivity(a)}</span>
                            <span className="cp-hint" style={{ margin: 0 }}>{fmtWhen(a.created)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
