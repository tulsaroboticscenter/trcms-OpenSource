<?php
declare(strict_types=1);

namespace App\Reports;

/**
 * Translates a user-authored computed-field expression into safe SQL.
 *
 * Only these tokens are allowed: dataset field keys (resolved to their vetted
 * SQL expression via the same resolver used everywhere else, so tier + join
 * rules still apply), numeric literals, the operators + - * / ( ) and comma,
 * and a small allowlist of functions. Anything else — quotes, semicolons,
 * subqueries, unknown identifiers — is rejected. No raw SQL ever reaches the
 * database from user input.
 */
final class SafeExpression
{
    private const FUNCS = ['round', 'abs', 'coalesce', 'least', 'greatest', 'floor', 'ceil', 'nullif', 'if'];

    /**
     * @param callable(string):Field $resolve resolves a field key to its Field (throws if disallowed)
     */
    public static function toSql(string $expr, callable $resolve): string
    {
        $expr = trim($expr);
        if ($expr === '') throw new ReportException('Empty computed expression.');
        if (preg_match('/[^A-Za-z0-9_+\-*\/(),.\s]/', $expr)) {
            throw new ReportException('Computed expression contains an unsupported character.');
        }
        preg_match_all('/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[-+*\/(),]/', $expr, $m);
        $tokens = $m[0];
        if (!$tokens) throw new ReportException('Could not parse the computed expression.');

        $out = [];
        $n = count($tokens);
        for ($i = 0; $i < $n; $i++) {
            $t = $tokens[$i];
            if (preg_match('/^[A-Za-z_]/', $t)) {
                $isCall = ($i + 1 < $n) && $tokens[$i + 1] === '(';
                if ($isCall) {
                    if (!in_array(strtolower($t), self::FUNCS, true)) {
                        throw new ReportException("Function '$t' is not allowed in computed fields.");
                    }
                    $out[] = strtoupper($t);
                } else {
                    $f = $resolve($t);   // validates existence + tier, records joins
                    if (self::isAggregate($f->expr)) throw new ReportException("Cannot use the measure '{$f->label}' in a computed field.");
                    $out[] = '(' . $f->expr . ')';
                }
            } else {
                $out[] = $t;   // number, operator, paren, comma
            }
        }
        return implode(' ', $out);
    }

    private static function isAggregate(string $expr): bool
    {
        return (bool)preg_match('/^\s*(COUNT|SUM|AVG|MIN|MAX)\s*\(/i', $expr);
    }
}
