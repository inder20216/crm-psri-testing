<?php
/**
 * picklist_suggestions.php — lets agents propose a new picklist value
 * (currently used for Cases → High Value Case → "Name of Procedure") that
 * sits pending until an Admin approves it. Picklists themselves live in
 * Google Sheets (see n8n_psri_picklists_list.json / picklist_add.json) —
 * this table only tracks the review queue; on approval, the value is
 * pushed live by calling the existing n8n psri-picklist-add webhook
 * (same pattern as reports.php's report_users_map()).
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';

const PS_N8N_BASE = 'https://automation.openmindhelpline.com/webhook';

function ps_normalize(string $s): string {
    $s = mb_strtolower(trim($s));
    $s = preg_replace('/[^\p{L}\p{N}\s]/u', '', $s) ?? $s; // strip punctuation
    $s = preg_replace('/\s+/', ' ', $s) ?? $s;               // collapse whitespace
    return $s;
}

/** Fetches the live values for one list from the existing n8n Picklists endpoint. */
function ps_live_values(string $listName): array {
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 8, 'ignore_errors' => true]]);
    $res = @file_get_contents(PS_N8N_BASE . '/psri-picklists', false, $ctx);
    if ($res === false) return [];
    $data = json_decode($res, true);
    if (!is_array($data) || empty($data['picklists'][$listName])) return [];
    return array_values(array_filter($data['picklists'][$listName], 'is_string'));
}

/**
 * Checks $value against $existing (live + already-pending) for an exact
 * match (normalized) and near-duplicates (PHP's built-in similar_text(),
 * no extra dependency). Exact match is a hard block; similar matches are
 * returned so the caller can ask the agent to confirm instead of silently
 * rejecting — wording/spelling varies more than the procedure itself does.
 */
function ps_check_duplicates(string $value, array $existing): array {
    $normValue = ps_normalize($value);
    $similar = [];
    foreach ($existing as $ex) {
        $normEx = ps_normalize((string) $ex);
        if ($normEx === '') continue;
        if ($normEx === $normValue) return ['exact' => $ex, 'similar' => []];
        similar_text($normValue, $normEx, $pct);
        if ($pct >= 75.0) $similar[] = $ex;
    }
    return ['exact' => null, 'similar' => $similar];
}

/**
 * Returns one of:
 *  ['error' => string]
 *  ['needsConfirmation' => true, 'similar' => [...]]  (not yet inserted)
 *  ['id' => int, 'message' => string]                  (inserted as pending)
 * $force=true skips the similarity soft-block (agent confirmed "add anyway").
 */
function ps_suggest(array $b): array {
    $listName = trim((string) ($b['listName'] ?? ''));
    $value    = trim((string) ($b['value'] ?? ''));
    $force    = !empty($b['force']);
    if ($listName === '') return ['error' => 'listName is required'];
    if ($value === '')    return ['error' => 'value is required'];

    $pdo = psri_db();
    $live = ps_live_values($listName);

    $st = $pdo->prepare("SELECT value FROM picklist_suggestions WHERE list_name = ? AND status = 'pending'");
    $st->execute([$listName]);
    $pending = array_column($st->fetchAll(), 'value');

    $check = ps_check_duplicates($value, array_merge($live, $pending));
    if ($check['exact'] !== null) {
        return ['error' => 'This value already exists: "' . $check['exact'] . '"'];
    }
    if ($check['similar'] && !$force) {
        return ['needsConfirmation' => true, 'similar' => array_slice(array_unique($check['similar']), 0, 5)];
    }

    $ins = $pdo->prepare(
        "INSERT INTO picklist_suggestions (list_name, value, suggested_by, suggested_by_name) VALUES (?, ?, ?, ?)"
    );
    $ins->execute([$listName, $value, (string) ($b['agentId'] ?? ''), (string) ($b['agentName'] ?? '')]);

    return ['id' => (int) $pdo->lastInsertId(), 'message' => 'Suggested — pending approval'];
}

/** $status: '' = all, or pending|approved|rejected. */
function ps_list(string $status): array {
    $pdo = psri_db();
    $sql = 'SELECT * FROM picklist_suggestions';
    $params = [];
    if ($status !== '') { $sql .= ' WHERE status = ?'; $params[] = $status; }
    $sql .= ' ORDER BY created DESC LIMIT 200';
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return array_map(static fn (array $r) => [
        'id'               => (int) $r['id'],
        'listName'         => $r['list_name'],
        'value'            => $r['value'],
        'suggestedBy'      => $r['suggested_by'],
        'suggestedByName'  => $r['suggested_by_name'],
        'status'           => $r['status'],
        'reviewedBy'       => $r['reviewed_by'],
        'reviewedByName'   => $r['reviewed_by_name'],
        'reviewedAt'       => $r['reviewed_at'] ?? '',
        'created'          => $r['created'],
    ], $st->fetchAll());
}

/** Approves or rejects one suggestion; on approve, pushes the value live via n8n. */
function ps_review(array $b): array {
    $id = (int) ($b['id'] ?? 0);
    if ($id <= 0) return ['error' => 'Suggestion id is required'];
    if (!array_key_exists('approved', $b)) return ['error' => 'A Yes/No decision is required'];
    $reviewerId   = (string) ($b['reviewerId'] ?? '');
    $reviewerName = (string) ($b['reviewerName'] ?? '');
    if ($reviewerId === '') return ['error' => 'Reviewer is required'];

    $pdo = psri_db();
    $st = $pdo->prepare('SELECT * FROM picklist_suggestions WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) return ['error' => 'Suggestion not found'];
    if ($row['status'] !== 'pending') return ['error' => 'Already reviewed'];

    $approved = !empty($b['approved']);
    $status = $approved ? 'approved' : 'rejected';
    $pdo->prepare('UPDATE picklist_suggestions SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW() WHERE id = ?')
        ->execute([$status, $reviewerId, $reviewerName, $id]);

    $pushWarning = '';
    if ($approved) {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'timeout' => 8, 'ignore_errors' => true,
            'header' => "Content-Type: application/json\r\n",
            'content' => json_encode(['listName' => $row['list_name'], 'value' => $row['value']]),
        ]]);
        $res = @file_get_contents(PS_N8N_BASE . '/psri-picklist-add', false, $ctx);
        $data = $res !== false ? json_decode($res, true) : null;
        if (!is_array($data) || empty($data['success'])) {
            $pushWarning = 'Approved here, but could not push it live to the Picklists sheet — add it manually.';
        }
    }

    return ['id' => $id, 'message' => $approved ? 'Suggestion approved' : 'Suggestion rejected', 'warning' => $pushWarning];
}
