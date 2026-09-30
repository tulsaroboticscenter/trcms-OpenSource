<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class CheckoutsDataset extends Dataset
{
    public function key(): string { return 'checkouts'; }
    public function label(): string { return 'Equipment Checkouts'; }
    public function baseFrom(): string { return 'inv_checkouts ic'; }

    public function joins(): array
    {
        return [
            'item'    => 'LEFT JOIN inv_items i ON i.id = ic.item_id',
            'members' => 'LEFT JOIN members m ON m.id = ic.member_id',
            'team'    => 'LEFT JOIN team_seasons ts ON ts.id = ic.team_season_id',
        ];
    }

    public function fields(): array
    {
        return [
            'item'        => new Field('item', 'Item', 'COALESCE(i.name, ic.custom_item_name)', 'string', 'public', false, ['item']),
            'member'      => new Field('member', 'Checked out by', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'team'        => new Field('team', 'Team', 'ts.team_name', 'string', 'internal', false, ['team']),
            'status'      => new Field('status', 'Status', 'ic.status', 'string', 'public'),
            'quantity'    => new Field('quantity', 'Quantity', 'ic.quantity', 'decimal', 'internal', true),
            'checkout_date' => new Field('checkout_date', 'Checked out', 'DATE(ic.checkout_date)', 'date', 'internal'),
            'due_date'    => new Field('due_date', 'Due', 'ic.expected_return_date', 'date', 'internal'),
            'returned_date' => new Field('returned_date', 'Returned', 'DATE(ic.returned_date)', 'date', 'internal'),
            'is_overdue'  => new Field('is_overdue', 'Overdue', "CASE WHEN ic.status = 'out' AND ic.expected_return_date IS NOT NULL AND ic.expected_return_date < CURDATE() THEN 1 ELSE 0 END", 'bool', 'internal'),
            'count'       => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['ic.member_id = ?', [$memberId]];
            case 'own_teams':
                return ['ic.team_season_id IN (SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?)', [$memberId]];
            default: return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['ic.team_season_id = ?', [$teamSeasonId]];
    }
}
