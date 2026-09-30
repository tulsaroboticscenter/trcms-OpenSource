<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Thin client for the ftcscout.org public GraphQL API (https://api.ftcscout.org/graphql).
 * No auth required. Used server-side to populate the scouting caches (roster,
 * pre-event projections, match schedule, live stats) so scouters' offline devices
 * can pull a self-contained event bundle.
 *
 * Note: FTC scoring is reported per alliance, not per robot — the per-team figures
 * here are ftcscout's OPR decomposition, not direct measurements.
 */
final class FtcScout
{
    private const ENDPOINT = 'https://api.ftcscout.org/graphql';

    /** Run a GraphQL query and return the decoded `data` object (throws on transport/GraphQL error). */
    public static function query(string $query, array $variables = []): array
    {
        $body = json_encode(['query' => $query, 'variables' => (object)$variables], JSON_UNESCAPED_SLASHES);
        $ch = curl_init(self::ENDPOINT);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
        ]);
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            throw new \RuntimeException("ftcscout request failed: $err");
        }
        if ($code >= 400) {
            throw new \RuntimeException("ftcscout returned HTTP $code");
        }
        $decoded = json_decode((string)$raw, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('ftcscout returned an unreadable response');
        }
        if (!empty($decoded['errors'])) {
            $msg = $decoded['errors'][0]['message'] ?? 'unknown GraphQL error';
            throw new \RuntimeException("ftcscout GraphQL error: $msg");
        }
        return $decoded['data'] ?? [];
    }

    /**
     * Event header + roster + pre-event projections in one call.
     * Returns ['event' => [...], 'teams' => [...], 'previewStats' => [...]] or null if not found.
     * $statsType is the season's stats union member, e.g. 'TeamEventStats2025'.
     */
    public static function eventBundle(int $season, string $code, string $statsType): ?array
    {
        $q = <<<GQL
        query(\$season: Int!, \$code: String!) {
          eventByCode(season: \$season, code: \$code) {
            code name divisionCode start end
            location { city state }
            teams { teamNumber team { name } stats { ... on $statsType {
              opr {
                totalPointsNp autoPoints dcPoints
                autoArtifactPoints dcArtifactPoints
                penaltyPointsByOpp penaltyPointsCommitted
              }
              avg { totalPointsNp autoPoints dcPoints }
            } } }
            previewStats {
              teamNumber npOpr
              stats { ... on $statsType {
                opr {
                  totalPointsNp autoPoints dcPoints
                  autoArtifactPoints dcArtifactPoints
                  penaltyPointsByOpp penaltyPointsCommitted
                }
                avg { totalPointsNp autoPoints dcPoints }
              } }
            }
          }
        }
        GQL;
        $data = self::query($q, ['season' => $season, 'code' => $code]);
        return $data['eventByCode'] ?? null;
    }

    /**
     * Match schedule for an event (may be empty pre-publish). Includes the final
     * red/blue score per played match — used (hidden) for training-mode reveal.
     * $scoresType is the season's MatchScores union member, e.g. 'MatchScores2025'.
     */
    public static function schedule(int $season, string $code, string $scoresType = 'MatchScores2025'): array
    {
        $q = <<<GQL
        query(\$season: Int!, \$code: String!) {
          eventByCode(season: \$season, code: \$code) {
            hasMatches
            matches {
              matchNum tournamentLevel scheduledStartTime hasBeenPlayed
              scores { ... on $scoresType { red { totalPoints } blue { totalPoints } } }
              teams { teamNumber alliance station surrogate allianceRole }
            }
          }
        }
        GQL;
        $data = self::query($q, ['season' => $season, 'code' => $code]);
        return $data['eventByCode']['matches'] ?? [];
    }

    /** Current-event team stats (live OPR), kept separate from the pre-event baseline. */
    public static function liveStats(int $season, string $code, string $statsType): array
    {
        $q = <<<GQL
        query(\$season: Int!, \$code: String!) {
          eventByCode(season: \$season, code: \$code) {
            teams {
              teamNumber
              stats { ... on $statsType {
                rank rp tb1 tb2 wins losses ties dqs qualMatchesPlayed
                opr { totalPoints totalPointsNp autoPoints dcPoints
                      penaltyPointsByOpp penaltyPointsCommitted }
                dev { totalPointsNp }
              } }
            }
          }
        }
        GQL;
        $data = self::query($q, ['season' => $season, 'code' => $code]);
        return $data['eventByCode']['teams'] ?? [];
    }

    /**
     * Combined live sync: team stats + played match scores in one call.
     * Returns ['teams' => [...], 'matches' => [...]] so syncLive can update
     * both scout_live_stats and scout_matches in one API round-trip.
     */
    public static function liveData(int $season, string $code, string $statsType, string $scoresType): array
    {
        $q = <<<GQL
        query(\$season: Int!, \$code: String!) {
          eventByCode(season: \$season, code: \$code) {
            teams {
              teamNumber
              stats { ... on $statsType {
                rank rp tb1 tb2 wins losses ties dqs qualMatchesPlayed
                opr { totalPoints totalPointsNp autoPoints dcPoints
                      penaltyPointsByOpp penaltyPointsCommitted }
                dev { totalPointsNp }
              } }
            }
            matches {
              matchNum tournamentLevel hasBeenPlayed
              scores { ... on $scoresType { red { totalPoints } blue { totalPoints } } }
              teams { teamNumber alliance station surrogate allianceRole }
            }
          }
        }
        GQL;
        $data = self::query($q, ['season' => $season, 'code' => $code]);
        $ev = $data['eventByCode'] ?? [];
        return ['teams' => $ev['teams'] ?? [], 'matches' => $ev['matches'] ?? []];
    }
}
