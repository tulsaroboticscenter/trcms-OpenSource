<?php
declare(strict_types=1);

namespace App\Reports;

/**
 * One selectable field in a dataset: a friendly key mapped to a SQL expression,
 * with a type (for formatting), a sensitivity tier (for masking), whether it can
 * be aggregated, and which optional joins it requires.
 *
 * tier: public < internal < pii < financial (a viewer must be entitled to the
 * field's tier to see it, else it is masked/omitted by the compiler).
 */
final class Field
{
    public const TIERS = ['public' => 0, 'internal' => 1, 'pii' => 2, 'financial' => 3];

    /** @param string[] $joins join keys this field's expression depends on */
    public function __construct(
        public string $key,
        public string $label,
        public string $expr,
        public string $type = 'string',      // string|int|decimal|date|datetime|bool
        public string $tier = 'internal',
        public bool $aggregatable = false,
        public array $joins = [],
    ) {}

    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'label' => $this->label,
            'type' => $this->type,
            'tier' => $this->tier,
            'aggregatable' => $this->aggregatable,
        ];
    }

    public static function tierRank(string $tier): int
    {
        return self::TIERS[$tier] ?? 1;
    }
}
