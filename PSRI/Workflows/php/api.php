<?php
/**
 * api.php — HTTP entry point for the PSRI workflow automation (replaces the
 * n8n psri-workflow-* webhooks). Routed by the last URL path segment, so it
 * works both as  .../api.php/psri-workflow-get  (Apache/nginx PATH_INFO)
 * and behind  php -S localhost:8000 api.php  (router mode, local dev).
 *
 *   GET  psri-contacts?q=                      → { success, contacts:[…] } (list/search; q empty = 50 most recent)
 *   POST psri-contact-add    {name,mobile,contactType,…}  → { success, id, message } (400 + error on invalid/duplicate)
 *   POST psri-contact-update {id,…}                       → { success, id, message } (400 + error on invalid/not found)
 *   GET  psri-cases?q=|status=|callTxnIds=                → { success, cases:[…], count } (priority: callTxnIds > status > q > 50 most recent)
 *   GET  psri-contacts-export?from=&to=  → CSV download, every column, all rows (from/to = Y-m-d, optional)
 *   GET  psri-cases-export?from=&to=     → CSV download, every column, all rows (from/to = Y-m-d, optional)
 *   GET  psri-high-value-export?from=&to= → CSV download, cases WHERE is_high_value=1 only
 *   GET  psri-appreciation-list?status=   → { success, cases:[…] } (status: pending|approved|rejected, blank=all) — includes recordingUrl
 *   POST psri-appreciation-review {caseId,approved,reviewedBy} → { success, id, message } (400 + error on invalid)
 *   GET  psri-prospects?status=&limit=    → { success, prospects:[…], count } (status defaults to 'Followup')
 *   POST psri-prospect-update {id,callStatus,leadStatus,finalStatus,nextCallAt,remarks,assignedTo,agentId,agentName} → { success, id, message }
 *   POST psri-prospect-call-attempt {id,agentId,agentName} → { success, id, message }
 *   GET  psri-prospect-activity?prospectId= → { success, activity:[…] }
 *   POST psri-picklist-suggest {listName,value,agentId,agentName,force?} → { success, id, message } OR
 *                                             { success:false, needsConfirmation:true, similar:[…] } (HTTP 200, not an error — ask the agent, then resend with force:true)
 *   GET  psri-picklist-suggestions?status= → { success, suggestions:[…] } (status: pending|approved|rejected, blank=all)
 *   POST psri-picklist-suggestion-review {id,approved,reviewerId,reviewerName} → { success, id, message, warning? }
 *
 *   GET  psri-workflow-get                    → { success, workflows:[…] }
 *   POST psri-workflow-save        {id?,name,trigger,status,config,updatedBy}
 *                                             → { success, workflow:{id,name,status} }
 *   GET  psri-workflow-runs?id=&limit=        → { success, runs:[…] }
 *   POST psri-contact-workflow-run {contact:{id,…}}        → { success, ran:[…] }
 *   POST psri-case-workflow-run    {case:{id,contactId,…}} → { success, ran:[…] }
 *   POST psri-workflow-test        {graph, trigger?, contact?, case?}
 *                                             → dry run: walks + evaluates, writes nothing
 *
 * CLI:
 *   php api.php migrate                         create the runner tables
 *   php api.php test <graph.json> [payload.json] dry-run a graph (payload: {contact,case})
 *
 * User-facing errors are always generic; details go to the PHP error log.
 */
declare(strict_types=1);

require_once __DIR__ . '/runner.php';
require_once __DIR__ . '/contacts.php';
require_once __DIR__ . '/cases.php';
require_once __DIR__ . '/reports.php';
require_once __DIR__ . '/prospects.php';
require_once __DIR__ . '/picklist_suggestions.php';

if (PHP_SAPI === 'cli') {
    $cmd = $argv[1] ?? '';
    if ($cmd === 'migrate') {
        echo json_encode(['tables' => psri_migrate()], JSON_PRETTY_PRINT) . "\n";
    } elseif ($cmd === 'test' && is_file($argv[2] ?? '')) {
        $graph = json_decode((string) file_get_contents($argv[2]), true);
        $payload = is_file($argv[3] ?? '') ? json_decode((string) file_get_contents($argv[3]), true) : [];
        $trigger = api_trigger_of($graph);
        [$contact, $case] = api_context($trigger, $payload['contact'] ?? [], $payload['case'] ?? []);
        echo json_encode(wf_fire($trigger, $contact, $case, ['graph' => $graph, 'dryRun' => true]), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    } else {
        fwrite(STDERR, "usage: php api.php migrate | php api.php test <graph.json> [payload.json]\n");
        exit(2);
    }
    exit(0);
}

function api_out(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit(0);
}

function api_trigger_of(?array $graph): string {
    foreach (($graph['nodes'] ?? []) as $n) {
        $key = array_search($n['data']['actionType'] ?? '', WF_TRIGGER_NODE, true);
        if ($key !== false) return $key;
    }
    return 'contact-created';
}

/**
 * Builds the {contact, case} context. The stored contact row is the source of
 * truth (so a case trigger still sees the contact's email, city, …); payload
 * fields fill in anything the table doesn't hold.
 */
function api_context(string $trigger, array $contact, array $case): array {
    if ($case) {
        $case['caseId'] = $case['caseId'] ?? $case['id'] ?? '';
        $contact += array_filter([
            'id' => $case['contactId'] ?? '', 'name' => $case['contactName'] ?? '', 'mobile' => $case['contactMobile'] ?? '',
        ], fn ($v) => $v !== '');
    }
    $stored = wf_load_contact(wf_scalar($contact['id'] ?? ''));
    return [$stored ? array_merge($contact, $stored) : $contact, $case];
}

$origin = psri_config()['cors_origin'];
header('Access-Control-Allow-Origin: ' . $origin);
if ($origin !== '*') header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit(0); }

$route = basename((string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH));
$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];

try {
    switch ($route) {
        case 'psri-contacts':
            api_out(['success' => true, 'contacts' => contacts_list((string) ($_GET['q'] ?? ''))]);

        case 'psri-contact-add':
            $res = contacts_add($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-contact-update':
            $res = contacts_update($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-cases':
            $cases = cases_list($_GET);
            api_out(['success' => true, 'cases' => $cases, 'count' => count($cases)]);

        case 'psri-case-add':
            $res = cases_add($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-case-update':
            $res = cases_update($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-contacts-export':
            report_export_csv('contacts', (string) ($_GET['from'] ?? ''), (string) ($_GET['to'] ?? ''));
            exit(0);

        case 'psri-cases-export':
            report_export_csv('cases', (string) ($_GET['from'] ?? ''), (string) ($_GET['to'] ?? ''));
            exit(0);

        case 'psri-high-value-export':
            report_export_csv('cases', (string) ($_GET['from'] ?? ''), (string) ($_GET['to'] ?? ''), 'is_high_value = 1', 'high_value_cases');
            exit(0);

        case 'psri-appreciation-list':
            api_out(['success' => true, 'cases' => cases_appreciation_list((string) ($_GET['status'] ?? ''))]);

        case 'psri-appreciation-review':
            $res = cases_appreciation_review($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-prospects':
            $prospects = prospects_list((string) ($_GET['status'] ?? ''), (int) ($_GET['limit'] ?? 0));
            api_out(['success' => true, 'prospects' => $prospects, 'count' => count($prospects)]);

        case 'psri-prospect-update':
            $res = prospects_update($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-prospect-call-attempt':
            $res = prospects_call_attempt($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-prospect-activity':
            api_out(['success' => true, 'activity' => prospects_activity_list((string) ($_GET['prospectId'] ?? ''))]);

        case 'psri-picklist-suggest':
            $res = ps_suggest($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            if (!empty($res['needsConfirmation'])) api_out(['success' => false] + $res, 200);
            api_out(['success' => true] + $res);

        case 'psri-picklist-suggestions':
            api_out(['success' => true, 'suggestions' => ps_list((string) ($_GET['status'] ?? ''))]);

        case 'psri-picklist-suggestion-review':
            $res = ps_review($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-workflow-get':
            api_out(['success' => true, 'workflows' => wf_list()]);

        case 'psri-workflow-save':
            $res = wf_save($body);
            if (isset($res['error'])) api_out(['success' => false, 'error' => $res['error']], 400);
            api_out(['success' => true] + $res);

        case 'psri-workflow-runs':
            api_out(['success' => true, 'runs' => wf_runs((string) ($_GET['id'] ?? ''), (int) ($_GET['limit'] ?? 40))]);

        case 'psri-contact-workflow-run':
        case 'psri-case-workflow-run':
            $trigger = $route === 'psri-case-workflow-run' ? 'case-created' : 'contact-created';
            $contact = is_array($body['contact'] ?? null) ? $body['contact'] : [];
            $case = is_array($body['case'] ?? null) ? $body['case'] : [];
            if ($trigger === 'contact-created' && empty($contact['id'])) api_out(['success' => false, 'error' => 'contact.id is required'], 400);
            if ($trigger === 'case-created' && empty($case['id']) && empty($case['caseId'])) api_out(['success' => false, 'error' => 'case.id is required'], 400);
            [$contact, $case] = api_context($trigger, $contact, $case);
            api_out(['success' => true] + wf_fire($trigger, $contact, $case));

        case 'psri-workflow-test':
            $graph = is_array($body['graph'] ?? null) ? $body['graph'] : null;
            if (!$graph || !is_array($graph['nodes'] ?? null)) api_out(['success' => false, 'error' => 'graph is required'], 400);
            $trigger = isset(WF_TRIGGER_NODE[$body['trigger'] ?? '']) ? $body['trigger'] : api_trigger_of($graph);
            [$contact, $case] = api_context($trigger, is_array($body['contact'] ?? null) ? $body['contact'] : [], is_array($body['case'] ?? null) ? $body['case'] : []);
            api_out(['success' => true] + wf_fire($trigger, $contact, $case, ['graph' => $graph, 'dryRun' => true]));

        default:
            api_out(['success' => false, 'error' => 'Not found'], 404);
    }
} catch (Throwable $e) {
    error_log('[psri-workflow] ' . $route . ': ' . $e->getMessage());
    api_out(['success' => false, 'error' => 'Something went wrong. Please try again.'], 500);
}
