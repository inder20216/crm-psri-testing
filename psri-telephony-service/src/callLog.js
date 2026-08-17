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

// Per-project contact resolution already tells us the contact_id on a call_log
// row; the latest Case for that same number lives in the project's own
// contacts/cases tables. Only PSRI has those in this same database today.
const caseLookups = {
  async psri(phone) {
    if (!phone) return null
    const [rows] = await pool.query(
      `SELECT case_id, call_for, summary, status, created
       FROM cases WHERE contact_mobile = ? ORDER BY created DESC LIMIT 1`,
      [phone]
    )
    return rows.length ? rows[0] : null
  },
}

// Missed-call callback tracking. Walks each phone number's call history
// chronologically and tracks a small state machine:
//   - an unanswered inbound call starts (or continues) a "missed" streak
//   - an unanswered outbound call against an active streak is a failed
//     callback attempt (stage increments)
//   - ANY answered call (either direction) clears the streak entirely —
//     called back and picked up, or they called in again and got through
//   - 3 failed callback attempts and the number is dropped (given up)
// Nothing is ever deleted — this is recomputed fresh on every request from
// full call_logs history within the lookback window.
const MAX_CALLBACK_ATTEMPTS = 3
const LOOKBACK_DAYS = 30

export async function listMissedCalls({ project, limit }) {
  if (!project) throw new Error('project is required')

  const [rows] = await pool.query(
    `SELECT phone, direction, duration_seconds, started_at, ended_at, call_txn_id,
            called_number, disposition, recording_url, contact_id, agent_email
     FROM call_logs
     WHERE project = ? AND phone <> '' AND ended_at IS NOT NULL
       AND started_at >= DATE_SUB(NOW(), INTERVAL ${LOOKBACK_DAYS} DAY)
     ORDER BY phone, started_at ASC`,
    [project]
  )

  const byPhone = new Map()
  for (const r of rows) {
    if (!byPhone.has(r.phone)) byPhone.set(r.phone, [])
    byPhone.get(r.phone).push(r)
  }

  const pending = []
  for (const [phone, calls] of byPhone) {
    let streakStart = null   // the row that started the current missed streak
    let failedAttempts = 0
    let lastCall = null

    for (const c of calls) {
      const answered = Number(c.duration_seconds) > 0
      lastCall = c
      if (answered) {
        streakStart = null
        failedAttempts = 0
        continue
      }
      if (c.direction === 'inbound') {
        if (!streakStart) streakStart = c
      } else if (c.direction === 'outbound' && streakStart) {
        failedAttempts++
      }
    }

    if (!streakStart) continue                          // never missed, or fully resolved
    if (failedAttempts >= MAX_CALLBACK_ATTEMPTS) continue // gave up after 3 failed callbacks

    pending.push({
      phone,
      stage: failedAttempts + 1, // 1 = missed, 2 = 2nd attempt, 3 = 3rd attempt
      missedSince: streakStart.started_at,
      lastCall,
    })
  }

  pending.sort((a, b) => new Date(b.lastCall.started_at) - new Date(a.lastCall.started_at))
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const trimmed = pending.slice(0, safeLimit)

  const lookupCase = caseLookups[project]
  const results = []
  for (const p of trimmed) {
    const latestCase = lookupCase ? await lookupCase(p.phone) : null
    results.push({
      phone: p.phone,
      stage: p.stage,
      missedSince: p.missedSince,
      lastCallTxnId: p.lastCall.call_txn_id,
      lastCalledNumber: p.lastCall.called_number,
      lastDirection: p.lastCall.direction,
      lastStartedAt: p.lastCall.started_at,
      lastAgentEmail: p.lastCall.agent_email,
      contactId: p.lastCall.contact_id,
      latestCase,
    })
  }
  return results
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
