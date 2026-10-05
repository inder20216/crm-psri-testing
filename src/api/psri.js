const BASE = import.meta.env.VITE_PSRI_API_BASE || '/psri-webhook';
// Workflow automation (designer store + runner) is served by its own PHP API.
const WF_BASE = import.meta.env.VITE_PSRI_WORKFLOW_BASE || '/psri-api';

// A workflow that dies mid-execution (e.g. a node losing its credential) still
// responds 200 with an empty body — that must surface as an error, not a silent "success".
function parseOrThrow(path, ok, text) {
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!ok || data === null) throw new Error((data && data.error) || `${path} failed: empty or invalid response`);
  return data;
}

async function get(path, params = {}, base = BASE) {
  const url = new URL(`${base}/${path}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });
  const r = await fetch(url.toString());
  const text = await r.text();
  return parseOrThrow(path, r.ok, text);
}

async function post(path, body, base = BASE) {
  const r = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return parseOrThrow(path, r.ok, text);
}

// Fires "new record" automations. Fire-and-forget: a workflow problem must
// never block or fail the save that triggered it.
const fireWorkflows = (path, body) => post(path, body, WF_BASE)
  .catch(err => console.warn('[workflows] trigger failed:', err.message));

export const psri = {
  getUsers:   ()      => get('psri-users'),
  addUser:    (data)  => post('psri-user-add', data),
  updateUser: (data)  => post('psri-user-update', data),

  getContacts:   (q)    => get('psri-contacts', { q }, WF_BASE),
  addContact:    (data) => post('psri-contact-add', data, WF_BASE).then(res => {
    if (res && res.id) fireWorkflows('psri-contact-workflow-run', { contact: { ...data, id: res.id } });
    return res;
  }),
  updateContact: (data) => post('psri-contact-update', data, WF_BASE),

  getPicklists:     ()    => get('psri-picklists'),
  addPicklistValue: (data) => post('psri-picklist-add', data),

  // Accepts either a bare search string or an options object ({ q, status })
  // — status is an exact-match filter (e.g. 'Incomplete'), q is a fuzzy search.
  getCases:   (opts) => get('psri-cases', typeof opts === 'string' ? { q: opts } : (opts || {}), WF_BASE),
  addCase:    (data) => post('psri-case-add', data, WF_BASE),
  updateCase: (data) => post('psri-case-update', data, WF_BASE),
  // "Case Created" automations — call once a case is really saved (not for
  // Incomplete drafts). The runner ignores repeat calls for the same case.
  runCaseWorkflows: (data) => (data && data.id ? fireWorkflows('psri-case-workflow-run', { case: data }) : Promise.resolve()),

  getDependencies: ()    => get('psri-dependencies'),
  addDependency:   (data) => post('psri-dependency-add', data),

  polishSummary: (data) => post('psri-summary-polish', data),
  validateCase:  (data) => post('psri-case-validate', data),

  getSpecialtySummaries: () => get('psri-specialty-summaries'),
  getGuidance:           () => get('psri-guidance'),

  searchDoctors:   (query, searchBy) => post('psri-doctor-search', { query, searchBy }),
  searchSpecialty: (specialty)       => post('psri-specialty-search', { specialty }),

  // Telephony (call_logs) — all n8n workflows now, same base as everything else.
  // Fire-and-forget: a call event must never block call handling, so this
  // never throws — it just logs a warning on failure.
  logCall: (data) => post('psri-call-log-upsert', data).catch(err => console.warn('[telephony] call log failed:', err.message)),

  // Fills in disposition/duration/recording on an already-upserted call_logs
  // row once psri.pollSparkTG() resolves it. Also fire-and-forget.
  enrichCallLog: (data) => post('psri-call-log-enrich', data).catch(err => console.warn('[telephony] enrich failed:', err.message)),

  // Asks SparkTG (via n8n) whether a call has finished processing yet —
  // { success, found, record }. Never throws; caller treats a failed/empty
  // poll the same as "not found yet" and just retries.
  pollSparkTG: (callId) => get('psri-sparktg-poll', { callId })
    .catch(err => { console.warn('[telephony] poll failed:', err.message); return { success: false, found: false }; }),

  // Full call history (all calls, any outcome) — thin data API, no server-side
  // computation. Accepts either a bare search string (Call Logs page) or an
  // options object { q, days, limit } (Missed Calls widget pulls a wider
  // window and computes its own state machine client-side).
  getCallLogs: (opts) => get('psri-call-logs', typeof opts === 'string' ? { q: opts } : (opts || {}))
    .then(d => (d && d.success ? d.callLogs : []))
    .catch(err => { console.warn('[telephony] getCallLogs failed:', err.message); return []; }),

  // Prospects — unconverted "Enquiry or Transfer" leads, one row per contact,
  // maintained server-side by cases.php's cases_add() as cases come in.
  getProspects: (opts) => get('psri-prospects', typeof opts === 'string' ? { status: opts } : (opts || {}), WF_BASE)
    .then(d => (d && d.success ? d.prospects : []))
    .catch(err => { console.warn('[prospects] getProspects failed:', err.message); return []; }),
  updateProspect:        (data) => post('psri-prospect-update', data, WF_BASE),
  recordProspectCallAttempt: (data) => post('psri-prospect-call-attempt', data, WF_BASE)
    .catch(err => console.warn('[prospects] call attempt log failed:', err.message)),
  getProspectActivity: (prospectId) => get('psri-prospect-activity', { prospectId }, WF_BASE)
    .then(d => (d && d.success ? d.activity : []))
    .catch(err => { console.warn('[prospects] getProspectActivity failed:', err.message); return []; }),

  // Workflow designer — automation graphs configured in the CRM and run
  // server-side by the automation engine. These never throw on read paths
  // (designer pages handle their own load errors), but save must throw so
  // the editor can surface failures.
  getWorkflows:     ()    => get('psri-workflow-get', {}, WF_BASE).then(d => (d && d.workflows ? d.workflows : [])),
  saveWorkflow:     (data) => post('psri-workflow-save', data, WF_BASE),
  getWorkflowRuns:  (opts) => get('psri-workflow-runs', typeof opts === 'string' ? { id: opts } : (opts || {}), WF_BASE)
    .then(d => (d && d.runs ? d.runs : []))
    .catch(err => { console.warn('[workflows] getWorkflowRuns failed:', err.message); return []; }),

  // Raw CSV export (every column, all rows) — a plain download URL, not a
  // fetch call: the browser handles the download natively and PHP streams
  // the file, so this stays fine even for contacts' ~150k rows.
  exportContactsUrl: (from, to) => {
    const u = new URL(`${WF_BASE}/psri-contacts-export`, window.location.origin);
    if (from) u.searchParams.set('from', from);
    if (to)   u.searchParams.set('to', to);
    return u.toString();
  },
  exportCasesUrl: (from, to) => {
    const u = new URL(`${WF_BASE}/psri-cases-export`, window.location.origin);
    if (from) u.searchParams.set('from', from);
    if (to)   u.searchParams.set('to', to);
    return u.toString();
  },
  exportHighValueUrl: (from, to) => {
    const u = new URL(`${WF_BASE}/psri-high-value-export`, window.location.origin);
    if (from) u.searchParams.set('from', from);
    if (to)   u.searchParams.set('to', to);
    return u.toString();
  },

  // Appreciation review — TL audits the call recording against the
  // "Appreciation Received" case and approves/rejects it.
  getAppreciationList: (status) => get('psri-appreciation-list', { status: status || '' }, WF_BASE)
    .then(d => (d && d.success ? d.cases : []))
    .catch(err => { console.warn('[appreciation] getAppreciationList failed:', err.message); return []; }),
  reviewAppreciation: (data) => post('psri-appreciation-review', data, WF_BASE),
};
