<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Audit logging helper — port of app/core/audit.py write_audit().
 * Inserts into audit_logs. Never throws (swallows failures like the Python version).
 */
final class Audit
{
    /**
     * Per-request context, set once by middleware and used as the FALLBACK for any
     * Audit::write() that doesn't pass an IP or impersonation role explicitly.
     *
     * Why: there are ~477 audit call sites and only a handful ever passed an IP, so
     * audit_logs.ip_address was ~99% NULL. Rather than edit every call site (and rely
     * on every future one remembering), the context is captured once per request and
     * applied here. An explicit argument at the call site still wins.
     */
    private static ?string $ctxIp = null;
    private static ?string $ctxImpersonating = null;

    public static function setRequestContext(?string $ip, ?string $impersonatingRole = null): void
    {
        self::$ctxIp = $ip;
        self::$ctxImpersonating = $impersonatingRole;
    }

    /** Cleared between requests in long-lived processes; harmless under PHP-FPM. */
    public static function clearRequestContext(): void
    {
        self::$ctxIp = null;
        self::$ctxImpersonating = null;
    }

    public static function write(
        PDO $pdo,
        ?int $actorId,
        string $tableName,
        ?int $recordId,
        string $action,
        ?array $oldValues = null,
        ?array $newValues = null,
        ?string $impersonatingRole = null,
        ?string $ipAddress = null
    ): void {
        // Fall back to the request context so every call site records where the action
        // came from, and whether it was taken while impersonating a role.
        $ipAddress = $ipAddress ?? self::$ctxIp;
        $impersonatingRole = $impersonatingRole ?? self::$ctxImpersonating;
        try {
            $stmt = $pdo->prepare(
                "INSERT INTO audit_logs (actor_id, impersonating_role, table_name, record_id, action, old_values, new_values, ip_address, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())"
            );
            $stmt->execute([
                $actorId, $impersonatingRole, $tableName, $recordId, $action,
                $oldValues !== null ? json_encode($oldValues) : null,
                $newValues !== null ? json_encode($newValues) : null,
                $ipAddress,
            ]);
        } catch (\Throwable $e) {
            // Auditing must never break a real operation, so this is still swallowed —
            // but NOT silently. A discarded audit row used to be completely invisible:
            // action names longer than the (previously 20-char) column threw here and
            // vanished, so 'password_reset_requested' was never once recorded. If audit
            // writes start failing, this is the only place it will show.
            error_log('[TRCMS] AUDIT WRITE FAILED action=' . $action
                . ' table=' . $tableName . ' actor=' . var_export($actorId, true)
                . ' :: ' . $e->getMessage());
        }
    }
}
