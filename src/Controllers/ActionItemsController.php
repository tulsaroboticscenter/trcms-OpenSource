<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Per-user "needs your action" counts for the sidebar badges. Every count is
 * gated by the permission required to actually act on it, so a member only sees
 * a badge for work they're approved to manage. Aggregated per nav module.
 */
final class ActionItemsController
{
    public static function counts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $can = fn(string $key, string $lvl = 'write') => Permissions::memberCan($pdo, $cur, $key, $lvl);
        $count = function (string $sql) use ($pdo): int {
            try { return (int)$pdo->query($sql)->fetchColumn(); } catch (\Throwable $e) { return 0; }
        };

        $detail = [];

        // Reservations awaiting approval.
        if ($can('reservations.approve')) {
            $detail['reservations_pending'] = $count("SELECT COUNT(*) FROM reservations WHERE status = 'pending'");
        }
        // Equipment checkouts: requests to approve + items past their due date.
        if ($can('inventory.checkout_approve')) {
            $detail['checkout_requests'] = $count("SELECT COUNT(*) FROM inv_checkouts WHERE status = 'requested'");
            $detail['checkout_overdue'] = $count("SELECT COUNT(*) FROM inv_checkouts WHERE status = 'out' AND expected_return_date IS NOT NULL AND expected_return_date < CURDATE()");
        }
        // Purchasing: BOMs submitted and ready to be ordered/processed.
        if ($can('inventory.budgets')) {
            $detail['boms_to_process'] = $count("SELECT COUNT(*) FROM inv_boms WHERE status = 'ready_to_order'");
        }
        // Scholarship applications awaiting review/decision (surfaced on the Members nav).
        if ($can('scholarships.applications', 'read')) {
            $detail['scholarships_pending'] = $count("SELECT COUNT(*) FROM scholarship_applications WHERE status IN ('pending','under_review')");
        }

        // Aggregate per nav module id (matches moduleRegistry ids).
        $modules = [
            'reservations' => ($detail['reservations_pending'] ?? 0),
            'inventory' => ($detail['checkout_requests'] ?? 0) + ($detail['checkout_overdue'] ?? 0) + ($detail['boms_to_process'] ?? 0),
            'members' => ($detail['scholarships_pending'] ?? 0),
        ];
        $modules = array_filter($modules, fn($n) => $n > 0);

        return Http::json($res, ['modules' => (object)$modules, 'detail' => (object)$detail]);
    }
}
