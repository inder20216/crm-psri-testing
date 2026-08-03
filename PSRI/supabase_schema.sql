-- ============================================================
-- PSRI CRM — Supabase Schema
-- Run this in Supabase SQL Editor to create both tables.
-- Project: Open Mind Services — PSRI Hospital CRM
-- ============================================================

-- ── CONTACTS TABLE ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  contact_id        TEXT PRIMARY KEY,              -- e.g. CON12345678
  salutation        TEXT DEFAULT '',
  full_name         TEXT NOT NULL,
  age               TEXT DEFAULT '',
  mobile_isd        TEXT DEFAULT '+91',
  mobile            TEXT NOT NULL,
  alt_mobile_isd    TEXT DEFAULT '+91',
  alt_mobile        TEXT DEFAULT '',
  landline_isd      TEXT DEFAULT '+91',
  landline          TEXT DEFAULT '',
  email             TEXT DEFAULT '',
  country           TEXT DEFAULT 'IN',
  state             TEXT DEFAULT '',
  city              TEXT DEFAULT '',
  contact_type      TEXT NOT NULL,
  source            TEXT DEFAULT '',
  language          TEXT DEFAULT '',
  assigned_to       TEXT DEFAULT '',
  notes             TEXT DEFAULT '',
  created           TIMESTAMPTZ DEFAULT now()
);

-- Index for fast mobile searches (used by duplicate check and contact search)
CREATE INDEX IF NOT EXISTS idx_contacts_mobile    ON contacts (mobile);
CREATE INDEX IF NOT EXISTS idx_contacts_full_name ON contacts (full_name);

-- ── CASES TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  case_id                    TEXT PRIMARY KEY,     -- e.g. CASE12345678
  contact_id                 TEXT NOT NULL REFERENCES contacts(contact_id),
  contact_name               TEXT DEFAULT '',
  contact_mobile             TEXT DEFAULT '',
  channel                    TEXT DEFAULT '',
  called_number              TEXT DEFAULT '',
  call_txn_id                TEXT DEFAULT '',
  type_of_call               TEXT DEFAULT '',
  call_for                   TEXT NOT NULL,
  type_of_enquiry            TEXT DEFAULT '',
  priority                   TEXT DEFAULT '',
  status                     TEXT DEFAULT '',
  summary                    TEXT NOT NULL,
  assigned_to                TEXT DEFAULT '',
  -- Appointment section
  is_appointment             BOOLEAN DEFAULT FALSE,
  specialty                  TEXT DEFAULT '',
  doctor_name                TEXT DEFAULT '',
  specific_doctor_requested  BOOLEAN DEFAULT FALSE,
  appointment_date           TEXT DEFAULT '',
  appointment_time           TEXT DEFAULT '',
  appointment_status         TEXT DEFAULT '',
  -- Complaint / Feedback section
  type_of_complaint          TEXT DEFAULT '',
  -- Emergency section
  type_of_emergency          TEXT DEFAULT '',
  -- Callback section
  is_callback                BOOLEAN DEFAULT FALSE,
  callback_datetime          TEXT DEFAULT '',
  callback_completed         BOOLEAN DEFAULT FALSE,
  -- Transfer section
  is_transfer                BOOLEAN DEFAULT FALSE,
  transferred_to             TEXT DEFAULT '',
  -- High Value section
  is_high_value              BOOLEAN DEFAULT FALSE,
  type_of_procedure          TEXT DEFAULT '',
  name_of_procedure          TEXT DEFAULT '',
  mode_of_payment            TEXT DEFAULT '',
  specialty_enquired_for     TEXT DEFAULT '',
  -- Appreciation section
  is_appreciation            BOOLEAN DEFAULT FALSE,
  appreciation_details       TEXT DEFAULT '',
  -- Timestamp
  created                    TIMESTAMPTZ DEFAULT now()
);

-- Indexes for case search and contact history lookup
CREATE INDEX IF NOT EXISTS idx_cases_contact_id     ON cases (contact_id);
CREATE INDEX IF NOT EXISTS idx_cases_contact_mobile ON cases (contact_mobile);
CREATE INDEX IF NOT EXISTS idx_cases_created        ON cases (created DESC);
CREATE INDEX IF NOT EXISTS idx_cases_status         ON cases (status);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
-- Disable RLS (n8n uses the service role key which bypasses RLS anyway,
-- but disabling it avoids confusing "permission denied" errors during setup).
ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE cases    DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- To verify the tables were created correctly, run:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'contacts' ORDER BY ordinal_position;
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'cases' ORDER BY ordinal_position;
-- ============================================================
