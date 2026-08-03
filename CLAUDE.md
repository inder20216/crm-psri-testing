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
| Admin pages | `src/admin/` (Users, Picklists, Dependencies — shared across projects) |
| Contexts | `src/context/` |
| n8n workflows | `PSRI/Workflows/*.json` |
| Process doc | `PSRI/PSRI_PROCESS.md` — full data model, module specs, lessons |
| Supabase schema | `PSRI/supabase_schema.sql` |

## Backend

| Layer | Used for |
|---|---|
| Supabase (Postgres) | `contacts` + `cases` tables — bulk data, 147k contact records |
| Google Sheets ("OM CRM - PSRI") | Users, Picklists, Dependencies, SpecialtySummaries, Guidance, Doctors tabs |
| n8n at `automation.openmindhelpline.com` (self-hosted) | All API workflows |

## SparkTG CTI
- Agent login in the React app: `10167201` / `agent007`
- n8n workflows use: `10167200` / `admin`
- Incoming call flow: DialerPanel fires → auto-navigate to Cases form. Contact found → pre-fill. Not found → Quick Add modal auto-opens. No manual click needed.

## Dev
```
npm run dev   # port 5200
```

## Hard rules
- **Never expose** n8n, Supabase, or OpenAI names in user-facing error messages — generic text only
- **Duplicate contacts**: block only if BOTH name AND mobile match an existing record exactly
- **Dependent dropdowns**: fall back to ungated flat picklist if no dependency pairs exist yet for a parent value — never show an empty dropdown
- **No user delete**: removing a User record is structurally impossible by design (no delete endpoint at all)
- **Role protection**: cannot change a role if it would leave zero Super Admins
