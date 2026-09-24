import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { psri } from '../api/psri';
import { fromConfig, validateGraph } from './workflow/schema';
import { useAuth } from '../context/AuthContext';
import './Admin.css';
import './Workflow.css';

const TRIGGER = { 'contact-created': 'Contact Created', 'case-created': 'Case Created' };

export default function WorkflowsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const refresh = useCallback(() => {
    setLoading(true); setError('');
    return psri.getWorkflows()
      .then(list => setWorkflows(list || []))
      .catch(() => setError('Could not load workflows. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleStatus = async (wf) => {
    const next = wf.status === 'Active' ? 'Draft' : 'Active';
    if (next === 'Active') {
      const { nodes, edges } = fromConfig(wf.config);
      const issues = validateGraph(nodes, edges).filter(i => i.severity === 'error');
      if (issues.length > 0) {
        setSaveErr('This workflow has issues that must be fixed before it can run. Open it in the editor.');
        return;
      }
    }
    setBusyId(wf.id); setSaveErr('');
    try {
      await psri.saveWorkflow({ ...wf, status: next, updatedBy: currentUser?.name || '' });
      showToast(next === 'Active' ? `${wf.name} is now Active.` : `${wf.name} set to Draft.`);
      refresh();
    } catch (e) {
      setSaveErr(e.message || 'Could not update workflow status.');
    } finally {
      setBusyId(null);
    }
  };

  const nodeCount = (wf) => {
    try { return (fromConfig(wf.config) || { nodes: [] }).nodes.length; } catch { return '—'; }
  };

  return (
    <div className="admin-page wf-list-page">
      {toast && <div className="admin-toast">{toast}</div>}

      <div className="admin-top">
        <div>
          <h1 className="admin-title">Workflows</h1>
          <p className="admin-subtitle">Automations that run when a new contact or a new case is created — designed on the canvas, executed by the automation runner.</p>
        </div>
        <button className="admin-btn-primary" onClick={() => navigate('/admin/workflows/new')}>+ New Workflow</button>
      </div>

      <div className="admin-top-actions">
        <button onClick={() => navigate('/admin/workflows/new?template=new-contact')}>+ New Contact Workflow</button>
        <button onClick={() => navigate('/admin/workflows/new?template=new-case')}>+ New Case Workflow</button>
      </div>

      {error && <div className="admin-err-banner">{error}</div>}
      {saveErr && <div className="admin-err-banner">{saveErr}</div>}

      <div className="admin-table-wrap">
        {loading && <div className="admin-table-loading">Loading workflows…</div>}
        {!loading && workflows.length === 0 && (
          <div className="wf-empty">
            <div className="wf-empty-icon">🔀</div>
            <p>No workflows yet. Create one to automate what happens when a new contact or a new case is added.</p>
          </div>
        )}
        {!loading && workflows.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Nodes</th>
                <th>Status</th>
                <th>Last updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map(wf => (
                <tr key={wf.id}>
                  <td style={{ fontWeight: 700 }}>{wf.name}</td>
                  <td>{TRIGGER[wf.trigger] || wf.trigger || '—'}</td>
                  <td>{nodeCount(wf)}</td>
                  <td>
                    <span className={`wf-status-badge ${wf.status === 'Active' ? 'active' : 'draft'}`}>
                      {wf.status === 'Active' ? '● Active' : 'Draft'}
                    </span>
                  </td>
                  <td className="wf-muted">{wf.updated || '—'}{wf.updatedBy ? ` · ${wf.updatedBy}` : ''}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button className="admin-btn-ghost" onClick={() => navigate(`/admin/workflows/${wf.id}`)}>Open</button>
                      <button
                        className={wf.status === 'Active' ? 'admin-btn-ghost' : 'admin-btn-primary'}
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => toggleStatus(wf)}
                        disabled={busyId === wf.id}
                      >
                        {busyId === wf.id ? '…' : (wf.status === 'Active' ? 'Deactivate' : 'Activate')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="wf-foot-note">Workflows only run when marked <strong>Active</strong>. Only Super Admins can edit or activate workflows. Drafts never execute.</p>
    </div>
  );
}
