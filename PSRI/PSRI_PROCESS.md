# PSRI Hospital CRM — Process Documentation

## Overview
A call center CRM for PSRI Hospital (Pushpawati Singhania Hospital & Research Institute), built as the first project inside a new **Universal CRM** platform — a Vtiger-style shell designed to host multiple unrelated business lines (PSRI, VMM, future "Lots"), each as an independent project with its own modules, sharing one User Management / Picklist / Dependency layer.

PSRI currently uses Vtiger with no automation; this replaces it with a custom-built system, migrating ~147,000 historical contact records from Vtiger exports.

## Architecture
- **Frontend**: React + Vite app at `universal-crm/` (separate from `vmm-crm/` — VMM stays a standalone deployed app for now, linked from a placeholder page inside the universal shell)
- **Shell design**: a single expandable left rail (icon-only by default, expands to show project names + module sub-links) replaces a separate per-project sidebar. Projects are registered in `src/projects/registry.jsx` — adding a new project later is just one entry, no shell rewiring.
- **Backend split by data volume**:
  - **Supabase (Postgres)** — `contacts` and `cases` tables. Originally built on Google Sheets, but n8n's Google Sheets node **crashed** (`RangeError: Maximum call stack size exceeded`) trying to load the full 147k-row Contacts sheet in one execution — Google Sheets cannot serve large-table reads reliably. Migrated to Supabase (free tier, hosted Postgres + REST API), using n8n's native **Supabase node** (not raw HTTP requests — cleaner auth, no header-mismatch risk).
  - **Google Sheets** — Users, Picklists, Dependencies. These stay small (dozens to low hundreds of rows), so Sheets remains fine here; matches the original "stay on Sheets" preference where the data volume allows it.
- **n8n**: same self-hosted instance as VMM (`automation.openmindhelpline.com`), workflows kept in `PSRI/Workflows/` (local only, not in git, since they contain credential references)

## Modules (in the React app, under the PSRI project)

| Module | Route | Purpose |
|---|---|---|
| Contacts | `/psri/contacts` | Patient/caller directory |
| Cases | `/psri/cases` | Call center case logging |
| (Leads) | — | Not yet built — pending after Cases is solid |

Plus platform-level admin (under the ⚙ Settings rail icon, shared across all projects):
| Page | Route | Purpose |
|---|---|---|
| Users | `/admin/users` | User Management — roles: Super Admin, Admin, User |
| Picklists | `/admin/picklists` | Flat admin-managed dropdown values (Contact Type, Source of Information, Language, City, Channel, Type of Call, Call For, Type of Enquiry, Priority, Case Status, Appointment Status, Specialty, Type of Procedure, Mode of Payment, Doctor) |
| Dependencies | `/admin/dependencies` | Value-to-value relationships between picklists (e.g. Specialty=Cardiology → Doctor=Dr. X) |

## Data Model

### Contacts (Supabase `contacts` table)
Salutation, Full Name (auto-corrected to Title Case on blur), Age, Mobile + Alt Mobile + Landline (each with its own ISD code dropdown showing "+91 India" style labels), Email, Country → State → City (cascading for India via a static dataset; free text for other countries), Contact Type, Source of Information, Language, Assigned To (references Users), Notes.

Duplicate rule: a new contact is blocked only if **both name AND mobile** match an existing contact exactly (same mobile with a different name is allowed — e.g. family members sharing one number).

### Cases (Supabase `cases` table)
Linked to a Contact via `contact_id` (denormalized `contact_name`/`contact_mobile` copied in for fast list display). Core fields: Channel, Called Number, **Call Transaction ID** (SparkTG UUID format), Type of Call, Call For, Type of Enquiry, Priority, Status, Summary, Assigned To. Four optional toggle sections, each revealing more fields only when checked:
- **Appointment**: Specialty, Doctor Name (dependent on Specialty), Specific Doctor Requested, Appointment Date/Time, Appointment Status (dependent on Call For)
- **Callback**: Call Back Date & Time, Was Call Back Completed
- **Transfer**: Transferred To
- **High Value**: Type of Procedure, Name of Procedure, Mode of Payment, Specialty Enquired For

Contact resolution flow for new Cases: search existing contacts first (debounced, server-side search by name/mobile/email); if no match, a **Quick Add Contact** inline modal opens. This modal captures the **full Contact field set** (Salutation, Name, Age, Mobile/Alt Mobile/Landline with ISD, Email, Country/State/City, Contact Type, Source, Language, Assigned To, Notes) — same fields as the standalone Contacts form — so nothing has to be filled in later. (Originally scoped as a minimal 4-field quick-add; expanded after the user asked for full capture at Quick Add time, not deferred to the Contacts page.)

The Case form is laid out as **two columns**: the form itself (left, capped at 920px) plus a **sticky right sidebar** (`.psri-case-sidebar`) containing:
- **Doctor &amp; Specialty Lookup** — two fully independent search tabs, see dedicated section below.
- **Contact History** — once a Contact is selected/created, shows their past Cases (reuses the existing Cases search by mobile number — no new backend needed) so the agent can see what the caller previously enquired about and whether they'd already booked an appointment.

### Users (Google Sheets `Users` tab)
User ID, User Name, User Contact Number, User Official Email, User Password, Role, Created. **No delete endpoint exists at all** — removal is structurally impossible, not just hidden in the UI. Role changes are blocked if they would leave zero Super Admins.

### Picklists (Google Sheets `Picklists` tab)
Columns: `List Name`, `Value`. Flat key-value store — any list name works, admin can create brand-new lists from the Picklists page itself, not just add values to pre-known ones.

### Dependencies (Google Sheets `Dependencies` tab)
Columns: `Main Field`, `Main Value`, `Sub Field`, `Sub Value`. Every row is an explicit value-to-value pair (not a generic "list A depends on list B" declaration) — e.g. `Specialty | Cardiology | Doctor | Dr. Rahul Manchanda`. Three relationships currently wired into the Cases form:
- Specialty → Doctor
- Call For → Type of Enquiry
- Call For → Appointment Status

Dependent dropdowns fall back to the flat Picklist (ungated) list if no dependency pairs exist yet for the selected parent value, so the form never shows an empty dropdown while data is still being populated.

**Type of Call → Call For** is now a 4th wired dependency — `CasesPage.jsx`'s Call For dropdown narrows by the selected Type of Call via the same `getDependentOptions()` helper used for Specialty→Doctor (added to `DependenciesContext.jsx`'s `KNOWN_RELATIONSHIPS`). Selecting a new Type of Call resets Call For/Type of Enquiry/Appointment Status downstream.

### Dependency data status (as of latest update)
- **Type of Call → Call For** — confirmed, wired into the Cases form, and the 28-row table (Inbound: 6 values — Appointment, Enquiry or Transfer, Complaint/Feedback, Emergency, Inaudible or Call Disconnected, Language Barrier; Abandoned Call and Outbound: 11 values each — same 6 plus Unable to Connect, Concern Resolved, Already taken appointment, Consulted in Other Hospital, Called By Mistake) was handed to the user as a paste-ready block for the `Dependencies` sheet
- **Specialty base list** — 40 PSRI specialties added to the `Picklists` sheet (Anesthesiology through Wellness)
- **Specialty → Doctor pairing** — **architecture changed**: PSRI's doctor roster is being connected as its own **live Google Sheet** (Doctor Master), not just typed into the Dependencies table, because it carries far more than a name (Consultation Charges, Availability, Specific Protocols, Appointment Details, Experience, etc.). Plan: (1) Dependencies sheet keeps a lightweight Specialty→Doctor Name pair (just for the Cases form's Doctor Name dropdown), sourced as a two-column extract from the live sheet; (2) a separate **Doctor Master lookup** (new n8n workflow, not yet built) reads the full live sheet for a future "Doctor Details" panel. Waiting on the live sheet's ID/share access + tab/column names from PSRI.

## Known Lessons / Gotchas
- **n8n field-mapping doesn't always survive JSON import** — both Google Sheets and Supabase nodes have shown blank "Fields to Send" after importing a workflow JSON, even though the export looked correct. Always manually verify field mappings on Insert/Update/Append nodes after import, same as verifying credentials.
- **Supabase node has no native OR-across-fields filter** — multi-field search (e.g. matching name OR mobile OR email) is done via several parallel `getAll` calls (one per field) feeding into a dedupe-by-id Code node, rather than one query.
- **ISD codes from bulk-imported data need normalizing** — the original Vtiger export stored `"91"` instead of `"+91"`; the List workflow normalizes this on read (prepends `+` if missing) so the frontend's ISD dropdown always matches.

## AI / Guidance Features (Cases form)

### Specialty AI Summary (built)
Cached, not live — specialties are a fixed ~40-value list, so summaries are generated **once** per specialty (English + Hindi) and stored, rather than calling OpenAI on every Case. Pieces:
- **`SpecialtySummaries` Google Sheet tab** (new, same "OM CRM - PSRI" sheet) — columns `Specialty`, `Summary EN`, `Summary HI`.
- **`n8n_psri_specialty_summary_generate.json`** (self-hosted instance) — `POST /psri-specialty-summary-generate`, run manually/occasionally: reads the `Specialty` Picklist, diffs against what's already cached, calls OpenAI (`gpt-4o-mini`) once per missing specialty for a 2-3 sentence EN+HI explanation aimed at a call-center agent reading aloud to a patient, appends each result. Re-running it is safe — already-cached specialties are skipped.
- **`n8n_psri_specialty_summaries_list.json`** (self-hosted) — `GET /psri-specialty-summaries`, simple cached read, same pattern as Picklists/Dependencies list workflows.
- **Frontend**: `SpecialtySummariesContext.jsx` (fetch-once-on-load, like `PicklistsContext`) + a `SpecialtyInfo` component in `CasesPage.jsx` — an "About {Specialty}" toggle next to the Specialty dropdown in the Appointment section, with an English/Hindi button toggle.
- Still needed: import + activate the 3 workflows, set the real `SpecialtySummaries`/`Picklists` sheet GIDs (placeholders in the JSON), connect the OpenAI credential, run the generator once.

### Agent Guidance / Next-Best-Action coaching (built)
Decided as **rule-based**, not LLM-generated — a lookup table, not a live AI call, so it's free, predictable, and editable directly in a sheet. Decided placement: **tooltip next to the active field** (an ⓘ icon, not a side panel or banner).
- **`Guidance` Google Sheet tab** (new, same "OM CRM - PSRI" sheet) — columns `Call For`, `Field`, `Tip`, `Suggested Script`. Each row is a rule: for a given Call For value + a specific form field, show this coaching tip (why it matters for customer satisfaction/business outcome) and this suggested phrase to say.
- **`n8n_psri_guidance_list.json`** (self-hosted) — `GET /psri-guidance`, same simple cached-read pattern.
- **Frontend**: `GuidanceContext.jsx` (fetch-once) + a `GuidanceTip` component wired next to the **Call For**, **Priority**, **Summary**, **Specialty**, and **Appointment Date** field labels in `CasesPage.jsx` — click the ⓘ to reveal the tip + suggested script for the currently-selected Call For.
- Still needed: paste the seed Guidance rows (given to the user as a paste-ready block) into the new `Guidance` tab, import/activate the workflow, set the sheet GID placeholder.

## Doctor/Specialty Lookup &amp; Contact History (built)

### Doctor &amp; Specialty Lookup — two independent workflows
Both run on the **self-hosted** instance (`automation.openmindhelpline.com`) — confirmed working via direct Postman testing, not the cloud instance originally assumed. "By Doctor" and "By Specialty" are **two completely separate search flows** sharing one UI card, with no shared state or mixed logic between them:

- **"By Doctor" tab** (`DoctorSearchTab` in `CasesPage.jsx`) → calls **Workflow 1 only**: `n8n_psri_doctor_lookup.json`, `POST /psri-doctor-search`. Webhook → Code (extract query) → Google Sheets (read `Doctors` tab) → Code (filter by doctor name + map every real column) → Code (build response) → Respond. Returns a flat list of matching doctors; click one for full detail (Education 1-3, Other Qualifications, Experience, Languages Known, Centre, OPD Schedule, Consultation Charges, Walk-In Protocol + count, CGHS Protocol, Specific Protocol, Block, Status).
- **"By Specialty" tab** (`SpecialtySearchTab` in `CasesPage.jsx`) → calls **Workflow 2 only**: `n8n_psri_specialty_search.json`, `POST /psri-specialty-search`. Webhook → Code (extract specialty) → Google Sheets (same `Doctors` tab) → Code (filter by specialty + map doctors) → Code (build AI prompt) → HTTP Request to OpenAI (`gpt-4o`, live per search, not cached) → Code (parse JSON response) → Respond. Returns `{ success, specialty, summaryEn, summaryHi, doctors: [...] }` — an AI-generated English+Hindi explanation of the specialty plus every doctor under it, in one response.
- **Note on overlap**: this live per-search AI generation is a *second*, separate source of specialty text from the already-built cached `SpecialtySummaries` system (used by the Appointment section's "About {Specialty}" toggle, generated once via batch job — see above). Not consolidated; both exist for different UI surfaces.
- **`Doctors` Google Sheet tab** — confirmed real headers: `Sr. No.`, `Doctor Name`, `Specialty`, `Education 1`, `Education 2`, `Education 3`, `Other Qualifications`, `Experience`, `Languages Known`, `Centre`, `OPD Schedule`, `Consultation Charges`, `Walk-In Protocol`, `If Yes (Number of Walk-Ins Allowed)`, `CGHS Protocol`, `Any Specific Protocol`, `Block`, `Status`. Both workflows' field mappings use these exact names — no more guessing.
- **`api/psri.js`** — `searchDoctors(query, searchBy)` and `searchSpecialty(specialty)`, both via the same self-hosted `BASE` (`/psri-webhook` proxy) — no separate cloud base needed.
- Still needed: import/activate `n8n_psri_specialty_search.json`, connect its Google Sheets credential + an OpenAI Header Auth credential (same generic-header pattern as the Specialty Summary Generator workflow).

### Contact History
`ContactHistoryPanel` in `CasesPage.jsx` — past Cases for the selected Contact, reusing the existing Cases search (by mobile) rather than a new workflow; excludes the case currently being edited.

## Tariff Chatbot

A call-center agent-facing chatbot that answers questions about PSRI's tariff schedule (room charges, OT, lab, packages, corporate rates, etc.) directly from the source documents.

### Architecture
- **Source files** — stored in Google Drive folder `10OCdknPRAng86Ecfod9Ngv7BMYRj1QVq` ("PSRI Tariff Docs"):
  - Tariff PDF (`Tariff FY 2025-26 as on 31.03.25 (5) (11) (4).pdf`) — **NOTE: this PDF is scanned (image-based), not text-based. No text can be extracted from it.** All useful tariff content must come from the Excel file.
  - Corporate/tariff Excel file — contains the actual rate data, works correctly.
- **Vector store** — Supabase `psri_knowledge` table (see `PSRI/Workflows/psri_knowledge_schema.sql`). Data persists across n8n executions (unlike the earlier in-memory store which was wiped after each workflow run).
- **Two n8n workflows**:
  - `n8n_psri_tariff_ingest.json` — runs on 2-day schedule. Clears the `psri_knowledge` table first, then downloads files from Drive, splits into chunks, embeds via OpenAI, stores in Supabase.
  - `n8n_psri_tariff_tool.json` — called as a sub-workflow by the main chat workflow. Classifies the query intent → identifies tariff categories → semantic search on `psri_knowledge` via `match_psri_knowledge()` → GPT-4.1-mini generates the answer from retrieved excerpts.

### Supabase schema
Table: `psri_knowledge(id, content, source, metadata jsonb, embedding vector(1536), created_at)`
Function: `match_psri_knowledge(query_embedding, match_threshold=0.3, match_count=6)`
Schema file: `PSRI/Workflows/psri_knowledge_schema.sql`

**Important**: run `ALTER TABLE psri_knowledge ALTER COLUMN source DROP NOT NULL;` — the n8n Supabase vector store node does not set the `source` column on insert, so it must be nullable. This line is included at the bottom of the schema file.

### Credential placeholders
All three Supabase nodes in `n8n_psri_tariff_ingest.json` and the one in `n8n_psri_tariff_tool.json` use `REPLACE_WITH_SUPABASE_CREDENTIAL_ID` — replace with the actual n8n credential ID after import.

### To populate for the first time
1. Run the schema SQL in Supabase (including the `DROP NOT NULL` line)
2. Import both workflow JSONs into n8n, replace credential IDs
3. Run the ingest workflow manually once — check `psri_knowledge` in Supabase Table Editor for rows
4. Test the tool workflow with a sample tariff question

### Known limitation
The tariff PDF is scanned (image-based) — the PDF loader extracts no text from it. Only the Excel file contributes data to the vector store. To fix: either obtain a text-based PDF from PSRI, OCR the existing PDF (open in Microsoft Word → save as new PDF), or add PDF-only content into the Excel file.

## Pending Items
- **Leads module** — explicitly deferred until Cases is solid; not yet scoped.
- **Google Maps city autocomplete** — discussed as a "nice to have" for the Country/State/City cascade; needs a Google Maps API key (billing-enabled) that doesn't exist yet — not started.
- **Real picklist & dependency data** — most lists currently only have a few test values; full PSRI-specific taxonomy (Type of Call → Call For → Type of Enquiry hierarchy from the original Vtiger pivot export) still needs to be entered via the admin pages.
- **147k historical Contacts** — were bulk-loaded directly into the original Google Sheet before the Supabase migration; need to be re-migrated into the Supabase `contacts` table (e.g. via CSV export/import in Supabase's Table Editor).

## Key Files
- `universal-crm/` — React app source (shell: `src/App.jsx`, `src/components/ProjectRail.jsx`; PSRI pages: `src/projects/psri/`; admin pages: `src/admin/`; shared contexts: `src/context/`)
- `PSRI/Workflows/*.json` — all n8n workflow exports (local only, not in git)
