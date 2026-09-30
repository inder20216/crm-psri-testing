<?php
/**
 * cases.php — direct PHP+MySQL Cases endpoints, replacing the n8n
 * psri-cases* webhooks. Ported 1:1 from
 * PSRI/Workflows/n8n_psri_cases_list_mysql.json's SQL/mapping.
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';

/** Maps a full cases row to the camelCase shape the Cases page expects. */
function cases_row_to_api(array $r): array {
    return [
        'id'                      => $r['case_id']                   ?? '',
        'contactId'               => $r['contact_id']                ?? '',
        'contactName'             => $r['contact_name']              ?? '',
        'contactMobile'           => $r['contact_mobile']            ?? '',
        'channel'                 => $r['channel']                   ?? '',
        'calledNumber'            => $r['called_number']             ?? '',
        'callTxnId'               => $r['call_txn_id']                ?? '',
        'typeOfCall'              => $r['type_of_call']               ?? '',
        'callFor'                 => $r['call_for']                   ?? '',
        'typeOfEnquiry'           => $r['type_of_enquiry']            ?? '',
        'priority'                => $r['priority']                   ?? '',
        'queryType'               => $r['query_type']                 ?? '',
        'status'                  => $r['status']                     ?? '',
        'summary'                 => $r['summary']                    ?? '',
        'assignedTo'              => $r['assigned_to']                ?? '',
        'isAppointment'           => (bool) ($r['is_appointment']            ?? false),
        'specialty'               => $r['specialty']                  ?? '',
        'doctorName'              => $r['doctor_name']                ?? '',
        'specificDoctorRequested' => (bool) ($r['specific_doctor_requested'] ?? false),
        'appointmentDate'         => $r['appointment_date']           ?? '',
        'appointmentTime'         => $r['appointment_time']           ?? '',
        'appointmentStatus'       => $r['appointment_status']         ?? '',
        'typeOfComplaint'         => $r['type_of_complaint']          ?? '',
        'typeOfEmergency'         => $r['type_of_emergency']          ?? '',
        'isCallback'              => (bool) ($r['is_callback']               ?? false),
        'callbackDatetime'        => $r['callback_datetime']          ?? '',
        'callbackCompleted'       => (bool) ($r['callback_completed']        ?? false),
        'isTransfer'              => (bool) ($r['is_transfer']               ?? false),
        'transferredTo'           => $r['transferred_to']             ?? '',
        'isHighValue'             => (bool) ($r['is_high_value']             ?? false),
        'typeOfProcedure'         => $r['type_of_procedure']          ?? '',
        'nameOfProcedure'         => $r['name_of_procedure']          ?? '',
        'modeOfPayment'           => $r['mode_of_payment']            ?? '',
        'specialtyEnquiredFor'    => $r['specialty_enquired_for']     ?? '',
        'isAppreciation'          => (bool) ($r['is_appreciation']           ?? false),
        'appreciationDetails'     => $r['appreciation_details']       ?? '',
        'created'                 => $r['created']                    ?? '',
    ];
}

/**
 * Same priority order as the n8n version: callTxnIds (exact IN list) >
 * status (exact) > q (fuzzy search) > 50 most recent.
 */
function cases_list(array $params): array {
    $pdo = psri_db();

    $callTxnIds = trim((string) ($params['callTxnIds'] ?? ''));
    if ($callTxnIds !== '') {
        $ids = array_slice(array_filter(array_map('trim', explode(',', $callTxnIds))), 0, 500);
        if (empty($ids)) return [];
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT * FROM cases WHERE call_txn_id IN ($placeholders) ORDER BY created DESC");
        $st->execute(array_values($ids));
        return array_map('cases_row_to_api', $st->fetchAll());
    }

    $status = trim((string) ($params['status'] ?? ''));
    if ($status !== '') {
        $st = $pdo->prepare('SELECT * FROM cases WHERE status = ? ORDER BY created DESC LIMIT 100');
        $st->execute([$status]);
        return array_map('cases_row_to_api', $st->fetchAll());
    }

    $q = trim((string) ($params['q'] ?? ''));
    if ($q !== '') {
        $like = '%' . $q . '%';
        $st = $pdo->prepare('SELECT * FROM cases WHERE contact_name LIKE ? OR contact_mobile LIKE ? OR summary LIKE ? ORDER BY created DESC LIMIT 50');
        $st->execute([$like, $like, $like]);
        return array_map('cases_row_to_api', $st->fetchAll());
    }

    $st = $pdo->query('SELECT * FROM cases ORDER BY created DESC LIMIT 50');
    return array_map('cases_row_to_api', $st->fetchAll());
}

/**
 * Ported 1:1 from n8n_psri_case_add_mysql.json, including its two
 * independent Prospects side effects (both fire off the same insert,
 * neither affects the response):
 *  - call_for === 'Enquiry or Transfer' → find/create an open Prospect for
 *    this contact, link this case to it, log the activity.
 *  - is_appointment → auto-converts any open Prospect for this contact
 *    (lead booked via incoming call), logs the activity.
 * Returns ['error' => string] or ['id' => string, 'message' => string].
 */
function cases_add(array $b): array {
    $isDraft = ($b['status'] ?? '') === 'Incomplete';

    if (empty($b['contactId'])) return ['error' => 'Select or create a contact first'];
    if (!$isDraft) {
        if (($b['channel'] ?? '') === 'Call' && empty($b['typeOfCall'])) return ['error' => 'Type of Call is required for Call channel'];
        if (empty($b['callFor'])) return ['error' => 'Call For is required'];
        if (trim((string) ($b['summary'] ?? '')) === '') return ['error' => 'Summary is required'];
    }

    $pdo = psri_db();
    $newId = 'CASE' . substr((string) round(microtime(true) * 1000), -8);

    $callFor      = (string) ($b['callFor'] ?? '');
    $isAppointment = !empty($b['isAppointment']);
    $callTxnId    = (string) ($b['callTxnId'] ?? '');
    $contactId    = (string) $b['contactId'];
    $contactName  = (string) ($b['contactName'] ?? '');
    $contactMobile = (string) ($b['contactMobile'] ?? '');
    $assignedTo   = (string) ($b['assignedTo'] ?? '');

    $ins = $pdo->prepare(
        'INSERT INTO cases (case_id, contact_id, contact_name, contact_mobile, channel, called_number, call_txn_id, type_of_call, call_for, type_of_enquiry, priority, query_type, status, summary, assigned_to, is_appointment, specialty, doctor_name, specific_doctor_requested, appointment_date, appointment_time, appointment_status, type_of_complaint, type_of_emergency, is_callback, callback_datetime, callback_completed, is_transfer, transferred_to, is_high_value, type_of_procedure, name_of_procedure, mode_of_payment, specialty_enquired_for, is_appreciation, appreciation_details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $ins->execute([
        $newId, $contactId, $contactName, $contactMobile,
        (string) ($b['channel'] ?? ''), (string) ($b['calledNumber'] ?? ''), $callTxnId,
        (string) ($b['typeOfCall'] ?? ''), $callFor, (string) ($b['typeOfEnquiry'] ?? ''),
        (string) ($b['priority'] ?? ''), (string) ($b['queryType'] ?? ''), (string) ($b['status'] ?? ''),
        trim((string) ($b['summary'] ?? '')), $assignedTo,
        $isAppointment ? 1 : 0,
        (string) ($b['specialty'] ?? ''), (string) ($b['doctorName'] ?? ''),
        !empty($b['specificDoctorRequested']) ? 1 : 0,
        (string) ($b['appointmentDate'] ?? ''), (string) ($b['appointmentTime'] ?? ''), (string) ($b['appointmentStatus'] ?? ''),
        (string) ($b['typeOfComplaint'] ?? ''), (string) ($b['typeOfEmergency'] ?? ''),
        !empty($b['isCallback']) ? 1 : 0, (string) ($b['callbackDatetime'] ?? ''), !empty($b['callbackCompleted']) ? 1 : 0,
        !empty($b['isTransfer']) ? 1 : 0, (string) ($b['transferredTo'] ?? ''),
        !empty($b['isHighValue']) ? 1 : 0, (string) ($b['typeOfProcedure'] ?? ''), (string) ($b['nameOfProcedure'] ?? ''),
        (string) ($b['modeOfPayment'] ?? ''), (string) ($b['specialtyEnquiredFor'] ?? ''),
        !empty($b['isAppreciation']) ? 1 : 0, (string) ($b['appreciationDetails'] ?? ''),
    ]);

    if ($callTxnId !== '') {
        $pdo->prepare("UPDATE call_logs SET case_id = ? WHERE project = 'psri' AND call_txn_id = ?")
            ->execute([$newId, $callTxnId]);
    }

    if ($callFor === 'Enquiry or Transfer') {
        cases_link_prospect_enquiry($pdo, $contactId, $contactName, $contactMobile, $newId, $assignedTo);
    }

    if ($isAppointment) {
        cases_auto_convert_prospect($pdo, $contactId, $assignedTo);
    }

    return ['id' => $newId, 'message' => 'Case created'];
}

/** Find-or-create the contact's open Prospect, link this case to it, log the activity. */
function cases_link_prospect_enquiry(PDO $pdo, string $contactId, string $contactName, string $contactMobile, string $caseId, string $assignedTo): void {
    $st = $pdo->prepare("SELECT prospect_id FROM prospects WHERE contact_id = ? AND final_status = 'Followup' LIMIT 1");
    $st->execute([$contactId]);
    $found = $st->fetchColumn();
    $isNew = $found === false;
    $prospectId = $isNew ? ('PROS' . substr((string) round(microtime(true) * 1000), -8)) : (string) $found;

    if ($isNew) {
        $pdo->prepare("INSERT INTO prospects (prospect_id, contact_id, contact_name, contact_mobile, final_status, assigned_to) VALUES (?, ?, ?, ?, 'Followup', ?)")
            ->execute([$prospectId, $contactId, $contactName, $contactMobile, $assignedTo]);
    }

    $pdo->prepare('INSERT IGNORE INTO prospect_enquiry_cases (prospect_id, case_id) VALUES (?, ?)')
        ->execute([$prospectId, $caseId]);

    $action = $isNew ? 'created' : 'linked';
    $note   = $isNew ? 'Prospect created from new enquiry' : 'Additional enquiry linked to existing prospect';
    $pdo->prepare("INSERT INTO prospect_activity_log (prospect_id, agent_id, agent_name, action, note) VALUES (?, ?, 'System', ?, ?)")
        ->execute([$prospectId, $assignedTo, $action, $note]);
}

/**
 * Ported 1:1 from n8n_psri_case_update_mysql.json — fetch-then-diff, same
 * pattern as contacts_update(). No Prospects side effects here (those only
 * fire on case creation). Always writes every field (not a partial update).
 */
function cases_update(array $b): array {
    $id = trim((string) ($b['id'] ?? ''));
    if ($id === '') return ['error' => 'Case id is required'];

    $pdo = psri_db();
    $st = $pdo->prepare('SELECT * FROM cases WHERE case_id = ? LIMIT 1');
    $st->execute([$id]);
    $current = $st->fetch();
    if (!$current) return ['error' => 'Case not found'];

    $pick     = static fn (string $key, string $col) => array_key_exists($key, $b) ? $b[$key] : ($current[$col] ?? '');
    $pickBool = static fn (string $key, string $col) => (array_key_exists($key, $b) ? !empty($b[$key]) : !empty($current[$col])) ? 1 : 0;

    $typeOfCall = (string) $pick('typeOfCall', 'type_of_call');
    $callFor    = (string) $pick('callFor', 'call_for');
    $summary    = trim((string) $pick('summary', 'summary'));
    $isDraft    = $pick('status', 'status') === 'Incomplete';

    if (!$isDraft) {
        if ($typeOfCall === '') return ['error' => 'Type of Call is required'];
        if ($callFor === '') return ['error' => 'Call For is required'];
        if ($summary === '') return ['error' => 'Summary is required'];
    }

    $upd = $pdo->prepare(
        'UPDATE cases SET contact_id=?, contact_name=?, contact_mobile=?, channel=?, called_number=?, call_txn_id=?, type_of_call=?, call_for=?, type_of_enquiry=?, priority=?, query_type=?, status=?, summary=?, assigned_to=?, is_appointment=?, specialty=?, doctor_name=?, specific_doctor_requested=?, appointment_date=?, appointment_time=?, appointment_status=?, type_of_complaint=?, type_of_emergency=?, is_callback=?, callback_datetime=?, callback_completed=?, is_transfer=?, transferred_to=?, is_high_value=?, type_of_procedure=?, name_of_procedure=?, mode_of_payment=?, specialty_enquired_for=?, is_appreciation=?, appreciation_details=? WHERE case_id=?'
    );
    $upd->execute([
        (string) $pick('contactId', 'contact_id'),
        (string) $pick('contactName', 'contact_name'),
        (string) $pick('contactMobile', 'contact_mobile'),
        (string) $pick('channel', 'channel'),
        (string) $pick('calledNumber', 'called_number'),
        (string) $pick('callTxnId', 'call_txn_id'),
        $typeOfCall,
        $callFor,
        (string) $pick('typeOfEnquiry', 'type_of_enquiry'),
        (string) $pick('priority', 'priority'),
        (string) $pick('queryType', 'query_type'),
        (string) $pick('status', 'status'),
        $summary,
        (string) $pick('assignedTo', 'assigned_to'),
        $pickBool('isAppointment', 'is_appointment'),
        (string) $pick('specialty', 'specialty'),
        (string) $pick('doctorName', 'doctor_name'),
        $pickBool('specificDoctorRequested', 'specific_doctor_requested'),
        (string) $pick('appointmentDate', 'appointment_date'),
        (string) $pick('appointmentTime', 'appointment_time'),
        (string) $pick('appointmentStatus', 'appointment_status'),
        (string) $pick('typeOfComplaint', 'type_of_complaint'),
        (string) $pick('typeOfEmergency', 'type_of_emergency'),
        $pickBool('isCallback', 'is_callback'),
        (string) $pick('callbackDatetime', 'callback_datetime'),
        $pickBool('callbackCompleted', 'callback_completed'),
        $pickBool('isTransfer', 'is_transfer'),
        (string) $pick('transferredTo', 'transferred_to'),
        $pickBool('isHighValue', 'is_high_value'),
        (string) $pick('typeOfProcedure', 'type_of_procedure'),
        (string) $pick('nameOfProcedure', 'name_of_procedure'),
        (string) $pick('modeOfPayment', 'mode_of_payment'),
        (string) $pick('specialtyEnquiredFor', 'specialty_enquired_for'),
        $pickBool('isAppreciation', 'is_appreciation'),
        (string) $pick('appreciationDetails', 'appreciation_details'),
        $id,
    ]);

    return ['id' => $id, 'message' => 'Case updated'];
}

/** If the contact has an open Prospect, auto-convert it — an appointment case means the lead converted. */
function cases_auto_convert_prospect(PDO $pdo, string $contactId, string $assignedTo): void {
    $st = $pdo->prepare("SELECT prospect_id FROM prospects WHERE contact_id = ? AND final_status = 'Followup' LIMIT 1");
    $st->execute([$contactId]);
    $prospectId = $st->fetchColumn();
    if ($prospectId === false) return;

    $pdo->prepare("UPDATE prospects SET final_status = 'Converted' WHERE prospect_id = ?")->execute([$prospectId]);
    $pdo->prepare(
        "INSERT INTO prospect_activity_log (prospect_id, agent_id, agent_name, action, field_changed, old_value, new_value, note)
         VALUES (?, ?, 'System', 'auto_converted', 'final_status', 'Followup', 'Converted', 'Lead converted via incoming call')"
    )->execute([$prospectId, $assignedTo]);
}

/**
 * Appreciation review list — every case with is_appreciation=1, joined to
 * call_logs (by call_txn_id, a value-match not a real FK — see
 * mysql_schema.sql) to pull the recording a TL needs to actually audit the
 * appreciation against. $status filters: 'pending' | 'approved' | 'rejected'
 * (blank = all).
 */
function cases_appreciation_list(string $status): array {
    $pdo = psri_db();
    $sql = "SELECT c.*, cl.recording_url, cl.duration_seconds
            FROM cases c
            LEFT JOIN call_logs cl ON cl.project = 'psri' AND cl.call_txn_id = c.call_txn_id AND c.call_txn_id <> ''
            WHERE c.is_appreciation = 1";
    if ($status === 'pending')  $sql .= ' AND c.appreciation_approved IS NULL';
    if ($status === 'approved') $sql .= ' AND c.appreciation_approved = 1';
    if ($status === 'rejected') $sql .= ' AND c.appreciation_approved = 0';
    $sql .= ' ORDER BY c.created DESC';

    $rows = $pdo->query($sql)->fetchAll();
    $usersMap = report_users_map();

    return array_map(static function (array $r) use ($usersMap) {
        $out = cases_row_to_api($r);
        $out['recordingUrl']            = $r['recording_url']              ?? '';
        $out['callDurationSeconds']      = $r['duration_seconds']           ?? null;
        $out['appreciationApproved']     = $r['appreciation_approved'] === null ? null : (bool) $r['appreciation_approved'];
        $out['appreciationReviewedBy']   = $usersMap[$r['appreciation_reviewed_by'] ?? ''] ?? ($r['appreciation_reviewed_by'] ?? '');
        $out['appreciationReviewedAt']   = $r['appreciation_reviewed_at'] ?? '';
        if ($out['assignedTo'] !== '') $out['assignedTo'] = $usersMap[$out['assignedTo']] ?? $out['assignedTo'];
        return $out;
    }, $rows);
}

/** Records a TL's Yes/No decision on one appreciation case. */
function cases_appreciation_review(array $b): array {
    $caseId = trim((string) ($b['caseId'] ?? ''));
    if ($caseId === '') return ['error' => 'Case id is required'];
    if (!array_key_exists('approved', $b) || $b['approved'] === null) return ['error' => 'A Yes/No decision is required'];
    $reviewedBy = trim((string) ($b['reviewedBy'] ?? ''));
    if ($reviewedBy === '') return ['error' => 'Reviewer is required'];

    $pdo = psri_db();
    $st = $pdo->prepare('SELECT case_id FROM cases WHERE case_id = ? AND is_appreciation = 1');
    $st->execute([$caseId]);
    if (!$st->fetchColumn()) return ['error' => 'Appreciation case not found'];

    $pdo->prepare(
        'UPDATE cases SET appreciation_approved = ?, appreciation_reviewed_by = ?, appreciation_reviewed_at = NOW() WHERE case_id = ?'
    )->execute([!empty($b['approved']) ? 1 : 0, $reviewedBy, $caseId]);

    return ['id' => $caseId, 'message' => 'Appreciation reviewed'];
}
