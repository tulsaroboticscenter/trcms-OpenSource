<?php
declare(strict_types=1);

namespace App\Reports;

use App\Reports\Datasets\AssetsDataset;
use App\Reports\Datasets\AttendanceDataset;
use App\Reports\Datasets\CheckoutsDataset;
use App\Reports\Datasets\DonationsDataset;
use App\Reports\Datasets\EnrollmentsDataset;
use App\Reports\Datasets\EventsDataset;
use App\Reports\Datasets\FeedbackDataset;
use App\Reports\Datasets\GoalsDataset;
use App\Reports\Datasets\GrantsDataset;
use App\Reports\Datasets\InventoryDataset;
use App\Reports\Datasets\InventoryMovementsDataset;
use App\Reports\Datasets\MembersDataset;
use App\Reports\Datasets\PortfolioPiecesDataset;
use App\Reports\Datasets\MentorPipelineDataset;
use App\Reports\Datasets\RepairsDataset;
use App\Reports\Datasets\ReservationsDataset;
use App\Reports\Datasets\ScholarshipsDataset;
use App\Reports\Datasets\SponsorsDataset;
use App\Reports\Datasets\TeamMembersDataset;
use App\Reports\Datasets\TimeImpactDataset;
use App\Reports\Datasets\UsageMonthlyDataset;
use App\Reports\Datasets\VisitorsDataset;
use App\Reports\Datasets\WaitlistDataset;

/**
 * Registry of available datasets. Adding a dataset = one entry here plus its
 * class. Datasets are the only things a report definition may target.
 */
final class DatasetRegistry
{
    /** @return array<string,Dataset> */
    public static function all(): array
    {
        static $cache = null;
        if ($cache === null) {
            $cache = [];
            $list = [
                new MembersDataset(), new EventsDataset(), new TimeImpactDataset(),
                new AttendanceDataset(), new InventoryDataset(), new AssetsDataset(),
                new GrantsDataset(), new DonationsDataset(), new ScholarshipsDataset(),
                new EnrollmentsDataset(), new SponsorsDataset(), new GoalsDataset(), new PortfolioPiecesDataset(),
                new RepairsDataset(), new CheckoutsDataset(), new ReservationsDataset(),
                new WaitlistDataset(), new MentorPipelineDataset(), new FeedbackDataset(),
                new UsageMonthlyDataset(), new InventoryMovementsDataset(),
                new VisitorsDataset(), new TeamMembersDataset(),
            ];
            foreach ($list as $d) {
                $cache[$d->key()] = $d;
            }
        }
        return $cache;
    }

    public static function get(string $key): ?Dataset
    {
        return self::all()[$key] ?? null;
    }
}
