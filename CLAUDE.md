# Universal CRM — PSRI Project

## What this repo is
React + Vite app (`npm run dev` on port 5200) hosting multiple CRM projects on a shared shell.
**PSRI Hospital CRM** is the active project being built here.
VMM is present as a placeholder stub only — all real VMM work lives in `../vmm-crm/`.

## Key file locations

| What | Where |
|---|---|
| PSRI pages | `src/projects/psri/` |
| API layer | `src/api/psri.js` |
| Auth (MSAL) | `src/auth/msalConfig.js` |
| Shell | `src/App.jsx`, `src/components/ProjectRail.jsx` |
| Admin pages | `src/admin/` (Users, Picklists, Dependencies; Workflows + Workflow designer `/admin/workflows*` — Super Admin only) |
| Workflow designer | `src/admin/workflow/` (schema, nodes, palette, property panel) + `src/admin/WorkflowEditorPage.jsx`, `WorkflowsPage.jsx`, `Workflow.css` |
| Contexts | `src/context/` |
| n8n workflows | `PSRI/Workflows/*.json` |
| Process doc | `PSRI/PSRI_PROCESS.md` — full data model, module specs, lessons |
| Supabase schema | `PSRI/supabase_schema.sql` |

## Backend

| Layer | Used for |
|---|---|
| Supabase (Postgres) | `contacts` + `cases` tables — bulk data, 147k contact records |
| Google Sheets ("OM CRM - PSRI") | Users, Picklists, Dependencies, SpecialtySummaries, Guidance, Doctors tabs |
| MySQL (`psri` DB) | `workflows` + `workflow_runs` (visual automation config/run log), `new_contacts` / `new_cases` lists |
| PHP API (`PSRI/Workflows/php/api.php`) | Workflow designer store + runner — replaced the n8n workflow webhooks |
| n8n at `automation.openmindhelpline.com` (self-hosted) | All API workflows |

## Workflow automation (visual designer)
- Super Admins design "new contact" / "new case" automation in the React Flow designer (`/admin/workflows`); the graph is serialized to JSON and saved to MySQL `workflows` (one `workflow_runs` row per executed node).
- **PHP is the executor** (`PSRI/Workflows/php/`: `api.php` entry, `runner.php` engine, `config.php` credentials — gitignored; copy `config.example.php`). Frontend calls it via `VITE_PSRI_WORKFLOW_BASE` (default `/psri-api`, Vite-proxied to `localhost:8000`).
- Triggers are fired by the frontend, fire-and-forget: `psri.addContact` → `psri-contact-workflow-run`; `CasesPage.handleSave` → `psri.runCaseWorkflows` for new cases or completed Incomplete drafts. The runner runs each workflow at most once per contact/case.
- "Append Row to Sheet" nodes write to MySQL lists: tab `New Contacts` → `new_contacts`, `New Cases` → `new_cases`.
- Editor UI never names the backend (hard rule). Setup/deploy steps: `PSRI/Workflows/IMPORT_NOTES.md`.

## SparkTG CTI
- Agent login in the React app: `10167201` / `agent007`
- n8n workflows use: `10167200` / `admin`
- Incoming call flow: DialerPanel fires → auto-navigate to Cases form. Contact found → pre-fill. Not found → Quick Add modal auto-opens. No manual click needed.

## Dev
```
npm run dev   # port 5200
php -S localhost:8000 PSRI/Workflows/php/api.php   # workflow API (needed for /admin/workflows)
```

## Hard rules
- **Never expose** n8n, Supabase, or OpenAI names in user-facing error messages — generic text only
- **Duplicate contacts**: block only if BOTH name AND mobile match an existing record exactly
- **Dependent dropdowns**: fall back to ungated flat picklist if no dependency pairs exist yet for a parent value — never show an empty dropdown
- **No user delete**: removing a User record is structurally impossible by design (no delete endpoint at all)
- **Role protection**: cannot change a role if it would leave zero Super Admins
