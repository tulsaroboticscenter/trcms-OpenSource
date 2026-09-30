<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class EnrollmentsDataset extends Dataset
{
    public function key(): string { return 'enrollments'; }
    public function label(): string { return 'Enrollments & Payments'; }
    public function baseFrom(): string { return 'enrollments e'; }

    public function joins(): array
    {
        return [
            'members'  => 'JOIN members m ON m.id = e.member_id',
            'programs' => 'LEFT JOIN programs p ON p.id = e.program_id',
        ];
    }

    public function fields(): array
    {
        return [
            'member_name'     => new Field('member_name', 'Member', "TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,'')))", 'string', 'pii', false, ['members']),
            'member_type'     => new Field('member_type', 'Member type', 'm.member_type', 'string', 'public', false, ['members']),
            'program'         => new Field('program', 'Program', 'p.name', 'string', 'public', false, ['programs']),
            'enrollment_year' => new Field('enrollment_year', 'Year', 'e.enrollment_year', 'int', 'public'),
            'status'          => new Field('status', 'Status', 'e.status', 'string', 'internal'),
            'date_enrolled'   => new Field('date_enrolled', 'Enrolled', 'e.date_enrolled', 'date', 'internal'),
            'date_payment'    => new Field('date_payment', 'Payment date', 'e.date_payment', 'date', 'internal'),
            'payment_amount'  => new Field('payment_amount', 'Paid', 'e.payment_amount', 'decimal', 'financial', true),
            'amount_due'      => new Field('amount_due', 'Amount due', 'e.amount_due', 'decimal', 'financial', true),
            'balance'         => new Field('balance', 'Balance', 'COALESCE(e.amount_due,0) - COALESCE(e.payment_amount,0)', 'decimal', 'financial', true),
            'payment_method'  => new Field('payment_method', 'Payment method', 'e.payment_method', 'string', 'internal'),
            'scholarship_fund' => new Field('scholarship_fund', 'Scholarship fund', 'e.scholarship_fund', 'string', 'internal'),
            'shirt_size'      => new Field('shirt_size', 'Shirt size', 'm.shirt_size', 'string', 'internal', false, ['members']),
            'youth_tc'        => new Field('youth_tc', 'Youth T&C', 'e.tc_youth_agreed', 'bool', 'internal'),
            'parent_tc'       => new Field('parent_tc', 'Parent T&C', 'e.tc_parent_agreed', 'bool', 'internal'),
            'count'           => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all': return [null, []];
            case 'self': return ['e.member_id = ?', [$memberId]];
            case 'own_teams':
                return [
                    "e.member_id IN (SELECT tma2.member_id FROM team_member_assignments tma2
                       WHERE tma2.team_season_id IN (SELECT tma1.team_season_id FROM team_member_assignments tma1 WHERE tma1.member_id = ?))",
                    [$memberId],
                ];
            default: return ['1 = 0', []];
        }
    }
}
