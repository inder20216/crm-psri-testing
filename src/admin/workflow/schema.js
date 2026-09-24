// Workflow designer schema — node definitions, field descriptors, graph
// validation and (de)serialisation for the automation designer.
//
// A workflow is a plain object graph saved as JSON config:
//   { v: 1, nodes: [{ id, type, position, data: { actionType, config } }],
//     edges: [{ id, source, target, sourceHandle, targetHandle }] }
//
// The type palette is intentionally small: every action type maps 1:1 to a
// handler inside the automation engine's interpreter, so a designed graph is
// data an executor can run — this file is the contract both sides share.

export const TEMPLATE_HINT = 'Supports {{contact.field}} — e.g. {{contact.name}}, {{contact.mobile}}; case workflows also {{case.field}} — e.g. {{case.caseId}}, {{case.specialty}}';

// Contact fields the condition / update nodes can reference.
// dbColumn is the column used when writing the value back to a contact.
export const CONTACT_FIELDS = [
  { key: 'name',        label: 'Full Name',       dbColumn: 'full_name' },
  { key: 'salutation',  label: 'Salutation',      dbColumn: 'salutation' },
  { key: 'age',         label: 'Age',             dbColumn: 'age' },
  { key: 'mobile',      label: 'Mobile',          dbColumn: 'mobile' },
  { key: 'altMobile',   label: 'Alt Mobile',      dbColumn: 'alt_mobile' },
  { key: 'landline',    label: 'Landline',        dbColumn: 'landline' },
  { key: 'email',       label: 'Email',           dbColumn: 'email' },
  { key: 'country',     label: 'Country',         dbColumn: 'country' },
  { key: 'state',       label: 'State',           dbColumn: 'state' },
  { key: 'city',        label: 'City',            dbColumn: 'city' },
  { key: 'contactType', label: 'Contact Type',    dbColumn: 'contact_type' },
  { key: 'source',      label: 'Source',          dbColumn: 'source' },
  { key: 'language',    label: 'Language',        dbColumn: 'language' },
  { key: 'assignedTo',  label: 'Assigned To',     dbColumn: 'assigned_to' },
  { key: 'notes',       label: 'Notes',           dbColumn: 'notes' },
  { key: 'subSource',   label: 'Sub Source',      dbColumn: null },
];

// Fields that never exist as a column on the contacts table cannot be written.
export const UPDATABLE_FIELDS = CONTACT_FIELDS.filter(f => f.dbColumn);

// Case fields a condition can branch on (Case Created workflows). The
// "case." prefix tells the runner to read the triggering case, not the contact.
export const CASE_FIELDS = [
  { key: 'case.channel',       label: 'Case · Channel' },
  { key: 'case.typeOfCall',    label: 'Case · Type of Call' },
  { key: 'case.callFor',       label: 'Case · Call For' },
  { key: 'case.typeOfEnquiry', label: 'Case · Type of Enquiry' },
  { key: 'case.queryType',     label: 'Case · Query Type' },
  { key: 'case.priority',      label: 'Case · Priority' },
  { key: 'case.status',        label: 'Case · Status' },
  { key: 'case.specialty',     label: 'Case · Specialty' },
  { key: 'case.doctorName',    label: 'Case · Doctor' },
  { key: 'case.summary',       label: 'Case · Summary' },
];

export const CONDITION_FIELDS = [...CONTACT_FIELDS, ...CASE_FIELDS];

export const OPERATORS = [
  { value: 'eq',          label: 'equals' },
  { value: 'neq',         label: 'does not equal' },
  { value: 'contains',    label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'in',          label: 'is one of (comma separated)' },
  { value: 'empty',       label: 'is empty' },
  { value: 'notEmpty',    label: 'is not empty' },
];

export const OPERATOR_NEEDS_VALUE = op => op !== 'empty' && op !== 'notEmpty';

export const TRIGGER_TRANSLATIONS = {
  'contact-created': { label: 'Contact Created', description: 'A new contact is added to the CRM' },
  'case-created':    { label: 'Case Created',    description: 'A new case (enquiry / appointment) is opened for a contact' },
};

// Maps a trigger node's actionType to the trigger key recorded on the workflow
// (and used by the runner's Trigger= workflow row lookup).
export function triggerKeyFor(actionType) {
  return {
    contactCreated: 'contact-created',
    caseCreated:    'case-created',
  }[actionType] || 'contact-created';
}

// ── Node definitions ────────────────────────────────────────────────────────

const def = (actionType, kind, label, icon, color, description, fields, defaults, summary) =>
  ({ actionType, kind, label, icon, color, description, fields, defaults, summary });

export const NODE_DEFS = {
  contactCreated: def(
    'contactCreated', 'trigger', 'Contact Created', '⚡', '#0d9488',
    'Fires when a new contact is added to the CRM',
    [],
    {},
    () => 'Fires when a new contact is saved',
  ),

  caseCreated: def(
    'caseCreated', 'trigger', 'Case Created', '🔥', '#be123c',
    'Fires when a new case (enquiry / appointment case) is opened',
    [],
    {},
    () => 'Fires when a new case is opened',
  ),

  assign: def(
    'assign', 'action', 'Assign Contact', '👤', '#4338ca',
    'Assigns the new contact to an agent',
    [
      { key: 'assignedTo', label: 'Assign to', type: 'user', required: true },
    ],
    { assignedTo: '' },
    (cfg, { users } = {}) => {
      const u = (users || []).find(x => x.id === cfg.assignedTo);
      return u ? `Assign to ${u.name}` : (cfg.assignedTo ? `Assign to ${cfg.assignedTo}` : 'Not configured');
    },
  ),

  notify: def(
    'notify', 'action', 'Send Notification', '🔔', '#4338ca',
    'Posts a message to a webhook or email address',
    [
      {
        key: 'channel', label: 'Channel', type: 'select', required: true,
        options: [{ value: 'Webhook', label: 'Webhook URL' }, { value: 'Email', label: 'Email' }],
      },
      { key: 'url',      label: 'Webhook URL',    type: 'text',     required: true, showIf: c => c.channel !== 'Email',     placeholder: 'https://hooks.example.com/…' },
      { key: 'message',  label: 'Message',        type: 'textarea', required: true, showIf: c => c.channel !== 'Email',     placeholder: 'New contact: {{contact.name}}, {{contact.mobile}}' },
      { key: 'from',     label: 'From (email)',   type: 'text',                     showIf: c => c.channel === 'Email',     placeholder: 'Optional — blank uses the CRM sender' },
      { key: 'to',       label: 'To',             type: 'text',     required: true, showIf: c => c.channel === 'Email',     placeholder: 'team@example.com or {{contact.email}}' },
      { key: 'subject',  label: 'Subject',        type: 'text',     required: true, showIf: c => c.channel === 'Email',     placeholder: 'New patient contact' },
      { key: 'body',     label: 'Body',           type: 'textarea', required: true, showIf: c => c.channel === 'Email',     placeholder: '{{contact.name}} just registered.\n{{contact.notes}}' },
    ],
    { channel: 'Webhook', url: '', message: '', from: '', to: '', subject: '', body: '' },
    (cfg) => cfg.channel === 'Email'
      ? `Email → ${cfg.to || '…'}`
      : `Webhook → ${cfg.url || '…'}`,
  ),

  createCase: def(
    'createCase', 'action', 'Create Case', '🗂️', '#4338ca',
    'Auto-opens a case linked to the new contact',
    [
      { key: 'channel',       label: 'Channel',          type: 'picklist',  list: 'Channel' },
      { key: 'typeOfCall',    label: 'Type of Call',     type: 'picklist',  list: 'Type of Call', clears: ['callFor'] },
      { key: 'callFor',       label: 'Call For',         type: 'dependent', deps: { mainField: 'Type of Call', subField: 'Call For' },          parentKey: 'typeOfCall',    clears: ['typeOfEnquiry'] },
      { key: 'typeOfEnquiry', label: 'Type of Enquiry',  type: 'dependent', deps: { mainField: 'Call For', subField: 'Type of Enquiry' },       parentKey: 'callFor' },
      { key: 'priority',      label: 'Priority',         type: 'picklist',  list: 'Priority' },
      { key: 'status',        label: 'Status',           type: 'picklist',  list: 'Status' },
      { key: 'summary',       label: 'Case Summary',     type: 'textarea',  required: true, placeholder: 'Auto-opened for {{contact.name}} ({{contact.contactType}})' },
      { key: 'specialty',     label: 'Specialty',        type: 'picklist',  list: 'Specialty', clears: ['doctorName'], hint: 'Only if this is an appointment case' },
      { key: 'doctorName',    label: 'Doctor',           type: 'dependent', deps: { mainField: 'Specialty', subField: 'Doctor' }, parentKey: 'specialty', hint: 'Only if this is an appointment case' },
    ],
    { channel: '', typeOfCall: '', callFor: '', typeOfEnquiry: '', priority: '', status: '', summary: '', specialty: '', doctorName: '' },
    (cfg) => cfg.specialty ? `Case: ${cfg.typeOfCall || '…'} → ${cfg.doctorName || cfg.specialty}` : (cfg.typeOfCall ? `Case: ${cfg.typeOfCall} ${cfg.callFor || ''}`.trim() : 'Not configured'),
  ),

  updateContact: def(
    'updateContact', 'action', 'Update Contact', '✏️', '#4338ca',
    'Writes a value back to the new contact',
    [
      { key: 'field', label: 'Field', type: 'contactField', required: true },
      { key: 'value', label: 'Value', type: 'textarea',     required: true, placeholder: 'Supports {{contact…}} templates' },
    ],
    { field: '', value: '' },
    (cfg) => {
      if (!cfg.field) return 'Not configured';
      const f = CONTACT_FIELDS.find(x => x.key === cfg.field);
      return `Set ${f ? f.label : cfg.field} = ${cfg.value || '…'}`;
    },
  ),

  sheetRow: def(
    'sheetRow', 'action', 'Append Row to Sheet', '📊', '#4338ca',
    'Appends a row to a tab in the OM CRM spreadsheet',
    [
      { key: 'tab',  label: 'Sheet tab', type: 'text', required: true, placeholder: 'e.g. WorkflowLog — create the tab first' },
      { key: 'rows', label: 'Row values', type: 'kv', required: true, kvKeyLabel: 'Column', kvValueLabel: 'Value' },
    ],
    { tab: '', rows: [{ key: 'Contact Name', value: '{{contact.name}}' }, { key: 'Mobile', value: '{{contact.mobile}}' }] },
    (cfg) => `${(cfg.rows || []).filter(r => r.key).length} value(s) → “${cfg.tab || '…'}”`,
  ),

  webhook: def(
    'webhook', 'action', 'Call Webhook', '🔗', '#4338ca',
    'Makes a generic HTTP request',
    [
      { key: 'url',    label: 'URL',    type: 'text',     required: true, placeholder: 'https://your-service.com/endpoint' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map(v => ({ value: v, label: v })) },
      { key: 'body',   label: 'Body (JSON)', type: 'textarea', showIf: c => ['POST', 'PUT', 'PATCH'].includes(c.method), placeholder: '{ "text": "{{contact.name}}" }' },
    ],
    { url: '', method: 'POST', body: '' },
    (cfg) => `${cfg.method || 'POST'} ${cfg.url || '…'}`,
  ),

  condition: def(
    'condition', 'condition', 'Condition', '🔀', '#d97706',
    'Branches on a contact or case field (True / False)',
    [
      { key: 'field',    label: 'Field',    type: 'contactField', required: true, allFields: true },
      { key: 'operator', label: 'Operator', type: 'select', required: true, options: OPERATORS },
      { key: 'value',    label: 'Value',    type: 'text',    required: true, showIf: c => OPERATOR_NEEDS_VALUE(c.operator) },
    ],
    { field: '', operator: 'eq', value: '' },
    (cfg) => {
      const f = CONDITION_FIELDS.find(x => x.key === cfg.field);
      const op = OPERATORS.find(x => x.value === cfg.operator);
      const base = `${f ? f.label : cfg.field || 'field'} ${op ? op.label : cfg.operator || ''}`;
      return OPERATOR_NEEDS_VALUE(cfg.operator) ? `${base} “${cfg.value || '…'}”` : base;
    },
  ),
};

export const PALETTE_GROUPS = [
  { group: 'Trigger',   color: '#0d9488', items: [NODE_DEFS.contactCreated, NODE_DEFS.caseCreated] },
  { group: 'Actions',   color: '#4338ca', items: [NODE_DEFS.assign, NODE_DEFS.notify, NODE_DEFS.createCase, NODE_DEFS.updateContact, NODE_DEFS.sheetRow, NODE_DEFS.webhook] },
  { group: 'Logic',     color: '#d97706', items: [NODE_DEFS.condition] },
];

export const getDef = actionType => NODE_DEFS[actionType];

// Prevents a picklist select from silently dropping a value that isn't in the
// current list (admin may have removed it since the workflow was configured).
export function withCurrentValue(list, current) {
  if (!current || list.includes(current)) return list;
  return [...list, current];
}

// ── Node helpers ────────────────────────────────────────────────────────────

let seq = 0;
export function newId() {
  seq += 1;
  return `n${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newNode(actionType, position) {
  const d = getDef(actionType);
  return {
    id: newId(),
    type: d.kind === 'condition' ? 'condition' : d.kind === 'trigger' ? 'trigger' : 'action',
    position,
    data: { actionType, config: { ...(d.defaults || {}) } },
  };
}

export function isConditionLike(node) {
  const d = getDef(node?.data?.actionType);
  return d?.kind === 'condition';
}

export function isTriggerLike(node) {
  const d = getDef(node?.data?.actionType);
  return d?.kind === 'trigger';
}

// ── Serialisation ───────────────────────────────────────────────────────────

export function toConfig(nodes, edges) {
  return {
    v: 1,
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: { actionType: n.data.actionType, config: n.data.config || {} },
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || null,
      targetHandle: e.targetHandle || null,
    })),
  };
}

export function fromConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.nodes)) return { nodes: [], edges: [] };
  const ids = new Set(cfg.nodes.map(n => n.id));
  const nodes = cfg.nodes
    .filter(n => getDef(n.data && n.data.actionType))
    .map(n => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { actionType: n.data.actionType, config: { ...(getDef(n.data.actionType).defaults || {}), ...(n.data.config || {}) } },
    }));
  const edges = cfg.edges
    .filter(e => ids.has(e.source) && ids.has(e.target))
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || null,
      targetHandle: e.targetHandle || null,
      type: 'smoothstep',
      label: e.sourceHandle === 'true' ? 'True' : e.sourceHandle === 'false' ? 'False' : '',
      style: e.sourceHandle === 'false' ? { strokeDasharray: '6 4', stroke: '#94a3b8' } : {},
    }));
  return { nodes, edges };
}

// ── Graph validation ────────────────────────────────────────────────────────

function buildAdjacency(nodes, edges) {
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => { if (adj[e.source]) adj[e.source].push(e.target); });
  return adj;
}

function hasCycle(nodes, edges) {
  const adj = buildAdjacency(nodes, edges);
  const state = {};
  nodes.forEach(n => { state[n.id] = 0; }); // 0 unvisited, 1 visiting, 2 done
  const dfs = (id) => {
    if (state[id] === 1) return true;
    if (state[id] === 2) return false;
    state[id] = 1;
    for (const t of adj[id] || []) { if (dfs(t)) return true; }
    state[id] = 2;
    return false;
  };
  return nodes.some(n => dfs(n.id));
}

export function validateGraph(nodes, edges) {
  const issues = [];
  const triggers = nodes.filter(isTriggerLike);
  const nonTriggers = nodes.filter(n => !isTriggerLike(n));

  if (triggers.length === 0) issues.push({ severity: 'error', nodeId: null, message: 'Add the “Contact Created” trigger node to start the workflow.' });
  if (triggers.length > 1) issues.push({ severity: 'error', nodeId: null, message: 'Only one trigger node is allowed per workflow.' });
  if (nonTriggers.length === 0) issues.push({ severity: 'error', nodeId: null, message: 'Add at least one action node.' });

  if (triggers.length >= 1) {
    const adj = buildAdjacency(nodes, edges);
    const seen = new Set();
    const stack = [...(adj[triggers[0].id] || [])];
    seen.add(triggers[0].id);
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      (adj[id] || []).forEach(t => { if (!seen.has(t)) stack.push(t); });
    }
    nonTriggers.forEach(n => {
      if (!seen.has(n.id)) issues.push({ severity: 'error', nodeId: n.id, message: `Node “${getDef(n.data.actionType).label}” is not connected from the trigger — it will never run.` });
    });
  }

  nodes.filter(isConditionLike).forEach(n => {
    const out = edges.filter(e => e.source === n.id);
    if (out.length === 2) {
      const hasTrue = out.some(e => e.sourceHandle === 'true');
      const hasFalse = out.some(e => e.sourceHandle === 'false');
      if (hasTrue && hasFalse && out[0].target === out[1].target) {
        issues.push({ severity: 'warn', nodeId: n.id, message: 'True and False branches go to the same node — consider a simpler step.' });
      }
    }
    if (out.length === 0) issues.push({ severity: 'warn', nodeId: n.id, message: 'Condition has no branches connected — it does nothing yet.' });
  });

  if (hasCycle(nodes, edges)) issues.push({ severity: 'error', nodeId: null, message: 'Workflow contains a loop — cycles are not allowed.' });

  nodes.forEach(n => {
    const d = getDef(n.data.actionType);
    d.fields.forEach(f => {
      if (!f.required || (f.showIf && !f.showIf(n.data.config || {}))) return;
      const val = (n.data.config || {})[f.key];
      const empty = f.type === 'kv'
        ? !(Array.isArray(val) && val.some(r => (r.key || '').trim() && (r.value || '').trim()))
        : !String(val || '').trim();
      if (empty) issues.push({ severity: 'error', nodeId: n.id, message: `“${d.label}”: ${f.label} is required.` });
    });
  });

  return issues;
}

export const severityBlocks = issues => issues.some(i => i.severity === 'error');