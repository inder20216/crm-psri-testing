<?php
/**
 * db.php — config + PDO MySQL connection for the PSRI workflow runner.
 *
 * One shared connection for every handler. Tables: contacts, cases (see
 * PSRI/mysql_schema.sql) plus the runner-owned workflows, workflow_runs,
 * new_contacts and new_cases (created by psri_migrate() in runner.php).
 */
declare(strict_types=1);

function psri_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/config.php';
    }
    return $cfg;
}

function psri_db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $c = psri_config()['db'];
    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $c['host'], $c['port'], $c['name']);
    $pdo = new PDO($dsn, $c['user'], $c['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 10,
    ]);
    // Timestamps shown in the designer's History tab are read in IST.
    $pdo->exec("SET time_zone = '+05:30'");
    return $pdo;
}
