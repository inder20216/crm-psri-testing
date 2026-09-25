# PSRI Workflow Automation — PHP runner setup

`php/` code and this file are committed; `php/config.php` (MySQL password) and the n8n JSONs stay
**gitignored** — on a fresh checkout copy `php/config.example.php` to `config.php` or set `PSRI_DB_*` env vars. The n8n JSONs in this folder
(`n8n_psri_workflow_*.json`, `n8n_psri_contact_workflow_runner.json`) are **retired** — the PHP API below
replaces all four. Keep them only as reference; don't re-import them.

## Files (`php/`)

| File | Purpose |
|---|---|
| `api.php` | HTTP entry point (routes by last URL segment) + CLI (`migrate`, `test`) |
| `runner.php` | Engine: workflow store, graph walk, actions, run log, table migration |
| `db.php` | Config loader + PDO connection (session time zone IST) |
| `config.php` (gitignored; template: `config.example.php`) | DB credentials, `mail_from`, `cors_origin` — all env-overridable (`PSRI_DB_HOST`, `PSRI_DB_PASS`, `PSRI_MAIL_FROM`, `PSRI_CORS_ORIGIN`, …) |
| `graphs/*.json` | Sample graphs + payloads for `php api.php test` |

## Endpoints

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET  | `psri-workflow-get` | — | `{ success, workflows:[{id,name,trigger,status,config,updatedBy,updated}] }` |
| POST | `psri-workflow-save` | `{ id?, name, trigger, status, config, updatedBy }` | `{ success, workflow:{id,name,status} }` (400 + `error` on invalid) |
| GET  | `psri-workflow-runs` | `?id=<workflowId>&limit=40` | `{ success, runs:[…] }` newest first |
| POST | `psri-contact-workflow-run` | `{ contact:{ id, … } }` | `{ success, ran:[…] }` |
| POST | `psri-case-workflow-run` | `{ case:{ id, contactId, … } }` | `{ success, ran:[…] }` |
| POST | `psri-workflow-test` | `{ graph, contact?, case? }` | dry run — walks + evaluates, writes/sends nothing |

## Local dev

```
php -S localhost:8000 PSRI/Workflows/php/api.php     # from the repo root
npm run dev                                          # Vite proxies /psri-api → localhost:8000
```
PHP on this machine is the winget install (not on PATH):
`%LOCALAPPDATA%\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe`

## Deploy

**Target:** the Ubuntu/Apache server at 45.114.142.171 (also the MySQL host), which already serves
`https://openmindservices.in` with a valid certificate → API URL `https://openmindservices.in/psri-workflow/api.php`.

**Scripted (recommended):** copy the `php/` folder to the server and run `sudo bash php/deploy/server-setup.sh`
(optionally `TEST_EMAIL=you@example.com`). It installs PHP + postfix, puts the code in `/opt/psri-workflow`
(config.php there, `root:www-data 640`, never in the web root), adds a one-line stub at
`<docroot>/psri-workflow/api.php`, runs `migrate`, and smoke-tests the URL + CORS header. Safe to re-run.
Deploy key for this PC: `~/.ssh/psri_deploy` (public half must be in the server user's `authorized_keys`).

**Manual steps (what the script does):**

1. Copy `php/` to any PHP 8.1+ host with `pdo_mysql` that can reach MySQL `45.114.142.171:3306`
   (`curl` and `mbstring` are used when present, not required). Keep `config.php` out of the web root
   or protect it; better, set the `PSRI_DB_*` env vars and blank the defaults.
2. `php api.php migrate` once — creates `workflows`, `workflow_runs` (+ `new_contacts`/`new_cases` if missing).
   Already done on the live DB on 2026-09-24.
3. Build the frontend with `VITE_PSRI_WORKFLOW_BASE=https://<host>/<path>/api.php` (Apache/nginx pass the
   rest as PATH_INFO: `…/api.php/psri-workflow-get`). Set `PSRI_CORS_ORIGIN` to the CRM's origin.
4. Email notifications use PHP `mail()` — the host needs sendmail or an SMTP relay configured, and
   `mail_from` should be a domain that host may send for.

## Behaviour

- Only `Active` workflows run. Each runs **at most once per contact** (contact-created) or **per case**
  (case-created) — repeated trigger calls are skipped (MySQL `GET_LOCK` guards concurrent calls).
- Triggers come from the frontend, fire-and-forget: `psri.addContact` (after a successful add) and
  `CasesPage.handleSave` → `psri.runCaseWorkflows` (new case, or an Incomplete draft being completed).
- Graph walk: breadth-first from the trigger; a condition follows only its True/False edges; a node reached
  by two branches runs once; conditions see values written by earlier Update Contact nodes.
- Templates: `{{contact.x}}`, `{{case.x}}` (camelCase). For case triggers the contact is loaded from
  `contacts` by `case.contactId`, so every contact field is available.
- **Append Row to Sheet** → MySQL lists: tab `New Contacts` → `new_contacts`, `New Cases` → `new_cases`.
  Row labels map to columns (Contact Name/Full Name/Name/Contact, Mobile/Phone, Source, Lead Type, Case ID,
  Contact ID, Specialty, Summary, Priority, Status); unknown labels are skipped and noted in the run log.
  `contact_id`, `case_id`, `workflow_id` are filled automatically.
- Create Case ids are `CASE` + 8 digits (collision-checked); a case created by the workflow becomes
  `{{case.*}}` for later nodes.
- Every visited node is logged to `workflow_runs` (`ok` / `error` / `noop`). Errors shown in History are
  action-level messages; DB errors show MySQL's message only, never connection details.
- API errors returned to the browser are generic; details go to the PHP error log.
