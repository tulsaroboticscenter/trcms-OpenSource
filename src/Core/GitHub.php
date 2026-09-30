<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Minimal GitHub API client for pushing a TRCMS feedback item to GitHub as an
 * Issue and adding it to an organization Project (v2). Configuration lives in
 * system_config (category 'github'): token, owner, repo, project_number.
 *
 * The token is a fine-grained PAT with, on the org's repos:
 *   - Issues: Read & Write
 *   - Projects: Read & Write   (needed only if a project_number is configured)
 */
final class GitHub
{
    private const API = 'https://api.github.com';

    /** Stored config (token, owner, repo, project_number). */
    public static function config(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'github'");
        $s->execute();
        $r = $s->fetch();
        $v = $r ? json_decode((string) $r['values'], true) : [];
        return is_array($v) ? $v : [];
    }

    public static function isConfigured(PDO $pdo): bool
    {
        $c = self::config($pdo);
        return !empty($c['token']) && !empty($c['owner']) && !empty($c['repo']);
    }

    private static function token(PDO $pdo): string
    {
        $t = (string) (self::config($pdo)['token'] ?? '');
        if ($t === '') throw new \RuntimeException('GitHub integration is not configured (no token).');
        return $t;
    }

    /** Low-level HTTP call. Returns [httpCode, decodedBody]. */
    private static function http(string $token, string $method, string $url, ?array $json = null): array
    {
        $ch = curl_init($url);
        $headers = [
            'Authorization: Bearer ' . $token,
            'Accept: application/vnd.github+json',
            'X-GitHub-Api-Version: 2022-11-28',
            'User-Agent: TRCMS',
        ];
        $opts = [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
        ];
        if ($json !== null) {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_POSTFIELDS] = json_encode($json, JSON_UNESCAPED_SLASHES);
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $opts);
        $raw  = curl_exec($ch);
        $err  = curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false) throw new \RuntimeException("GitHub request failed: $err");
        $decoded = json_decode((string) $raw, true);
        return [$code, is_array($decoded) ? $decoded : []];
    }

    /** Verify the token can see the configured repo. Returns a human-readable result. */
    public static function test(PDO $pdo): array
    {
        $c = self::config($pdo);
        if (empty($c['token']) || empty($c['owner']) || empty($c['repo'])) {
            return ['ok' => false, 'message' => 'Missing token, owner, or repo.'];
        }
        [$code, $body] = self::http($c['token'], 'GET', self::API . "/repos/{$c['owner']}/{$c['repo']}");
        if ($code === 200) {
            $proj = '';
            if (!empty($c['project_number'])) {
                try { self::projectNodeId($c['token'], (string) $c['owner'], (int) $c['project_number']); $proj = ' Project found.'; }
                catch (\Throwable $e) { $proj = ' But project lookup failed: ' . $e->getMessage(); }
            }
            return ['ok' => true, 'message' => "Connected to {$c['owner']}/{$c['repo']}." . $proj];
        }
        $msg = $body['message'] ?? "HTTP $code";
        return ['ok' => false, 'message' => "Could not reach repo: $msg"];
    }

    /**
     * Create an Issue from a feedback item and (if a project is configured) add
     * it to the org Project board. Returns ['number','url','node_id'].
     */
    public static function createIssueFromFeedback(PDO $pdo, array $fb): array
    {
        $c = self::config($pdo);
        if (empty($c['repo'])) throw new \RuntimeException('No GitHub repository configured.');
        $token = self::token($pdo);

        $title = '[Feedback #' . $fb['id'] . '] ' . ($fb['title'] ?? 'Untitled');
        $body  = self::buildBody($fb);
        $labels = self::labelsFor((string) ($fb['type'] ?? ''));

        $payload = ['title' => $title, 'body' => $body];
        if ($labels) $payload['labels'] = $labels;

        [$code, $resp] = self::http($token, 'POST', self::API . "/repos/{$c['owner']}/{$c['repo']}/issues", $payload);
        if ($code !== 201) {
            // Retry once without labels in case a label doesn't exist on the repo.
            if ($labels) {
                unset($payload['labels']);
                [$code, $resp] = self::http($token, 'POST', self::API . "/repos/{$c['owner']}/{$c['repo']}/issues", $payload);
            }
            if ($code !== 201) {
                throw new \RuntimeException('GitHub issue creation failed: ' . ($resp['message'] ?? "HTTP $code"));
            }
        }

        $result = [
            'number'  => (int) ($resp['number'] ?? 0),
            'url'     => (string) ($resp['html_url'] ?? ''),
            'node_id' => (string) ($resp['node_id'] ?? ''),
        ];

        // Best-effort: add to the project board. Don't fail the whole action if this errors.
        if (!empty($c['project_number']) && $result['node_id'] !== '') {
            try {
                $projectId = self::projectNodeId($token, (string) $c['owner'], (int) $c['project_number']);
                self::graphql($token, 'mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item { id } } }',
                    ['p' => $projectId, 'c' => $result['node_id']]);
                $result['added_to_project'] = true;
            } catch (\Throwable $e) {
                $result['added_to_project'] = false;
                $result['project_error'] = $e->getMessage();
            }
        }
        return $result;
    }

    /** Open or close an issue identified by its html URL. $state = 'open'|'closed'. */
    public static function setIssueStateByUrl(PDO $pdo, string $issueUrl, string $state): void
    {
        if (!in_array($state, ['open', 'closed'], true)) return;
        if (!preg_match('#github\.com/([^/]+)/([^/]+)/issues/(\d+)#', $issueUrl, $m)) {
            throw new \RuntimeException('Could not parse the GitHub issue URL.');
        }
        [, $owner, $repo, $num] = $m;
        [$code, $resp] = self::http(self::token($pdo), 'PATCH',
            self::API . "/repos/$owner/$repo/issues/$num", ['state' => $state]);
        if ($code !== 200) {
            throw new \RuntimeException('GitHub issue state change failed: ' . ($resp['message'] ?? "HTTP $code"));
        }
    }

    /** Map a TRCMS feedback status to the GitHub Project (v2) "Status" column name. */
    public static function projectStatusFor(string $trcmsStatus): ?string
    {
        return match ($trcmsStatus) {
            'new', 'planned' => 'Todo',
            'in_progress'    => 'In Progress',
            'in_review'      => 'In Review',
            'testing'        => 'In Review',
            'done'           => 'Done',
            'declined'       => 'Declined',
            default          => null,
        };
    }

    /**
     * Move the issue's card to a column on the configured org Project (v2) by
     * setting its single-select "Status" field. $statusName is matched
     * case/space/punctuation-insensitively against the project's Status options
     * (so "In Review" matches an "In review" option). If the issue isn't on the
     * board yet it is added first. Returns ['ok'=>bool, 'reason'?=>string].
     */
    public static function setProjectStatusByUrl(PDO $pdo, string $issueUrl, string $statusName): array
    {
        $c = self::config($pdo);
        if (empty($c['project_number'])) return ['ok' => false, 'reason' => 'no project configured'];
        if (!preg_match('#github\.com/([^/]+)/([^/]+)/issues/(\d+)#', $issueUrl, $m)) {
            throw new \RuntimeException('Could not parse the GitHub issue URL.');
        }
        [, $owner, $repo, $num] = $m;
        $token = self::token($pdo);
        $projectNumber = (int) $c['project_number'];
        $projectId = self::projectNodeId($token, (string) $c['owner'], $projectNumber);

        // Find this issue's card on the project (and the issue node id to add it if missing).
        $d = self::graphql($token,
            'query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id projectItems(first:50){ nodes { id project { number } } } } } }',
            ['o' => $owner, 'r' => $repo, 'n' => (int) $num]);
        $issue = $d['repository']['issue'] ?? null;
        if (!$issue) throw new \RuntimeException('GitHub issue not found.');
        $itemId = null;
        foreach (($issue['projectItems']['nodes'] ?? []) as $it) {
            if ((int) ($it['project']['number'] ?? 0) === $projectNumber) { $itemId = $it['id']; break; }
        }
        if ($itemId === null) {
            $add = self::graphql($token,
                'mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item { id } } }',
                ['p' => $projectId, 'c' => $issue['id']]);
            $itemId = $add['addProjectV2ItemById']['item']['id'] ?? null;
            if ($itemId === null) return ['ok' => false, 'reason' => 'could not add issue to project'];
        }

        // Resolve the Status single-select field + the option matching $statusName.
        $f = self::graphql($token,
            'query($p:ID!){ node(id:$p){ ... on ProjectV2 { field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } } }',
            ['p' => $projectId]);
        $field = $f['node']['field'] ?? null;
        if (!$field || empty($field['id'])) return ['ok' => false, 'reason' => 'project has no Status field'];
        $norm = fn(string $s) => preg_replace('/[^a-z0-9]/', '', strtolower($s));
        $want = $norm($statusName);
        $optionId = null; $available = [];
        foreach (($field['options'] ?? []) as $opt) {
            $available[] = $opt['name'];
            if ($norm((string) $opt['name']) === $want) { $optionId = $opt['id']; break; }
        }
        if ($optionId === null) {
            return ['ok' => false, 'reason' => "no Status option matching '$statusName' (project has: " . implode(', ', $available) . ')'];
        }

        self::graphql($token,
            'mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:{ singleSelectOptionId:$o }}){ projectV2Item { id } } }',
            ['p' => $projectId, 'i' => $itemId, 'f' => $field['id'], 'o' => $optionId]);
        return ['ok' => true, 'option' => $statusName];
    }

    /** Post a comment on an existing issue, identified by its html URL. */
    public static function addCommentByUrl(PDO $pdo, string $issueUrl, string $body): array
    {
        if (!preg_match('#github\.com/([^/]+)/([^/]+)/issues/(\d+)#', $issueUrl, $m)) {
            throw new \RuntimeException('Could not parse the GitHub issue URL.');
        }
        [, $owner, $repo, $num] = $m;
        [$code, $resp] = self::http(self::token($pdo), 'POST',
            self::API . "/repos/$owner/$repo/issues/$num/comments", ['body' => $body]);
        if ($code !== 201) {
            throw new \RuntimeException('GitHub comment failed: ' . ($resp['message'] ?? "HTTP $code"));
        }
        return ['url' => (string) ($resp['html_url'] ?? '')];
    }

    private static function buildBody(array $fb): string
    {
        $lines = [];
        $lines[] = ($fb['description'] ?? '') !== '' ? $fb['description'] : '_(no description)_';
        $lines[] = '';
        if (!empty($fb['steps']))   { $lines[] = '**Steps to reproduce:**'; $lines[] = $fb['steps']; $lines[] = ''; }
        $meta = [];
        if (!empty($fb['type']))           $meta[] = 'Type: ' . $fb['type'];
        if (!empty($fb['priority']))       $meta[] = 'Priority: ' . $fb['priority'];
        if (!empty($fb['page']))           $meta[] = 'Page: ' . $fb['page'];
        if (!empty($fb['app_version']))    $meta[] = 'Version: ' . $fb['app_version'];
        if (!empty($fb['target_release'])) $meta[] = 'Target release: ' . $fb['target_release'];
        if (!empty($fb['submitter_name'])) $meta[] = 'Submitted by: ' . $fb['submitter_name'];
        if ($meta) { $lines[] = '---'; $lines[] = implode(' · ', $meta); }
        $lines[] = '';
        $lines[] = '_Created from TRCMS feedback #' . ($fb['id'] ?? '?') . '._';
        return implode("\n", $lines);
    }

    /** Map a feedback type to GitHub's default labels (which exist in every repo). */
    private static function labelsFor(string $type): array
    {
        return match (strtolower($type)) {
            'bug'                    => ['bug'],
            'feature', 'enhancement' => ['enhancement'],
            default                  => [],
        };
    }

    /** Resolve an org Project (v2) number to its GraphQL node id. */
    private static function projectNodeId(string $token, string $owner, int $number): string
    {
        $data = self::graphql($token,
            'query($o:String!,$n:Int!){ organization(login:$o){ projectV2(number:$n){ id } } }',
            ['o' => $owner, 'n' => $number]);
        $id = $data['organization']['projectV2']['id'] ?? null;
        if (!$id) throw new \RuntimeException("Project #$number not found on org '$owner' (check the number and token's Projects permission).");
        return (string) $id;
    }

    private static function graphql(string $token, string $query, array $vars): array
    {
        [$code, $resp] = self::http($token, 'POST', self::API . '/graphql', ['query' => $query, 'variables' => (object) $vars]);
        if ($code !== 200) throw new \RuntimeException("GitHub GraphQL HTTP $code");
        if (!empty($resp['errors'])) throw new \RuntimeException('GitHub GraphQL: ' . ($resp['errors'][0]['message'] ?? 'error'));
        return $resp['data'] ?? [];
    }
}
