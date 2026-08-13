-- ============================================================
-- Telephony Service — MySQL Schema
-- Run this in your MySQL client (or `mysql < schema.sql`) to
-- create the agents + call_logs tables.
--
-- These two tables are shared across every process that uses this
-- service (PSRI, VMM, future ones) — every row is tagged with a
-- `project` column. There are no foreign keys into any project's
-- own contacts/cases tables: those may live in a completely
-- different database (VMM's does), so contact_id/case_id are
-- loose, application-level references matched by value, not
-- enforced FKs. Uniqueness and lookups are scoped per (project, ...)
-- instead.
-- ============================================================

-- ── AGENTS TABLE ─────────────────────────────────────────────
-- Local mirror of each project's SparkTG agent roster (GET /api/v1/agents).
CREATE TABLE agents (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project          VARCHAR(20)   NOT NULL,                -- 'psri' | 'vmm' | ...
  agent_id         VARCHAR(20)   NOT NULL,                -- SparkTG's own `id`, scoped to that project's SparkTG account
  sparktg_user_id  VARCHAR(20)   NOT NULL DEFAULT '',      -- SparkTG's `user_id` (distinct field)
  name             VARCHAR(150)  NOT NULL DEFAULT '',
  number           VARCHAR(20)   NOT NULL DEFAULT '',
  status_code      INT           NOT NULL DEFAULT 0,       -- raw SparkTG status int — mapping unverified, kept undecoded
  last_synced      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agents_project_agent_id (project, agent_id),
  INDEX idx_agents_project_number (project, number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── CALL_LOGS TABLE ──────────────────────────────────────────
-- The core CDR table. One row per SparkTG call per project
-- (call_txn_id is unique within a project — different projects'
-- SparkTG accounts could theoretically reuse ids, hence the
-- composite uniqueness), created the instant a call starts and
-- enriched over its lifecycle.
CREATE TABLE call_logs (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project           VARCHAR(20)   NOT NULL,                    -- 'psri' | 'vmm' | ...
  call_txn_id       VARCHAR(64)   NOT NULL,                    -- SparkTG callId/xnid
  direction         VARCHAR(10)   NOT NULL DEFAULT '',          -- 'inbound' | 'outbound'
  phone             VARCHAR(20)   NOT NULL DEFAULT '',          -- normalized caller/callee number
  called_number     VARCHAR(20)   NOT NULL DEFAULT '',          -- DID that was called
  agent_id          VARCHAR(20)   NULL,                         -- loose reference to agents.agent_id within the same project (SparkTG's own id — best-effort, often unset)
  agent_email       VARCHAR(255)  NOT NULL DEFAULT '',          -- the CRM's own logged-in-agent identity — this is the reliable "who handled this call" field, since agents are known by email on the SparkTG side and the CRM already knows who's logged in
  contact_id        VARCHAR(20)   NULL,                         -- loose reference to that project's own contacts table
  case_id           VARCHAR(20)   NULL,                         -- loose reference to that project's own cases table
  status            VARCHAR(20)   NOT NULL DEFAULT 'started',   -- 'started' | 'ended' | 'enriched'
  disposition       VARCHAR(50)   NOT NULL DEFAULT '',
  duration_seconds  INT           NULL,
  recording_url     VARCHAR(500)  NOT NULL DEFAULT '',
  ivr_data          TEXT          NULL,                         -- raw JSON string of ivrData, kept opaque
  started_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at          TIMESTAMP     NULL,
  raw_payload       JSON          NULL,                         -- full raw event payload, for debugging/re-mapping
  created           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_call_logs_project_txn (project, call_txn_id),
  INDEX idx_call_logs_project_phone      (project, phone),
  INDEX idx_call_logs_project_contact_id (project, contact_id),
  INDEX idx_call_logs_project_case_id    (project, case_id),
  INDEX idx_call_logs_project_agent_email (project, agent_email),
  INDEX idx_call_logs_started_at         (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- To verify:
--   SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
--   FROM information_schema.columns
--   WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME IN ('agents','call_logs')
--   ORDER BY TABLE_NAME, ORDINAL_POSITION;
-- ============================================================
