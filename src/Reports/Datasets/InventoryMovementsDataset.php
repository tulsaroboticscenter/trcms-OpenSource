<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

/**
 * Inventory movements ledger — every receive / transfer / removal, with the
 * item, quantity, from/to location & team, reason, who, and when. Powers
 * inventory addition and removal reports.
 */
final class InventoryMovementsDataset extends Dataset
{
    public function key(): string { return 'inventory_movements'; }
    public function label(): string { return 'Inventory Movements'; }
    public function baseFrom(): string { return 'inv_movements mv'; }

    public function joins(): array
    {
        return [
            'item'  => 'LEFT JOIN inv_items it ON it.id = mv.item_id',
            'floc'  => 'LEFT JOIN inv_locations fl ON fl.id = mv.from_location_id',
            'tloc'  => 'LEFT JOIN inv_locations tl ON tl.id = mv.to_location_id',
            'actor' => 'LEFT JOIN members am ON am.id = mv.actor_id',
        ];
    }

    public function fields(): array
    {
        return [
            'item'          => new Field('item', 'Item', 'it.name', 'string', 'public', false, ['item']),
            'asset_tag'     => new Field('asset_tag', 'Asset tag', 'it.asset_tag', 'string', 'internal', false, ['item']),
            'movement_type' => new Field('movement_type', 'Type', 'mv.movement_type', 'string', 'public'),
            'quantity'      => new Field('quantity', 'Quantity', 'mv.quantity', 'decimal', 'internal', true),
            'from_location' => new Field('from_location', 'From location', 'fl.name', 'string', 'internal', false, ['floc']),
            'to_location'   => new Field('to_location', 'To location', 'tl.name', 'string', 'internal', false, ['tloc']),
            'reason'        => new Field('reason', 'Reason', 'mv.reason', 'string', 'internal'),
            'actor'         => new Field('actor', 'By', "TRIM(CONCAT(COALESCE(am.first_name,''),' ',COALESCE(am.last_name,'')))", 'string', 'internal', false, ['actor']),
            'date'          => new Field('date', 'Date', 'DATE(mv.created_at)', 'date', 'public'),
            'count'         => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'own_teams':
                return [
                    "(mv.from_team_season_id IN (SELECT team_season_id FROM team_member_assignments WHERE member_id = ?)
                      OR mv.to_team_season_id IN (SELECT team_season_id FROM team_member_assignments WHERE member_id = ?))",
                    [$memberId, $memberId],
                ];
            default: return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['(mv.from_team_season_id = ? OR mv.to_team_season_id = ?)', [$teamSeasonId, $teamSeasonId]];
    }
}
