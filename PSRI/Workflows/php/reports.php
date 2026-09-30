<?php
/**
 * reports.php — raw CSV export for Cases/Contacts, every column, straight
 * from the database. No aggregation — the client builds their own reports
 * from this data separately. Columns are read from the table itself
 * (SHOW COLUMNS) rather than hardcoded, so a schema change doesn't require
 * a matching code change here.
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';

/**
 * Users (id → name) live in Google Sheets, not MySQL, so a raw DB export
 * can't resolve `assigned_to` on its own — fetch the existing n8n Users
 * endpoint (Users itself isn't being migrated; this just borrows its data
 * for display). Falls back to an empty map on any failure so a broken/slow
 * lookup never breaks the export — the report just falls back to raw IDs.
 */
function report_users_map(): array {
    $url = 'https://automation.openmindhelpline.com/webhook/psri-users';
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 8, 'ignore_errors' => true]]);
    $res = @file_get_contents($url, false, $ctx);
    if ($res === false) return [];
    $data = json_decode($res, true);
    if (!is_array($data) || empty($data['users'])) return [];
    $map = [];
    foreach ($data['users'] as $u) {
        if (!empty($u['id'])) $map[$u['id']] = $u['name'] ?? $u['id'];
    }
    return $map;
}

/**
 * Streams `SELECT * FROM {$table}` as a CSV attachment directly to the
 * response — never builds the whole result set in memory, so this is safe
 * even for contacts' ~150k rows. $from/$to (Y-m-d) optionally filter on the
 * table's `created` column; both blank = full table. $extraWhere is a
 * hardcoded (never user-supplied) SQL condition, e.g. 'is_high_value = 1' —
 * ANDed in alongside the date filter. $filenamePrefix overrides the
 * downloaded file's name (defaults to the table name).
 */
function report_export_csv(string $table, string $from, string $to, string $extraWhere = '', string $filenamePrefix = ''): void {
    $pdo = psri_db();
    $columns = array_column($pdo->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(), 'Field');

    $conditions = [];
    $params = [];
    if ($extraWhere !== '') $conditions[] = $extraWhere;
    if ($from !== '' && $to !== '') {
        $conditions[] = 'created BETWEEN ? AND ?';
        $params = [$from . ' 00:00:00', $to . ' 23:59:59'];
    } elseif ($from !== '') {
        $conditions[] = 'created >= ?';
        $params = [$from . ' 00:00:00'];
    } elseif ($to !== '') {
        $conditions[] = 'created <= ?';
        $params = [$to . ' 23:59:59'];
    }

    $sql = "SELECT * FROM `{$table}`";
    if ($conditions) $sql .= ' WHERE ' . implode(' AND ', $conditions);
    $sql .= ' ORDER BY created DESC';

    $st = $pdo->prepare($sql);
    $st->execute($params);

    $usersMap = in_array('assigned_to', $columns, true) ? report_users_map() : [];

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . ($filenamePrefix !== '' ? $filenamePrefix : $table) . '_' . date('Y-m-d') . '.csv"');
    // BOM so Excel opens UTF-8 (patient names etc.) correctly instead of mangling it.
    echo "\xEF\xBB\xBF";

    $out = fopen('php://output', 'w');
    fputcsv($out, $columns, ',', '"', '');
    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        if (isset($row['assigned_to']) && $row['assigned_to'] !== '') {
            $row['assigned_to'] = $usersMap[$row['assigned_to']] ?? $row['assigned_to'];
        }
        fputcsv($out, array_map(static fn ($v) => $v === null ? '' : $v, $row), ',', '"', '');
    }
    fclose($out);
}
