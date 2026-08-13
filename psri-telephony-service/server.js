import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { pool } from './src/db.js'
import { upsertCallLog, listCallLogs } from './src/callLog.js'
import { fetchAgents } from './src/sparktg.js'
import { listProjects } from './src/config.js'

const PORT = process.env.PORT || 4001
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)

const app = express()
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }))
app.use(express.json())

app.get('/health', (req, res) => res.json({ ok: true, projects: listProjects() }))

// Called by each project's app on show_dialer (status: 'started') and
// hide_dialer (status: 'ended'). Fire-and-forget from the caller's point of
// view — it doesn't need to wait for enrichment, which happens in the
// background. Body must include `project` (e.g. "psri", "vmm").
app.post('/call-log/upsert', async (req, res) => {
  try {
    await upsertCallLog(req.body || {})
    res.json({ success: true })
  } catch (err) {
    console.error('[POST /call-log/upsert]', err.message)
    res.status(400).json({ success: false, error: err.message })
  }
})

// Read path for displaying call history — e.g. GET /call-logs?project=psri&contactId=CON12345678
app.get('/call-logs', async (req, res) => {
  try {
    const { project, phone, contactId, caseId, agentEmail, today, limit } = req.query
    const rows = await listCallLogs({ project, phone, contactId, caseId, agentEmail, today, limit })
    res.json({ success: true, callLogs: rows })
  } catch (err) {
    console.error('[GET /call-logs]', err.message)
    res.status(400).json({ success: false, error: err.message })
  }
})

// Periodically refreshes each configured project's local `agents` table
// from its own SparkTG roster. Not on the critical path for call capture
// (call_logs.agent_id is nullable) — just keeps the table from going stale.
async function syncAgents(project) {
  try {
    const agents = await fetchAgents(project)
    for (const a of agents) {
      await pool.query(
        `INSERT INTO agents (project, agent_id, sparktg_user_id, name, number, status_code)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sparktg_user_id = VALUES(sparktg_user_id),
           name = VALUES(name),
           number = VALUES(number),
           status_code = VALUES(status_code)`,
        [project, String(a.id), String(a.user_id || ''), a.name || '', String(a.number || ''), Number(a.status) || 0]
      )
    }
    console.log(`[agents sync] ${project}: upserted ${agents.length} agent(s)`)
  } catch (err) {
    console.error(`[agents sync] ${project} failed:`, err.message)
  }
}

function syncAllProjects() {
  for (const project of listProjects()) syncAgents(project)
}

app.listen(PORT, () => {
  console.log(`[psri-telephony-service] listening on http://localhost:${PORT}, projects: ${listProjects().join(', ')}`)
  syncAllProjects()
  setInterval(syncAllProjects, 5 * 60 * 1000) // every 5 minutes
})
