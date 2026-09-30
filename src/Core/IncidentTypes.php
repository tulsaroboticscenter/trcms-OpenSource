<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Incident type catalog (§4). The FULL list lives here so Phase 2 is a UI-and-routing change,
 * not a schema change. Only Phase-1 types are offered on the form; the server rejects the rest.
 * Tiers drive is_sensitive / is_restricted and the default routing.
 */
final class IncidentTypes
{
    /** slug => [label, phase (1|2), tier (standard|sensitive|restricted)] */
    public const CATALOG = [
        'medical'        => ['Medical / Health Event', 1, 'standard'],
        'injury'         => ['Injury / Accident', 1, 'standard'],
        'behavior'       => ['Behavior / Conduct (youth)', 1, 'sensitive'],
        'near_miss'      => ['Near Miss / Unsafe Condition', 1, 'standard'],
        'adult_conduct'  => ['Adult Conduct / Youth Protection', 2, 'restricted'],
        'abuse'          => ['Abuse or Neglect Suspicion', 2, 'restricted'],
        'mental_health'  => ['Mental Health / Self-Harm', 2, 'restricted'],
        'bullying'       => ['Bullying / Harassment / Discrimination', 2, 'sensitive'],
        'missing_youth'  => ['Missing Youth / Unauthorized Pickup', 2, 'restricted'],
        'security'       => ['Security / Threat', 2, 'sensitive'],
        'emergency'      => ['Emergency Activation (weather, fire, evacuation, drill)', 2, 'standard'],
        'transportation' => ['Transportation / Vehicle', 2, 'standard'],
        'property'       => ['Property Damage / Loss / Theft', 2, 'standard'],
        'facility'       => ['Facility Issue', 2, 'standard'],
        'substance'      => ['Substance Use', 2, 'sensitive'],
        'data_privacy'   => ['Data / Privacy Incident', 2, 'sensitive'],
        'complaint'      => ['Complaint / Grievance', 2, 'sensitive'],
        'ethics'         => ['Financial / Ethics Concern (whistleblower)', 2, 'restricted'],
    ];

    public static function isValid(string $slug): bool    { return isset(self::CATALOG[$slug]); }
    public static function isPhase1(string $slug): bool    { return (self::CATALOG[$slug][1] ?? 9) === 1; }
    public static function tier(string $slug): string      { return self::CATALOG[$slug][2] ?? 'standard'; }
    public static function isSensitive(string $slug): bool { return self::tier($slug) === 'sensitive'; }
    public static function isRestricted(string $slug): bool { return self::tier($slug) === 'restricted'; }
    public static function label(string $slug): string     { return self::CATALOG[$slug][0] ?? $slug; }

    /** Phase-1 types for the picker (the frontend has its own copy; this is the server guard). */
    public static function phase1(): array
    {
        $out = [];
        foreach (self::CATALOG as $slug => $c) {
            if ($c[1] === 1) $out[] = ['slug' => $slug, 'label' => $c[0], 'tier' => $c[2]];
        }
        return $out;
    }
}
