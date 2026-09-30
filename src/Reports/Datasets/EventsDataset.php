<?php
declare(strict_types=1);

namespace App\Reports\Datasets;

use App\Reports\Dataset;
use App\Reports\Field;

final class EventsDataset extends Dataset
{
    public function key(): string { return 'events'; }
    public function label(): string { return 'Events'; }
    public function baseFrom(): string { return 'events e'; }

    public function fields(): array
    {
        return [
            'event_id'     => new Field('event_id', 'Event #', 'e.id', 'int', 'internal'),
            'title'        => new Field('title', 'Title', 'e.name', 'string', 'public'),
            'event_type'   => new Field('event_type', 'Type', 'e.event_type', 'string', 'public'),
            'event_date'   => new Field('event_date', 'Date', 'e.event_date', 'date', 'public'),
            'end_date'     => new Field('end_date', 'End date', 'e.end_date', 'date', 'public'),
            'start_time'   => new Field('start_time', 'Start time', 'e.start_time', 'string', 'public'),
            'end_time'     => new Field('end_time', 'End time', 'e.end_time', 'string', 'public'),
            'location'     => new Field('location', 'Location', 'e.location', 'string', 'public'),
            'meeting_mode' => new Field('meeting_mode', 'Meeting mode', 'e.meeting_mode', 'string', 'public'),
            'details'      => new Field('details', 'Details', 'e.details', 'string', 'internal'),
            'is_informational' => new Field('is_informational', 'Info event', 'e.is_informational', 'bool', 'public'),
            'is_recurring' => new Field('is_recurring', 'Recurring', 'e.is_recurring', 'bool', 'public'),
            'recurrence'   => new Field('recurrence', 'Recurrence', 'e.recurrence_description', 'string', 'public'),
            'mentor_coverage_met' => new Field('mentor_coverage_met', 'Mentor coverage met', 'e.mentor_coverage_met', 'bool', 'internal'),
            'fundraising'  => new Field('fundraising', 'Fundraising opportunity', 'e.fundraising_opportunity', 'bool', 'internal'),
            'is_sponsorable' => new Field('is_sponsorable', 'Sponsorable', 'e.is_sponsorable', 'bool', 'internal'),
            'sponsorship_goal' => new Field('sponsorship_goal', 'Sponsorship goal', 'e.sponsorship_goal', 'decimal', 'financial', true),
            'created_at'   => new Field('created_at', 'Created', 'DATE(e.created_at)', 'date', 'internal'),
            'count'        => new Field('count', 'Count', 'COUNT(*)', 'int', 'public', true),
        ];
    }

    public function rowScopeWhere(string $scope, int $memberId): array
    {
        switch ($scope) {
            case 'all':
                return [null, []];
            case 'own_teams':
                return [
                    "e.id IN (
                        SELECT etl.event_id FROM event_team_links etl
                         WHERE etl.team_season_id IN (
                            SELECT tma.team_season_id FROM team_member_assignments tma WHERE tma.member_id = ?
                         )
                     )",
                    [$memberId],
                ];
            case 'self':
            case 'none':
            default:
                return ['1 = 0', []];
        }
    }

    public function teamFilter(int $teamSeasonId): array
    {
        return ['e.id IN (SELECT etl.event_id FROM event_team_links etl WHERE etl.team_season_id = ?)', [$teamSeasonId]];
    }
}
