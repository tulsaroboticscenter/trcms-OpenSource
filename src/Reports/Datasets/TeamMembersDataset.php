<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

/**
 * Team rosters, one row per member per team assignment — so a member on two teams
 * appears twice and a report can group by team. Scoped to the CURRENT roster
 * (active assignments, not those a member has left). For a de-duplicated,
 * one-row-per-person view (incl. FDP members) use the Members dataset's
 * On-a-team / Team(s) / In-FDP fields instead.
 */
final class TeamMembersDataset extends Dataset
{
    public function key(): string { return 'team_members'; }
    public function label(): string { return 'Team Members (roster)'; }

    // Member + team-season + team are intrinsic to every roster row, so they are
    // always joined here; the program is optional and joined only when referenced.
    public function baseFrom(): string
    {
        return 'team_member_assignments tma'
            . ' JOIN members m ON m.id = tma.member_id'
            . ' JOIN team_seasons ts ON ts.id = tma.team_season_id'
            . ' JOIN teams t ON t.id = ts.team_id';
    }

    public function joins(): array
    {
        return ['programs' => 'LEFT JOIN programs p ON p.id = t.program_id'];
    }

    /** Current roster only — assignments the member has not left. */
    public function baseWhere(): array
    {
        return ['tma.date_left IS NULL', []];
    }

    public function fields(): array
    {
        return [
            // Team
            'team_number'  => new Field('team_number', 'Team #', 't.team_number', 'string', 'public'),
            'team_name'    => new Field('team_name', 'Team name', 'ts.team_name', 'string', 'public'),
            'team_label'   => new Field('team_label', 'Team', "TRIM(CONCAT(t.team_number, CASE WHEN COALESCE(ts.team_name,'') <> '' THEN CONCAT(' ', ts.team_name) ELSE '' END))", 'string', 'public'),
            'season'       => new Field('season', 'Season', 'ts.season', 'string', 'public'),
            'program_name' => new Field('program_name', 'Program', 'p.name', 'string', 'public', false, ['programs']),

            // Member
            'member_id'     => new Field('member_id', 'Member #', 'm.id', 'int', 'internal'),
            'member_number' => new Field('member_number', 'Member number', 'm.member_number', 'string', 'internal'),
            'full_name'     => new Field('full_name', 'Name', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii'),
            'first_name'    => new Field('first_name', 'First name', 'm.first_name', 'string', 'pii'),
            'last_name'     => new Field('last_name', 'Last name', 'm.last_name', 'string', 'pii'),
            'member_type'   => new Field('member_type', 'Type', 'm.member_type', 'string', 'public'),
            'shirt_size'    => new Field('shirt_size', 'Shirt size', 'm.shirt_size', 'string', 'internal'),
            'grade'         => new Field('grade', 'Grade', 'm.grade', 'string', 'internal'),
            'graduation_year' => new Field('graduation_year', 'Grad year', 'm.graduation_year', 'int', 'internal'),
            'school'        => new Field('school', 'School', 'm.school', 'string', 'pii'),
            'email'         => new Field('email', 'Email', 'm.email', 'string', 'pii'),
            'phone'         => new Field('phone', 'Phone', 'm.phone', 'string', 'pii'),

            // Assignment
            'primary_role'   => new Field('primary_role', 'Primary role', 'tma.primary_role', 'string', 'internal'),
            'secondary_role' => new Field('secondary_role', 'Secondary role', 'tma.secondary_role', 'string', 'internal'),
            'date_joined'    => new Field('date_joined', 'Joined team', 'tma.date_joined', 'date', 'internal'),
            'registered_on_first' => new Field('registered_on_first', 'Registered on FIRST', 'tma.registered_on_first', 'bool', 'internal'),

            'count'         => new Field('count', 'Members', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all':
                return [null, []];
            case 'self':
                return ['tma.member_id = ?', [$memberId]];
            case 'own_teams':
                // Rosters of team-seasons the viewer is on.
                return [
                    'tma.team_season_id IN (SELECT tma1.team_season_id FROM team_member_assignments tma1 WHERE tma1.member_id = ?)',
                    [$memberId],
                ];
            case 'none':
            default:
                return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['tma.team_season_id = ?', [$teamSeasonId]];
    }
}
