<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Season Strategy evidence spine (Phase 3). Creates and serializes strategy_evidence
 * rows that goal updates and portfolio captures link to. An evidence item is either an
 * external link or a reference to an existing TRCMS record (typed by source_type).
 */
final class StrategyEvidence
{
    private const TYPES = ['impact_log', 'outreach_event', 'task', 'budget_line', 'certification', 'resource', 'file', 'portfolio_capture', 'external_link'];

    /** Create an evidence row from {source_type,label,external_url?,source_id?}; returns its id or null. */
    public static function create(PDO $pdo, ?array $d, ?int $byId): ?int
    {
        if (!$d) return null;
        $label = trim((string)($d['label'] ?? ''));
        $url = trim((string)($d['external_url'] ?? ''));
        $sourceId = !empty($d['source_id']) ? (int)$d['source_id'] : null;
        if ($label === '' && $url === '' && $sourceId === null) return null;
        $type = in_array($d['source_type'] ?? null, self::TYPES, true) ? (string)$d['source_type'] : ($url !== '' ? 'external_link' : 'external_link');
        if ($label === '') $label = $url !== '' ? $url : ucfirst(str_replace('_', ' ', $type));
        $pdo->prepare("INSERT INTO strategy_evidence (source_type, source_id, external_url, label, created_by_id, created_at) VALUES (?,?,?,?,?,NOW())")
            ->execute([$type, $sourceId, $url ?: null, $label, $byId]);
        return (int)$pdo->lastInsertId();
    }

    public static function serialize(PDO $pdo, ?int $id): ?array
    {
        if ($id === null) return null;
        $s = $pdo->prepare("SELECT * FROM strategy_evidence WHERE id = ?"); $s->execute([$id]);
        $e = $s->fetch();
        if (!$e) return null;
        return ['id' => (int)$e['id'], 'source_type' => $e['source_type'],
            'source_id' => $e['source_id'] !== null ? (int)$e['source_id'] : null,
            'external_url' => $e['external_url'], 'label' => $e['label']];
    }
}
