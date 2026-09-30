<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class AttendanceDataset extends Dataset
{
    public function key(): string { return 'attendance'; }
    public function label(): string { return 'Attendance (check-ins)'; }
    public function baseFrom(): string { return 'checkins c'; }

    public function joins(): array
    {
        return [
            'members' => 'JOIN members m ON m.id = c.member_id',
            'events'  => 'LEFT JOIN events e ON e.id = c.event_id',
        ];
    }

    public function fields(): array
    {
        return [
            'member_name' => new Field('member_name', 'Member', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'member_type' => new Field('member_type', 'Member type', 'm.member_type', 'string', 'public', false, ['members']),
            'checkin_date' => new Field('checkin_date', 'Date', 'DATE(c.time_in)', 'date', 'internal'),
            'event_name'  => new Field('event_name', 'Event', 'e.name', 'string', 'public', false, ['events']),
            'event_type'  => new Field('event_type', 'Event type', 'e.event_type', 'string', 'public', false, ['events']),
            'count'       => new Field('count', 'Check-ins', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['c.member_id = ?', [$memberId]];
            case 'own_teams':
                return [
                    "c.member_id IN (SELECT tma2.member_id FROM team_member_assignments tma2
                       WHERE tma2.team_season_id IN (SELECT tma1.team_season_id FROM team_member_assignments tma1 WHERE tma1.member_id = ?))",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }
}
