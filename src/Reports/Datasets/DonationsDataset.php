<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class DonationsDataset extends Dataset
{
    public function key(): string { return 'donations'; }
    public function label(): string { return 'Donations'; }
    public function baseFrom(): string { return 'inv_fundraising_donations d'; }

    public function joins(): array
    {
        return [
            'sp'  => 'LEFT JOIN sponsors sp ON sp.id = d.sponsor_id',
            'ev'  => 'LEFT JOIN events ev ON ev.id = d.event_id',
            'cat' => 'LEFT JOIN inv_budget_categories bc ON bc.id = d.budget_category_id',
        ];
    }

    public function fields(): array
    {
        return [
            'name'            => new Field('name', 'Donation / source', 'd.name', 'string', 'internal'),
            'received_date'   => new Field('received_date', 'Received', 'd.received_date', 'date', 'internal'),
            'expected_amount' => new Field('expected_amount', 'Expected', 'd.expected_amount', 'decimal', 'financial', true),
            'received_amount' => new Field('received_amount', 'Received $', 'd.received_amount', 'decimal', 'financial', true),
            'is_received'     => new Field('is_received', 'Received?', 'CASE WHEN d.received_date IS NOT NULL THEN 1 ELSE 0 END', 'bool', 'internal'),
            'sponsor'         => new Field('sponsor', 'Sponsor', 'sp.name', 'string', 'internal', false, ['sp']),
            'event'           => new Field('event', 'Event', 'ev.name', 'string', 'internal', false, ['ev']),
            'category'        => new Field('category', 'Budget category', 'bc.name', 'string', 'internal', false, ['cat']),
            'from_grant'      => new Field('from_grant', 'From grant?', 'CASE WHEN d.grant_id IS NOT NULL THEN 1 ELSE 0 END', 'bool', 'internal'),
            'notes'           => new Field('notes', 'Notes', 'd.notes', 'string', 'internal'),
            'created_at'      => new Field('created_at', 'Logged', 'DATE(d.created_at)', 'date', 'internal'),
            'count'           => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        // Donations are org-level (not team/member scoped); amounts are still
        // gated by the financial field tier. Anyone with 'all' or 'own_teams'
        // sees the rows; self/none see nothing.
        return in_array($scope, ['all', 'own_teams'], true) ? [null, []] : ['1 = 0', []];
    }
}
