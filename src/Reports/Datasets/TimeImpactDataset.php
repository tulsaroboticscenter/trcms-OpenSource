<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class TimeImpactDataset extends Dataset
{
    public function key(): string { return 'time_impact'; }
    public function label(): string { return 'Time & Impact'; }
    public function baseFrom(): string { return 'time_entries te'; }

    public function joins(): array
    {
        return [
            'members' => 'JOIN members m ON m.id = te.member_id',
            'ev'      => 'LEFT JOIN events ev ON ev.id = te.event_id',
        ];
    }

    public function fields(): array
    {
        return [
            'member_name'   => new Field('member_name', 'Member', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'member_type'   => new Field('member_type', 'Member type', 'm.member_type', 'string', 'public', false, ['members']),
            'entry_date'    => new Field('entry_date', 'Date', 'te.entry_date', 'date', 'internal'),
            'season'        => new Field('season', 'Season', 'te.season', 'string', 'public'),
            'area'          => new Field('area', 'Activity area', 'te.area', 'string', 'internal'),
            'is_volunteer'  => new Field('is_volunteer', 'Volunteer', 'te.is_volunteer', 'bool', 'internal'),
            'hours'         => new Field('hours', 'Hours', 'te.minutes/60', 'decimal', 'internal', true),
            'minutes'       => new Field('minutes', 'Minutes', 'te.minutes', 'int', 'internal', true),
            'verified'      => new Field('verified', 'Verified', 'te.verified', 'bool', 'internal'),
            'event'         => new Field('event', 'Event', 'ev.name', 'string', 'public', false, ['ev']),
            'created_at'    => new Field('created_at', 'Logged', 'DATE(te.created_at)', 'date', 'internal'),
            'count'         => new Field('count', 'Entries', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['te.member_id = ?', [$memberId]];
            case 'own_teams':
                return [
                    "te.member_id IN (SELECT tma2.member_id FROM team_member_assignments tma2
                       WHERE tma2.team_season_id IN (SELECT tma1.team_season_id FROM team_member_assignments tma1 WHERE tma1.member_id = ?))",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['te.team_season_id = ?', [$teamSeasonId]];
    }
}
