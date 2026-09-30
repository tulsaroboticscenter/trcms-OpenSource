<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class RepairsDataset extends Dataset
{
    public function key(): string { return 'repairs'; }
    public function label(): string { return 'Repairs'; }
    public function baseFrom(): string { return 'repair_tickets rt'; }

    public function joins(): array
    {
        return ['item' => 'LEFT JOIN inv_items i ON i.id = rt.inv_item_id'];
    }

    public function fields(): array
    {
        return [
            'title'          => new Field('title', 'Title', 'rt.title', 'string', 'public'),
            'equipment'      => new Field('equipment', 'Equipment', 'COALESCE(i.name, rt.equipment_name)', 'string', 'public', false, ['item']),
            'asset_tag'      => new Field('asset_tag', 'Asset tag', 'i.asset_tag', 'string', 'internal', false, ['item']),
            'kind'           => new Field('kind', 'Kind', 'rt.kind', 'string', 'public'),
            'status'         => new Field('status', 'Status', 'rt.status', 'string', 'public'),
            'priority'       => new Field('priority', 'Priority', 'rt.priority', 'string', 'public'),
            'reported_date'  => new Field('reported_date', 'Reported', 'rt.reported_date', 'date', 'internal'),
            'completed_date' => new Field('completed_date', 'Completed', 'rt.completed_date', 'date', 'internal'),
            'repair_cost'    => new Field('repair_cost', 'Repair cost', 'rt.repair_cost', 'decimal', 'financial', true),
            'count'          => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        return in_array($scope, ['all', 'own_teams'], true) ? [null, []] : ['1 = 0', []];
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['rt.inv_item_id IN (SELECT id FROM inv_items WHERE assigned_team_season_id = ?)', [$teamSeasonId]];
    }
}
