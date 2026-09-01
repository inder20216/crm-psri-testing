# PSRI Hospital CRM — Process Documentation

## Overview
A call center CRM for PSRI Hospital (Pushpawati Singhania Research Institute), built as the first project inside a new **Universal CRM** platform — a Vtiger-style shell designed to host multiple unrelated business lines (PSRI, VMM, future "Lots"), each as an independent project with its own modules, sharing one User Management / Picklist / Dependency layer.

PSRI is transitioning off Vtiger onto this system in a single full cutover (not a phased dual-system rollout), with live call telephony (SparkTG) capture built in from day one.

## Architecture
- **Frontend**: React + Vite app at `universal-crm/` (separate from `vmm-crm/` — VMM stays a standalone deployed app for now, linked from a placeholder page inside the universal shell). Deployed to GitHub Pages at `https://inder20216.github.io/crm-psri-testing/` via `npm run deploy`.
- **Shell design**: a single expandable left rail (icon-only by default, expands to show project names + module sub-links) replaces a separate per-project sidebar. Projects are registered in `src/projects/registry.jsx`.
- **Backend split by data volume and ownership**:
  - **MySQL** (`psri` database, phpMyAdmin-managed) — `contacts`, `cases`, and `call_logs` tables. Originally built on Google Sheets, then Supabase; migrated to MySQL for the 147k-row contact volume and to support the telephony (`call_logs`) integration on the same database. All access goes through n8n's "MySQL PSRI" credential — no direct app-to-DB connection.
  - **Google Sheets** ("OM CRM - PSRI") — Users, Picklists, Dependencies, SpecialtySummaries, Guidance, Doctors tabs. These stay small (dozens to low hundreds of rows), so Sheets remains fine here.
- **n8n**: self-hosted instance at `automation.openmindhelpline.com`, workflows kept in `PSRI/Workflows/` (local only, gitignored, since they contain credential references). Production webhooks resolve at `https://automation.openmindhelpline.com/webhook/<path>`; the frontend proxies through `/psri-webhook/<path>` (see `vite.config.js` / `.env.production`).
- **Auth**: MSAL (Microsoft/Azure AD) — a logged-in account's email is matched case-insensitively against the Users sheet's `User Official Email` column; no match means Access Denied.

## Modules (in the React app, under the PSRI project)

| Module | Route | Purpose |
|---|---|---|
| Contacts | `/psri/contacts` | Patient/caller directory |
| Cases | `/psri/cases` | Call center case logging |
| Incomplete Cases | `/psri/incomplete-cases` | Drafts saved mid-call (see below) |
| Call Logs | `/psri/call-logs` | Full call history table, live from SparkTG |
| (Leads) | — | Not yet built — pending after Cases is solid |

Plus platform-level admin:
| Page | Route | Access | Purpose |
|---|---|---|---|
| Users | `/admin/users` | Super Admin only | User Management — roles: Super Admin, Admin, User |
| Picklists | `/admin/picklists` | Super Admin only | Flat admin-managed dropdown values |
| Dependencies | `/admin/dependencies` | Super Admin only | Value-to-value relationships between picklists |
| Productivity | `/admin/productivity` | Admin **or** Super Admin (TL/Manager) | Per-agent call volume, AHT, missed-call callback TAT — see Telephony section |

## Data Model

### Contacts (MySQL `contacts` table)
Salutation, Full Name (auto-corrected to Title Case on blur), Age, Mobile + Alt Mobile + Landline (each with its own ISD code dropdown), Email, Country → State → City (cascading for India via a static dataset), Contact Type, Source of Information, Language, Assigned To, Notes.

Duplicate rule: a new contact is blocked only if **both name AND mobile** match an existing contact exactly.

### Cases (MySQL `cases` table)
Linked to a Contact via `contact_id` (`NOT NULL` FK — a case cannot exist without a contact; denormalized `contact_name`/`contact_mobile` copied in for fast list display). Core fields: Channel, Called Number, **Call Transaction ID** (`call_txn_id`, links to `call_logs.call_txn_id` by value — no FK, since `call_logs` is shared across projects), Type of Call, Call For, Type of Enquiry, Priority, **Query Type** (Basic / Detailed — a global classification tag, no extra fields unlocked), Status, Summary. Four optional toggle sections:
- **Appointment**: Specialty, Doctor Name (dependent on Specialty), Specific Doctor Requested, Appointment Date/Time, Appointment Status
- **Callback**: Call Back Date & Time, Was Call Back Completed
- **Transfer**: Transferred To
- **High Value**: Type of Procedure, Name of Procedure, Mode of Payment, Specialty Enquired For

**Assigned To**: visible and editable only for Admin/Super Admin roles (TLs/Managers). Regular agents never see this field — every case they create is silently assigned to themselves, with no way to change it, including via "Repeat with New Enquiry" (which used to inherit the original historical case's assignee; now always defaults to the current agent).

**Multiple appointments per call**: one call can require several appointments (same contact/different doctors, one doctor/different family members, or a fully mixed combination). After saving an Appointment case, a **"+ Add Another Appointment"** button keeps the call's Channel/Type of Call/Call Transaction ID attached but resets contact and doctor, so the agent can pick a new contact (search or Quick Add) and doctor without re-navigating. Several `cases` rows can legitimately share one `call_txn_id` — this is intentional, not a bug, and both the Call Logs page and the bulk case-lookup-by-`call_txn_id` endpoint (`n8n_psri_cases_list_mysql.json`'s `callTxnIds` param) handle it as an array, not a single value.

Contact resolution flow: search existing contacts first (debounced, server-side, by name/mobile/email); if no match, a **Quick Add Contact** inline modal opens, capturing the full Contact field set.

The Case form is two columns: the form itself (left) plus a sticky right sidebar containing Live Agent Guidance, the AI Advisor (post-save), Doctor & Specialty Lookup, and Contact History.

### Incomplete Cases (same `cases` table, `status = 'Incomplete'`)
A new call interrupting an in-progress, never-yet-saved case would previously overwrite the form with zero warning. Now:
- **Automatic**: if the agent has an unsaved new case open (contact picked, some real content entered) and a new call/Resume interrupts it, it's silently saved as `status = 'Incomplete'` before the form resets — skipped for cases opened via Edit (never downgrades a real case) and right after a successful create (avoids a duplicate).
- **Manual**: a **"💾 Save as Incomplete"** button lets an agent deliberately save half-finished work and step away, without needing to fill the normally-required fields (Type of Call/Call For/Summary skip validation server-side when `status === 'Incomplete'`).
- Drafts show up on the dedicated **Incomplete Cases** page with their Call Transaction ID and a recording link (looked up from `call_logs` by transaction id), plus a **Resume** button that reloads the draft back into the Cases form. Completing it normally flips `status` back to `Resolved`.

### Users (Google Sheets `Users` tab)
Columns: `User ID`, `User Name`, `User Contact Number`, `User Official Email`, `User Password`, `Role`, `SparkTG Extension`, `Created`. No delete endpoint exists at all. Role changes are blocked if they would leave zero Super Admins.

`SparkTG Extension` is a newer column: SparkTG's call webhook sends an `agent-number` field that's inconsistently either the agent's personal mobile (matches `User Contact Number`) or SparkTG's own internal extension id — this column lets an admin record the extension separately so Call Logs/Productivity can resolve either format to the real agent name (`src/projects/psri/agentResolve.js`).

### Picklists / Dependencies (Google Sheets)
Unchanged from original design — flat `List Name`/`Value` pairs for Picklists; explicit value-to-value pairs for Dependencies. Wired relationships: Specialty→Doctor, Call For→Type of Enquiry, Call For→Appointment Status, Type of Call→Call For.

## Telephony (SparkTG) Integration

### `call_logs` table (MySQL, shared schema across projects via a `project` column)
`call_txn_id` (unique), `direction`, `phone`, `called_number`, `agent_email`, `agent_number`, `contact_id`, `case_id`, `status`, `disposition`, `duration_seconds`, `recording_url`, `started_at`, `ended_at`.

### Two independent capture paths, both writing to the same table
1. **Browser capture** (`SparkTGContext.jsx`) — the embedded SparkTG dialer widget's `show_dialer`/`hide_dialer` postMessage events fire `psri.logCall(...)` the instant a call starts/ends, populating `agent_email` from the logged-in CRM session. Blind spot: only fires if an agent's browser widget is open — a call that rings with nobody logged in is never captured this way.
2. **SparkTG webhook** (`n8n_psri_sparktg_webhook.json`, `POST/GET /psri-sparktg-webhook`) — configured directly in SparkTG's system (requires their support team to set the callback URL per service ID; self-service wasn't available in the admin panel). Sends `callid`, `call-type`, `customer-number`, `virtual-number`, `agent-number`, `disposition` (`answered`/`missed`), `call-duration`, `recording-url`, `start-time`, `end-time` — a complete call summary including the answer/missed outcome directly, no reconstruction needed. This path has **no blind spot** — it fires regardless of whether any agent's browser is open. Both paths upsert the same `call_logs` row (keyed by `call_txn_id`), only overwriting a field when the new data actually has a value for it.
   - Note: SparkTG sends the literal string `"-"` (not blank) when it has no `agent-number` for a call — normalized to empty, same as everywhere else.

### Call Logs page (`/psri/call-logs`)
Full-detail table: Call Txn ID, Start/End Time, Call Type, Customer/Virtual Number, Disposition, Duration, **Agent** (resolved to a CRM name via `agentResolve.js`, falling back to `Ext. <number>` if unmapped), Recording, **Contact** (server-side `LEFT JOIN` against `contacts`), and every linked **Case** (array, not a single value — see Multiple Appointments above).

### Missed Calls widget (floating panel, `MissedCallsWidget.jsx`)
Client-side state machine (not a server-side computation, to avoid re-running heavy logic in n8n every 60s per agent) reading raw `call_logs` rows: an unanswered inbound call opens a "missed" streak for that phone number; an unanswered outbound callback increments the attempt count (1st/2nd/3rd); any answered call (in either direction) clears the streak; 3 failed attempts drops the number off the list entirely. The toggle badge shows only stage-1 (fresh) misses, not the sum across all three attempt tabs.

### Agent Productivity dashboard (`/admin/productivity`, Admin/Super Admin only)
Phase 1 (built): per-agent Total/Inbound/Outbound/Answered/Missed calls, AHT (average duration of answered calls, currently blended inbound+outbound, not split), and Average Callback TAT (time between a missed inbound call and the next answered outbound call to that number, credited to whoever placed the callback — currently raw elapsed time, not working-hours-adjusted). All computed client-side from the existing Call Logs data, zero new backend.

Phase 2 (not started): Login/Break time tracking. Requires new infrastructure — we don't capture agent presence history anywhere today, only a live snapshot via SparkTG's `GET /api/v1/dashboard?svc-id=`. Would need a new scheduled n8n workflow polling that endpoint every 1–2 minutes, a new MySQL table logging status snapshots, and an aggregation step — accuracy bounded by the polling interval.

## Tariff Chatbot
Agent-facing AI chat (💬 icon) answering billing/tariff questions from source documents via a LangChain agent (GPT-4.1-mini) + Supabase pgvector retrieval — not from memory.

- **Source files** — Google Drive folder `10OCdknPRAng86Ecfod9Ngv7BMYRj1QVq` ("PSRI Tariff Docs"). The tariff **PDF is scanned/image-based — contributes zero extractable text**. All actual tariff content comes from the Excel file, which is ingested correctly (one row → one clean chunk, keeping a rate and its label together).
- **Known accuracy gap** (open, not yet fixed): vector retrieval (`n8n_psri_tariff_tool.json`) only pulls `topK: 6` chunks per query — likely too few for compound/multi-category questions. Reported by the team as giving "incomplete and incorrect" answers; root cause not fully confirmed yet (topK vs. something else) — pending a fix.
- **Workflows**: `n8n_psri_tariff_ingest.json` (2-day schedule, re-embeds everything), `n8n_psri_tariff_chat.json` (the chat endpoint, `POST /psri-tariff-chat`), `n8n_psri_tariff_tool.json` (sub-workflow: classify → vector search → extract answer).

## Known Lessons / Gotchas
- **n8n MySQL nodes**: the `select` operation's dynamic column-picker throws `identifier.match is not a function` — always use `executeQuery` with hand-built, pre-escaped SQL strings instead. The "Query Parameters" feature silently doesn't bind (`?` placeholders reach MySQL literally) — build the complete SQL string in a preceding Code node instead. `alwaysOutputData: true` is required on every MySQL node, or n8n halts the whole workflow on a zero-row result.
- **A workflow that dies mid-execution still returns HTTP 200 with an empty body** — the frontend's `parseOrThrow()` helper in `src/api/psri.js` treats an empty/unparseable body as an error specifically because of this; don't assume a 200 means success.
- **n8n workflow files are gitignored** — every change to `PSRI/Workflows/*.json` requires a manual re-import + credential rebind in n8n; nothing there deploys automatically with `git push`.
- **n8n field-mapping doesn't always survive JSON import** — verify Insert/Update/Append field mappings after import, same as credentials.
- **SparkTG's webhook self-service wasn't available** on this account's admin panel — required emailing SparkTG support directly with the target URL and service ID to get it configured.

## Pending Items
- **Tariff Bot accuracy** — `topK` bump and possibly chunking strategy, pending confirmation from the team on which questions are failing.
- **Productivity Phase 2** — Login/Break time tracking, needs new SparkTG-status-polling infrastructure (see Telephony section).
- **Working-hours-adjusted Callback TAT** — currently raw elapsed time; should exclude off-hours gaps.
- **AHT split by direction** — currently blended inbound+outbound.
- **VMM's SparkTG webhook** — configuration email sent to SparkTG support, awaiting their reply.
- **Leads module** — explicitly deferred until Cases is solid; not yet scoped.
- **Google Maps city autocomplete** — "nice to have," needs a billing-enabled API key that doesn't exist yet.

## Key Files
- `universal-crm/` — React app source (shell: `src/App.jsx`, `src/components/ProjectRail.jsx`; PSRI pages: `src/projects/psri/`; admin pages: `src/admin/`; shared contexts: `src/context/`; API layer: `src/api/psri.js`)
- `PSRI/Workflows/*.json` — all n8n workflow exports (local only, gitignored)
- `PSRI/mysql_schema.sql` — Contacts/Cases DDL reference (not the live `call_logs` schema, which evolved ad hoc during the telephony build)
- `PSRI/PSRI_PROGRESS_LOG.md` — daily progress log for management updates
