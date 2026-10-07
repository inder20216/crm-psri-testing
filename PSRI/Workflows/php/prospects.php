<?php
/**
 * prospects.php — direct PHP+MySQL Prospects endpoints, replacing the n8n
 * psri-prospect* webhooks. Ported 1:1 from the four n8n_psri_prospect*
 * workflow JSON files' SQL/mapping.
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function prospects_row_to_api(array $r): array {
    return [
        'id'            => $r['prospect_id']     ?? '',
        'contactId'     => $r['contact_id']      ?? '',
        'contactName'   => $r['contact_name']    ?? '',
        'contactMobile' => $r['contact_mobile']  ?? '',
        'firstCallDate' => $r['first_call_date'] ?? '',
        'callStatus'    => $r['call_status']     ?? '',
        'leadStatus'    => $r['lead_status']     ?? '',
        'finalStatus'   => $r['final_status']    ?? '',
        'attempts'      => $r['attempts']        ?? 0,
        'lastCallAt'    => $r['last_call_at']    ?? '',
        'nextCallAt'    => $r['next_call_at']    ?? '',
        'remarks'       => $r['remarks']         ?? '',
        'assignedTo'    => $r['assigned_to']     ?? '',
        'created'       => $r['created']         ?? '',
        'enquiryCount'  => $r['enquiry_count']   ?? 0,
        'enquiryTypes'  => $r['enquiry_types']   ?? '',
    ];
}

/** $status defaults to 'Followup' (the open-prospects view), matching the n8n version. */
function prospects_list(string $status, int $limit): array {
    $status = $status !== '' ? $status : 'Followup';
    $limit = min(max($limit > 0 ? $limit : 200, 1), 2000);

    $pdo = psri_db();
    $st = $pdo->prepare(
        "SELECT p.*, COUNT(pec.case_id) AS enquiry_count, GROUP_CONCAT(DISTINCT NULLIF(c.type_of_enquiry, '') SEPARATOR ', ') AS enquiry_types
         FROM prospects p
         LEFT JOIN prospect_enquiry_cases pec ON pec.prospect_id = p.prospect_id
         LEFT JOIN cases c ON c.case_id = pec.case_id
         WHERE p.final_status = ?
         GROUP BY p.prospect_id
         ORDER BY p.created DESC
         LIMIT $limit"
    );
    $st->execute([$status]);
    return array_map('prospects_row_to_api', $st->fetchAll());
}

/**
 * Fetch-then-diff, same shape as contacts_update()/cases_update() — but
 * only these 6 fields are editable, and every actual change gets its own
 * row in prospect_activity_log (the audit trail the Prospects page reads
 * back). first_call_date is set once, on whichever edit happens first.
 * Returns ['error' => string] or ['id' => string, 'message' => string].
 */
function prospects_update(array $b): array {
    $id = trim((string) ($b['id'] ?? ''));
    if ($id === '') return ['error' => 'Prospect id is required'];

    $pdo = psri_db();
    $st = $pdo->prepare('SELECT * FROM prospects WHERE prospect_id = ? LIMIT 1');
    $st->execute([$id]);
    $current = $st->fetch();
    if (!$current) return ['error' => 'Prospect not found'];

    $pick = static fn (string $key, string $col) => array_key_exists($key, $b) ? $b[$key] : ($current[$col] ?? '');

    $callStatus  = (string) $pick('callStatus', 'call_status');
    $leadStatus  = (string) $pick('leadStatus', 'lead_status');
    $finalStatus = (string) $pick('finalStatus', 'final_status');
    $nextCallAt  = $pick('nextCallAt', 'next_call_at');
    $remarks     = $pick('remarks', 'remarks');
    $assignedTo  = (string) $pick('assignedTo', 'assigned_to');

    $diffs = [];
    $check = static function (string $field, $old, $new) use (&$diffs) {
        $o = (string) ($old ?? '');
        $n = (string) ($new ?? '');
        if ($o !== $n) $diffs[] = ['field' => $field, 'old' => $o, 'new' => $n];
    };
    $check('call_status', $current['call_status'], $callStatus);
    $check('lead_status', $current['lead_status'], $leadStatus);
    $check('final_status', $current['final_status'], $finalStatus);
    $check('next_call_at', $current['next_call_at'], $nextCallAt);
    $check('remarks', $current['remarks'], $remarks);
    $check('assigned_to', $current['assigned_to'], $assignedTo);

    $upd = $pdo->prepare(
        'UPDATE prospects SET call_status = ?, lead_status = ?, final_status = ?, next_call_at = ?, remarks = ?, assigned_to = ?, first_call_date = IFNULL(first_call_date, CURDATE()) WHERE prospect_id = ?'
    );
    $upd->execute([
        $callStatus, $leadStatus, $finalStatus,
        ($nextCallAt === '' || $nextCallAt === null) ? null : $nextCallAt,
        ($remarks === '' || $remarks === null) ? null : $remarks,
        $assignedTo, $id,
    ]);

    if ($diffs) {
        $agentId   = (string) ($b['agentId'] ?? '');
        $agentName = (string) ($b['agentName'] ?? '');
        $ins = $pdo->prepare(
            'INSERT INTO prospect_activity_log (prospect_id, agent_id, agent_name, action, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($diffs as $d) {
            $ins->execute([$id, $agentId, $agentName, 'status_change', $d['field'], $d['old'], $d['new']]);
        }
    }

    return ['id' => $id, 'message' => 'Prospect updated'];
}

/** Click-to-call from the Prospects page: increments attempts, timestamps, logs the attempt. */
function prospects_call_attempt(array $b): array {
    $id = trim((string) ($b['id'] ?? ''));
    if ($id === '') return ['error' => 'Prospect id is required'];
    $agentId    = (string) ($b['agentId'] ?? '');
    $agentName  = (string) ($b['agentName'] ?? '');
    $callTxnId  = trim((string) ($b['callTxnId'] ?? ''));
    $note = $callTxnId !== ''
        ? "Call placed from Prospects page — txn {$callTxnId}"
        : 'Call placed from Prospects page';

    $pdo = psri_db();
    $pdo->prepare(
        'UPDATE prospects SET attempts = attempts + 1, last_call_at = NOW(), first_call_date = IFNULL(first_call_date, CURDATE()), assigned_to = ? WHERE prospect_id = ?'
    )->execute([$agentId, $id]);
    $pdo->prepare(
        "INSERT INTO prospect_activity_log (prospect_id, agent_id, agent_name, action, note) VALUES (?, ?, ?, 'call_attempt', ?)"
    )->execute([$id, $agentId, $agentName, $note]);

    return ['id' => $id, 'message' => 'Call attempt recorded'];
}

function prospects_activity_list(string $prospectId): array {
    if ($prospectId === '') return [];
    $pdo = psri_db();
    $st = $pdo->prepare('SELECT * FROM prospect_activity_log WHERE prospect_id = ? ORDER BY created DESC LIMIT 200');
    $st->execute([$prospectId]);
    return array_map(static fn (array $r) => [
        'id'           => $r['id'],
        'prospectId'   => $r['prospect_id'],
        'agentId'      => $r['agent_id']      ?? '',
        'agentName'    => $r['agent_name']    ?? '',
        'action'       => $r['action']        ?? '',
        'fieldChanged' => $r['field_changed'] ?? '',
        'oldValue'     => $r['old_value']     ?? '',
        'newValue'     => $r['new_value']     ?? '',
        'note'         => $r['note']          ?? '',
        'created'      => $r['created']       ?? '',
    ], $st->fetchAll());
}
