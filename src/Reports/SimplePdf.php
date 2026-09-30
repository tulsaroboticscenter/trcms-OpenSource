<?php
declare(strict_types=1);

namespace App\Reports;

/**
 * Minimal, dependency-free PDF writer for a titled data table. Uses the PDF core
 * fonts (Helvetica / Helvetica-Bold) so nothing needs embedding, and computes
 * exact cross-reference byte offsets. Handles column fitting, cell truncation,
 * and page breaks. Not a general PDF library — just enough for report exports.
 */
final class SimplePdf
{
    private const W = 612.0;          // US Letter
    private const H = 792.0;
    private const MARGIN = 40.0;
    private const FS = 8.0;           // table font size
    private const ROW = 13.0;         // row height
    private const CHARW = 0.5;        // approx Helvetica char width per pt of font size

    /**
     * @param array<int,array<string,string>> $columns each with 'label'
     * @param array<int,array<int,mixed>> $rows positional values aligned to columns
     */
    public static function render(string $title, array $columns, array $rows): string
    {
        $tableW = self::W - 2 * self::MARGIN;
        $ncol = max(1, count($columns));

        // Column widths: weight by max content length (capped), normalized to fit.
        $weights = [];
        foreach ($columns as $ci => $c) {
            $max = strlen((string)$c['label']);
            foreach ($rows as $r) $max = max($max, strlen((string)($r[$ci] ?? '')));
            $weights[$ci] = min(max($max, 4), 40);
        }
        $sum = array_sum($weights) ?: 1;
        $colW = []; $colX = []; $x = self::MARGIN;
        foreach ($weights as $ci => $w) {
            $colW[$ci] = $tableW * $w / $sum;
            $colX[$ci] = $x;
            $x += $colW[$ci];
        }
        $maxChars = fn(int $ci) => max(1, (int)floor($colW[$ci] / (self::FS * self::CHARW)));

        // Build page content streams, breaking when we run out of vertical room.
        $pages = [];
        $content = '';
        $y = self::H - self::MARGIN;

        $startPage = function () use (&$content, &$y, $title) {
            $content = '';
            $y = self::H - self::MARGIN;
            $content .= "BT /F2 14 Tf 1 0 0 1 " . self::num(self::MARGIN) . " " . self::num($y) . " Tm (" . self::esc($title) . ") Tj ET\n";
            $y -= 22;
        };
        $writeRow = function (array $cells, bool $bold) use (&$content, &$y, $colX, $maxChars) {
            $font = $bold ? 'F2' : 'F1';
            foreach ($cells as $ci => $val) {
                $txt = self::truncate((string)$val, $maxChars($ci));
                $content .= "BT /$font " . self::FS . " Tf 1 0 0 1 " . self::num($colX[$ci]) . " " . self::num($y) . " Tm (" . self::esc($txt) . ") Tj ET\n";
            }
            $y -= self::ROW;
        };

        $startPage();
        $writeRow(array_map(fn($c) => (string)$c['label'], $columns), true);
        $y -= 2;
        foreach ($rows as $r) {
            if ($y < self::MARGIN + self::ROW) {
                $pages[] = $content;
                $startPage();
                $writeRow(array_map(fn($c) => (string)$c['label'], $columns), true);
                $y -= 2;
            }
            $cells = [];
            foreach ($columns as $ci => $_) $cells[$ci] = $r[$ci] ?? '';
            $writeRow($cells, false);
        }
        $pages[] = $content;

        return self::assemble($pages);
    }

    /** @param string[] $pageContents */
    private static function assemble(array $pageContents): string
    {
        $n = count($pageContents);
        // Object numbers: 1 Catalog, 2 Pages, 3 F1, 4 F2, then per page (page, contents).
        $kids = [];
        for ($i = 0; $i < $n; $i++) $kids[] = (5 + $i * 2) . ' 0 R';

        $objects = [];
        $objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        $objects[2] = "<< /Type /Pages /Kids [" . implode(' ', $kids) . "] /Count $n >>";
        $objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
        $objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
        for ($i = 0; $i < $n; $i++) {
            $pageObj = 5 + $i * 2;
            $contentsObj = 6 + $i * 2;
            $objects[$pageObj] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " . self::num(self::W) . " " . self::num(self::H) . "]"
                . " /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents $contentsObj 0 R >>";
            $stream = $pageContents[$i];
            $objects[$contentsObj] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "endstream";
        }
        ksort($objects);

        // Serialize with exact byte offsets for the xref table.
        $out = "%PDF-1.4\n";
        $offsets = [];
        foreach ($objects as $num => $body) {
            $offsets[$num] = strlen($out);
            $out .= "$num 0 obj\n$body\nendobj\n";
        }
        $xrefPos = strlen($out);
        $count = count($objects) + 1;
        $out .= "xref\n0 $count\n0000000000 65535 f \n";
        for ($num = 1; $num < $count; $num++) {
            $out .= sprintf("%010d 00000 n \n", $offsets[$num]);
        }
        $out .= "trailer\n<< /Size $count /Root 1 0 R >>\nstartxref\n$xrefPos\n%%EOF";
        return $out;
    }

    private static function esc(string $s): string
    {
        // PDF text strings: escape backslash and parentheses; drop control chars.
        $s = str_replace(['\\', '(', ')', "\r", "\n"], ['\\\\', '\\(', '\\)', ' ', ' '], $s);
        return $s;
    }

    private static function truncate(string $s, int $max): string
    {
        $s = trim(preg_replace('/\s+/', ' ', $s) ?? $s);
        if (strlen($s) <= $max) return $s;
        return $max > 2 ? substr($s, 0, $max - 2) . '..' : substr($s, 0, $max);
    }

    private static function num(float $f): string
    {
        return rtrim(rtrim(sprintf('%.2f', $f), '0'), '.');
    }
}
