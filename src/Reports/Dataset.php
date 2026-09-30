<?php
declare(strict_types=1);

namespace App\Reports;

use PDO;

/**
 * A curated dataset — the semantic layer between report authors and the
 * database. It exposes friendly, typed fields (never raw columns/SQL), the base
 * table, optional joins, and a row-scope strategy. The compiler assembles a
 * safe parameterized query from a report definition against a dataset; it never
 * trusts field keys, operators, or aggregations that aren't declared here.
 */
abstract class Dataset
{
    abstract public function key(): string;
    abstract public function label(): string;

    /** FROM clause with alias, e.g. "members m". */
    abstract public function baseFrom(): string;

    /** @return array<string,Field> keyed by field key */
    abstract public function fields(): array;

    /** @return array<string,string> joinKey => "JOIN ... ON ..." (added only when needed) */
    public function joins(): array { return []; }

    /**
     * An always-applied WHERE fragment for the dataset (e.g. Assets = only
     * asset-typed items), or null. Kept separate from row-scope.
     * @return array{0:?string,1:array<int,mixed>}
     */
    public function baseWhere(): array { return [null, []]; }

    /**
     * Row-scope WHERE fragment for a viewer, or [null, []] for no restriction.
     * @return array{0:?string,1:array<int,mixed>}
     */
    abstract public function rowScopeWhere(string $scope, int $memberId): array;

    /**
     * Optional WHERE fragment narrowing to a single team-season (used by the
     * team-page Reports tab). Null if the dataset has no team linkage.
     * @return array{0:?string,1:array<int,mixed>}
     */
    public function teamFilter(int $teamSeasonId): array { return [null, []]; }

    public function field(string $key): ?Field
    {
        return $this->fields()[$key] ?? null;
    }

    /** Fields visible to a viewer entitled up to $maxTier, as plain arrays. */
    public function fieldCatalog(string $maxTier): array
    {
        $cap = Field::tierRank($maxTier);
        $out = [];
        foreach ($this->fields() as $f) {
            if (Field::tierRank($f->tier) <= $cap) $out[] = $f->toArray();
        }
        return $out;
    }

    public function meta(string $maxTier): array
    {
        return [
            'key' => $this->key(),
            'label' => $this->label(),
            'fields' => $this->fieldCatalog($maxTier),
        ];
    }
}
