<?php
/**
 * contacts.php — direct PHP+MySQL Contacts endpoints, replacing the n8n
 * psri-contacts* webhooks one at a time (starting with list/search only —
 * add/update come later once this is verified).
 *
 * Ported 1:1 from PSRI/Workflows/n8n_psri_contacts_list_mysql.json's SQL,
 * using the same `contacts` table db.php already connects to. Uses PDO
 * prepared statements instead of manual string-escaping.
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';

/** Maps a full contacts row to the camelCase shape the Contacts page expects. */
function contacts_row_to_api(array $r): array {
    return [
        'id'           => $r['contact_id']     ?? '',
        'salutation'   => $r['salutation']     ?? '',
        'name'         => $r['full_name']      ?? '',
        'age'          => $r['age']            ?? '',
        'mobileIsd'    => $r['mobile_isd']     ?: '+91',
        'mobile'       => $r['mobile']         ?? '',
        'altMobileIsd' => $r['alt_mobile_isd'] ?: '+91',
        'altMobile'    => $r['alt_mobile']     ?? '',
        'landlineIsd'  => $r['landline_isd']   ?: '+91',
        'landline'     => $r['landline']       ?? '',
        'email'        => $r['email']          ?? '',
        'country'      => $r['country']        ?: 'IN',
        'state'        => $r['state']          ?? '',
        'city'         => $r['city']           ?? '',
        'contactType'  => $r['contact_type']   ?? '',
        'source'       => $r['source']         ?? '',
        'subSource'    => $r['sub_source']     ?? '',
        'language'     => $r['language']       ?? '',
        'assignedTo'   => $r['assigned_to']    ?? '',
        'notes'        => $r['notes']          ?? '',
        'created'      => $r['created']        ?? '',
    ];
}

/**
 * q non-empty: fuzzy search across name/mobile/alt_mobile/landline/email
 * (matches the n8n version, now including landline). q empty: 50 most
 * recent contacts.
 */
function contacts_list(string $q): array {
    $pdo = psri_db();
    if ($q !== '') {
        $like = '%' . $q . '%';
        $st = $pdo->prepare(
            'SELECT * FROM contacts WHERE full_name LIKE ? OR mobile LIKE ? OR alt_mobile LIKE ? OR landline LIKE ? OR email LIKE ? ORDER BY created DESC LIMIT 50'
        );
        $st->execute([$like, $like, $like, $like, $like]);
    } else {
        $st = $pdo->query('SELECT * FROM contacts ORDER BY created DESC LIMIT 50');
    }
    return array_map('contacts_row_to_api', $st->fetchAll());
}

/**
 * Ported 1:1 from n8n_psri_contact_add_mysql.json. Returns either
 * ['error' => string] or ['id' => string, 'message' => string].
 */
function contacts_add(array $b): array {
    $name   = trim((string) ($b['name']   ?? ''));
    $mobile = trim((string) ($b['mobile'] ?? ''));

    if ($name === '') return ['error' => 'Full Name is required'];
    if (!preg_match('/^\d{10}$/', $mobile)) return ['error' => 'Valid 10-digit mobile is required'];
    if (empty($b['contactType'])) return ['error' => 'Contact Type is required'];

    $pdo = psri_db();

    // Hard rule (CLAUDE.md): block only if BOTH name AND mobile match an
    // existing record exactly — not mobile alone, so genuinely different
    // people sharing a household/landline number can still both be added.
    $st = $pdo->prepare('SELECT full_name FROM contacts WHERE mobile = ?');
    $st->execute([$mobile]);
    foreach ($st->fetchAll() as $row) {
        if (strtolower(trim((string) $row['full_name'])) === strtolower($name)) {
            return ['error' => 'A contact with this name and mobile number already exists'];
        }
    }

    $newId = 'CON' . substr((string) round(microtime(true) * 1000), -8);

    $ins = $pdo->prepare(
        'INSERT INTO contacts (contact_id, salutation, full_name, age, mobile_isd, mobile, alt_mobile_isd, alt_mobile, landline_isd, landline, email, country, state, city, contact_type, source, sub_source, language, assigned_to, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $ins->execute([
        $newId,
        (string) ($b['salutation'] ?? ''),
        $name,
        ($b['age'] ?? '') === '' ? null : (int) $b['age'],
        (string) ($b['mobileIsd'] ?? '+91'),
        $mobile,
        (string) ($b['altMobileIsd'] ?? '+91'),
        (string) ($b['altMobile'] ?? ''),
        (string) ($b['landlineIsd'] ?? '+91'),
        (string) ($b['landline'] ?? ''),
        (string) ($b['email'] ?? ''),
        (string) ($b['country'] ?? 'IN'),
        (string) ($b['state'] ?? ''),
        (string) ($b['city'] ?? ''),
        (string) $b['contactType'],
        (string) ($b['source'] ?? ''),
        (string) ($b['subSource'] ?? ''),
        (string) ($b['language'] ?? ''),
        (string) ($b['assignedTo'] ?? ''),
        (string) ($b['notes'] ?? ''),
    ]);

    return ['id' => $newId, 'message' => 'Contact created'];
}

/**
 * Ported 1:1 from n8n_psri_contact_update_mysql.json — fetch existing row,
 * then for each field: use the request body's value if that key was sent
 * at all (even empty string), otherwise keep the existing DB value. Always
 * writes every field (not a partial/diff update).
 */
function contacts_update(array $b): array {
    $id = trim((string) ($b['id'] ?? ''));
    if ($id === '') return ['error' => 'Contact id is required'];

    $pdo = psri_db();
    $st = $pdo->prepare('SELECT * FROM contacts WHERE contact_id = ? LIMIT 1');
    $st->execute([$id]);
    $current = $st->fetch();
    if (!$current) return ['error' => 'Contact not found'];

    $pick = static fn (string $key, string $col) => array_key_exists($key, $b) ? $b[$key] : ($current[$col] ?? '');

    $name        = trim((string) $pick('name', 'full_name'));
    $mobile      = trim((string) $pick('mobile', 'mobile'));
    $contactType = $pick('contactType', 'contact_type');

    if ($name === '') return ['error' => 'Full Name is required'];
    if (!preg_match('/^\d{10}$/', $mobile)) return ['error' => 'Valid 10-digit mobile is required'];
    if (empty($contactType)) return ['error' => 'Contact Type is required'];

    $age = $pick('age', 'age');

    $upd = $pdo->prepare(
        'UPDATE contacts SET salutation=?, full_name=?, age=?, mobile_isd=?, mobile=?, alt_mobile_isd=?, alt_mobile=?, landline_isd=?, landline=?, email=?, country=?, state=?, city=?, contact_type=?, source=?, sub_source=?, language=?, assigned_to=?, notes=? WHERE contact_id=?'
    );
    $upd->execute([
        (string) $pick('salutation', 'salutation'),
        $name,
        ($age === '' || $age === null) ? null : (int) $age,
        (string) $pick('mobileIsd', 'mobile_isd'),
        $mobile,
        (string) $pick('altMobileIsd', 'alt_mobile_isd'),
        (string) $pick('altMobile', 'alt_mobile'),
        (string) $pick('landlineIsd', 'landline_isd'),
        (string) $pick('landline', 'landline'),
        (string) $pick('email', 'email'),
        (string) $pick('country', 'country'),
        (string) $pick('state', 'state'),
        (string) $pick('city', 'city'),
        (string) $contactType,
        (string) $pick('source', 'source'),
        (string) $pick('subSource', 'sub_source'),
        (string) $pick('language', 'language'),
        (string) $pick('assignedTo', 'assigned_to'),
        (string) $pick('notes', 'notes'),
        $id,
    ]);

    return ['id' => $id, 'message' => 'Contact updated'];
}
