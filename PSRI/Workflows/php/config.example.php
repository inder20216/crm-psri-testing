<?php
/**
 * config.example.php — copy to config.php (gitignored) and fill in, or leave
 * the defaults blank and set the PSRI_* environment variables on the server.
 */
declare(strict_types=1);

$env = static fn (string $k, string $default): string =>
    (getenv($k) !== false && getenv($k) !== '') ? (string) getenv($k) : $default;

return [
    'db' => [
        'host' => $env('PSRI_DB_HOST', ''),
        'port' => $env('PSRI_DB_PORT', '3306'),
        'name' => $env('PSRI_DB_NAME', 'psri'),
        'user' => $env('PSRI_DB_USER', ''),
        'pass' => $env('PSRI_DB_PASS', ''),
    ],
    // Sender for "Send Notification → Email" nodes that leave From blank.
    'mail_from'   => $env('PSRI_MAIL_FROM', 'crm@psrihospital.com'),
    // Origin allowed to call the API from the browser ('*' = any). Set this
    // to the CRM's origin in production, e.g. https://crm.example.com
    'cors_origin' => $env('PSRI_CORS_ORIGIN', '*'),
];
