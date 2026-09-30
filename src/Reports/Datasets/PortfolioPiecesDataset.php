<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

/** Portfolio pieces dataset — every tracked Inspire/Impact piece with owner + status. */
final class PortfolioPiecesDataset extends Dataset
{
    public function key(): string { return 'portfolio_pieces'; }
    public function label(): string { return 'Portfolio Pieces'; }
    public function baseFrom(): string { return 'portfolio_pieces pp'; }

    public function joins(): array
    {
        return [
            'portfolio' => 'LEFT JOIN team_portfolios tp ON tp.id = pp.portfolio_id',
            'team'      => 'LEFT JOIN team_seasons ts ON ts.id = tp.team_season_id',
            'owner'     => 'LEFT JOIN members o ON o.id = pp.owner_member_id',
        ];
    }

    public function fields(): array
    {
        return [
            'title'        => new Field('title', 'Piece', 'pp.title', 'string', 'public'),
            'section'      => new Field('section', 'Section', 'pp.section_type', 'string', 'public'),
            'status'       => new Field('status', 'Status', 'pp.status', 'string', 'public'),
            'award_target' => new Field('award_target', 'Award', 'tp.award_target', 'string', 'public', false, ['portfolio']),
            'team'         => new Field('team', 'Team', 'ts.team_name', 'string', 'internal', false, ['team', 'portfolio']),
            'season'       => new Field('season', 'Season', 'ts.season', 'string', 'public', false, ['team', 'portfolio']),
            'owner'        => new Field('owner', 'Owner', "TRIM(CONCAT(COALESCE(o.first_name,''),' ',COALESCE(o.last_name,'')))", 'string', 'internal', false, ['owner']),
            'due_date'     => new Field('due_date', 'Due', 'pp.due_date', 'date', 'public'),
            'has_asset'    => new Field('has_asset', 'Canva linked', '(pp.resource_id IS NOT NULL)', 'bool', 'public'),
            'done'         => new Field('done', 'Done', "(pp.status = 'done')", 'bool', 'public'),
            'count'        => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['tp.team_season_id = ?', [$teamSeasonId]];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'own_teams':
                return [
                    "tp.team_season_id IN (SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?)",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }
}
