-- ============================================================
-- PSRI CRM — MySQL Schema
-- Run this in your MySQL client (or `mysql < mysql_schema.sql`)
-- to create the contacts + cases tables.
--
-- Telephony (agents/call_logs) lives in a separate schema file —
-- see psri-telephony-service/schema.sql — because that data is
-- shared across every project (PSRI, VMM, future ones), not owned
-- by PSRI. There is no foreign key from call_logs into this
-- database's contact_id/case_id: other projects' contacts/cases
-- may live in an entirely different database, so the link is a
-- loose, application-level reference (matched by value), not an
-- enforced FK.
--
-- Design conventions used throughout (proper types, not a 1:1 port
-- of the old Postgres/Supabase TEXT-everything schema):
--   - IDs (business keys like CON12345678/CASE12345678, app-generated)
--     -> VARCHAR(20)
--   - created                       -> real TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     MySQL stamps it automatically — INSERTs should NOT pass a value for it
--   - email                         -> VARCHAR(255) + CHECK constraint (must look
--     like an email, or be empty — email is optional)
--   - phone-type fields (mobile, alt_mobile, landline, contact_mobile,
--     called_number) -> VARCHAR, NOT a numeric type (phone numbers are
--     identifiers, not quantities — leading zeros matter, no arithmetic
--     is ever done on them), + CHECK constraint restricting to digits only
--   - age                           -> TINYINT UNSIGNED (a real number).
--     NOTE for the 147k migration: any legacy/blank/non-numeric age value
--     must be cleaned to NULL before import — this column will reject
--     anything that isn't a plain number.
--   - short categorical/name fields -> VARCHAR(n); NOT MySQL ENUM, because
--     these values are admin-editable via the Picklists page at runtime —
--     an ENUM would break the moment an admin adds a new picklist value
--   - long free-form text (notes/summary/appreciation_details) -> TEXT
--   - booleans                      -> TINYINT(1) DEFAULT 0
--
-- CHECK constraints are enforced on MySQL 8.0.16+; on older MySQL/MariaDB
-- versions they're parsed but silently ignored (not an error either way).
--
-- Re-running this file: MySQL's CREATE TABLE has no clean
-- IF NOT EXISTS-safe equivalent for indexes across versions the
-- way Postgres does, so re-running against an already-created
-- schema will error on duplicate objects — that's expected, not
-- a bug. Drop/recreate manually if you need a clean rebuild.
-- ============================================================

-- ── CONTACTS TABLE ───────────────────────────────────────────
CREATE TABLE contacts (
  contact_id        VARCHAR(20)   NOT NULL PRIMARY KEY,      -- e.g. CON12345678
  salutation        VARCHAR(20)   NOT NULL DEFAULT '',
  full_name         VARCHAR(255)  NOT NULL,
  age               TINYINT UNSIGNED NULL,
  mobile_isd        VARCHAR(6)    NOT NULL DEFAULT '+91',
  mobile            VARCHAR(20)   NOT NULL,
  alt_mobile_isd    VARCHAR(6)    NOT NULL DEFAULT '+91',
  alt_mobile        VARCHAR(20)   NOT NULL DEFAULT '',
  landline_isd      VARCHAR(6)    NOT NULL DEFAULT '+91',
  landline          VARCHAR(20)   NOT NULL DEFAULT '',
  email             VARCHAR(255)  NOT NULL DEFAULT '',
  country           VARCHAR(5)    NOT NULL DEFAULT 'IN',
  state             VARCHAR(100)  NOT NULL DEFAULT '',
  city              VARCHAR(100)  NOT NULL DEFAULT '',
  contact_type      VARCHAR(50)   NOT NULL,
  source            VARCHAR(100)  NOT NULL DEFAULT '',
  language          VARCHAR(50)   NOT NULL DEFAULT '',
  assigned_to       VARCHAR(100)  NOT NULL DEFAULT '',
  notes             TEXT          NULL,
  created           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_contacts_email       CHECK (email = '' OR email REGEXP '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'),
  CONSTRAINT chk_contacts_mobile      CHECK (mobile REGEXP '^[0-9]+$'),
  CONSTRAINT chk_contacts_alt_mobile  CHECK (alt_mobile = '' OR alt_mobile REGEXP '^[0-9]+$'),
  CONSTRAINT chk_contacts_landline    CHECK (landline = '' OR landline REGEXP '^[0-9]+$'),
  INDEX idx_contacts_mobile    (mobile),
  INDEX idx_contacts_full_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── CASES TABLE ──────────────────────────────────────────────
CREATE TABLE cases (
  case_id                    VARCHAR(20)   NOT NULL PRIMARY KEY,   -- e.g. CASE12345678
  contact_id                 VARCHAR(20)   NOT NULL,
  contact_name               VARCHAR(255)  NOT NULL DEFAULT '',
  contact_mobile              VARCHAR(20)   NOT NULL DEFAULT '',
  channel                    VARCHAR(50)   NOT NULL DEFAULT '',
  called_number              VARCHAR(20)   NOT NULL DEFAULT '',
  call_txn_id                VARCHAR(64)   NOT NULL DEFAULT '',
  type_of_call               VARCHAR(50)   NOT NULL DEFAULT '',
  call_for                   VARCHAR(100)  NOT NULL DEFAULT '',
  type_of_enquiry            VARCHAR(100)  NOT NULL DEFAULT '',
  priority                   VARCHAR(20)   NOT NULL DEFAULT '',
  query_type                 VARCHAR(20)   NOT NULL DEFAULT '',   -- 'Basic' | 'Detailed'
  status                     VARCHAR(50)   NOT NULL DEFAULT '',
  summary                    TEXT          NULL,
  assigned_to                VARCHAR(100)  NOT NULL DEFAULT '',
  -- Appointment section
  is_appointment              TINYINT(1)    NOT NULL DEFAULT 0,
  specialty                  VARCHAR(100)  NOT NULL DEFAULT '',
  doctor_name                VARCHAR(150)  NOT NULL DEFAULT '',
  specific_doctor_requested  TINYINT(1)    NOT NULL DEFAULT 0,
  appointment_date           VARCHAR(20)   NOT NULL DEFAULT '',
  appointment_time           VARCHAR(20)   NOT NULL DEFAULT '',
  appointment_status         VARCHAR(50)   NOT NULL DEFAULT '',
  -- Complaint / Feedback section
  type_of_complaint          VARCHAR(100)  NOT NULL DEFAULT '',
  -- Emergency section
  type_of_emergency          VARCHAR(100)  NOT NULL DEFAULT '',
  -- Callback section
  is_callback                 TINYINT(1)    NOT NULL DEFAULT 0,
  callback_datetime          VARCHAR(30)   NOT NULL DEFAULT '',
  callback_completed         TINYINT(1)    NOT NULL DEFAULT 0,
  -- Transfer section
  is_transfer                 TINYINT(1)    NOT NULL DEFAULT 0,
  transferred_to             VARCHAR(100)  NOT NULL DEFAULT '',
  -- High Value section
  is_high_value                TINYINT(1)    NOT NULL DEFAULT 0,
  type_of_procedure          VARCHAR(100)  NOT NULL DEFAULT '',
  name_of_procedure          VARCHAR(150)  NOT NULL DEFAULT '',
  mode_of_payment            VARCHAR(50)   NOT NULL DEFAULT '',
  specialty_enquired_for     VARCHAR(100)  NOT NULL DEFAULT '',
  -- Appreciation section
  is_appreciation              TINYINT(1)    NOT NULL DEFAULT 0,
  appreciation_details       TEXT          NULL,
  -- Timestamp — MySQL-managed, do not pass a value for this on INSERT
  created                    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cases_contact FOREIGN KEY (contact_id) REFERENCES contacts(contact_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_cases_contact_mobile CHECK (contact_mobile = '' OR contact_mobile REGEXP '^[0-9]+$'),
  CONSTRAINT chk_cases_called_number  CHECK (called_number = '' OR called_number REGEXP '^[0-9]+$'),
  INDEX idx_cases_contact_id     (contact_id),
  INDEX idx_cases_contact_mobile (contact_mobile),
  INDEX idx_cases_status         (status),
  INDEX idx_cases_created        (created),
  INDEX idx_cases_call_txn_id    (call_txn_id)   -- matches call_logs.call_txn_id by value (no FK — see note above)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- To verify the tables were created correctly, run:
--   SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
--   FROM information_schema.columns
--   WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME IN ('contacts','cases')
--   ORDER BY TABLE_NAME, ORDINAL_POSITION;
-- ============================================================
