<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

class InventoryDataset extends Dataset
{
    /** Effective quantity: tagged assets count as 1 (single physical item). */
    protected const EFFECTIVE_QTY = "CASE WHEN i.item_type = 'asset_tagged' THEN COALESCE(NULLIF(i.current_quantity, 0), 1) ELSE COALESCE(i.current_quantity, 0) END";

    public function key(): string { return 'inventory'; }
    public function label(): string { return 'Inventory'; }
    public function baseFrom(): string { return 'inv_items i'; }

    public function joins(): array
    {
        return [
            'cat' => 'LEFT JOIN inv_categories cat ON cat.id = i.category_id',
            'loc' => 'LEFT JOIN inv_locations loc ON loc.id = i.location_id',
            'team' => 'LEFT JOIN team_seasons ts ON ts.id = i.assigned_team_season_id',
        ];
    }

    public function fields(): array
    {
        return [
            'name'      => new Field('name', 'Item', 'i.name', 'string', 'public'),
            'item_type' => new Field('item_type', 'Type', 'i.item_type', 'string', 'public'),
            'category'  => new Field('category', 'Category', 'cat.name', 'string', 'public', false, ['cat']),
            'location'  => new Field('location', 'Location', 'loc.name', 'string', 'internal', false, ['loc']),
            'team'      => new Field('team', 'Assigned team', 'ts.team_name', 'string', 'internal', false, ['team']),
            'asset_tag' => new Field('asset_tag', 'Asset tag', 'i.asset_tag', 'string', 'internal'),
            // A tagged asset is a single item, so treat its quantity as 1 even if
            // current_quantity is 0/NULL — otherwise its value would compute to 0.
            'quantity'  => new Field('quantity', 'Quantity', self::EFFECTIVE_QTY, 'decimal', 'internal', true),
            'unit_cost' => new Field('unit_cost', 'Unit cost', 'i.cost', 'decimal', 'financial', true),
            'value'     => new Field('value', 'Value', '(' . self::EFFECTIVE_QTY . ') * COALESCE(i.cost,0)', 'decimal', 'financial', true),
            'added_date' => new Field('added_date', 'Added', 'DATE(i.created_at)', 'date', 'internal'),
            'purchase_date' => new Field('purchase_date', 'Purchased', 'i.purchase_date', 'date', 'internal'),
            'retirement_date' => new Field('retirement_date', 'Retired', 'i.retirement_date', 'date', 'internal'),
            'count'     => new Field('count', 'Item count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'own_teams':
                return [
                    "i.assigned_team_season_id IN (SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?)",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['i.assigned_team_season_id = ?', [$teamSeasonId]];
    }
}
