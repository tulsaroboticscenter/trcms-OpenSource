<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class WaitlistDataset extends Dataset
{
    public function key(): string { return 'waitlist'; }
    public function label(): string { return 'Waitlist'; }
    public function baseFrom(): string { return 'waitlist_entries w'; }

    public function joins(): array
    {
        return ['programs' => 'LEFT JOIN programs p ON p.id = w.program_id'];
    }

    public function fields(): array
    {
        return [
            'program'        => new Field('program', 'Program', 'p.name', 'string', 'public', false, ['programs']),
            'season'         => new Field('season', 'Season', 'w.season', 'string', 'public'),
            'status'         => new Field('status', 'Status', 'w.status', 'string', 'public'),
            'sibling'        => new Field('sibling', 'Has sibling in program', 'w.sibling_of_member', 'bool', 'internal'),
            'parent_mentor'  => new Field('parent_mentor', 'Parent mentor interest', 'w.parent_mentor_interest', 'bool', 'internal'),
            'requested_date' => new Field('requested_date', 'Requested', 'w.requested_date', 'date', 'internal'),
            'offered_at'     => new Field('offered_at', 'Offered', 'DATE(w.offered_at)', 'date', 'internal'),
            'offer_expires'  => new Field('offer_expires', 'Offer expires', 'w.offer_expires', 'date', 'internal'),
            'carried_from'   => new Field('carried_from', 'Carried from', 'w.carried_from_season', 'string', 'internal'),
            'count'          => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        return in_array($scope, ['all', 'own_teams'], true) ? [null, []] : ['1 = 0', []];
    }
}
