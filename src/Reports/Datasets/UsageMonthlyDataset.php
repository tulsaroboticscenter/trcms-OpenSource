<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

/**
 * Long-term usage trending, from the usage_monthly rollup. Sensitive (it
 * profiles individual adoption), so row scope is admin-or-self: 'all' sees
 * everyone, otherwise a member sees only their own rows; team scopes see none.
 */
final class UsageMonthlyDataset extends Dataset
{
    public function key(): string { return 'usage_monthly'; }
    public function label(): string { return 'Usage (monthly)'; }
    public function baseFrom(): string { return 'usage_monthly um'; }

    public function joins(): array
    {
        return ['members' => 'LEFT JOIN members m ON m.id = um.member_id'];
    }

    public function fields(): array
    {
        return [
            'member'         => new Field('member', 'Member', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'member_type'    => new Field('member_type', 'Member type', 'm.member_type', 'string', 'public', false, ['members']),
            'month'          => new Field('month', 'Month', 'um.period_month', 'string', 'public'),
            'pageviews'      => new Field('pageviews', 'Page views', 'um.pageviews', 'int', 'internal', true),
            'sessions'       => new Field('sessions', 'Sessions', 'um.sessions', 'int', 'internal', true),
            'active_minutes' => new Field('active_minutes', 'Active minutes', 'um.active_minutes', 'int', 'internal', true),
            'active_days'    => new Field('active_days', 'Active days', 'um.active_days', 'int', 'internal', true),
            'last_seen'      => new Field('last_seen', 'Last seen', 'um.last_seen', 'datetime', 'internal'),
            'count'          => new Field('count', 'Rows', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['um.member_id = ?', [$memberId]];
            default: return ['1 = 0', []];   // team scopes see nothing (sensitive)
        }
    }
}
