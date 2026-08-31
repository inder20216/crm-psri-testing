// SparkTG only gives us its own agent-number on a call — sometimes the
// agent's personal mobile (matches Users.contact), sometimes SparkTG's own
// internal extension id (matches the separately-maintained Users.sparktgExtension).
// Shared by Call Logs and the Productivity dashboard so agent-identity
// resolution lives in one place.
export function buildAgentNumberMap(users) {
  const map = new Map();
  users.forEach(u => {
    if (u.contact) map.set(u.contact, u.name);
    if (u.sparktgExtension) map.set(u.sparktgExtension, u.name);
  });
  return map;
}

// Best-effort human label for a call_logs row: the CRM login email when the
// browser-capture path recorded it, else the resolved name for whichever
// number SparkTG's webhook sent, else the raw number as a last resort.
export function resolveAgentLabel(call, nameByNumber) {
  if (call.agentEmail) return call.agentEmail;
  if (call.agentNumber) return nameByNumber.get(call.agentNumber) || `Ext. ${call.agentNumber}`;
  return '—';
}

// A stable per-agent grouping key — prefers the resolved name so email- and
// number-sourced rows for the same person collapse into one bucket; falls
// back to the raw identifiers so unresolved calls still get their own group
// instead of being silently merged into "Unknown".
export function resolveAgentKey(call, nameByNumber) {
  if (call.agentEmail) return call.agentEmail;
  if (call.agentNumber) return nameByNumber.get(call.agentNumber) || `ext:${call.agentNumber}`;
  return 'unknown';
}
