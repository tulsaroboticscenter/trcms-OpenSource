<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class MembersDataset extends Dataset
{
    public function key(): string { return 'members'; }
    public function label(): string { return 'Members'; }
    public function baseFrom(): string { return 'members m'; }

    public function fields(): array
    {
        return [
            // Identity
            'member_id'     => new Field('member_id', 'Member #', 'm.id', 'int', 'internal'),
            'member_number' => new Field('member_number', 'Member number', 'm.member_number', 'string', 'internal'),
            'first_name'    => new Field('first_name', 'First name', 'm.first_name', 'string', 'pii'),
            'middle_name'   => new Field('middle_name', 'Middle name', 'm.middle_name', 'string', 'pii'),
            'last_name'     => new Field('last_name', 'Last name', 'm.last_name', 'string', 'pii'),
            'full_name'     => new Field('full_name', 'Name', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii'),
            'member_type'   => new Field('member_type', 'Type', 'm.member_type', 'string', 'public'),
            'username'      => new Field('username', 'Username', 'm.username', 'string', 'pii'),

            // Status
            'is_active'     => new Field('is_active', 'Active', 'm.is_active', 'bool', 'internal'),
            'is_archived'   => new Field('is_archived', 'Archived', 'm.is_archived', 'bool', 'internal'),
            'is_alumni'     => new Field('is_alumni', 'Alumni', 'm.is_alumni', 'bool', 'internal'),
            'is_junior_mentor' => new Field('is_junior_mentor', 'Junior mentor', 'm.is_junior_mentor', 'bool', 'internal'),
            'date_joined'   => new Field('date_joined', 'Date joined', 'm.date_joined', 'date', 'internal'),
            'created_at'    => new Field('created_at', 'Record created', 'DATE(m.created_at)', 'date', 'internal'),
            'archived_at'   => new Field('archived_at', 'Archived date', 'DATE(m.archived_at)', 'date', 'internal'),

            // Youth / school
            'school'        => new Field('school', 'School', 'm.school', 'string', 'pii'),
            'graduation_year' => new Field('graduation_year', 'Grad year', 'm.graduation_year', 'int', 'internal'),
            'shirt_size'    => new Field('shirt_size', 'Shirt size', 'm.shirt_size', 'string', 'internal'),
            'experience_years' => new Field('experience_years', 'Robotics experience (yrs)', 'm.robotics_experience_years', 'int', 'internal', true),
            'birthday'      => new Field('birthday', 'Birthday', 'm.birthday', 'date', 'pii'),
            'age'           => new Field('age', 'Age', 'TIMESTAMPDIFF(YEAR, m.birthday, CURDATE())', 'int', 'pii', true),

            // Demographics (sensitive)
            'sex'           => new Field('sex', 'Sex', 'm.sex', 'string', 'pii'),
            'race'          => new Field('race', 'Race/ethnicity', 'm.race', 'string', 'pii'),
            'free_reduced_lunch' => new Field('free_reduced_lunch', 'Free/reduced lunch', 'm.free_reduced_lunch_eligible', 'bool', 'pii'),

            // Contact
            'email'         => new Field('email', 'Email', 'm.email', 'string', 'pii'),
            'phone'         => new Field('phone', 'Phone', 'm.phone', 'string', 'pii'),
            'address_line1' => new Field('address_line1', 'Street', 'm.address_line1', 'string', 'pii'),
            'city'          => new Field('city', 'City', 'm.city', 'string', 'pii'),
            'state'         => new Field('state', 'State', 'm.state', 'string', 'pii'),
            'zip_code'      => new Field('zip_code', 'ZIP', 'm.zip_code', 'string', 'pii'),

            // Guardians & emergency
            'guardian1_name'  => new Field('guardian1_name', 'Guardian 1', 'm.guardian1_name', 'string', 'pii'),
            'guardian1_email' => new Field('guardian1_email', 'Guardian 1 email', 'm.guardian1_email', 'string', 'pii'),
            'guardian1_phone' => new Field('guardian1_phone', 'Guardian 1 phone', 'm.guardian1_phone', 'string', 'pii'),
            'emergency_contact_name'  => new Field('emergency_contact_name', 'Emergency contact', 'm.emergency_contact_name', 'string', 'pii'),
            'emergency_contact_phone' => new Field('emergency_contact_phone', 'Emergency phone', 'm.emergency_contact_phone', 'string', 'pii'),

            // Agreements
            'youth_tc_agreed'  => new Field('youth_tc_agreed', 'Youth T&C signed', 'm.youth_tc_agreed', 'bool', 'internal'),
            'parent_tc_agreed' => new Field('parent_tc_agreed', 'Parent T&C signed', 'm.parent_tc_agreed', 'bool', 'internal'),

            // Team & FDP membership. Correlated subqueries on the member, so the row
            // stays one-per-member (no duplication when someone is on several teams).
            // "Active" = a current roster assignment (not left) / an active FDP membership.
            'on_team'       => new Field('on_team', 'On a team',
                "(CASE WHEN EXISTS (SELECT 1 FROM team_member_assignments tma WHERE tma.member_id = m.id AND tma.date_left IS NULL) THEN 1 ELSE 0 END)",
                'bool', 'internal'),
            'team_names'    => new Field('team_names', 'Team(s)',
                "(SELECT GROUP_CONCAT(DISTINCT CONCAT(t.team_number, CASE WHEN COALESCE(ts.team_name,'') <> '' THEN CONCAT(' ', ts.team_name) ELSE '' END) ORDER BY t.team_number SEPARATOR ', ')
                    FROM team_member_assignments tma
                    JOIN team_seasons ts ON ts.id = tma.team_season_id
                    JOIN teams t ON t.id = ts.team_id
                   WHERE tma.member_id = m.id AND tma.date_left IS NULL)",
                'string', 'internal'),
            'in_fdp'        => new Field('in_fdp', 'In FDP',
                "(CASE WHEN EXISTS (SELECT 1 FROM fdp_memberships fm WHERE fm.member_id = m.id AND fm.status = 'active') THEN 1 ELSE 0 END)",
                'bool', 'internal'),
            'fdp_status'    => new Field('fdp_status', 'FDP status',
                "(SELECT fm.status FROM fdp_memberships fm WHERE fm.member_id = m.id ORDER BY fm.enrollment_year DESC LIMIT 1)",
                'string', 'internal'),
            // Convenience flag for the common "everyone on a team OR in the FDP" roster
            // (e.g. a shirt-size pull) — filter this = Yes to get exactly that set.
            'team_or_fdp'   => new Field('team_or_fdp', 'On a team or in FDP',
                "(CASE WHEN EXISTS (SELECT 1 FROM team_member_assignments tma WHERE tma.member_id = m.id AND tma.date_left IS NULL)
                         OR EXISTS (SELECT 1 FROM fdp_memberships fm WHERE fm.member_id = m.id AND fm.status = 'active')
                       THEN 1 ELSE 0 END)",
                'bool', 'internal'),

            'count'         => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all':
                return [null, []];
            case 'self':
                return ['m.id = ?', [$memberId]];
            case 'own_teams':
                // Members who share a team-season with the viewer.
                return [
                    "m.id IN (
                        SELECT tma2.member_id FROM team_member_assignments tma2
                         WHERE tma2.team_season_id IN (
                            SELECT tma1.team_season_id FROM team_member_assignments tma1 WHERE tma1.member_id = ?
                         )
                     )",
                    [$memberId],
                ];
            case 'none':
            default:
                return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['m.id IN (SELECT tma.member_id FROM team_member_assignments tma WHERE tma.team_season_id = ?)', [$teamSeasonId]];
    }
}
