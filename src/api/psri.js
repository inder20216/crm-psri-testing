const BASE = import.meta.env.VITE_PSRI_API_BASE || '/psri-webhook';

// A workflow that dies mid-execution (e.g. a node losing its credential) still
// responds 200 with an empty body — that must surface as an error, not a silent "success".
function parseOrThrow(path, ok, text) {
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!ok || data === null) throw new Error((data && data.error) || `${path} failed: empty or invalid response`);
  return data;
}

async function get(path, params = {}) {
  const url = new URL(`${BASE}/${path}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });
  const r = await fetch(url.toString());
  const text = await r.text();
  return parseOrThrow(path, r.ok, text);
}

async function post(path, body) {
  const r = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return parseOrThrow(path, r.ok, text);
}

export const psri = {
  getUsers:   ()      => get('psri-users'),
  addUser:    (data)  => post('psri-user-add', data),
  updateUser: (data)  => post('psri-user-update', data),

  getContacts:   (q)    => get('psri-contacts', { q }),
  addContact:    (data) => post('psri-contact-add', data),
  updateContact: (data) => post('psri-contact-update', data),

  getPicklists:     ()    => get('psri-picklists'),
  addPicklistValue: (data) => post('psri-picklist-add', data),

  getCases:   (q)    => get('psri-cases', { q }),
  addCase:    (data) => post('psri-case-add', data),
  updateCase: (data) => post('psri-case-update', data),

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

  // Unique latest missed inbound calls, bucketed by callback-attempt stage.
  getMissedCalls: () => get('psri-missed-calls')
    .then(d => (d && d.success ? d.missedCalls : []))
    .catch(err => { console.warn('[telephony] getMissedCalls failed:', err.message); return []; }),
};
