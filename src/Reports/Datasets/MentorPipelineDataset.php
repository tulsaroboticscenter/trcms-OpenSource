<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class MentorPipelineDataset extends Dataset
{
    public function key(): string { return 'mentor_pipeline'; }
    public function label(): string { return 'Mentor Pipeline'; }
    public function baseFrom(): string { return 'mentor_prospects mp'; }

    public function fields(): array
    {
        return [
            'name'         => new Field('name', 'Name', 'mp.name', 'string', 'pii'),
            'kind'         => new Field('kind', 'Kind', 'mp.kind', 'string', 'public'),
            'stage'        => new Field('stage', 'Stage', 'mp.stage', 'string', 'public'),
            'source'       => new Field('source', 'Source', 'mp.source', 'string', 'internal'),
            'email'        => new Field('email', 'Email', 'mp.email', 'string', 'pii'),
            'phone'        => new Field('phone', 'Phone', 'mp.phone', 'string', 'pii'),
            'ypt_done'     => new Field('ypt_done', 'YPT done', 'mp.ypt_done', 'bool', 'internal'),
            'background_done' => new Field('background_done', 'Background done', 'mp.background_done', 'bool', 'internal'),
            'tc_done'      => new Field('tc_done', 'T&C done', 'mp.tc_done', 'bool', 'internal'),
            'orientation_done' => new Field('orientation_done', 'Orientation done', 'mp.orientation_done', 'bool', 'internal'),
            'created_at'   => new Field('created_at', 'Added', 'DATE(mp.created_at)', 'date', 'internal'),
            'count'        => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        return in_array($scope, ['all', 'own_teams'], true) ? [null, []] : ['1 = 0', []];
    }
}
