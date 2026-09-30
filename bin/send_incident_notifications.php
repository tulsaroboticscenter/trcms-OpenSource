<?php
declare(strict_types=1);

/**
 * Deliver pending incident-report notifications. Filing a report only LOGS where it should route
 * (so a member's submit is instant and never blocked by email); this script does the actual
 * sending. Schedule it on a frequent cron (e.g. every 5 minutes) in Plesk:
 *
 *   php bin/send_incident_notifications.php
 *
 * Safe to run concurrently-ish: it only picks up rows that are unsent and not yet errored.
 */

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require __DIR__ . '/../vendor/autoload.php';

use App\Core\Config;
use App\Core\Database;
use App\Controllers\IncidentsController;

Config::load(dirname(__DIR__));
$pdo = Database::pdo();
$sent = IncidentsController::sendPendingNotifications($pdo, 300);
echo '[incident-notify] delivered ' . $sent . " pending notification(s)\n";
