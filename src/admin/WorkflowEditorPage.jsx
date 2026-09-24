import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType,
  applyEdgeChanges, applyNodeChanges, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { psri } from '../api/psri';
import { useAuth } from '../context/AuthContext';
import { fromConfig, getDef, isConditionLike, newNode, severityBlocks, toConfig, validateGraph } from './workflow/schema';
import { nodeTypes } from './workflow/nodes';
import { NEW_CASE_TEMPLATE_KEY, NEW_CONTACT_TEMPLATE_KEY, buildNewCaseTemplate, buildNewContactTemplate } from './workflow/templates';
import { triggerKeyFor } from './workflow/schema';
import Palette from './workflow/Palette';
import PropertyPanel from './workflow/PropertyPanel';
import './Admin.css';
import './Workflow.css';

function RunRow({ status }) {
  const ok = status === 'ok';
  return (
    <span className={`wf-run-status ${ok ? 'ok' : 'err'}`}>{ok ? '✓' : '✕'} {status}</span>
  );
}

function RunHistory({ workflowId }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!workflowId) { setRuns([]); return; }
    setLoading(true); setError('');
    psri.getWorkflowRuns({ id: workflowId, limit: 40 })
      .then(r => setRuns(Array.isArray(r) ? r : []))
      .catch(() => { setError('Could not load run history.'); setRuns([]); })
      .finally(() => setLoading(false));
  }, [workflowId]);

  useEffect(load, [load]);

  return (
    <div className="wf-history">
      <div className="wf-history-top">
        <span>Recent runs</span>
        <button type="button" className="wf-btn-ghost-sm" onClick={load} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
      </div>
      {error && <div className="wf-history-empty">{error}</div>}
      {!loading && !error && runs.length === 0 && (
        <div className="wf-history-empty">No runs yet. Runs appear here once the workflow executes.</div>
      )}
      {runs.length > 0 && (
        <table className="wf-run-table">
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id || i}>
                <td className="wf-run-ok"><RunRow status={r.status} /></td>
                <td className="wf-run-when">{r.at || '—'}</td>
                <td className="wf-run-action">{r.actionLabel || r.action || '—'}</td>
                <td className="wf-run-contact">{r.contactName || r.contactId || '—'}</td>
                {r.error && <td className="wf-run-err" title={r.error}>{r.error}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function WorkflowEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useAuth();
  const isNew = id === 'new';
  const workflowId = isNew ? null : id;
  const templateKey = isNew ? searchParams.get('template') : null;

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const [name, setName] = useState('');
  const [status, setStatus] = useState('Draft');
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [issues, setIssues] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [toast, setToast] = useState('');
  const [panelTab, setPanelTab] = useState('configure');

  const flowRef = useRef(null);
  const workspaceRef = useRef(null);
  const edgesRef = useRef([]);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const onNodesChange = useCallback(ch => {
    setNodes(nds => applyNodeChanges(ch, nds));
    setDirty(true);
  }, []);
  const onEdgesChange = useCallback(ch => {
    setEdges(eds => applyEdgeChanges(ch, eds));
    setDirty(true);
  }, []);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const onConnect = useCallback((params) => {
    const src = nodes.find(n => n.id === params.source);
    const edge = {
      ...params,
      type: 'smoothstep',
      label: '',
      style: {},
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    };
    if (isConditionLike(src)) {
      edge.label = params.sourceHandle === 'true' ? 'True' : params.sourceHandle === 'false' ? 'False' : '';
      edge.style = params.sourceHandle === 'false' ? { strokeDasharray: '6 4', stroke: '#94a3b8' } : {};
    }
    setEdges(eds => addEdge(edge, eds));
    setDirty(true);
  }, [nodes]);

  const isValidConnection = useCallback((conn) => {
    if (conn.source === conn.target) return false;
    if (conn.sourceHandle === null || conn.sourceHandle === undefined) return false;
    const dup = edgesRef.current.some(e =>
      e.source === conn.source && e.target === conn.target &&
      (e.sourceHandle || null) === (conn.sourceHandle || null)
    );
    if (dup) return false;
    return true;
  }, []);

  const handleAdd = useCallback((actionType) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    let pos = { x: 340, y: 160 };
    if (flowRef.current && rect) {
      pos = flowRef.current.screenToFlowPosition({ x: rect.x + rect.width * 0.42, y: rect.y + rect.height * 0.45 });
    }
    const order = nodes.length;
    const node = newNode(actionType, { x: Math.round(pos.x) + (order % 5) * 16, y: Math.round(pos.y) + (order % 4) * 16 });
    setNodes(nds => [...nds, node]);
    setSelectedId(node.id);
    setIssues(null);
    setDirty(true);
  }, [nodes.length]);

  const patchSelected = useCallback((configPatch) => {
    setNodes(nds => nds.map(n => n.id === selectedId ? { ...n, data: { ...n.data, config: configPatch } } : n));
    setIssues(null);
    setDirty(true);
  }, [selectedId]);

  const removeSelected = useCallback(() => {
    setNodes(nds => nds.filter(n => n.id !== selectedId));
    setEdges(eds => eds.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    setIssues(null);
    setDirty(true);
  }, [selectedId]);

  const runValidate = useCallback(() => {
    const iss = validateGraph(nodes, edges);
    setIssues(iss);
    const errIds = new Set(iss.filter(i => i.nodeId).map(i => i.nodeId));
    setNodes(nds => nds.map(n => errIds.has(n.id) ? { ...n, className: 'wf-invalid' } : { ...n, className: undefined }));
    if (iss.length === 0) showToast('All checks passed.');
    return iss;
  }, [nodes, edges]);

  const handleSave = useCallback(async () => {
    const iss = status === 'Active' ? runValidate() : [];
    if (status === 'Active' && severityBlocks(iss)) { showToast('Fix the errors before saving as Active.'); return; }
    const trigger = triggerKeyFor(nodes.find(n => n.type === 'trigger')?.data?.actionType) || 'contact-created';
    setSaving(true); setSaveErr('');
    try {
      const res = await psri.saveWorkflow({
        id: isNew ? null : workflowId,
        name: (name || '').trim() || 'Untitled workflow',
        trigger,
        status,
        config: toConfig(nodes, edges),
        updatedBy: currentUser?.name || '',
      });
      setStatus(res.workflow.status);
      setDirty(false);
      setIssues(null);
      if (isNew) navigate(`/admin/workflows/${res.workflow.id}`, { replace: true });
      showToast(status === 'Active' ? 'Workflow activated and saved.' : 'Saved as draft.');
    } catch (e) {
      setSaveErr(e.message || 'Could not save workflow. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [status, name, nodes, edges, isNew, workflowId, currentUser, navigate, runValidate]);

  useEffect(() => {
    if (isNew) {
    if (templateKey === NEW_CONTACT_TEMPLATE_KEY) {
      const { nodes: nds, edges: eds } = buildNewContactTemplate(currentUser?.id);
      setNodes(nds);
      setEdges(eds);
      setName('New Contact Onboarding');
    } else if (templateKey === NEW_CASE_TEMPLATE_KEY) {
      const { nodes: nds, edges: eds } = buildNewCaseTemplate(currentUser?.id);
      setNodes(nds);
      setEdges(eds);
      setName('New Case Onboarding');
    } else {
        const seed = newNode('contactCreated', { x: 80, y: 140 });
        setNodes([seed]);
        setEdges([]);
        setName('New Workflow');
      }
      setStatus('Draft');
      setLoading(false);
      return;
    }
    psri.getWorkflows()
      .then(list => {
        const wf = (list || []).find(w => w.id === workflowId);
        if (!wf) { setLoadErr('Workflow not found — it may have been removed.'); return; }
        setName(wf.name || '');
        setStatus(wf.status || 'Draft');
        const { nodes: nds, edges: eds } = fromConfig(wf.config);
        setNodes(nds);
        setEdges(eds);
      })
      .catch(() => setLoadErr('Could not load workflow. Please try again.'))
      .finally(() => setLoading(false));
  }, [isNew, workflowId, templateKey, currentUser]);

  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const selectedNode = nodes.find(n => n.id === selectedId) || null;
  const triggerCount = nodes.filter(n => getDef(n.data.actionType).kind === 'trigger').length;

  return (
    <div className="admin-page wf-editor-page">
      {toast && <div className="admin-toast">{toast}</div>}

      <div className="wf-toolbar">
        <Link to="/admin/workflows" className="wf-btn-back">← Workflows</Link>
        <input
          className="wf-name-input"
          value={name}
          onChange={e => { setName(e.target.value); setDirty(true); }}
          placeholder="Workflow name"
          disabled={loading}
        />
        <div className="wf-status-seg" role="group" aria-label="Status">
          <button
            type="button"
            className={`wf-seg ${status === 'Draft' ? 'on draft' : ''}`}
            onClick={() => { setStatus('Draft'); setDirty(true); }}
            disabled={loading}
          >Draft</button>
          <button
            type="button"
            className={`wf-seg ${status === 'Active' ? 'on active' : ''}`}
            onClick={() => { setStatus('Active'); setDirty(true); }}
            disabled={loading}
          >Active</button>
        </div>
        <button type="button" className="wf-btn-ghost" onClick={runValidate} disabled={loading}>Validate</button>
        <button type="button" className="wf-btn-primary" onClick={handleSave} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {dirty && <span className="wf-dirty-dot" title="Unsaved changes">●</span>}
      </div>

      {saveErr && <div className="admin-err-banner">{saveErr}</div>}
      {loadErr && <div className="admin-err-banner">{loadErr}</div>}

      {issues && issues.length > 0 && (
        <div className={`wf-issues ${severityBlocks(issues) ? 'has-errors' : ''}`}>
          {issues.map((i, idx) => (
            <button
              key={idx}
              type="button"
              className={`wf-issue ${i.severity}`}
              onClick={() => { if (i.nodeId) { setSelectedId(i.nodeId); } }}
            >
              <span>{i.severity === 'error' ? '✕' : '⚠'}</span> {i.message}
            </button>
          ))}
        </div>
      )}

      <div className="wf-workspace" ref={workspaceRef}>
        <Palette onAdd={handleAdd} />

        <div className="wf-canvas">
          {loading && <div className="wf-loading">Loading workflow…</div>}
          {!loading && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onInit={inst => { flowRef.current = inst; }}
              onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id || null)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} color="#dbe2ea" />
              <Controls position="bottom-left" showInteractive={false} />
              <MiniMap
                style={{ width: 140, height: 90 }}
                position="bottom-right"
                pannable
                zoomable
                nodeColor={n => (getDef(n.data?.actionType).color) || '#94a3b8'}
                maskColor="rgba(15, 23, 42, 0.12)"
              />
            </ReactFlow>
          )}
        </div>

        <div className="wf-right-col">
          <div className="wf-tabs">
            <button type="button" className={`wf-tab ${panelTab === 'configure' ? 'on' : ''}`} onClick={() => setPanelTab('configure')}>Configure</button>
            <button type="button" className={`wf-tab ${panelTab === 'history' ? 'on' : ''}`} onClick={() => setPanelTab('history')}>History</button>
          </div>
          {panelTab === 'configure' ? (
            <PropertyPanel node={selectedNode} onPatch={patchSelected} onRemove={removeSelected} />
          ) : (
            <RunHistory workflowId={workflowId} />
          )}
        </div>
      </div>

      {!loading && triggerCount === 0 && !loadErr && (
        <div className="wf-tip"><strong>Tip:</strong> add the “Contact Created” trigger from the palette, then drag from its right edge to the next node.</div>
      )}
    </div>
  );
}