<?php
declare(strict_types=1);

namespace App\Core;

/** CSV helpers. */
final class Csv
{
    /**
     * Security #12: neutralize spreadsheet formula injection. A cell whose value begins with
     * =, +, -, @ (or a leading tab / carriage-return that Excel treats as a formula lead-in)
     * is executed as a formula when the exported file is opened — e.g. a member with the name
     * =HYPERLINK("http://evil","click") runs on an admin's machine. Prefixing with a single
     * quote forces the spreadsheet to treat it as literal text. Values are otherwise unchanged.
     */
    public static function formulaSafe(mixed $value): string
    {
        $s = (string)$value;
        if ($s !== '' && strpbrk($s[0], "=+-@\t\r") !== false) {
            return "'" . $s;
        }
        return $s;
    }
}
