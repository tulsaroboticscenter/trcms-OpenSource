<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class SponsorsDataset extends Dataset
{
    public function key(): string { return 'sponsors'; }
    public function label(): string { return 'Sponsors'; }
    public function baseFrom(): string { return 'sponsors sp'; }

    public function fields(): array
    {
        return [
            'name'            => new Field('name', 'Sponsor', 'sp.name', 'string', 'public'),
            'scope'           => new Field('scope', 'Scope', 'sp.scope', 'string', 'public'),
            'tier'            => new Field('tier', 'Tier', 'sp.tier', 'string', 'public'),
            'lifecycle_state' => new Field('lifecycle_state', 'Status', 'sp.lifecycle_state', 'string', 'public'),
            'industry'        => new Field('industry', 'Industry', 'sp.industry_category', 'string', 'public'),
            'season'          => new Field('season', 'Season', 'sp.season', 'string', 'public'),
            'contact_name'    => new Field('contact_name', 'Contact', 'sp.primary_contact_name', 'string', 'pii'),
            'contact_email'   => new Field('contact_email', 'Contact email', 'sp.primary_contact_email', 'string', 'pii'),
            'contact_phone'   => new Field('contact_phone', 'Contact phone', 'sp.primary_contact_phone', 'string', 'pii'),
            'website'         => new Field('website', 'Website', 'sp.website', 'string', 'public'),
            'created_at'      => new Field('created_at', 'Added', 'DATE(sp.created_at)', 'date', 'internal'),
            'count'           => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        // Sponsors are organization relationships, not per-member rows. Builders
        // (own_teams+) see them all; self/none see none.
        switch ($scope) {
            case 'all':
            case 'own_teams':
                return [null, []];
            default:
                return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return [
            "sp.id IN (SELECT stx.sponsor_id FROM sponsor_teams stx
                        JOIN team_seasons tsx ON tsx.team_id = stx.team_id WHERE tsx.id = ?)",
            [$teamSeasonId],
        ];
    }
}
