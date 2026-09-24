<?php
/**
 * runner.php — the PSRI workflow engine (replaces the n8n runner).
 *
 * Executes graphs saved by the React Flow designer. The contract is
 * src/admin/workflow/schema.js toConfig():
 *   { v:1, nodes:[{ id, type, data:{ actionType, config } }],
 *          edges:[{ source, target, sourceHandle: 'true'|'false'|null }] }
 *
 * Walk: breadth-first from the trigger node (contactCreated / caseCreated).
 * A condition node follows only the edges on its True or False handle; any
 * other node follows all outgoing edges. A node reached by two branches
 * runs once. Conditions are evaluated live, so a value written by an
 * earlier Update Contact node is visible to a later condition.
 *
 * Templates: {{contact.<field>}} and {{case.<field>}} (camelCase keys, the
 * same objects the CRM submits when saving a contact / case).
 *
 * This file only defines functions — api.php is the HTTP/CLI entry point.
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';

const WF_TRIGGER_NODE = ['contact-created' => 'contactCreated', 'case-created' => 'caseCreated'];

const WF_LABELS = [
    'assign' => 'Assign contact', 'createCase' => 'Create case', 'updateContact' => 'Update contact',
    'sheetRow' => 'Append list row', 'webhook' => 'Call webhook', 'notify' => 'Send notification',
    'condition' => 'Condition',
];

// Contact field key (schema.js CONTACT_FIELDS) → contacts column.
const WF_CONTACT_COLUMNS = [
    'name' => 'full_name', 'salutation' => 'salutation', 'age' => 'age', 'mobile' => 'mobile',
    'altMobile' => 'alt_mobile', 'landline' => 'landline', 'email' => 'email', 'country' => 'country',
    'state' => 'state', 'city' => 'city', 'contactType' => 'contact_type', 'source' => 'source',
    'language' => 'language', 'assignedTo' => 'assigned_to', 'notes' => 'notes',
];

// "Append Row to Sheet" nodes now write to MySQL list tables, picked by the
// node's tab name (case/space-insensitive).
const WF_LISTS = ['newcontacts' => 'new_contacts', 'newcases' => 'new_cases'];

// Row "Column" labels (normalized) → list-table column.
const WF_LIST_COLUMNS = [
    'contactname' => 'contact_name', 'fullname' => 'contact_name', 'name' => 'contact_name',
    'contact' => 'contact_name', 'patientname' => 'contact_name',
    'mobile' => 'mobile', 'contactmobile' => 'mobile', 'phone' => 'mobile', 'mobilenumber' => 'mobile',
    'source' => 'source', 'leadtype' => 'lead_type', 'caseid' => 'case_id', 'contactid' => 'contact_id',
    'specialty' => 'specialty', 'speciality' => 'specialty', 'summary' => 'summary',
    'casesummary' => 'summary', 'priority' => 'priority', 'status' => 'status',
];

// ── Schema ────────────────────────────────────────────────────────────────

/** Creates the runner-owned tables if missing (safe to re-run). */
function psri_migrate(): array {
    $pdo = psri_db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS workflows (
        workflow_id VARCHAR(64) NOT NULL PRIMARY KEY,
        name        VARCHAR(200) NOT NULL DEFAULT '',
        trigger_key VARCHAR(50)  NOT NULL DEFAULT 'contact-created',
        status      VARCHAR(10)  NOT NULL DEFAULT 'Draft',
        graph_json  LONGTEXT     NOT NULL,
        updated_by  VARCHAR(120) NOT NULL DEFAULT '',
        created     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_wf_trigger_status (trigger_key, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        workflow_id   VARCHAR(64)  NOT NULL DEFAULT '',
        workflow_name VARCHAR(200) NOT NULL DEFAULT '',
        trigger_key   VARCHAR(50)  NOT NULL DEFAULT '',
        contact_id    VARCHAR(20)  NOT NULL DEFAULT '',
        contact_name  VARCHAR(255) NOT NULL DEFAULT '',
        case_id       VARCHAR(20)  NOT NULL DEFAULT '',
        node_id       VARCHAR(64)  NOT NULL DEFAULT '',
        action        VARCHAR(60)  NOT NULL DEFAULT '',
        status        VARCHAR(10)  NOT NULL DEFAULT 'ok',
        error         TEXT         NULL,
        created       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_runs_workflow   (workflow_id, created),
        INDEX idx_runs_contact_id (contact_id),
        INDEX idx_runs_case_id    (case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS new_contacts (
        log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        case_id VARCHAR(20) NOT NULL DEFAULT '',
        contact_id VARCHAR(20) NOT NULL DEFAULT '',
        contact_name VARCHAR(255) NOT NULL DEFAULT '',
        mobile VARCHAR(20) NOT NULL DEFAULT '',
        source VARCHAR(100) NOT NULL DEFAULT '',
        lead_type VARCHAR(50) NOT NULL DEFAULT '',
        workflow_id VARCHAR(64) NOT NULL DEFAULT '',
        created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_new_contacts_mobile CHECK (mobile = '' OR mobile REGEXP '^[0-9]+$'),
        INDEX idx_nc_contact_id (contact_id),
        INDEX idx_nc_case_id (case_id),
        INDEX idx_nc_created (created)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS new_cases (
        log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        case_id VARCHAR(20) NOT NULL DEFAULT '',
        contact_id VARCHAR(20) NOT NULL DEFAULT '',
        contact_name VARCHAR(255) NOT NULL DEFAULT '',
        mobile VARCHAR(20) NOT NULL DEFAULT '',
        specialty VARCHAR(100) NOT NULL DEFAULT '',
        summary TEXT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT '',
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        workflow_id VARCHAR(64) NOT NULL DEFAULT '',
        created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_new_cases_mobile CHECK (mobile = '' OR mobile REGEXP '^[0-9]+$'),
        INDEX idx_nc2_case_id (case_id),
        INDEX idx_nc2_contact_id (contact_id),
        INDEX idx_nc2_created (created)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    return $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
}

// ── Workflow store ────────────────────────────────────────────────────────

function wf_row_to_api(array $r): array {
    $config = json_decode((string) $r['graph_json'], true);
    return [
        'id'        => $r['workflow_id'],
        'name'      => $r['name'] !== '' ? $r['name'] : 'Untitled',
        'trigger'   => $r['trigger_key'] !== '' ? $r['trigger_key'] : 'contact-created',
        'status'    => $r['status'] === 'Active' ? 'Active' : 'Draft',
        'config'    => is_array($config) ? $config : null,
        'updatedBy' => $r['updated_by'],
        'updated'   => (string) $r['updated'],
    ];
}

function wf_list(): array {
    $rows = psri_db()->query('SELECT * FROM workflows ORDER BY updated DESC')->fetchAll();
    return array_map('wf_row_to_api', $rows);
}

/**
 * Validates + upserts one workflow (same rules as the old save webhook).
 * Returns ['workflow' => …] or ['error' => user-facing message].
 */
function wf_save(array $body): array {
    $name = trim(wf_cut((string) ($body['name'] ?? ''), 200));
    if ($name === '') return ['error' => 'Workflow name is required.'];
    $config = $body['config'] ?? null;
    if (!is_array($config) || !isset($config['nodes']) || !is_array($config['nodes'])) {
        return ['error' => 'Workflow config is invalid — please re-save from the designer.'];
    }
    $configStr = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($configStr === false || strlen($configStr) > 1000000) return ['error' => 'Workflow is too large to save.'];

    $status  = ($body['status'] ?? '') === 'Active' ? 'Active' : 'Draft';
    $trigger = isset(WF_TRIGGER_NODE[$body['trigger'] ?? '']) ? $body['trigger'] : 'contact-created';
    if ($status === 'Active') {
        $triggers = array_filter($config['nodes'], fn ($n) => in_array($n['data']['actionType'] ?? '', WF_TRIGGER_NODE, true));
        if (count($triggers) !== 1) return ['error' => 'An active workflow needs exactly one trigger node.'];
    }
    $idRaw = (string) ($body['id'] ?? '');
    $id = preg_match('/^wf_[A-Za-z0-9]{1,60}$/', $idRaw) ? $idRaw : 'wf_' . base_convert((string) time(), 10, 36) . bin2hex(random_bytes(3));
    $by = wf_cut((string) ($body['updatedBy'] ?? ''), 120);

    psri_db()->prepare(
        'INSERT INTO workflows (workflow_id, name, trigger_key, status, graph_json, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), trigger_key = VALUES(trigger_key), status = VALUES(status),
             graph_json = VALUES(graph_json), updated_by = VALUES(updated_by), updated = CURRENT_TIMESTAMP'
    )->execute([$id, $name, $trigger, $status, $configStr, $by]);
    return ['workflow' => ['id' => $id, 'name' => $name, 'status' => $status]];
}

function wf_runs(string $workflowId, int $limit): array {
    $limit = max(1, min(200, $limit));
    $sql = 'SELECT * FROM workflow_runs' . ($workflowId !== '' ? ' WHERE workflow_id = ?' : '')
         . ' ORDER BY run_id DESC LIMIT ' . $limit;
    $st = psri_db()->prepare($sql);
    $st->execute($workflowId !== '' ? [$workflowId] : []);
    return array_map(fn ($r) => [
        'id'           => (string) $r['run_id'],
        'at'           => (string) $r['created'],
        'workflowId'   => $r['workflow_id'],
        'workflowName' => $r['workflow_name'],
        'contactId'    => $r['contact_id'],
        'contactName'  => $r['contact_name'],
        'caseId'       => $r['case_id'],
        'nodeId'       => $r['node_id'],
        'action'       => $r['action'],
        'actionLabel'  => $r['action'],
        'status'       => $r['status'],
        'error'        => (string) ($r['error'] ?? ''),
    ], $st->fetchAll());
}

// ── Helpers ───────────────────────────────────────────────────────────────

function wf_norm(string $s): string {
    return strtolower((string) preg_replace('/[^A-Za-z0-9]/', '', $s));
}

// mbstring is optional on many PHP installs — degrade to byte functions.
function wf_lower(string $s): string {
    return function_exists('mb_strtolower') ? mb_strtolower($s) : strtolower($s);
}

function wf_cut(string $s, int $len): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $len) : substr($s, 0, $len);
}

function wf_scalar($v): string {
    if (is_bool($v)) return $v ? 'true' : 'false';
    return is_scalar($v) ? (string) $v : '';
}

/** Replaces {{contact.x}} / {{case.x}}; $json escapes values for use inside a JSON string. */
function wf_resolve($tpl, array $ctx, bool $json = false): string {
    return (string) preg_replace_callback('/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/', function ($m) use ($ctx, $json) {
        $v = $ctx;
        foreach (explode('.', $m[1]) as $k) {
            if (!is_array($v) || !array_key_exists($k, $v)) return '';
            $v = $v[$k];
        }
        $s = wf_scalar($v);
        return $json ? substr((string) json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 1, -1) : $s;
    }, wf_scalar($tpl));
}

/**
 * Condition field: "case.<key>" reads the case (schema.js CASE_FIELDS);
 * anything else is a contact field, falling back to the case.
 */
function wf_field_value(array $ctx, string $field): string {
    if (str_starts_with($field, 'case.')) return wf_scalar($ctx['case'][substr($field, 5)] ?? '');
    if (array_key_exists($field, $ctx['contact'])) return wf_scalar($ctx['contact'][$field]);
    if (array_key_exists($field, $ctx['case'])) return wf_scalar($ctx['case'][$field]);
    return '';
}

function wf_eval_condition(array $cfg, array $ctx): bool {
    if (empty($cfg['field'])) return true;
    $a = wf_lower(wf_field_value($ctx, (string) $cfg['field']));
    $w = wf_lower(trim(wf_scalar($cfg['value'] ?? '')));
    switch ($cfg['operator'] ?? 'eq') {
        case 'neq':         return $a !== $w;
        case 'contains':    return $w === '' || str_contains($a, $w);
        case 'notContains': return $w === '' || !str_contains($a, $w);
        case 'in':          return in_array($a, array_filter(array_map('trim', preg_split('/[,;]/', $w))), true);
        case 'empty':       return trim($a) === '';
        case 'notEmpty':    return trim($a) !== '';
        default:            return $a === $w;
    }
}

function wf_digits(string $s): string {
    return (string) preg_replace('/\D/', '', $s);
}

/** Maps a contacts row to the camelCase shape the CRM uses. */
function wf_contact_from_row(array $r): array {
    $out = ['id' => $r['contact_id']];
    foreach (WF_CONTACT_COLUMNS as $key => $col) {
        $out[$key] = $r[$col] ?? '';
    }
    $out['mobileIsd'] = $r['mobile_isd'] ?? '';
    return $out;
}

function wf_load_contact(string $id): ?array {
    if ($id === '') return null;
    $st = psri_db()->prepare('SELECT * FROM contacts WHERE contact_id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ? wf_contact_from_row($row) : null;
}

function wf_table_columns(string $table): array {
    static $cache = [];
    if (!isset($cache[$table])) {
        $cache[$table] = array_column(psri_db()->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(), 'Field');
    }
    return $cache[$table];
}

/** DB errors shown in the History tab: MySQL's own message, never a stack/DSN. */
function wf_db_error(PDOException $e): string {
    $msg = $e->errorInfo[2] ?? '';
    return 'Database rejected the change' . ($msg !== '' ? ': ' . $msg : '.');
}

/** Minimal HTTP client — curl when available, PHP streams otherwise. Returns [status, error]. */
function wf_http(string $method, string $url, $body = null): array {
    if (!preg_match('#^https?://#i', $url)) return [0, 'URL must start with http:// or https://'];
    $payload = $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        ]);
        if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        return [$code, $err !== '' ? $err : ($code >= 400 ? "Endpoint answered HTTP {$code}" : '')];
    }
    $ctx = stream_context_create(['http' => [
        'method' => $method, 'timeout' => 10, 'ignore_errors' => true,
        'header' => "Content-Type: application/json\r\n", 'content' => $payload ?? '',
    ]]);
    $res = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
    }
    if ($res === false && $code === 0) return [0, 'Could not reach the endpoint'];
    return [$code, $code >= 400 ? "Endpoint answered HTTP {$code}" : ''];
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * Executes one action node. Mutates $ctx so later nodes see the result.
 * Returns ['status' => ok|error|noop, 'error' => string, 'detail' => mixed].
 */
function wf_action(string $type, array $cfg, array &$ctx, array $wf, bool $dry): array {
    $contactId = (string) ($ctx['contact']['id'] ?? '');
    $needsContact = in_array($type, ['assign', 'updateContact', 'createCase'], true);
    if ($needsContact && $contactId === '') return ['status' => 'noop', 'error' => 'No contact id on this record'];

    try {
        switch ($type) {
            case 'assign': {
                $to = trim(wf_resolve($cfg['assignedTo'] ?? '', $ctx));
                if ($to === '') return ['status' => 'error', 'error' => 'No agent selected'];
                if (!$dry) psri_db()->prepare('UPDATE contacts SET assigned_to = ? WHERE contact_id = ?')->execute([$to, $contactId]);
                $ctx['contact']['assignedTo'] = $to;
                return ['status' => 'ok', 'detail' => "assigned_to = {$to}"];
            }

            case 'updateContact': {
                $field = (string) ($cfg['field'] ?? '');
                $col = WF_CONTACT_COLUMNS[$field] ?? null;
                if ($col === null) return ['status' => 'error', 'error' => "“{$field}” is not a contact field that can be updated"];
                $val = wf_resolve($cfg['value'] ?? '', $ctx);
                if ($field === 'age') {
                    $val = is_numeric(trim($val)) ? (int) $val : null;
                } elseif (in_array($field, ['mobile', 'altMobile', 'landline'], true)) {
                    $val = wf_digits($val);
                }
                if (!$dry) psri_db()->prepare("UPDATE contacts SET `{$col}` = ? WHERE contact_id = ?")->execute([$val, $contactId]);
                $ctx['contact'][$field] = $val ?? '';
                return ['status' => 'ok', 'detail' => "{$col} = " . wf_scalar($val)];
            }

            case 'createCase': {
                $v = fn (string $k) => trim(wf_resolve($cfg[$k] ?? '', $ctx));
                $caseId = '';
                $pdo = psri_db();
                for ($i = 0; $i < 5 && $caseId === ''; $i++) {
                    $try = 'CASE' . str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
                    $st = $pdo->prepare('SELECT 1 FROM cases WHERE case_id = ?');
                    $st->execute([$try]);
                    if (!$st->fetchColumn()) $caseId = $try;
                }
                if ($caseId === '') return ['status' => 'error', 'error' => 'Could not allocate a case id'];
                $row = [
                    'case_id' => $caseId, 'contact_id' => $contactId,
                    'contact_name' => wf_scalar($ctx['contact']['name'] ?? ''),
                    'contact_mobile' => wf_digits(wf_scalar($ctx['contact']['mobile'] ?? '')),
                    'channel' => $v('channel'), 'type_of_call' => $v('typeOfCall'), 'call_for' => $v('callFor'),
                    'type_of_enquiry' => $v('typeOfEnquiry'), 'priority' => $v('priority'), 'query_type' => 'Basic',
                    'status' => $v('status'), 'summary' => $v('summary'),
                    'assigned_to' => wf_scalar($ctx['contact']['assignedTo'] ?? ''),
                    'is_appointment' => $v('specialty') !== '' ? 1 : 0,
                    'specialty' => $v('specialty'), 'doctor_name' => $v('doctorName'),
                ];
                if (!$dry) {
                    $cols = array_keys($row);
                    $pdo->prepare('INSERT INTO cases (`' . implode('`,`', $cols) . '`) VALUES (' . rtrim(str_repeat('?,', count($cols)), ',') . ')')
                        ->execute(array_values($row));
                }
                // Later nodes (e.g. a "New Cases" list row) can reference the new case.
                $ctx['case'] += ['id' => $caseId, 'caseId' => $caseId, 'specialty' => $row['specialty'],
                                 'summary' => $row['summary'], 'doctorName' => $row['doctor_name'],
                                 'status' => $row['status'], 'priority' => $row['priority']];
                return ['status' => 'ok', 'detail' => "created {$caseId}"];
            }

            case 'sheetRow': {
                $tab = (string) ($cfg['tab'] ?? '');
                $table = WF_LISTS[wf_norm($tab)] ?? null;
                if ($table === null) return ['status' => 'error', 'error' => "Unknown list “{$tab}” — use “New Contacts” or “New Cases”"];
                $cols = wf_table_columns($table);
                $data = [];
                $skipped = [];
                foreach (($cfg['rows'] ?? []) as $r) {
                    $label = trim((string) ($r['key'] ?? ''));
                    if ($label === '') continue;
                    $col = WF_LIST_COLUMNS[wf_norm($label)] ?? null;
                    if ($col === null || !in_array($col, $cols, true)) { $skipped[] = $label; continue; }
                    $data[$col] = wf_resolve($r['value'] ?? '', $ctx);
                }
                if (!$data) return ['status' => 'error', 'error' => 'None of the row columns exist in “' . $tab . '”: ' . implode(', ', $skipped)];
                if (isset($data['mobile'])) $data['mobile'] = wf_digits($data['mobile']);
                $auto = ['contact_id' => $contactId, 'case_id' => wf_scalar($ctx['case']['caseId'] ?? $ctx['case']['id'] ?? ''), 'workflow_id' => $wf['id']];
                foreach ($auto as $col => $val) {
                    if (!isset($data[$col]) && in_array($col, $cols, true)) $data[$col] = $val;
                }
                if (!$dry) {
                    $keys = array_keys($data);
                    psri_db()->prepare("INSERT INTO `{$table}` (`" . implode('`,`', $keys) . '`) VALUES (' . rtrim(str_repeat('?,', count($keys)), ',') . ')')
                        ->execute(array_values($data));
                }
                return ['status' => 'ok', 'error' => $skipped ? 'Skipped columns not in this list: ' . implode(', ', $skipped) : '', 'detail' => [$table => $data]];
            }

            case 'notify': {
                if (($cfg['channel'] ?? '') === 'Email') {
                    $to = trim(wf_resolve($cfg['to'] ?? '', $ctx));
                    $list = array_filter(array_map('trim', preg_split('/[,;]/', $to)));
                    // e.g. To = {{contact.email}} for a contact without an email — nothing to send.
                    if (!$list && trim((string) ($cfg['to'] ?? '')) !== '') return ['status' => 'noop', 'error' => 'Recipient has no email address — skipped'];
                    if (!$list) return ['status' => 'error', 'error' => 'Notification has no recipient'];
                    foreach ($list as $addr) {
                        if (!filter_var($addr, FILTER_VALIDATE_EMAIL)) return ['status' => 'error', 'error' => "Invalid recipient “{$addr}”"];
                    }
                    $strip = fn (string $s) => trim(str_replace(["\r", "\n"], ' ', $s));
                    $from = $strip(wf_resolve($cfg['from'] ?? '', $ctx)) ?: psri_config()['mail_from'];
                    $subject = $strip(wf_resolve($cfg['subject'] ?? '', $ctx));
                    $body = wf_resolve($cfg['body'] ?? '', $ctx);
                    if (!$dry) {
                        $headers = "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8";
                        $sent = @mail(implode(', ', $list), '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
                        if (!$sent) return ['status' => 'error', 'error' => 'The mail server did not accept the email'];
                    }
                    return ['status' => 'ok', 'detail' => 'email → ' . implode(', ', $list)];
                }
                $url = trim(wf_resolve($cfg['url'] ?? '', $ctx));
                if ($url === '') return ['status' => 'error', 'error' => 'Webhook URL is empty'];
                if (!$dry) {
                    [, $err] = wf_http('POST', $url, ['message' => wf_resolve($cfg['message'] ?? '', $ctx)]);
                    if ($err !== '') return ['status' => 'error', 'error' => $err];
                }
                return ['status' => 'ok', 'detail' => "POST {$url}"];
            }

            case 'webhook': {
                $url = trim(wf_resolve($cfg['url'] ?? '', $ctx));
                if ($url === '') return ['status' => 'error', 'error' => 'Webhook URL is empty'];
                $method = strtoupper((string) ($cfg['method'] ?? 'POST'));
                if (!in_array($method, ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'], true)) $method = 'POST';
                $body = null;
                if (in_array($method, ['POST', 'PUT', 'PATCH'], true) && trim((string) ($cfg['body'] ?? '')) !== '') {
                    $body = json_decode(wf_resolve($cfg['body'], $ctx, true), true);
                    if ($body === null) return ['status' => 'error', 'error' => 'Webhook body is not valid JSON'];
                }
                if (!$dry) {
                    [, $err] = wf_http($method, $url, $body);
                    if ($err !== '') return ['status' => 'error', 'error' => $err];
                }
                return ['status' => 'ok', 'detail' => "{$method} {$url}"];
            }
        }
    } catch (PDOException $e) {
        error_log('[psri-workflow] ' . $type . ': ' . $e->getMessage());
        return ['status' => 'error', 'error' => wf_db_error($e)];
    }
    return ['status' => 'error', 'error' => "Unknown node type “{$type}”"];
}

// ── Graph walk ────────────────────────────────────────────────────────────

/** Runs one workflow graph against $ctx. Returns one step per visited node. */
function wf_execute(array $wf, string $triggerKey, array &$ctx, bool $dry): array {
    $nodes = $wf['config']['nodes'] ?? [];
    $edges = $wf['config']['edges'] ?? [];
    $byId = [];
    foreach ($nodes as $n) $byId[$n['id']] = $n;
    $out = [];
    foreach ($edges as $e) $out[$e['source']][] = $e;

    $triggerType = WF_TRIGGER_NODE[$triggerKey] ?? '';
    $start = null;
    foreach ($nodes as $n) {
        if (($n['data']['actionType'] ?? '') === $triggerType) { $start = $n['id']; break; }
    }
    if ($start === null) return [['nodeId' => '', 'action' => 'No action', 'status' => 'noop', 'error' => 'Workflow has no matching trigger node']];

    $steps = [];
    $queue = [$start];
    $seen = [$start => true];
    while ($queue) {
        $id = array_shift($queue);
        $node = $byId[$id];
        $type = (string) ($node['data']['actionType'] ?? '');
        $cfg = is_array($node['data']['config'] ?? null) ? $node['data']['config'] : [];
        $next = $out[$id] ?? [];

        if ($type === 'condition') {
            $want = wf_eval_condition($cfg, $ctx) ? 'true' : 'false';
            $next = array_filter($next, fn ($e) => (($e['sourceHandle'] ?? null) ?: 'true') === $want);
            $steps[] = ['nodeId' => $id, 'action' => 'Condition → ' . ($want === 'true' ? 'True' : 'False'), 'status' => 'ok', 'error' => ''];
        } elseif ($id !== $start) {
            $r = wf_action($type, $cfg, $ctx, $wf, $dry);
            $steps[] = ['nodeId' => $id, 'action' => WF_LABELS[$type] ?? $type, 'status' => $r['status'], 'error' => $r['error'] ?? '', 'detail' => $r['detail'] ?? null];
        }

        foreach ($next as $e) {
            $t = $e['target'];
            if (isset($byId[$t]) && !isset($seen[$t])) { $seen[$t] = true; $queue[] = $t; }
        }
    }
    if (!$steps) $steps[] = ['nodeId' => $start, 'action' => 'No action', 'status' => 'noop', 'error' => 'Workflow has no connected actions'];
    return $steps;
}

function wf_log(array $wf, string $triggerKey, array $ctx, string $caseId, array $steps): void {
    $st = psri_db()->prepare('INSERT INTO workflow_runs (workflow_id, workflow_name, trigger_key, contact_id, contact_name, case_id, node_id, action, status, error)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($steps as $s) {
        $st->execute([
            $wf['id'], wf_cut($wf['name'], 200), $triggerKey,
            wf_cut(wf_scalar($ctx['contact']['id'] ?? ''), 20), wf_cut(wf_scalar($ctx['contact']['name'] ?? ''), 255),
            wf_cut($caseId, 20), wf_cut((string) $s['nodeId'], 64), wf_cut($s['action'], 60),
            $s['status'], $s['error'] !== '' ? $s['error'] : null,
        ]);
    }
}

/**
 * Fires every Active workflow for $triggerKey.
 *
 * $opts:
 *   graph  — run this inline graph instead of the saved workflows (designer test / CLI)
 *   dryRun — walk + evaluate, but write/send nothing and log nothing
 *
 * A saved workflow runs at most once per contact (contact-created) or per
 * case (case-created), so a retried or duplicated trigger call is harmless.
 */
function wf_fire(string $triggerKey, array $contact, array $case = [], array $opts = []): array {
    if (!isset(WF_TRIGGER_NODE[$triggerKey])) return ['error' => 'Unknown trigger'];
    $dry = !empty($opts['dryRun']);
    $inline = isset($opts['graph']);
    $ctx = ['contact' => $contact, 'case' => $case];
    $caseId = wf_scalar($case['caseId'] ?? $case['id'] ?? '');
    $recordId = $triggerKey === 'case-created' ? $caseId : wf_scalar($contact['id'] ?? '');

    if ($inline) {
        $workflows = [['id' => 'test', 'name' => 'Test run', 'config' => $opts['graph']]];
    } else {
        $st = psri_db()->prepare("SELECT * FROM workflows WHERE status = 'Active' AND trigger_key = ? ORDER BY created");
        $st->execute([$triggerKey]);
        $workflows = [];
        foreach ($st->fetchAll() as $r) {
            $w = wf_row_to_api($r);
            if (is_array($w['config'])) $workflows[] = $w;
        }
    }

    $pdo = psri_db();
    $lock = 'psri-wf-' . $triggerKey . '-' . $recordId;
    $locked = !$dry && !$inline && $recordId !== '' && (int) $pdo->query('SELECT GET_LOCK(' . $pdo->quote($lock) . ', 10)')->fetchColumn() === 1;
    try {
        $results = [];
        foreach ($workflows as $wf) {
            if (!$dry && !$inline && $recordId !== '') {
                $col = $triggerKey === 'case-created' ? 'case_id' : 'contact_id';
                $st = $pdo->prepare("SELECT 1 FROM workflow_runs WHERE workflow_id = ? AND trigger_key = ? AND {$col} = ? LIMIT 1");
                $st->execute([$wf['id'], $triggerKey, $recordId]);
                if ($st->fetchColumn()) { $results[] = ['workflowId' => $wf['id'], 'skipped' => 'already ran for this record']; continue; }
            }
            $steps = wf_execute($wf, $triggerKey, $ctx, $dry);
            if (!$dry && !$inline) wf_log($wf, $triggerKey, $ctx, $triggerKey === 'case-created' ? $caseId : '', $steps);
            $results[] = ['workflowId' => $wf['id'], 'name' => $wf['name'], 'steps' => $steps];
        }
        return ['ran' => $results];
    } finally {
        if ($locked) $pdo->query('SELECT RELEASE_LOCK(' . $pdo->quote($lock) . ')');
    }
}
