<?php
declare(strict_types=1);

namespace App\Reports;

/**
 * Compiles a JSON report definition against a dataset into a safe, fully
 * parameterized SQL query. Security is enforced HERE, not in the UI:
 *   - only fields declared on the dataset may be selected/filtered/sorted
 *   - a field above the viewer's field tier is rejected (never leaks)
 *   - the viewer's row-scope WHERE fragment is always injected
 *   - every value is bound (no interpolation)
 *   - a hard row cap is always applied
 *
 * Definition shape:
 *   {
 *     "fields":  [ {"field":"member_type"}, {"field":"count","agg":"count"} ],
 *     "filters": {"op":"and","conditions":[ {"field":"member_type","operator":"eq","value":"youth"} ]},
 *     "group_by":["member_type"],
 *     "sort":    [ {"field":"count","dir":"desc"} ],
 *     "limit":   200
 *   }
 * When any selected field carries an aggregate, all non-aggregate selected
 * fields are grouped automatically (standard BI behavior).
 */
final class ReportCompiler
{
    private const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'in', 'between', 'is_null', 'not_null'];
    private const AGGS = ['count', 'sum', 'avg', 'min', 'max'];
    private const ROW_CAP = 5000;

    /**
     * @return array{sql:string, params:array<int,mixed>, columns:array<int,array<string,string>>}
     */
    public function compile(Dataset $ds, array $def, array $ctx): array
    {
        $maxTier = $ctx['maxTier'] ?? 'internal';
        $scope = $ctx['scope'] ?? 'none';
        $memberId = (int)($ctx['memberId'] ?? 0);
        $capRank = Field::tierRank($maxTier);

        $needJoins = [];
        $resolveBase = function (string $key) use ($ds, $capRank, &$needJoins): Field {
            $f = $ds->field($key);
            if (!$f) throw new ReportException("Unknown field '$key'.");
            if (Field::tierRank($f->tier) > $capRank) throw new ReportException("You are not permitted to use the field '{$f->label}'.");
            foreach ($f->joins as $j) $needJoins[$j] = true;
            return $f;
        };

        // Computed fields: user-authored expressions over base fields, compiled
        // to SQL via the allowlist. They become resolvable like any other field
        // (and may themselves be aggregated). They may only reference base fields.
        $computed = [];
        foreach ($def['computed'] ?? [] as $cf) {
            $ckey = (string)($cf['key'] ?? '');
            if ($ckey === '' || !preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $ckey)) throw new ReportException('Invalid computed field key.');
            $sqlExpr = SafeExpression::toSql((string)($cf['expr'] ?? ''), $resolveBase);
            $type = (string)($cf['type'] ?? 'decimal');
            if (!in_array($type, ['int', 'decimal', 'string', 'date'], true)) $type = 'decimal';
            $computed[$ckey] = new Field($ckey, (string)($cf['label'] ?? $ckey), $sqlExpr, $type, 'internal', true, []);
        }
        $resolve = function (string $key) use ($computed, $resolveBase): Field {
            return $computed[$key] ?? $resolveBase($key);
        };

        // ---- SELECT ----
        $selected = $def['fields'] ?? [];
        if (!is_array($selected) || !$selected) throw new ReportException('Select at least one field.');

        $selectSql = [];
        $columns = [];
        $nonAgg = [];
        $aliasByField = [];
        $hasAgg = false;
        foreach ($selected as $sel) {
            $key = is_array($sel) ? ($sel['field'] ?? '') : (string)$sel;
            $agg = is_array($sel) ? strtolower((string)($sel['agg'] ?? '')) : '';
            $f = $resolve((string)$key);

            if ($agg !== '') {
                if (!in_array($agg, self::AGGS, true)) throw new ReportException("Unknown aggregate '$agg'.");
                // A field whose expression is already an aggregate (e.g. COUNT(*)) is used as-is.
                $expr = self::isAggregateExpr($f->expr) ? $f->expr : strtoupper($agg) . "({$f->expr})";
                $hasAgg = true;
            } elseif (self::isAggregateExpr($f->expr)) {
                $expr = $f->expr;
                $hasAgg = true;
            } else {
                $expr = $f->expr;
                $nonAgg[] = $f;
            }
            $alias = self::alias($f->key . ($agg ? "_$agg" : ''));
            $aliasByField[$f->key] = $alias;
            $selectSql[] = "$expr AS `$alias`";
            $columns[] = ['key' => $alias, 'label' => $f->label . ($agg ? ' (' . $agg . ')' : ''), 'type' => $agg === 'count' ? 'int' : $f->type];
        }

        // ---- WHERE (filters + row scope) ----
        $params = [];
        $where = [];
        if (!empty($def['filters'])) {
            $frag = $this->compileNode($def['filters'], $resolve, $ctx['params'] ?? [], $params);
            if ($frag !== '') $where[] = $frag;
        }
        [$baseSql, $baseParams] = $ds->baseWhere();
        if ($baseSql !== null) { $where[] = $baseSql; foreach ($baseParams as $p) $params[] = $p; }
        // Team-page context: narrow to a single team-season when supplied.
        if (!empty($ctx['teamSeasonId'])) {
            [$teamSql, $teamParams] = $ds->teamFilter((int)$ctx['teamSeasonId']);
            if ($teamSql !== null) { $where[] = $teamSql; foreach ($teamParams as $p) $params[] = $p; }
        }
        [$scopeSql, $scopeParams] = $ds->rowScopeWhere($scope, $memberId);
        if ($scopeSql !== null) { $where[] = $scopeSql; foreach ($scopeParams as $p) $params[] = $p; }

        // ---- GROUP BY (auto-group non-aggregates when aggregating) ----
        $groupSql = [];
        if ($hasAgg) {
            $explicit = $def['group_by'] ?? [];
            $groupKeys = [];
            foreach ($explicit as $gk) { $f = $resolve((string)$gk); $groupKeys[$f->key] = $f->expr; }
            foreach ($nonAgg as $f) $groupKeys[$f->key] = $f->expr;   // must group every selected dimension
            $groupSql = array_values($groupKeys);
        }

        // ---- ORDER BY ----
        $orderSql = [];
        foreach ($def['sort'] ?? [] as $s) {
            $f = $resolve((string)($s['field'] ?? ''));
            $dir = strtolower((string)($s['dir'] ?? 'asc')) === 'desc' ? 'DESC' : 'ASC';
            // Order by the SELECT alias when the field is selected (correct for
            // aggregated measures under only_full_group_by); else by its expr.
            $orderSql[] = (isset($aliasByField[$f->key]) ? "`{$aliasByField[$f->key]}`" : $f->expr) . " $dir";
        }

        // ---- assemble ----
        $sql = "SELECT " . implode(', ', $selectSql) . "\nFROM " . $ds->baseFrom();
        $allJoins = $ds->joins();
        foreach (array_keys($needJoins) as $jk) {
            if (isset($allJoins[$jk])) $sql .= "\n" . $allJoins[$jk];
        }
        if ($where) $sql .= "\nWHERE " . implode(' AND ', $where);
        if ($groupSql) $sql .= "\nGROUP BY " . implode(', ', $groupSql);
        if ($orderSql) $sql .= "\nORDER BY " . implode(', ', $orderSql);

        $limit = (int)($def['limit'] ?? 1000);
        if ($limit <= 0 || $limit > self::ROW_CAP) $limit = self::ROW_CAP;
        $sql .= "\nLIMIT " . $limit;

        return ['sql' => $sql, 'params' => $params, 'columns' => $columns];
    }

    /** Recursively compile a filter node (group or leaf) into a WHERE fragment. */
    private function compileNode(array $node, callable $resolve, array $runtime, array &$params): string
    {
        if (isset($node['op']) && isset($node['conditions'])) {
            $op = strtolower((string)$node['op']) === 'or' ? ' OR ' : ' AND ';
            $parts = [];
            foreach ($node['conditions'] as $c) {
                if (!is_array($c)) continue;
                $frag = $this->compileNode($c, $resolve, $runtime, $params);
                if ($frag !== '') $parts[] = $frag;
            }
            return $parts ? '(' . implode($op, $parts) . ')' : '';
        }

        // Leaf condition.
        $f = $resolve((string)($node['field'] ?? ''));
        if (self::isAggregateExpr($f->expr)) throw new ReportException("Cannot filter on the measure '{$f->label}'.");
        $operator = strtolower((string)($node['operator'] ?? 'eq'));
        if (!in_array($operator, self::OPS, true)) throw new ReportException("Unknown operator '$operator'.");

        // Resolve value: literal, or a runtime parameter reference. An unfilled
        // parameter drops the condition entirely (optional filter), rather than
        // matching against NULL.
        $isParam = array_key_exists('param', $node);
        $value = $isParam ? ($runtime[$node['param']] ?? null) : ($node['value'] ?? null);
        if ($isParam && !in_array($operator, ['is_null', 'not_null'], true)
            && ($value === null || $value === '' || (is_array($value) && !array_filter($value, fn($v) => $v !== '' && $v !== null)))) {
            return '';
        }
        $col = $f->expr;

        switch ($operator) {
            case 'is_null':  return "$col IS NULL";
            case 'not_null': return "$col IS NOT NULL";
            case 'contains':    $params[] = '%' . $value . '%'; return "$col LIKE ?";
            case 'starts_with': $params[] = $value . '%';       return "$col LIKE ?";
            case 'in':
                $vals = is_array($value) ? array_values($value) : [$value];
                if (!$vals) return '1 = 0';
                $ph = implode(',', array_fill(0, count($vals), '?'));
                foreach ($vals as $v) $params[] = $v;
                return "$col IN ($ph)";
            case 'between':
                $a = is_array($value) ? ($value[0] ?? null) : null;
                $b = is_array($value) ? ($value[1] ?? null) : null;
                $params[] = $a; $params[] = $b;
                return "$col BETWEEN ? AND ?";
            default:
                $map = ['eq' => '=', 'ne' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='];
                $params[] = $value;
                return "$col {$map[$operator]} ?";
        }
    }

    private static function isAggregateExpr(string $expr): bool
    {
        return (bool)preg_match('/^\s*(COUNT|SUM|AVG|MIN|MAX)\s*\(/i', $expr);
    }

    private static function alias(string $s): string
    {
        return preg_replace('/[^a-zA-Z0-9_]/', '_', $s) ?: 'f';
    }
}
