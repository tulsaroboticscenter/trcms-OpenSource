<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

/** Season Goals dataset (FR-G9) — team goals with owner, metric, and status. */
final class GoalsDataset extends Dataset
{
    public function key(): string { return 'goals'; }
    public function label(): string { return 'Season Goals'; }
    public function baseFrom(): string { return 'season_goals g'; }

    public function joins(): array
    {
        return [
            'team'  => 'LEFT JOIN team_seasons ts ON ts.id = g.team_season_id',
            'owner' => 'LEFT JOIN members o ON o.id = g.owner_member_id',
        ];
    }

    public function baseWhere(): array { return ["g.status <> 'archived'", []]; }

    public function fields(): array
    {
        return [
            'title'        => new Field('title', 'Goal', 'g.title', 'string', 'public'),
            'category'     => new Field('category', 'Category', 'g.category', 'string', 'public'),
            'status'       => new Field('status', 'Status', 'g.status', 'string', 'public'),
            'priority'     => new Field('priority', 'Priority', 'g.priority', 'string', 'public'),
            'team'         => new Field('team', 'Team', 'ts.team_name', 'string', 'internal', false, ['team']),
            'season'       => new Field('season', 'Season', 'g.season', 'string', 'public'),
            'owner'        => new Field('owner', 'Owner', "TRIM(CONCAT(COALESCE(o.first_name,''),' ',COALESCE(o.last_name,'')))", 'string', 'internal', false, ['owner']),
            'metric_type'  => new Field('metric_type', 'Metric', 'g.metric_type', 'string', 'public'),
            'target_value' => new Field('target_value', 'Target', 'g.target_value', 'decimal', 'public', true),
            'current_value' => new Field('current_value', 'Current', 'g.current_value', 'decimal', 'public', true),
            'unit'         => new Field('unit', 'Unit', 'g.unit', 'string', 'public'),
            'progress_pct' => new Field('progress_pct', 'Progress %', 'CASE WHEN g.target_value > 0 THEN LEAST(100, ROUND(g.current_value / g.target_value * 100)) WHEN g.status = \'achieved\' THEN 100 ELSE 0 END', 'int', 'public', true),
            'metric_source' => new Field('metric_source', 'Metric source', 'g.metric_source', 'string', 'internal'),
            'start_date'   => new Field('start_date', 'Start', 'g.start_date', 'date', 'public'),
            'due_date'     => new Field('due_date', 'Due', 'g.due_date', 'date', 'public'),
            'overdue'      => new Field('overdue', 'Overdue', "(g.due_date IS NOT NULL AND g.due_date < CURDATE() AND g.status NOT IN ('achieved','missed','archived'))", 'bool', 'public'),
            'created_at'   => new Field('created_at', 'Created', 'g.created_at', 'datetime', 'internal'),
            'count'        => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['g.team_season_id = ?', [$teamSeasonId]];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'own_teams':
                return [
                    "g.team_season_id IN (SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?)",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }
}
