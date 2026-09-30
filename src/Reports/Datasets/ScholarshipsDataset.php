<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class ScholarshipsDataset extends Dataset
{
    public function key(): string { return 'scholarships'; }
    public function label(): string { return 'College Scholarships'; }
    public function baseFrom(): string { return 'college_scholarship_applications a'; }

    public function joins(): array
    {
        return [
            'sch'     => 'LEFT JOIN college_scholarships s ON s.id = a.scholarship_id',
            'members' => 'LEFT JOIN members m ON m.id = a.member_id',
        ];
    }

    public function fields(): array
    {
        return [
            'member_name'     => new Field('member_name', 'Student', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'scholarship'     => new Field('scholarship', 'Scholarship', 's.name', 'string', 'public', false, ['sch']),
            'provider'        => new Field('provider', 'Provider', 's.provider', 'string', 'public', false, ['sch']),
            'status'          => new Field('status', 'Status', 'a.status', 'string', 'internal'),
            'season'          => new Field('season', 'Season', 'a.season', 'string', 'public'),
            'applied_date'    => new Field('applied_date', 'Applied', 'a.applied_date', 'date', 'internal'),
            'decision_date'   => new Field('decision_date', 'Decision', 'a.decision_date', 'date', 'internal'),
            'amount_awarded'  => new Field('amount_awarded', 'Awarded $', 'a.amount_awarded', 'decimal', 'financial', true),
            'count'           => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['a.member_id = ?', [$memberId]];
            case 'own_teams':
                return [
                    "a.member_id IN (SELECT tma2.member_id FROM team_member_assignments tma2
                       WHERE tma2.team_season_id IN (SELECT tma1.team_season_id FROM team_member_assignments tma1 WHERE tma1.member_id = ?))",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }
}
