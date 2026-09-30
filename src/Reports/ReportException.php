<?php
declare(strict_types=1);

namespace App\Reports;

/** Thrown when a report definition is invalid or references disallowed fields. */
final class ReportException extends \RuntimeException {}
