import { pool } from './db.js'
import { pollRecentCall } from './sparktg.js'

const POLL_ATTEMPTS = 6
const POLL_DELAY_MS = 3000

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Per-project contact resolution. PSRI's contacts live in this same MySQL
// database, so a direct query works. A project whose contacts live in a
// different backend (e.g. VMM today) has no entry here — linking is simply
// skipped for it until that project gets its own resolver added below.
const contactResolvers = {
  async psri(phone) {
    if (!phone) return null
    const [rows] = await pool.query('SELECT contact_id FROM contacts WHERE mobile = ? LIMIT 1', [phone])
    return rows.length ? rows[0].contact_id : null
  },
}

async function linkContactIfMatched(project, callTxnId, phone) {
  const resolve = contactResolvers[project]
  if (!resolve) return
  const contactId = await resolve(phone)
  if (!contactId) return
  await pool.query(
    'UPDATE call_logs SET contact_id = ? WHERE project = ? AND call_txn_id = ? AND contact_id IS NULL',
    [contactId, project, callTxnId]
  )
}

// One row per (project, call_txn_id). Called twice per call: once with
// status 'started' (call just began) and once with status 'ended' (call
// just finished). Both times it tries to auto-link a matching contact by
// phone (where a resolver exists for that project); the 'ended' call also
// kicks off the background poll-and-enrich sequence that fetches
// disposition/duration/recording from SparkTG.
export async function upsertCallLog({ project, callTxnId, direction, phone, calledNumber, status, agentEmail, raw }) {
  if (!project) throw new Error('project is required')
  if (!callTxnId) throw new Error('callTxnId is required')

  if (status === 'started') {
    await pool.query(
      `INSERT INTO call_logs (project, call_txn_id, direction, phone, called_number, agent_email, status, started_at, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, 'started', NOW(), ?)
       ON DUPLICATE KEY UPDATE
         direction = VALUES(direction),
         phone = VALUES(phone),
         called_number = VALUES(called_number),
         agent_email = VALUES(agent_email)`,
      [project, callTxnId, direction || '', phone || '', calledNumber || '', agentEmail || '', raw ? JSON.stringify(raw) : null]
    )
  } else if (status === 'ended') {
    const [result] = await pool.query(
      `UPDATE call_logs SET status = 'ended', ended_at = NOW(),
         agent_email = IF(? <> '', ?, agent_email)
       WHERE project = ? AND call_txn_id = ?`,
      [agentEmail || '', agentEmail || '', project, callTxnId]
    )
    if (result.affectedRows === 0) {
      // 'ended' arrived without a prior 'started' row (missed event) — insert a best-effort record.
      await pool.query(
        `INSERT INTO call_logs (project, call_txn_id, direction, phone, called_number, agent_email, status, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ended', NOW(), NOW())
         ON DUPLICATE KEY UPDATE status = 'ended', ended_at = NOW()`,
        [project, callTxnId, direction || '', phone || '', calledNumber || '', agentEmail || '']
      )
    }
  } else {
    throw new Error(`Unknown status "${status}" — expected "started" or "ended"`)
  }

  await linkContactIfMatched(project, callTxnId, phone)

  if (status === 'ended') {
    // Fire-and-forget — the HTTP response doesn't wait on this.
    pollAndEnrich(project, callTxnId).catch(err => console.error(`[call_log ${project}/${callTxnId}] poll/enrich failed:`, err.message))
  }
}

// Read path — lets a project's app display call history (a Call History
// panel, an agent's own recent calls, an admin view across everyone, a
// "today's calls" list). At least one filter beyond `project` is required
// — either a specific lookup (phone/contactId/caseId/agentEmail) or the
// `today` flag — so this can't accidentally become an unbounded full-table
// scan across all history.
export async function listCallLogs({ project, phone, contactId, caseId, agentEmail, today, limit }) {
  if (!project) throw new Error('project is required')
  const filters = { phone, contactId, caseId, agentEmail, today }
  if (!Object.values(filters).some(Boolean)) {
    throw new Error('At least one of phone, contactId, caseId, agentEmail, today is required')
  }

  const where = ['project = ?']
  const params = [project]
  if (phone)       { where.push('phone = ?');        params.push(phone) }
  if (contactId)   { where.push('contact_id = ?');   params.push(contactId) }
  if (caseId)      { where.push('case_id = ?');      params.push(caseId) }
  if (agentEmail)  { where.push('agent_email = ?');  params.push(agentEmail) }
  if (today && (today === true || today === 'true' || today === '1')) {
    where.push('started_at >= CURDATE()')
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const [rows] = await pool.query(
    `SELECT call_txn_id, direction, phone, called_number, agent_email, contact_id, case_id,
            status, disposition, duration_seconds, recording_url, started_at, ended_at
     FROM call_logs
     WHERE ${where.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT ?`,
    [...params, safeLimit]
  )
  return rows
}

async function pollAndEnrich(project, callTxnId) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_DELAY_MS)
    let record
    try {
      record = await pollRecentCall(project, callTxnId)
    } catch (err) {
      console.error(`[call_log ${project}/${callTxnId}] poll attempt ${attempt} error:`, err.message)
      continue
    }
    if (record) {
      await pool.query(
        `UPDATE call_logs
         SET disposition = ?, duration_seconds = ?, recording_url = ?, ivr_data = ?, status = 'enriched'
         WHERE project = ? AND call_txn_id = ?`,
        [
          record.disposition || '',
          Number.isFinite(Number(record.duration)) ? Number(record.duration) : null,
          record.recording || '',
          record.ivrData ? JSON.stringify(record.ivrData) : null,
          project,
          callTxnId,
        ]
      )
      return
    }
  }
  console.warn(`[call_log ${project}/${callTxnId}] no SparkTG record found after ${POLL_ATTEMPTS} attempts — left unenriched`)
}
