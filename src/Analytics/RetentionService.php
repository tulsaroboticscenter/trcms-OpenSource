<?php
declare(strict_types=1);

namespace App\Analytics;

use PDO;

/**
 * Cohort retention triangle. A member's cohort is the FIRST season they
 * participated in; retention at "year k" is the share of that cohort still
 * participating k seasons later. Reconstructed from member_season_participation
 * (the authoritative per-season participation record), so it works over all
 * existing history with no new data capture.
 *
 * Seasons are ordered chronologically by the season label (YYYY-YYYY sorts
 * correctly). "Year k" counts positions in that ordered list, so a cell is only
 * shown when the cohort-season + k has actually occurred (future = null).
 */
final class RetentionService
{
    public function __construct(private PDO $pdo) {}

    /**
     * @param string $memberType 'youth' | 'mentor' | 'all'
     * @param int $maxYears number of follow-on seasons to show (columns = 0..maxYears)
     * @return array{basis:string,max_years:int,member_type:string,cohorts:array<int,array<string,mixed>>}
     */
    public function triangle(string $memberType = 'youth', int $maxYears = 5): array
    {
        // 1. Ordered season list → position index.
        $seasons = [];       // position => season label
        $posBySeasonId = []; // season_id => position
        $i = 0;
        foreach ($this->pdo->query("SELECT id, season FROM first_seasons ORDER BY season") as $r) {
            $seasons[$i] = $r['season'];
            $posBySeasonId[(int)$r['id']] = $i;
            $i++;
        }
        $lastPos = $i - 1;
        if ($lastPos < 0) {
            return ['basis' => 'season', 'max_years' => $maxYears, 'member_type' => $memberType, 'cohorts' => []];
        }

        // 2. Participation rows, filtered by member type, only where the member
        //    actually did a program that season.
        $typeSql = $memberType === 'all' ? '' : ' AND m.member_type = :mt';
        $sql = "SELECT p.member_id, p.season_id
                  FROM member_season_participation p
                  JOIN members m ON m.id = p.member_id
                 WHERE (p.participated_fll_explore OR p.participated_fll_challenge
                        OR p.participated_ftc OR p.participated_frc OR p.participated_fdp)"
             . $typeSql;
        $st = $this->pdo->prepare($sql);
        if ($memberType !== 'all') $st->bindValue(':mt', $memberType);
        $st->execute();

        // member_id => set of positions. Track the latest season actually seen
        // (by POSITION, not id — first_seasons.id is not chronological) so we
        // never show a follow-on column for a season that hasn't happened yet.
        $memberPositions = [];
        $currentPos = 0;
        foreach ($st->fetchAll() as $row) {
            $sid = (int)$row['season_id'];
            if (!isset($posBySeasonId[$sid])) continue;
            $pos = $posBySeasonId[$sid];
            $memberPositions[(int)$row['member_id']][$pos] = true;
            if ($pos > $currentPos) $currentPos = $pos;
        }

        // 3. Group members by cohort (earliest position) and tally retention.
        // cohortPos => ['size'=>n, 'retained'=>[k=>count]]
        $byCohort = [];
        foreach ($memberPositions as $positions) {
            $cohort = min(array_keys($positions));
            $byCohort[$cohort]['size'] = ($byCohort[$cohort]['size'] ?? 0) + 1;
            for ($k = 0; $k <= $maxYears; $k++) {
                if (isset($positions[$cohort + $k])) {
                    $byCohort[$cohort]['retained'][$k] = ($byCohort[$cohort]['retained'][$k] ?? 0) + 1;
                }
            }
        }
        ksort($byCohort);

        // 4. Shape into rows with per-year pct (null where the season is future).
        $cohorts = [];
        foreach ($byCohort as $pos => $agg) {
            $size = (int)$agg['size'];
            $cells = [];
            for ($k = 0; $k <= $maxYears; $k++) {
                if ($pos + $k > $currentPos) {          // that season hasn't happened yet
                    $cells[] = ['year' => $k, 'retained' => null, 'pct' => null];
                    continue;
                }
                $ret = (int)($agg['retained'][$k] ?? 0);
                $cells[] = ['year' => $k, 'retained' => $ret, 'pct' => $size ? round($ret * 100 / $size, 1) : 0.0];
            }
            $cohorts[] = [
                'cohort_season' => $seasons[$pos],
                'size' => $size,
                'cells' => $cells,
            ];
        }

        return [
            'basis' => 'season',
            'max_years' => $maxYears,
            'member_type' => $memberType,
            'cohorts' => $cohorts,
        ];
    }
}
