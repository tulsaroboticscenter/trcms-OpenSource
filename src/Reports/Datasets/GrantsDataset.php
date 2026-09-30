<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class GrantsDataset extends Dataset
{
    public function key(): string { return 'grants'; }
    public function label(): string { return 'Grants'; }
    public function baseFrom(): string { return 'grant_teams gt'; }

    public function joins(): array
    {
        return [
            'grant' => 'LEFT JOIN grants g ON g.id = gt.grant_id',
            'team'  => 'LEFT JOIN team_seasons ts ON ts.id = gt.team_season_id',
        ];
    }

    public function fields(): array
    {
        return [
            'grant_name'   => new Field('grant_name', 'Grant', 'g.name', 'string', 'public', false, ['grant']),
            'funder'       => new Field('funder', 'Funder', 'g.funder_name', 'string', 'public', false, ['grant']),
            'scope'        => new Field('scope', 'Scope', 'g.scope', 'string', 'public', false, ['grant']),
            'grant_status' => new Field('grant_status', 'Grant status', 'g.status', 'string', 'public', false, ['grant']),
            'recurrence'   => new Field('recurrence', 'Recurrence', 'g.recurrence', 'string', 'public', false, ['grant']),
            'restricted'   => new Field('restricted', 'Restricted funds', 'g.restricted_funds', 'bool', 'internal', false, ['grant']),
            'team'         => new Field('team', 'Team', 'ts.team_name', 'string', 'internal', false, ['team']),
            'outcome'      => new Field('outcome', 'Outcome', 'gt.outcome', 'string', 'public'),
            'eligible'     => new Field('eligible', 'Eligible', 'gt.eligible', 'bool', 'internal'),
            'submitted'    => new Field('submitted', 'Submitted?', 'gt.submitted', 'bool', 'internal'),
            'submitted_date' => new Field('submitted_date', 'Submitted', 'gt.submitted_date', 'date', 'internal'),
            'received_date'  => new Field('received_date', 'Received', 'gt.received_date', 'date', 'internal'),
            'amount_requested' => new Field('amount_requested', 'Requested', 'gt.amount_requested', 'decimal', 'financial', true),
            'amount_received'  => new Field('amount_received', 'Received $', 'gt.amount_received', 'decimal', 'financial', true),
            'count'        => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'own_teams':
                return [
                    "gt.team_season_id IN (SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?)",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }
}
