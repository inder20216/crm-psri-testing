# PSRI CRM — Daily Progress Log

Daily build-progress updates, structured so this file can be read by an automated workflow to generate a management notification. **Newest entry at the top.** Every entry uses the same four headings — `Shipped` / `In Progress` / `Blocked` / `Next` — so a script or LLM step can reliably pull just the latest entry (everything between the top `## <date>` heading and the next `## <date>` heading) without needing to parse the whole file.

To add today's entry: copy the template at the very bottom of this file, fill it in, and paste it directly under this line — above the most recent existing entry.

---

## 2026-09-01 — Telephony integration + CRM feature build-out (consolidated recap)

*This entry retroactively summarizes a recent multi-day push, since day-by-day entries weren't kept during it. Entries from here forward should be added per actual day.*

**Shipped:**
- Live SparkTG call capture via a direct webhook integration — every call is now recorded automatically, including ones missed while no agent had their dialer open (the old browser-only capture couldn't see those at all)
- Call Logs page rebuilt as a full-detail table: timestamps, call type, contact name, resolved agent name, recording playback, and every case linked to that call
- Missed Calls panel now live and accurate — tracks callback attempts (1st / 2nd / 3rd) and clears automatically once a number is reached
- Incomplete Cases — an in-progress case is now auto-saved if a new call interrupts it, plus a manual "save for later" option; a dedicated page lists drafts with the call recording attached for reference
- Multiple appointments per call — one call can now produce several linked cases (e.g. booking appointments for a caller and their spouse/kids with different doctors) without losing the call's details
- Query Type field (Basic / Detailed) added to case classification
- New Agent Productivity dashboard for TLs/Managers — per-agent call volume, average handle time, missed-call callback turnaround
- Assigned To field restricted to TL/Manager roles — agents can no longer see or change who a case is assigned to; it's always themselves by default
- Tariff Bot chat panel sizing bug fixed

**In Progress:**
- Tariff Bot answer accuracy — reported as sometimes incomplete/incorrect, root-caused to the retrieval step likely pulling too few source excerpts per question; fix pending confirmation

**Blocked:**
- VMM's SparkTG webhook — configuration request sent to SparkTG support, awaiting their reply

**Next:**
- Productivity dashboard Phase 2 — agent login/break time tracking (needs new SparkTG status-polling infrastructure)
- Working-hours-adjusted callback TAT (currently raw elapsed time, should exclude off-hours gaps)
- Full regression check of core Contacts/Cases functionality ahead of the complete cutover from the old system

---

## Template for new entries

## YYYY-MM-DD

**Shipped:**
-

**In Progress:**
-

**Blocked:**
-

**Next:**
-
