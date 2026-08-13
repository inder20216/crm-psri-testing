# Telephony Service

Always-on Node/Express service that captures call data directly from SparkTG — no n8n involved. It's shared infrastructure across every process that uses SparkTG (PSRI today, VMM and future projects later), not PSRI-specific — every row it writes is tagged with a `project` column, and each project authenticates to SparkTG with its own account.

It:
- Receives call-start / call-end events from each project's app (`POST /call-log/upsert`)
- Writes/updates the shared `call_logs` table in MySQL (see `schema.sql`)
- Auto-links each call to a matching contact by phone number, where a resolver exists for that project (PSRI's contacts live in the same MySQL database, so this works today; a project whose contacts live elsewhere just doesn't get auto-linking until a resolver is added for it — see `src/callLog.js`)
- In the background, polls that project's own SparkTG account for the finished call's disposition/duration/recording and fills those in
- Every 5 minutes, refreshes each configured project's local `agents` table from its own SparkTG roster

n8n is unaffected — it still owns each project's own Contacts/Cases data. This service only owns the shared `agents`/`call_logs` tables, and there are no foreign keys from `call_logs` into any project's contacts/cases (those may live in a different database entirely) — links are loose, application-level references matched by value.

## Adding a new project (e.g. VMM)
1. Add its name to `TELEPHONY_PROJECTS` in `.env` (comma-separated).
2. Set `SPARKTG_<PROJECT>_SVC_ID` / `_USERNAME` / `_PASSWORD` for it.
3. If its contacts live in this same MySQL database, add a resolver function for it in `src/callLog.js`'s `contactResolvers` map. If not, skip this — calls still get captured, just without auto-linking to a contact.
4. That project's own app needs to call `POST /call-log/upsert` with `project: "<name>"` in the body, same as PSRI's `SparkTGContext.jsx` does.

No other code changes needed.

## Setup

```
npm install
cp .env.example .env
```

Fill in `.env` — see the comments in `.env.example` for what each value means and where it comes from.

`.env` is gitignored — nothing here should ever be committed.

## Database

Run `schema.sql` against your MySQL database once:
```
mysql -h <host> -u <user> -p <database> < schema.sql
```

## Run

```
npm start        # plain node
npm run dev       # auto-restarts on file changes (node --watch)
```

Check it's up: `curl http://localhost:4001/health` → `{ "ok": true, "projects": ["psri"] }`

## Deploying as an always-on process

This needs to stay running continuously, same as n8n does. Two common options on a Linux VPS:

**pm2** (simplest):
```
npm install -g pm2
pm2 start server.js --name psri-telephony-service
pm2 save
pm2 startup   # follow the printed instructions to survive reboots
```

**systemd** — create `/etc/systemd/system/psri-telephony.service`:
```ini
[Unit]
Description=Telephony Service
After=network.target

[Service]
WorkingDirectory=/path/to/psri-telephony-service
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/path/to/psri-telephony-service/.env

[Install]
WantedBy=multi-user.target
```
Then `systemctl enable --now psri-telephony`.

## API

### `POST /call-log/upsert`
Called by each project's app on `show_dialer` (call started) and `hide_dialer` (call ended).

```json
{
  "project": "psri",
  "callTxnId": "abc123",
  "direction": "inbound",
  "phone": "9873600063",
  "calledNumber": "01205136387",
  "status": "started"
}
```
`project` selects which SparkTG account and contact-resolver to use. `status` is `"started"` or `"ended"`. On `"ended"`, the service automatically polls that project's SparkTG account in the background (up to 6 attempts, 3s apart) for disposition/duration/recording — the caller doesn't need to do anything else.

### `GET /health`
Liveness check, returns `{ "ok": true, "projects": [...] }` — the list of currently configured projects.

## Linking a call to a Case
When a project's app saves a Case, its `call_txn_id` field already carries the SparkTG call id. Rather than calling this service, that project's own `case_add` workflow/backend (once it has its own DB access) runs one extra `UPDATE call_logs SET case_id = ? WHERE project = ? AND call_txn_id = ?` directly — no cross-service call needed. For PSRI, this happens in the n8n `case_add` workflow once it's on MySQL.
