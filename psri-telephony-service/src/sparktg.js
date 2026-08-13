import axios from 'axios'
import { getProjectConfig } from './config.js'

const BASE_URL = process.env.SPARKTG_BASE_URL || 'https://telephonycloud.co.in'

function authHeader(project) {
  const { username, password } = getProjectConfig(project)
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
}

// Look up one call's outcome (disposition/duration/recording) by its SparkTG
// transaction id, within the given project's SparkTG account. Returns null
// if the record isn't available yet — SparkTG can take a few seconds after
// the call ends to finalize it, so callers should retry with a delay rather
// than treating null as "no such call".
export async function pollRecentCall(project, callTxnId) {
  const { svcId } = getProjectConfig(project)
  const res = await axios.get(`${BASE_URL}/api/v1/agent-recent-calls`, {
    headers: { Authorization: authHeader(project) },
    params: { recent_txn_id: callTxnId, 'svc-id': svcId },
  })
  const raw = res.data
  const records = Array.isArray(raw) ? raw : (raw?.data || raw?.records || [])
  return records.find(r => r.xnid === callTxnId || r.id === callTxnId || r.callTxnId === callTxnId) || null
}

export async function fetchAgents(project) {
  const res = await axios.get(`${BASE_URL}/api/v1/agents`, {
    headers: { Authorization: authHeader(project) },
  })
  return Array.isArray(res.data) ? res.data : [res.data]
}
