<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/inventory/purchasing_router.py (prefix /api/v1/inventory). */
final class PurchasingController
{
    private const SHIPPING_ADDR_CATEGORY = 'shipping_addresses';
    private const FROZEN_STATUSES = ['received', 'archived', 'cancelled'];
    private const MENTOR_BOM_FIELDS = ['order_number', 'confirmation_number', 'shipping', 'tax', 'shipment_address',
        'expected_delivery_date', 'tracking_number', 'order_date', 'ordered_flag', 'backorder_flag', 'invoice_url'];
    private const MENTOR_LINE_FIELDS = ['actual_purchase_price', 'ordered_quantity', 'backorder_flag'];
    private const BOM_EDITABLE = ['vendor_id', 'budget_category_id', 'po_id', 'name', 'submitted_by_id', 'order_number',
        'confirmation_number', 'shipping', 'tax', 'shipment_address', 'expected_delivery_date', 'tracking_number',
        'order_date', 'ordered_flag', 'backorder_flag', 'invoice_url', 'notes', 'needed_by', 'needed_by_date'];
    private const BOM_INT = ['vendor_id', 'budget_category_id', 'po_id', 'submitted_by_id'];
    private const BOM_BOOL = ['ordered_flag', 'backorder_flag'];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function f($v): ?float { return $v === null ? null : (float)$v; }

    private static function orderQuantity($qty, $pk): float
    {
        $qty = (float)($qty ?? 0); $pk = (float)($pk ?? 0);
        return ($pk > 0 && $qty > 0) ? ceil($qty / $pk) * $pk : $qty;
    }

    private static function packagesNeeded($qty, $pk): float
    {
        $qty = (float)($qty ?? 0); $pk = (float)($pk ?? 0);
        return ($pk > 0 && $qty > 0) ? ceil($qty / $pk) : $qty;
    }

    // ── Budgets ──────────────────────────────────────────────────────────
    public static function getBudget(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $cv = $pdo->prepare("SELECT carryover_amount FROM team_seasons WHERE id = ?"); $cv->execute([$tsid]);
        $carryover = (float)($cv->fetch()['carryover_amount'] ?? 0);
        $cs = $pdo->prepare("SELECT * FROM inv_budget_categories WHERE team_season_id = ? ORDER BY display_order, id");
        $cs->execute([$tsid]);
        $cats = $cs->fetchAll();
        $catIds = array_map(fn($c) => (int)$c['id'], $cats);
        $pendingByCat = [];
        if ($catIds) {
            $ph = implode(',', array_fill(0, count($catIds), '?'));
            $pl = $pdo->prepare("SELECT bl.* FROM inv_bom_lines bl JOIN inv_boms b ON b.id = bl.bom_id
                                 WHERE bl.budget_category_id IN ($ph) AND b.status NOT IN ('cancelled','archived')");
            $pl->execute($catIds);
            foreach ($pl->fetchAll() as $l) {
                if ($l['is_received']) continue;
                $price = $l['actual_purchase_price'] !== null ? $l['actual_purchase_price'] : $l['expected_price'];
                if ($price === null) continue;
                $pkgs = self::packagesNeeded($l['quantity_required'], $l['package_quantity']);
                $cid = (int)$l['budget_category_id'];
                $pendingByCat[$cid] = ($pendingByCat[$cid] ?? 0.0) + $pkgs * (float)$price;
            }
        }
        $donationsByCat = [];
        if ($catIds) {
            $ph = implode(',', array_fill(0, count($catIds), '?'));
            $ds = $pdo->prepare(
                "SELECT d.*, e.name AS event_name, eft.expected_amount AS event_expected, gt.outcome AS grant_outcome
                 FROM inv_fundraising_donations d
                 LEFT JOIN events e ON e.id = d.event_id
                 LEFT JOIN inv_budget_categories bc ON bc.id = d.budget_category_id
                 LEFT JOIN event_fundraising_teams eft ON eft.event_id = d.event_id AND eft.team_season_id = bc.team_season_id
                 LEFT JOIN grant_teams gt ON gt.budget_donation_id = d.id
                 WHERE d.budget_category_id IN ($ph) ORDER BY d.event_id, d.display_order, d.id"
            );
            $ds->execute($catIds);
            foreach ($ds->fetchAll() as $d) $donationsByCat[(int)$d['budget_category_id']][] = $d;
        }
        $raised = function ($c) use ($donationsByCat) {
            $dons = $donationsByCat[(int)$c['id']] ?? [];
            if ($dons) return round(array_sum(array_map(fn($d) => (float)($d['received_amount'] ?? 0), $dons)), 2);
            return (float)($c['fundraising_raised'] ?? 0);
        };
        // Restricted portions of a fundraising category. A donation's restricted_amount
        // earmarks part of an award for a specific purpose; the rest is unrestricted.
        // Restricted-received is capped at what's actually in hand; restricted-expected
        // at what's expected (and drops declined grants), so restricted never overstates
        // the line it sits on.
        $restrictedReceived = function ($c) use ($donationsByCat) {
            $dons = $donationsByCat[(int)$c['id']] ?? [];
            return round(array_sum(array_map(function ($d) {
                $r = (float)($d['restricted_amount'] ?? 0);
                return $r > 0 ? min($r, (float)($d['received_amount'] ?? 0)) : 0.0;
            }, $dons)), 2);
        };
        $restrictedExpected = function ($c) use ($donationsByCat) {
            $dons = $donationsByCat[(int)$c['id']] ?? [];
            return round(array_sum(array_map(function ($d) {
                if (($d['grant_outcome'] ?? null) === 'declined') return 0.0;
                $r = (float)($d['restricted_amount'] ?? 0);
                if ($r <= 0) return 0.0;
                $exp = $d['expected_amount'] !== null ? (float)$d['expected_amount'] : $r;
                return min($r, $exp);
            }, $dons)), 2);
        };
        // Ad-hoc expenses (#98): manual team purchases. Fold each into its category's
        // actual; expenses with no category still count toward the team's total spend.
        $adhocRows = self::adhocList($pdo, $tsid);
        $adhocByCat = []; $adhocUnfiled = 0.0;
        foreach ($adhocRows as $a) {
            if ($a['budget_category_id'] !== null) $adhocByCat[(int)$a['budget_category_id']] = ($adhocByCat[(int)$a['budget_category_id']] ?? 0.0) + (float)$a['amount'];
            else $adhocUnfiled += (float)$a['amount'];
        }
        $actualOf = fn($c) => (float)($c['actual_amount'] ?? 0) + ($adhocByCat[(int)$c['id']] ?? 0.0);
        $pendingOf = fn($c) => $pendingByCat[(int)$c['id']] ?? 0.0;
        // Index children by parent so parents can roll up their sub-systems' spend.
        $childrenByParent = [];
        foreach ($cats as $c) {
            if ($c['parent_id'] !== null) $childrenByParent[(int)$c['parent_id']][] = $c;
        }
        $rolledActual = function ($c) use ($actualOf, $childrenByParent) {
            $sum = $actualOf($c);
            foreach ($childrenByParent[(int)$c['id']] ?? [] as $ch) $sum += $actualOf($ch);
            return $sum;
        };
        $rolledPending = function ($c) use ($pendingOf, $childrenByParent) {
            $sum = $pendingOf($c);
            foreach ($childrenByParent[(int)$c['id']] ?? [] as $ch) $sum += $pendingOf($ch);
            return $sum;
        };
        $items = [];
        foreach ($cats as $c) {
            $dons = $donationsByCat[(int)$c['id']] ?? [];
            $kids = $childrenByParent[(int)$c['id']] ?? [];
            $childBudget = array_sum(array_map(fn($k) => (float)($k['budgeted_amount'] ?? 0), $kids));
            $items[] = [
                'id' => (int)$c['id'], 'name' => $c['name'],
                'parent_id' => $c['parent_id'] !== null ? (int)$c['parent_id'] : null,
                'has_children' => count($kids) > 0,
                'budgeted_amount' => self::f($c['budgeted_amount']),
                // actual_amount / pending_amount roll up sub-system spend into the parent.
                'actual_amount' => round($rolledActual($c), 2),
                'own_actual' => round($actualOf($c), 2),
                'adhoc_amount' => round($adhocByCat[(int)$c['id']] ?? 0.0, 2),
                'pending_amount' => round($rolledPending($c), 2),
                // For a parent: how much of its budget is carved out to sub-systems, and what's left.
                'child_budget_total' => $kids ? round($childBudget, 2) : null,
                'unallocated' => $kids ? round((float)($c['budgeted_amount'] ?? 0) - $childBudget, 2) : null,
                'is_fundraising' => (bool)$c['is_fundraising'], 'fundraising_goal' => self::f($c['fundraising_goal']),
                'fundraising_raised' => round($raised($c), 2),
                'fundraising_expected' => $dons ? round(array_sum(array_map(fn($d) => ($d['grant_outcome'] ?? null) === 'declined' ? 0 : (float)($d['expected_amount'] ?? 0), $dons)), 2) : null,
                'donations' => $c['is_fundraising'] ? array_map([self::class, 'serializeDonation'], $dons) : [],
                'notes' => $c['notes'],
                'remaining' => round((float)($c['budgeted_amount'] ?? 0) - $rolledActual($c), 2),
            ];
        }
        // Team totals count each top-level category once — children fold into their
        // parent, so summing parents (not children) avoids double-counting budgets.
        $spendCats = array_filter($cats, fn($c) => !$c['is_fundraising'] && $c['parent_id'] === null);
        $fundCats = array_filter($cats, fn($c) => $c['is_fundraising']);
        return Http::json($res, [
            'team_season_id' => $tsid, 'categories' => $items,
            'carryover' => round($carryover, 2),
            'adhoc_expenses' => array_map([self::class, 'serializeAdhoc'], $adhocRows),
            'totals' => [
                'carryover' => round($carryover, 2),
                'budgeted' => self::f(array_sum(array_map(fn($c) => (float)($c['budgeted_amount'] ?? 0), $spendCats))),
                'actual' => round(array_sum(array_map($rolledActual, $spendCats)) + $adhocUnfiled, 2),
                'adhoc' => round(array_sum(array_map(fn($a) => (float)$a['amount'], $adhocRows)), 2),
                'pending' => round(array_sum(array_map($rolledPending, $spendCats)), 2),
                'fundraising_goal' => self::f(array_sum(array_map(fn($c) => (float)($c['fundraising_goal'] ?? 0), $fundCats))),
                'fundraising_raised' => round(array_sum(array_map(fn($c) => $raised($c), $fundCats)), 2),
                'fundraising_expected' => round(array_sum(array_map(function ($c) use ($donationsByCat) {
                    $dons = $donationsByCat[(int)$c['id']] ?? [];
                    return array_sum(array_map(fn($d) => ($d['grant_outcome'] ?? null) === 'declined' ? 0 : (float)($d['expected_amount'] ?? 0), $dons));
                }, $fundCats)), 2),
                // Restricted slices of the above (received + expected). Net Available's
                // restricted vs unrestricted split is derived on the client from these
                // plus carryover and actual spend (spend draws from unrestricted first).
                'fundraising_raised_restricted' => round(array_sum(array_map($restrictedReceived, $fundCats)), 2),
                'fundraising_expected_restricted' => round(array_sum(array_map($restrictedExpected, $fundCats)), 2),
            ],
        ]);
    }

    private const BUDGET_FIELDS = ['name', 'budgeted_amount', 'is_fundraising', 'fundraising_goal', 'fundraising_raised', 'actual_amount', 'notes'];

    /** Sum of child budgets under a parent, optionally excluding one child. */
    private static function childBudgetSum(PDO $pdo, int $parentId, ?int $excludeId = null): float
    {
        $sql = "SELECT COALESCE(SUM(budgeted_amount),0) FROM inv_budget_categories WHERE parent_id = ?";
        $args = [$parentId];
        if ($excludeId !== null) { $sql .= " AND id <> ?"; $args[] = $excludeId; }
        $s = $pdo->prepare($sql); $s->execute($args);
        return (float)$s->fetchColumn();
    }

    /**
     * Enforce the parent-as-cap rule: the sum of child budgets (with $childId's
     * new budget substituted in) may not exceed the parent's own budget. No cap
     * is enforced when the parent has no budget set. Returns an error, or null.
     */
    private static function checkChildCap(PDO $pdo, int $parentId, float $newChildBudget, ?int $childId = null): ?string
    {
        $s = $pdo->prepare("SELECT name, budgeted_amount FROM inv_budget_categories WHERE id = ?");
        $s->execute([$parentId]);
        $p = $s->fetch();
        if (!$p || $p['budgeted_amount'] === null) return null; // no cap to enforce
        $cap = (float)$p['budgeted_amount'];
        $others = self::childBudgetSum($pdo, $parentId, $childId);
        if (round($others + $newChildBudget, 2) > round($cap, 2) + 0.001) {
            $avail = round($cap - $others, 2);
            return sprintf('Sub-category budgets would exceed the "%s" budget of $%s (only $%s left to allocate).',
                $p['name'], number_format($cap, 2), number_format(max($avail, 0), 2));
        }
        return null;
    }

    /**
     * Validate a would-be parent_id for a spending category: must be an existing
     * top-level (parent_id NULL) spending category in the same team season.
     * Returns an error string, or null if OK.
     */
    private static function validateParent(PDO $pdo, ?int $parentId, int $tsid, ?int $selfId = null): ?string
    {
        if ($parentId === null) return null;
        if ($selfId !== null && $parentId === $selfId) return 'A category cannot be its own parent.';
        $s = $pdo->prepare("SELECT parent_id, team_season_id, is_fundraising FROM inv_budget_categories WHERE id = ?");
        $s->execute([$parentId]);
        $p = $s->fetch();
        if (!$p) return 'Parent category not found.';
        if ((int)$p['team_season_id'] !== $tsid) return 'Parent must belong to the same team.';
        if ($p['parent_id'] !== null) return 'Sub-categories can only be one level deep.';
        if ((int)$p['is_fundraising'] === 1) return 'Fundraising categories cannot have sub-categories.';
        // The category being nested must not itself already have children.
        if ($selfId !== null) {
            $c = $pdo->prepare("SELECT COUNT(*) FROM inv_budget_categories WHERE parent_id = ?");
            $c->execute([$selfId]);
            if ((int)$c->fetchColumn() > 0) return 'A category with sub-categories cannot itself become a sub-category.';
        }
        return null;
    }

    /** PUT /inventory/teams/{team_season_id}/carryover — set the prior-year carryover (signed). */
    public static function setCarryover(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.carryover', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $ts = $pdo->prepare("SELECT 1 FROM team_seasons WHERE id = ?"); $ts->execute([$tsid]);
        if (!$ts->fetch()) return Http::error($res, 'Team season not found', 404);
        $d = (array)$req->getParsedBody();
        $amt = ($d['carryover_amount'] ?? '') === '' || $d['carryover_amount'] === null ? 0.0 : (float)$d['carryover_amount'];
        $pdo->prepare("UPDATE team_seasons SET carryover_amount = ? WHERE id = ?")->execute([$amt, $tsid]);
        Audit::write($pdo, (int)$cur['id'], 'team_seasons', $tsid, 'update', null, ['carryover_amount' => $amt]);
        return Http::json($res, ['ok' => true, 'carryover_amount' => round($amt, 2)]);
    }

    // ── Ad-hoc team expenses (#98) ──────────────────────────────────────
    private static function adhocList(PDO $pdo, int $tsid): array
    {
        $s = $pdo->prepare("SELECT a.*, m.first_name, m.last_name, bc.name AS category_name
                            FROM team_adhoc_expenses a
                            LEFT JOIN members m ON m.id = a.purchaser_id
                            LEFT JOIN inv_budget_categories bc ON bc.id = a.budget_category_id
                            WHERE a.team_season_id = ? ORDER BY a.expense_date DESC, a.id DESC");
        $s->execute([$tsid]);
        return $s->fetchAll();
    }

    private static function serializeAdhoc(array $a): array
    {
        return [
            'id' => (int)$a['id'],
            'budget_category_id' => $a['budget_category_id'] !== null ? (int)$a['budget_category_id'] : null,
            'category_name' => $a['category_name'] ?? null,
            'vendor' => $a['vendor'], 'description' => $a['description'], 'amount' => self::f($a['amount']),
            'purchaser_id' => $a['purchaser_id'] !== null ? (int)$a['purchaser_id'] : null,
            'purchaser_name' => isset($a['first_name']) && $a['first_name'] !== null ? trim($a['first_name'] . ' ' . $a['last_name']) : null,
            'expense_date' => $a['expense_date'], 'notes' => $a['notes'], 'created_at' => $a['created_at'],
        ];
    }

    public static function listAdhoc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!self::perm($pdo, Auth::currentMember($pdo, $req), 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        return Http::json($res, array_map([self::class, 'serializeAdhoc'], self::adhocList($pdo, (int)$route['team_season_id'])));
    }

    public static function createAdhoc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $d = (array)$req->getParsedBody();
        $desc = trim((string)($d['description'] ?? ''));
        if ($desc === '') return Http::error($res, 'Describe what was purchased.', 422);
        $cat = (isset($d['budget_category_id']) && $d['budget_category_id'] !== '' && $d['budget_category_id'] !== null) ? (int)$d['budget_category_id'] : null;
        $purchaser = (isset($d['purchaser_id']) && $d['purchaser_id']) ? (int)$d['purchaser_id'] : (int)$cur['id'];
        $ins = $pdo->prepare("INSERT INTO team_adhoc_expenses (team_season_id, budget_category_id, vendor, description, amount, purchaser_id, expense_date, notes, created_by_id)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $ins->execute([$tsid, $cat, trim((string)($d['vendor'] ?? '')) ?: null, $desc, (float)($d['amount'] ?? 0), $purchaser,
            ($d['expense_date'] ?? '') ?: null, trim((string)($d['notes'] ?? '')) ?: null, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        \App\Core\Audit::write($pdo, (int)$cur['id'], 'team_adhoc_expenses', $id, 'create', null, ['amount' => (float)($d['amount'] ?? 0), 'description' => $desc]);
        $s = $pdo->prepare("SELECT a.*, m.first_name, m.last_name, bc.name AS category_name FROM team_adhoc_expenses a
                            LEFT JOIN members m ON m.id = a.purchaser_id LEFT JOIN inv_budget_categories bc ON bc.id = a.budget_category_id WHERE a.id = ?");
        $s->execute([$id]);
        return Http::json($res, self::serializeAdhoc($s->fetch()), 201);
    }

    public static function deleteAdhoc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM team_adhoc_expenses WHERE id = ?")->execute([(int)$route['expense_id']]);
        \App\Core\Audit::write($pdo, (int)$cur['id'], 'team_adhoc_expenses', (int)$route['expense_id'], 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    public static function createBudgetCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $ts = $pdo->prepare("SELECT 1 FROM team_seasons WHERE id = ?"); $ts->execute([$tsid]);
        if (!$ts->fetch()) return Http::error($res, 'Team season not found', 404);
        $d = (array)$req->getParsedBody();
        // Sub-category support: an optional parent_id nests this under a top-level
        // spending category. Validate the parent and enforce the "children may not
        // exceed the parent budget" cap before inserting.
        $parentId = array_key_exists('parent_id', $d) && $d['parent_id'] !== null && $d['parent_id'] !== ''
            ? (int)$d['parent_id'] : null;
        if ($parentId !== null) {
            if ($err = self::validateParent($pdo, $parentId, $tsid)) return Http::error($res, $err, 422);
            if (!empty($d['is_fundraising'])) return Http::error($res, 'A sub-category cannot be a fundraising category.', 422);
            $newBudget = array_key_exists('budgeted_amount', $d) && $d['budgeted_amount'] !== '' && $d['budgeted_amount'] !== null
                ? (float)$d['budgeted_amount'] : 0.0;
            if ($err = self::checkChildCap($pdo, $parentId, $newBudget)) return Http::error($res, $err, 422);
        }
        $cols = ['team_season_id']; $vals = [$tsid];
        if ($parentId !== null) { $cols[] = 'parent_id'; $vals[] = $parentId; }
        foreach (self::BUDGET_FIELDS as $f) {
            if (array_key_exists($f, $d)) { $cols[] = $f; $vals[] = $f === 'is_fundraising' ? (int)(bool)$d[$f] : $d[$f]; }
        }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO inv_budget_categories (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())");
        $ins->execute($vals);
        $rs = $pdo->prepare("SELECT * FROM inv_budget_categories WHERE id = ?"); $rs->execute([(int)$pdo->lastInsertId()]); $r = $rs->fetch();
        Audit::write($pdo, (int)$cur['id'], 'inv_budget_categories', (int)$r['id'], 'create', null, ['name' => $r['name'], 'team_season_id' => $tsid]);
        return Http::json($res, ['id' => (int)$r['id']], 201);
    }

    public static function updateBudgetCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT * FROM inv_budget_categories WHERE id = ?"); $s->execute([$id]);
        $cur = $s->fetch();
        if (!$cur) return Http::error($res, 'Budget category not found', 404);
        $tsid = (int)$cur['team_season_id'];
        $existingParent = $cur['parent_id'] !== null ? (int)$cur['parent_id'] : null;
        $d = (array)$req->getParsedBody();

        // Resolve the parent this row will have after the update (allow re-parent / detach).
        $newParent = $existingParent;
        if (array_key_exists('parent_id', $d)) {
            $newParent = ($d['parent_id'] === null || $d['parent_id'] === '') ? null : (int)$d['parent_id'];
            if ($err = self::validateParent($pdo, $newParent, $tsid, $id)) return Http::error($res, $err, 422);
        }
        // Resolve the budget this row will have after the update.
        $newBudget = array_key_exists('budgeted_amount', $d)
            ? (($d['budgeted_amount'] === '' || $d['budgeted_amount'] === null) ? null : (float)$d['budgeted_amount'])
            : ($cur['budgeted_amount'] !== null ? (float)$cur['budgeted_amount'] : null);

        // If this is (or becomes) a child, its budget must fit under the parent cap.
        if ($newParent !== null && $newBudget !== null) {
            if ($err = self::checkChildCap($pdo, $newParent, $newBudget, $id)) return Http::error($res, $err, 422);
        }
        // If this is a parent, its budget can't drop below what its children already hold.
        $childSum = self::childBudgetSum($pdo, $id);
        if ($childSum > 0 && $newBudget !== null && round($newBudget, 2) + 0.001 < round($childSum, 2)) {
            return Http::error($res, sprintf('Budget cannot be less than the $%s already allocated to its sub-categories.', number_format($childSum, 2)), 422);
        }

        $set = []; $args = [];
        foreach (self::BUDGET_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $f === 'is_fundraising' ? (int)(bool)$d[$f] : $d[$f]; }
        if (array_key_exists('parent_id', $d)) { $set[] = 'parent_id = ?'; $args[] = $newParent; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE inv_budget_categories SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'inv_budget_categories', $id, 'update');
        return Http::json($res, ['ok' => true]);
    }

    public static function deleteBudgetCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT 1 FROM inv_budget_categories WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Budget category not found', 404);
        $ch = $pdo->prepare("SELECT COUNT(*) FROM inv_budget_categories WHERE parent_id = ?"); $ch->execute([$id]);
        if ((int)$ch->fetchColumn() > 0) {
            return Http::error($res, 'Delete or move its sub-categories first.', 422);
        }
        $pdo->prepare("DELETE FROM inv_budget_categories WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_budget_categories', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Donations ────────────────────────────────────────────────────────
    private static function serializeDonation(array $d): array
    {
        return [
            'id' => (int)$d['id'], 'budget_category_id' => (int)$d['budget_category_id'], 'name' => $d['name'],
            'expected_amount' => self::f($d['expected_amount']), 'received_amount' => self::f($d['received_amount']),
            'restricted_amount' => self::f($d['restricted_amount'] ?? null),
            'received_date' => $d['received_date'], 'notes' => $d['notes'],
            'event_id' => isset($d['event_id']) && $d['event_id'] !== null ? (int)$d['event_id'] : null,
            'member_id' => isset($d['member_id']) && $d['member_id'] !== null ? (int)$d['member_id'] : null,
            'event_name' => $d['event_name'] ?? null,
            'event_expected' => isset($d['event_expected']) ? self::f($d['event_expected']) : null,
            // A held youth (on multiple eligible teams, hasn't chosen) shows as TBD.
            'is_tbd' => ($d['event_id'] ?? null) !== null && ($d['received_amount'] ?? null) === null,
            // Grant-sourced line: awarded (received) renders green; pending request shows expected only.
            'grant_id' => isset($d['grant_id']) && $d['grant_id'] !== null ? (int)$d['grant_id'] : null,
            'is_grant' => ($d['grant_id'] ?? null) !== null,
            'is_awarded' => ($d['grant_id'] ?? null) !== null && ($d['received_amount'] ?? null) !== null,
            // Declined for this team on the Grants page → shows red on team finances.
            'grant_outcome' => $d['grant_outcome'] ?? null,
            'is_declined' => ($d['grant_outcome'] ?? null) === 'declined',
            // Sponsor-sourced line: received renders green; pledge shows expected only.
            'sponsor_id' => isset($d['sponsor_id']) && $d['sponsor_id'] !== null ? (int)$d['sponsor_id'] : null,
            'is_sponsor' => ($d['sponsor_id'] ?? null) !== null,
            'is_sponsor_received' => ($d['sponsor_id'] ?? null) !== null && ($d['received_amount'] ?? null) !== null,
        ];
    }

    private const DONATION_FIELDS = ['name', 'expected_amount', 'received_amount', 'received_date', 'notes'];

    public static function addDonation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $cid = (int)$route['category_id'];
        $cs = $pdo->prepare("SELECT is_fundraising FROM inv_budget_categories WHERE id = ?"); $cs->execute([$cid]);
        $c = $cs->fetch();
        if (!$c) return Http::error($res, 'Budget category not found', 404);
        if (!$c['is_fundraising']) return Http::error($res, 'Donations can only be added to a fundraising category.', 400);
        $d = (array)$req->getParsedBody();
        if (trim((string)($d['name'] ?? '')) === '') return Http::error($res, 'A donor/source name is required.', 400);
        $cols = ['budget_category_id']; $vals = [$cid];
        foreach (self::DONATION_FIELDS as $f) if (array_key_exists($f, $d)) { $cols[] = $f; $vals[] = $f === 'name' ? trim((string)$d[$f]) : $d[$f]; }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO inv_fundraising_donations (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())");
        $ins->execute($vals);
        $don = self::loadDonation($pdo, (int)$pdo->lastInsertId());
        Audit::write($pdo, (int)$cur['id'], 'inv_fundraising_donations', (int)$don['id'], 'create', null, self::serializeDonation($don));
        return Http::json($res, self::serializeDonation($don), 201);
    }

    private static function loadDonation(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM inv_fundraising_donations WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function updateDonation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['donation_id'];
        if (!self::loadDonation($pdo, $id)) return Http::error($res, 'Donation not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::DONATION_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($f === 'name' && is_string($d[$f])) ? trim($d[$f]) : $d[$f]; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE inv_fundraising_donations SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        $don = self::loadDonation($pdo, $id);
        Audit::write($pdo, (int)$cur['id'], 'inv_fundraising_donations', $id, 'update', null, self::serializeDonation($don));
        return Http::json($res, self::serializeDonation($don));
    }

    public static function deleteDonation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.budgets', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['donation_id'];
        $don = self::loadDonation($pdo, $id);
        if (!$don) return Http::error($res, 'Donation not found', 404);
        Audit::write($pdo, (int)$cur['id'], 'inv_fundraising_donations', $id, 'delete', self::serializeDonation($don), null);
        $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Shipping addresses ───────────────────────────────────────────────
    private static function shippingAddresses(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?"); $s->execute([self::SHIPPING_ADDR_CATEGORY]);
        $r = $s->fetch();
        $vals = ($r && $r['values']) ? json_decode($r['values'], true) : [];
        $out = [];
        foreach (($vals ?: []) as $v) {
            if (is_array($v)) $out[] = ['name' => $v['name'] ?? '', 'address' => $v['address'] ?? ''];
            else $out[] = ['name' => '', 'address' => (string)$v];
        }
        return $out;
    }

    public static function listShippingAddresses(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::shippingAddresses($pdo));
    }

    private static function loadShippingCfg(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT * FROM system_config WHERE category = ?"); $s->execute([self::SHIPPING_ADDR_CATEGORY]);
        $cfg = $s->fetch();
        if (!$cfg) return [null, []];
        $vals = $cfg['values'] ? json_decode($cfg['values'], true) : [];
        $norm = [];
        foreach (($vals ?: []) as $v) $norm[] = is_array($v) ? $v : ['name' => '', 'address' => (string)$v];
        return [$cfg, $norm];
    }

    public static function addShippingAddress(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $addr = trim((string)($d['address'] ?? '')); $name = trim((string)($d['name'] ?? ''));
        if ($addr === '') return Http::error($res, 'Address is required.', 400);
        [$cfg, $values] = self::loadShippingCfg($pdo);
        if (!$cfg) {
            $ins = $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, ?, ?)");
            $ins->execute([self::SHIPPING_ADDR_CATEGORY, 'Shipping Addresses (for purchase orders)', json_encode([])]);
            $cfgId = (int)$pdo->lastInsertId(); $values = [];
        } else { $cfgId = (int)$cfg['id']; }
        $dup = false;
        foreach ($values as $e) if (($e['name'] ?? null) === $name && ($e['address'] ?? null) === $addr) { $dup = true; break; }
        if (!$dup) {
            $values[] = ['name' => $name, 'address' => $addr];
            $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($values), $cfgId]);
            Audit::write($pdo, (int)$cur['id'], 'system_config', $cfgId, 'update', null, ['added_shipping_address' => "$name — $addr"]);
        }
        return Http::json($res, self::shippingAddresses($pdo), 201);
    }

    public static function updateShippingAddress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Access denied', 403);
        [$cfg, $values] = self::loadShippingCfg($pdo);
        if (!$cfg) return Http::error($res, 'No shipping addresses configured yet.', 404);
        $index = (int)$route['index'];
        if ($index < 0 || $index >= count($values)) return Http::error($res, 'Shipping address not found.', 404);
        $d = (array)$req->getParsedBody();
        $addr = trim((string)($d['address'] ?? ''));
        if ($addr === '') return Http::error($res, 'Address is required.', 400);
        $old = $values[$index];
        $values[$index] = ['name' => trim((string)($d['name'] ?? '')), 'address' => $addr];
        $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($values), (int)$cfg['id']]);
        Audit::write($pdo, (int)$cur['id'], 'system_config', (int)$cfg['id'], 'update',
            ['shipping_address' => ($old['name'] ?? '') . ' — ' . ($old['address'] ?? '')],
            ['shipping_address' => $values[$index]['name'] . ' — ' . $values[$index]['address']]);
        return Http::json($res, self::shippingAddresses($pdo));
    }

    public static function deleteShippingAddress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Access denied', 403);
        [$cfg, $values] = self::loadShippingCfg($pdo);
        if (!$cfg) return Http::error($res, 'No shipping addresses configured yet.', 404);
        $index = (int)$route['index'];
        if ($index < 0 || $index >= count($values)) return Http::error($res, 'Shipping address not found.', 404);
        $removed = array_splice($values, $index, 1)[0];
        $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($values), (int)$cfg['id']]);
        Audit::write($pdo, (int)$cur['id'], 'system_config', (int)$cfg['id'], 'update',
            ['removed_shipping_address' => ($removed['name'] ?? '') . ' — ' . ($removed['address'] ?? '')], null);
        return Http::json($res, self::shippingAddresses($pdo));
    }

    // ── BOM serialization ────────────────────────────────────────────────
    private static function serializeLine(array $l): array
    {
        $orderQty = self::orderQuantity($l['quantity_required'], $l['package_quantity']);
        $expPkgs = self::packagesNeeded($l['quantity_required'], $l['package_quantity']);
        $expTotal = $l['expected_price'] !== null ? $expPkgs * (float)$l['expected_price'] : null;
        $actUnits = $l['ordered_quantity'] !== null ? (float)$l['ordered_quantity'] : $orderQty;
        $actPkgs = self::packagesNeeded($actUnits, $l['package_quantity']);
        $actTotal = $l['actual_purchase_price'] !== null ? $actPkgs * (float)$l['actual_purchase_price'] : null;
        return [
            'id' => (int)$l['id'], 'item_id' => $l['item_id'] !== null ? (int)$l['item_id'] : null,
            'part_number' => $l['part_number'], 'description' => $l['description'], 'url' => $l['url'],
            'package_quantity' => $l['package_quantity'] !== null ? (int)$l['package_quantity'] : null,
            'quantity_required' => self::f($l['quantity_required']), 'expected_price' => self::f($l['expected_price']),
            'budget_category_id' => $l['budget_category_id'] !== null ? (int)$l['budget_category_id'] : null,
            'order_quantity' => $orderQty, 'expected_total' => self::f($expTotal),
            'actual_purchase_price' => self::f($l['actual_purchase_price']), 'ordered_quantity' => self::f($l['ordered_quantity']),
            'actual_total' => self::f($actTotal), 'backorder_flag' => (bool)$l['backorder_flag'], 'notes' => $l['notes'],
        ];
    }

    private static function bomLines(PDO $pdo, int $bomId): array
    {
        $s = $pdo->prepare("SELECT * FROM inv_bom_lines WHERE bom_id = ? ORDER BY display_order, id"); $s->execute([$bomId]);
        return $s->fetchAll();
    }

    private static function loadBom(PDO $pdo, int $id): ?array
    {
        $sql = "SELECT b.*, v.name AS vendor_name, t.team_number,
                       cb.first_name AS cb_first, cb.last_name AS cb_last,
                       sb.first_name AS sb_first, sb.last_name AS sb_last
                FROM inv_boms b
                LEFT JOIN inv_vendors v ON v.id = b.vendor_id
                LEFT JOIN team_seasons ts ON ts.id = b.team_season_id
                LEFT JOIN teams t ON t.id = ts.team_id
                LEFT JOIN members cb ON cb.id = b.created_by_id
                LEFT JOIN members sb ON sb.id = b.submitted_by_id
                WHERE b.id = ?";
        $s = $pdo->prepare($sql); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function serializeBom(PDO $pdo, array $b, bool $withLines = true): array
    {
        $lines = self::bomLines($pdo, (int)$b['id']);
        $expTotal = 0.0; $actTotal = 0.0;
        foreach ($lines as $l) {
            $expTotal += self::packagesNeeded($l['quantity_required'], $l['package_quantity']) * (float)($l['expected_price'] ?? 0);
            $actUnits = $l['ordered_quantity'] !== null ? (float)$l['ordered_quantity'] : self::orderQuantity($l['quantity_required'], $l['package_quantity']);
            $actTotal += self::packagesNeeded($actUnits, $l['package_quantity']) * (float)($l['actual_purchase_price'] ?? 0);
        }
        $actTotal += (float)($b['shipping'] ?? 0) + (float)($b['tax'] ?? 0);
        $data = [
            'id' => (int)$b['id'], 'team_season_id' => $b['team_season_id'] !== null ? (int)$b['team_season_id'] : null,
            'team' => ($b['team_number'] ?? null) !== null ? '#' . $b['team_number'] : 'TRC (General)',
            'vendor_id' => $b['vendor_id'] !== null ? (int)$b['vendor_id'] : null, 'vendor_name' => $b['vendor_name'],
            'budget_category_id' => $b['budget_category_id'] !== null ? (int)$b['budget_category_id'] : null,
            'po_id' => $b['po_id'] !== null ? (int)$b['po_id'] : null, 'name' => $b['name'],
            'display_name' => $b['name'] ?: ($b['vendor_name'] ?: 'BOM #' . $b['id']),
            'status' => $b['status'], 'version' => (int)$b['version'], 'is_locked' => (bool)$b['is_locked'],
            'created_by' => ($b['cb_first'] !== null || $b['cb_last'] !== null) ? trim($b['cb_first'] . ' ' . $b['cb_last']) : null,
            'created_by_id' => $b['created_by_id'] !== null ? (int)$b['created_by_id'] : null,
            'submitted_by' => ($b['sb_first'] !== null || $b['sb_last'] !== null) ? trim($b['sb_first'] . ' ' . $b['sb_last']) : null,
            'order_number' => $b['order_number'], 'confirmation_number' => $b['confirmation_number'],
            'shipping' => self::f($b['shipping']), 'tax' => self::f($b['tax']), 'shipment_address' => $b['shipment_address'],
            'expected_delivery_date' => $b['expected_delivery_date'], 'tracking_number' => $b['tracking_number'],
            'order_date' => $b['order_date'], 'ordered_flag' => (bool)$b['ordered_flag'], 'backorder_flag' => (bool)$b['backorder_flag'],
            'invoice_url' => $b['invoice_url'], 'notes' => $b['notes'],
            'needed_by' => $b['needed_by'] ?? null, 'needed_by_date' => $b['needed_by_date'] ?? null,
            'expected_total' => self::f($expTotal), 'actual_total' => self::f($actTotal),
            'created_at' => Time::naiveIso($b['created_at']),
        ];
        if ($withLines) $data['lines'] = array_map([self::class, 'serializeLine'], $lines);
        return $data;
    }

    // ── BOM endpoints ────────────────────────────────────────────────────
    public static function listBoms(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['team_season_id'])) { $where[] = "b.team_season_id = ?"; $args[] = (int)$q['team_season_id']; }
        if (!empty($q['status'])) { $where[] = "b.status = ?"; $args[] = $q['status']; }
        // Hide archived (season-closed) BOMs unless explicitly asked for.
        elseif (!filter_var($q['include_archived'] ?? false, FILTER_VALIDATE_BOOLEAN)) { $where[] = "b.status <> 'archived'"; }
        $sql = "SELECT id FROM inv_boms b" . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY b.created_at DESC";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, array_map(fn($r) => self::serializeBom($pdo, self::loadBom($pdo, (int)$r['id']), false), $s->fetchAll()));
    }

    public static function getBom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $b = self::loadBom($pdo, (int)$route['bom_id']);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        return Http::json($res, self::serializeBom($pdo, $b));
    }

    public static function createBom(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        // team_season_id is optional: omit / null / 0 creates a general TRC BOM
        // not tied to a team. A non-zero value must be a real team season.
        $tsid = (isset($d['team_season_id']) && $d['team_season_id'] !== null && $d['team_season_id'] !== '') ? (int)$d['team_season_id'] : null;
        if ($tsid !== null) {
            $ts = $pdo->prepare("SELECT 1 FROM team_seasons WHERE id = ?"); $ts->execute([$tsid]);
            if (!$ts->fetch()) return Http::error($res, 'Team season not found', 404);
        }
        if (empty($d['vendor_id'])) return Http::error($res, 'A vendor is required — each BOM is for a single vendor.', 400);
        $vs = $pdo->prepare("SELECT 1 FROM inv_vendors WHERE id = ?"); $vs->execute([(int)$d['vendor_id']]);
        if (!$vs->fetch()) return Http::error($res, 'Vendor not found', 404);
        $ins = $pdo->prepare("INSERT INTO inv_boms (created_by_id, status, version, team_season_id, vendor_id, name, budget_category_id, notes, is_locked, ordered_flag, backorder_flag, created_at, updated_at)
                              VALUES (?, 'draft', 1, ?, ?, ?, ?, ?, false, false, false, NOW(), NOW())");
        $ins->execute([(int)$cur['id'], $tsid, (int)$d['vendor_id'], $d['name'] ?? null,
            isset($d['budget_category_id']) ? (int)$d['budget_category_id'] : null, $d['notes'] ?? null]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'create', null, ['team_season_id' => $tsid]);
        return Http::json($res, self::serializeBom($pdo, self::loadBom($pdo, $id)), 201);
    }

    public static function updateBom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $id);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        if (in_array($b['status'], self::FROZEN_STATUSES, true)) return Http::error($res, "This BOM is {$b['status']} and locked — its values can no longer be changed.", 400);
        $data = (array)$req->getParsedBody();
        $incoming = array_intersect_key($data, array_flip(self::BOM_EDITABLE));
        $touchesMentor = (bool)array_intersect(array_keys($incoming), self::MENTOR_BOM_FIELDS);
        $hasApprove = self::perm($pdo, $cur, 'inventory.bom_approve', 'write');
        $hasBom = self::perm($pdo, $cur, 'inventory.bom', 'write');
        if ($touchesMentor && !$hasApprove) return Http::error($res, 'Only a mentor can edit order/fulfillment fields.', 403);
        if (!$touchesMentor) {
            if (!$hasBom) return Http::error($res, 'You do not have permission to edit BOMs.', 403);
            if ($b['is_locked'] && !$hasApprove) return Http::error($res, 'This BOM is locked (submitted). Recall it to make changes.', 400);
        }
        if ($incoming) {
            $set = []; $args = [];
            foreach ($incoming as $k => $v) {
                $set[] = "$k = ?";
                $args[] = ($v !== null && in_array($k, self::BOM_INT, true)) ? (int)$v : (in_array($k, self::BOM_BOOL, true) ? (int)(bool)$v : $v);
            }
            $set[] = 'updated_at = NOW()'; $args[] = $id;
            $pdo->prepare("UPDATE inv_boms SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'update');
        return Http::json($res, self::serializeBom($pdo, self::loadBom($pdo, $id)));
    }

    public static function cancelBom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        // Cancelling kills the BOM (must be recreated). A purchasing manager
        // (bom_approve) or a team with bom write may do it.
        if (!self::perm($pdo, $cur, 'inventory.bom', 'write') && !self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $id = (int)$route['bom_id'];
        if (!self::loadBom($pdo, $id)) return Http::error($res, 'BOM not found', 404);
        $pdo->prepare("UPDATE inv_boms SET status = 'cancelled', po_id = NULL, updated_at = NOW() WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'update', null, ['status' => 'cancelled']);
        return Http::json($res, ['ok' => true]);
    }

    public static function deleteBomPermanent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $id);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        // Normally a BOM on a PO must be removed from the PO first; a System
        // Administrator may force-delete it (it simply leaves that PO).
        $isSysAdmin = in_array('System Administrator', Permissions::effectiveRolesFor($pdo, $cur), true);
        if ($b['po_id'] !== null && !$isSysAdmin) {
            return Http::error($res, 'This BOM is on a purchase order. Remove it from the PO before deleting.', 400);
        }
        $snapshot = self::serializeBom($pdo, $b);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'delete', $snapshot, null);
        $pdo->prepare("DELETE FROM inv_boms WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── BOM lines ────────────────────────────────────────────────────────
    private const LINE_FIELDS = ['item_id', 'part_number', 'description', 'url', 'package_quantity', 'quantity_required',
        'expected_price', 'budget_category_id', 'notes', 'actual_purchase_price', 'ordered_quantity', 'backorder_flag'];
    private const LINE_INT = ['item_id', 'package_quantity', 'budget_category_id'];
    private const LINE_BOOL = ['backorder_flag'];

    private static function linePayload(array $d): array
    {
        $out = [];
        foreach (self::LINE_FIELDS as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = $d[$f];
            if ($v !== null && in_array($f, self::LINE_INT, true)) $v = (int)$v;
            elseif (in_array($f, self::LINE_BOOL, true)) $v = (int)(bool)$v;
            $out[$f] = $v;
        }
        return $out;
    }

    private static function loadLine(PDO $pdo, int $bomId, int $lineId): ?array
    {
        $s = $pdo->prepare("SELECT * FROM inv_bom_lines WHERE id = ? AND bom_id = ?"); $s->execute([$lineId, $bomId]);
        return $s->fetch() ?: null;
    }

    public static function addBomLine(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom', 'write')) return Http::error($res, 'Access denied', 403);
        $bomId = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $bomId);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        if (in_array($b['status'], self::FROZEN_STATUSES, true)) return Http::error($res, "This BOM is {$b['status']} and locked — its values can no longer be changed.", 400);
        if ($b['is_locked'] && !self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'BOM is locked; recall it to add items.', 400);
        $payload = self::linePayload((array)$req->getParsedBody());
        $payload['bom_id'] = $bomId;
        $cols = array_keys($payload);
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO inv_bom_lines (" . implode(',', $cols) . ") VALUES ($ph)");
        $ins->execute(array_values($payload));
        $line = self::loadLine($pdo, $bomId, (int)$pdo->lastInsertId());
        Audit::write($pdo, (int)$cur['id'], 'inv_bom_lines', (int)$line['id'], 'create', null, self::serializeLine($line));
        return Http::json($res, self::serializeLine($line), 201);
    }

    public static function updateBomLine(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $bomId = (int)$route['bom_id']; $lineId = (int)$route['line_id'];
        $line = self::loadLine($pdo, $bomId, $lineId);
        if (!$line) return Http::error($res, 'Line not found', 404);
        $b = self::loadBom($pdo, $bomId);
        if ($b && in_array($b['status'], self::FROZEN_STATUSES, true)) return Http::error($res, "This BOM is {$b['status']} and locked — its values can no longer be changed.", 400);
        $payload = self::linePayload((array)$req->getParsedBody());
        $touchesMentor = (bool)array_intersect(array_keys($payload), self::MENTOR_LINE_FIELDS);
        if ($touchesMentor && !self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Only a mentor can edit fulfillment fields.', 403);
        if (!$touchesMentor && !self::perm($pdo, $cur, 'inventory.bom', 'write')) return Http::error($res, 'You do not have permission to edit BOMs.', 403);
        if ($payload) {
            $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($payload)));
            $args = array_values($payload); $args[] = $lineId;
            $pdo->prepare("UPDATE inv_bom_lines SET $set WHERE id = ?")->execute($args);
            // Recording the actual purchase price also updates the price on the linked inventory item,
            // so the catalog reflects what was really paid (the purchaser corrects the youth's estimate).
            if (array_key_exists('actual_purchase_price', $payload) && $payload['actual_purchase_price'] !== null
                && $line['item_id'] !== null) {
                $pdo->prepare("UPDATE inv_items SET cost = ?, updated_at = NOW() WHERE id = ?")
                    ->execute([$payload['actual_purchase_price'], (int)$line['item_id']]);
            }
        }
        $line = self::loadLine($pdo, $bomId, $lineId);
        Audit::write($pdo, (int)$cur['id'], 'inv_bom_lines', $lineId, 'update', null, self::serializeLine($line));
        return Http::json($res, self::serializeLine($line));
    }

    public static function deleteBomLine(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom', 'write')) return Http::error($res, 'Access denied', 403);
        $bomId = (int)$route['bom_id']; $lineId = (int)$route['line_id'];
        $line = self::loadLine($pdo, $bomId, $lineId);
        if (!$line) return Http::error($res, 'Line not found', 404);
        $b = self::loadBom($pdo, $bomId);
        if ($b && in_array($b['status'], self::FROZEN_STATUSES, true)) return Http::error($res, "This BOM is {$b['status']} and locked — its values can no longer be changed.", 400);
        Audit::write($pdo, (int)$cur['id'], 'inv_bom_lines', $lineId, 'delete', self::serializeLine($line), null);
        $pdo->prepare("DELETE FROM inv_bom_lines WHERE id = ?")->execute([$lineId]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Workflow transitions ─────────────────────────────────────────────
    public static function markReady(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $id);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        if ($b['status'] !== 'draft') return Http::error($res, "BOM cannot be submitted from status '{$b['status']}'.", 400);
        // Strip blank/bogus lines (e.g. an empty row left from tabbing past the last
        // item) so they don't flow onto the PO and get received into inventory (#156).
        $pdo->prepare("DELETE FROM inv_bom_lines WHERE bom_id = ?
                        AND item_id IS NULL
                        AND (part_number IS NULL OR part_number = '')
                        AND (description IS NULL OR description = '')
                        AND (quantity_required IS NULL OR quantity_required = 0)")->execute([$id]);
        if (!self::bomLines($pdo, $id)) return Http::error($res, 'Add at least one line item before submitting.', 400);
        $pdo->prepare("UPDATE inv_boms SET status = 'ready_to_order', is_locked = true, submitted_by_id = ?, updated_at = NOW() WHERE id = ?")->execute([(int)$cur['id'], $id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'update', null, ['status' => 'ready_to_order']);
        $fresh = self::serializeBom($pdo, self::loadBom($pdo, $id));
        self::notifyPurchasing($pdo, $fresh, $cur);
        return Http::json($res, $fresh);
    }

    /** Email the purchasing team that a BOM was submitted for ordering. Best-effort. */
    private static function notifyPurchasing(PDO $pdo, array $bom, array $submitter): void
    {
        if (!Mailer::enabled()) return;
        try {
            $to = EmailSettingsController::purchasingEmail($pdo);
            $who = trim(($submitter['first_name'] ?? '') . ' ' . ($submitter['last_name'] ?? '')) ?: 'A team';
            $name = $bom['display_name'] ?? $bom['name'] ?? ('BOM #' . $bom['id']);
            $team = $bom['team'] ?? 'a team';
            $count = is_array($bom['lines'] ?? null) ? count($bom['lines']) : null;
            $url = rtrim((string)(\App\Core\Config::get('APP_URL', '') ?? ''), '/') . '/inventory/boms/' . $bom['id'];
            $subject = "Order request: {$name} ({$team})";
            $body = "<p><strong>{$who}</strong> submitted a Bill of Materials for ordering.</p>"
                . "<ul><li><strong>BOM:</strong> " . htmlspecialchars((string)$name) . "</li>"
                . "<li><strong>Team:</strong> " . htmlspecialchars((string)$team) . "</li>"
                . ($count !== null ? "<li><strong>Line items:</strong> {$count}</li>" : "")
                . "</ul><p>Review and process it in the purchasing queue" . ($url ? ": <a href=\"{$url}\">{$url}</a>" : ".") . "</p>";
            Mailer::send($to, $subject, Mailer::wrap('New Order Request', $body), strip_tags($body));
        } catch (\Throwable $e) { /* notification failure must not block the submit */ }
    }

    public static function recallBom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $id);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        // A submitted (Pending) BOM can be recalled by the team; a rejected BOM
        // can likewise be pulled back to draft so the team can revise & resubmit.
        if (!in_array($b['status'], ['ready_to_order', 'rejected'], true)) {
            return Http::error($res, 'Only a submitted or rejected BOM can be returned to draft.', 400);
        }
        $pdo->prepare("UPDATE inv_boms SET status = 'draft', is_locked = false, updated_at = NOW() WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'update', null, ['status' => 'draft', 'from' => $b['status']]);
        return Http::json($res, self::serializeBom($pdo, self::loadBom($pdo, $id)));
    }

    /**
     * POST /inventory/boms/{id}/reject — purchasing manager rejects a submitted BOM.
     * The team sees "Rejected" and can revise & resubmit. An optional reason is
     * appended to the BOM notes so the team knows what to fix.
     */
    public static function rejectBom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $id);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        if ($b['status'] !== 'ready_to_order') return Http::error($res, 'Only a submitted (Pending) BOM can be rejected.', 400);
        $reason = trim((string)((array)$req->getParsedBody())['reason'] ?? '');
        $notes = (string)($b['notes'] ?? '');
        if ($reason !== '') {
            $stamp = '[Rejected ' . date('n/j/Y') . '] ' . $reason;
            $notes = $notes !== '' ? ($notes . "\n" . $stamp) : $stamp;
        }
        $pdo->prepare("UPDATE inv_boms SET status = 'rejected', is_locked = false, notes = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$notes, $id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'update', null, ['status' => 'rejected', 'reason' => $reason]);
        return Http::json($res, self::serializeBom($pdo, self::loadBom($pdo, $id)));
    }

    public static function markOrdered(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.bom_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['bom_id'];
        $b = self::loadBom($pdo, $id);
        if (!$b) return Http::error($res, 'BOM not found', 404);
        if (!in_array($b['status'], ['ready_to_order', 'draft'], true)) return Http::error($res, "BOM cannot be ordered from status '{$b['status']}'.", 400);
        $orderDate = $b['order_date'] ?: date('Y-m-d');
        $pdo->prepare("UPDATE inv_boms SET status = 'ordered', ordered_flag = true, is_locked = true, order_date = ?, updated_at = NOW() WHERE id = ?")->execute([$orderDate, $id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $id, 'update', null, ['status' => 'ordered']);
        return Http::json($res, self::serializeBom($pdo, self::loadBom($pdo, $id)));
    }
}
