<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class ReservationsDataset extends Dataset
{
    public function key(): string { return 'reservations'; }
    public function label(): string { return 'Reservations'; }
    public function baseFrom(): string { return 'reservations r'; }

    public function joins(): array
    {
        return [
            'members' => 'LEFT JOIN members m ON m.id = r.member_id',
            'team'    => 'LEFT JOIN team_seasons ts ON ts.id = r.team_season_id',
        ];
    }

    public function fields(): array
    {
        return [
            'requester'  => new Field('requester', 'Requested by', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'purpose'    => new Field('purpose', 'Purpose', 'r.purpose', 'string', 'public'),
            'team'       => new Field('team', 'Team', 'ts.team_name', 'string', 'internal', false, ['team']),
            'status'     => new Field('status', 'Status', 'r.status', 'string', 'public'),
            'start_at'   => new Field('start_at', 'Start', 'r.start_at', 'datetime', 'internal'),
            'end_at'     => new Field('end_at', 'End', 'r.end_at', 'datetime', 'internal'),
            'start_date' => new Field('start_date', 'Date', 'DATE(r.start_at)', 'date', 'public'),
            'created_at' => new Field('created_at', 'Requested', 'DATE(r.created_at)', 'date', 'internal'),
            'count'      => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['r.member_id = ?', [$memberId]];
            case 'own_teams':
                return ['r.team_season_id IN (SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?)', [$memberId]];
            default: return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['r.team_season_id = ?', [$teamSeasonId]];
    }
}
