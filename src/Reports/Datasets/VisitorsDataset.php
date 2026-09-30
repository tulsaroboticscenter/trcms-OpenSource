<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

/**
 * Visitors / inquiries — the front door of the recruiting funnel. Drives
 * open-house and follow-up reporting: filter on Inquiry date to pull everyone
 * who came in on a given night, with the contact details needed to follow up.
 *
 * Contact details (visitor and guardian), birthday, address and free-text notes
 * are 'pii', so they only render for viewers entitled to that tier (Mentor and
 * above by preset). Row scope mirrors the other recruiting datasets: staff-level
 * only — a viewer scoped to 'self' sees no rows.
 */
final class VisitorsDataset extends Dataset
{
    public function key(): string { return 'visitors'; }
    public function label(): string { return 'Visitors'; }
    public function baseFrom(): string { return 'visitors v'; }

    public function joins(): array
    {
        return [
            'programs' => 'LEFT JOIN programs p ON p.id = v.program_interest_id',
            'schools'  => 'LEFT JOIN schools s ON s.id = v.school_id',
            'owner'    => 'LEFT JOIN members om ON om.id = v.owner_id',
        ];
    }

    public function fields(): array
    {
        return [
            'name'            => new Field('name', 'Name', "TRIM(CONCAT(COALESCE(v.first_name,''),' ',COALESCE(v.last_name,'')))", 'string', 'pii'),
            'first_name'      => new Field('first_name', 'First name', 'v.first_name', 'string', 'pii'),
            'last_name'       => new Field('last_name', 'Last name', 'v.last_name', 'string', 'pii'),
            'visitor_number'  => new Field('visitor_number', 'Visitor #', 'v.visitor_number', 'string', 'internal'),
            'status'          => new Field('status', 'Status', 'v.status', 'string', 'public'),
            'inquiry_date'    => new Field('inquiry_date', 'Inquiry date', 'DATE(v.inquiry_date)', 'date', 'internal'),
            'added_on'        => new Field('added_on', 'Added', 'DATE(v.created_at)', 'date', 'internal'),
            'program_interest' => new Field('program_interest', 'Program interest', 'p.name', 'string', 'public', false, ['programs']),
            'school'          => new Field('school', 'School', 's.name', 'string', 'pii', false, ['schools']),
            'referral_source' => new Field('referral_source', 'How they heard about us', 'v.referral_source', 'string', 'internal'),
            'referral_detail' => new Field('referral_detail', 'Referral detail', 'v.referral_detail', 'string', 'internal'),
            'parent_mentor_interest' => new Field('parent_mentor_interest', 'Parent mentor interest', 'v.parent_mentor_interest', 'bool', 'internal'),
            'birthday'        => new Field('birthday', 'Birthday', 'v.birthday', 'date', 'pii'),
            'age'             => new Field('age', 'Age', 'TIMESTAMPDIFF(YEAR, v.birthday, CURDATE())', 'int', 'pii'),
            'email'           => new Field('email', 'Email', 'v.email', 'string', 'pii'),
            'phone'           => new Field('phone', 'Phone', 'v.phone', 'string', 'pii'),
            'guardian_name'   => new Field('guardian_name', 'Guardian', 'v.guardian1_name', 'string', 'pii'),
            'guardian_email'  => new Field('guardian_email', 'Guardian email', 'v.guardian1_email', 'string', 'pii'),
            'guardian_phone'  => new Field('guardian_phone', 'Guardian phone', 'v.guardian1_phone', 'string', 'pii'),
            'address'         => new Field('address', 'Address', "TRIM(CONCAT(COALESCE(v.address_line1,''),' ',COALESCE(v.address_line2,'')))", 'string', 'pii'),
            'city'            => new Field('city', 'City', 'v.city', 'string', 'pii'),
            'state'           => new Field('state', 'State', 'v.state', 'string', 'pii'),
            'zip_code'        => new Field('zip_code', 'ZIP', 'v.zip_code', 'string', 'pii'),
            'notes'           => new Field('notes', 'Additional info', 'v.additional_info', 'string', 'pii'),
            'next_follow_up'  => new Field('next_follow_up', 'Next follow-up', 'v.next_follow_up_date', 'date', 'internal'),
            'converted'       => new Field('converted', 'Converted to member', '(v.converted_member_id IS NOT NULL)', 'bool', 'internal'),
            'owner'           => new Field('owner', 'Owner', "TRIM(CONCAT(COALESCE(om.first_name,''),' ',COALESCE(om.last_name,'')))", 'string', 'internal', false, ['owner']),
            'count'           => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        return in_array($scope, ['all', 'own_teams'], true) ? [null, []] : ['1 = 0', []];
    }
}
