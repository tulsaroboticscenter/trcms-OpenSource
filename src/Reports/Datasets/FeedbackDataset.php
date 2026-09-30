<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class FeedbackDataset extends Dataset
{
    public function key(): string { return 'feedback'; }
    public function label(): string { return 'Feedback'; }
    public function baseFrom(): string { return 'feedback f'; }

    public function joins(): array
    {
        return ['members' => 'LEFT JOIN members m ON m.id = f.member_id'];
    }

    public function fields(): array
    {
        return [
            'title'          => new Field('title', 'Title', 'f.title', 'string', 'internal'),
            'type'           => new Field('type', 'Type', 'f.type', 'string', 'public'),
            'status'         => new Field('status', 'Status', 'f.status', 'string', 'public'),
            'priority'       => new Field('priority', 'Priority', 'f.priority', 'string', 'public'),
            'page'           => new Field('page', 'Page', 'f.page', 'string', 'internal'),
            'target_release' => new Field('target_release', 'Target release', 'f.target_release', 'string', 'public'),
            'resolution_release' => new Field('resolution_release', 'Resolved in', 'f.resolution_release', 'string', 'public'),
            'deployed_on'    => new Field('deployed_on', 'Deployed', 'f.deployed_on', 'date', 'internal'),
            'submitter'      => new Field('submitter', 'Submitted by', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'created_at'     => new Field('created_at', 'Submitted', 'DATE(f.created_at)', 'date', 'internal'),
            'count'          => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['f.member_id = ?', [$memberId]];
            case 'own_teams': return [null, []];
            default: return ['1 = 0', []];
        }
    }
}
