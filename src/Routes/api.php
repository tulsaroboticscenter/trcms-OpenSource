<?php
declare(strict_types=1);

/**
 * API route registration — mirrors the FastAPI module routers under /api/v1.
 * Add a line per module as it's ported.
 */

use App\Controllers\AuthController;
use App\Controllers\PaymentsController;
use App\Controllers\ConfigController;
use App\Controllers\EmailSettingsController;
use App\Controllers\PaymentSettingsController;
use App\Controllers\HelpController;
use App\Controllers\TourController;
use App\Controllers\CollegeScholarshipsController;
use App\Controllers\HolidaysController;
use App\Controllers\MembersController;
use App\Controllers\MergeController;
use App\Controllers\TeamsController;
use App\Controllers\VisitorsController;
use App\Controllers\SeasonsController;
use App\Controllers\FamiliesController;
use App\Controllers\ProgramsController;
use App\Controllers\ReportsController;
use App\Controllers\NightPrefsController;
use App\Controllers\CheckinController;
use App\Controllers\FllAttendanceController;
use App\Controllers\IncidentsController;
use App\Controllers\IncidentSettingsController;
use App\Controllers\FundraisingController;
use App\Controllers\GrantsController;
use App\Controllers\SponsorsController;
use App\Controllers\EventSponsorshipController;
use App\Controllers\ScholarshipsController;
use App\Controllers\ScholarshipApplicationsController;
use App\Controllers\InvoicesController;
use App\Controllers\MinutesController;
use App\Controllers\GroupsController;
use App\Controllers\WaitlistController;
use App\Controllers\SchoolsController;
use App\Controllers\MentorProspectsController;
use App\Controllers\RecruitmentImportController;
use App\Controllers\ReservationsController;
use App\Controllers\HallOfFameController;
use App\Controllers\FeedbackController;
use App\Controllers\RepairsController;
use App\Controllers\FinanceController;
use App\Controllers\AnnouncementsController;
use App\Controllers\SeasonTransitionController;
use App\Controllers\EnrollmentController;
use App\Controllers\RolesController;
use App\Controllers\EventsController;
use App\Controllers\EventSignupsController;
use App\Controllers\EventBringController;
use App\Controllers\EventTransportController;
use App\Controllers\CalendarController;
use App\Controllers\ParticipantsController;
use App\Controllers\CommunicationsController;
use App\Controllers\TrackingController;
use App\Controllers\ActionItemsController;
use App\Controllers\UploadsController;
use App\Controllers\ActivityController;
use App\Controllers\ResourcesController;
use App\Controllers\ShoppingController;
use App\Controllers\CertificationsController;
use App\Controllers\PlanningController;
use App\Controllers\TeamIssuesController;
use App\Controllers\TeamRolesController;
use App\Controllers\WishListController;
use App\Controllers\InventoryController;
use App\Controllers\InventoryCheckoutController;
use App\Controllers\InventoryReportsController;
use App\Controllers\PurchasingController;
use App\Controllers\POController;
use App\Controllers\AdminController;
use App\Controllers\SocialController;
use App\Controllers\ScoutingController;
use App\Controllers\CampController;
use App\Controllers\SystemBackupController;
use App\Controllers\SeasonPlanningController;
use App\Controllers\MedicalController;
use App\Controllers\OnboardingController;
use App\Controllers\VisitorSignupController;
use App\Controllers\VolunteerSignupController;
use App\Controllers\VolunteeringController;
use App\Controllers\FeatureNamesController;
use App\Controllers\SeasonGoalsController;
use App\Controllers\PortfolioController;
use App\Controllers\ReadinessController;
use App\Controllers\ReflectionsController;
use App\Controllers\FdpController;
use App\Controllers\ResumeController;
use App\Controllers\SpotlightController;
use Slim\App;

return function (App $app): void {
    $apiGroup = $app->group('/api/v1', function ($g) {
        // ── Auth (app/core/auth.py) ──
        $g->post('/auth/token', [AuthController::class, 'token']);
        $g->post('/auth/change-password', [AuthController::class, 'changePassword']);
        $g->post('/auth/forgot-password', [AuthController::class, 'forgotPassword']);
        $g->post('/auth/reset-password', [AuthController::class, 'resetWithToken']);
        $g->post('/auth/forgot-username', [AuthController::class, 'forgotUsername']);
        $g->get('/auth/me/preferences', [AuthController::class, 'getPreferences']);
        $g->patch('/auth/me/preferences', [AuthController::class, 'updatePreferences']);
        $g->get('/auth/me', [AuthController::class, 'me']);
        $g->get('/auth/2fa/status', [AuthController::class, 'twoFactorStatus']);
        $g->post('/auth/2fa/setup', [AuthController::class, 'twoFactorSetup']);
        $g->post('/auth/2fa/enable', [AuthController::class, 'twoFactorEnable']);
        $g->post('/auth/2fa/disable', [AuthController::class, 'twoFactorDisable']);
        $g->post('/members/{member_id:[0-9]+}/2fa/reset', [AuthController::class, 'twoFactorReset']);

        // ── Members ──
        $g->get('/members/suggest-username', [MembersController::class, 'suggestUsername']);
        $g->get('/members/', [MembersController::class, 'list']);
        $g->get('/members/me/children', [MembersController::class, 'myChildren']);
        $g->post('/members/', [MembersController::class, 'create']);
        $g->post('/members/import', [MembersController::class, 'import']);
        $g->post('/members/{member_id:[0-9]+}/send-welcome-email', [MembersController::class, 'sendWelcomeEmail']);
        $g->get('/members/{member_id:[0-9]+}/programs-supported', [MembersController::class, 'getProgramsSupported']);
        $g->put('/members/{member_id:[0-9]+}/programs-supported', [MembersController::class, 'setProgramsSupported']);
        $g->patch('/members/{member_id:[0-9]+}/convert-type', [MembersController::class, 'convertType']);
        $g->patch('/members/{member_id:[0-9]+}/promote-to-mentor', [MembersController::class, 'promoteToMentor']);
        $g->patch('/members/{member_id:[0-9]+}/deactivate', [MembersController::class, 'deactivate']);
        $g->patch('/members/{member_id:[0-9]+}/active', [MembersController::class, 'setActive']);
        $g->patch('/members/{member_id:[0-9]+}/archive', [MembersController::class, 'archive']);
        $g->patch('/members/{member_id:[0-9]+}/unarchive', [MembersController::class, 'unarchive']);
        $g->patch('/members/{member_id:[0-9]+}/compliance-exemption', [MembersController::class, 'complianceExemption']);
        $g->patch('/members/{member_id:[0-9]+}', [MembersController::class, 'update']);
        $g->get('/members/{id:[0-9]+}', [MembersController::class, 'get']);

        // ── Config (admin/config_router) ──
        $g->get('/config/', [ConfigController::class, 'listAll']);
        $g->get('/config/{category}', [ConfigController::class, 'get']);
        $g->put('/config/{category}', [ConfigController::class, 'update']);
        // Sidebar organisation (admin-configurable).
        $g->get('/nav-layout', [\App\Controllers\NavLayoutController::class, 'get']);
        $g->put('/nav-layout', [\App\Controllers\NavLayoutController::class, 'save']);
        $g->post('/nav-layout/reset', [\App\Controllers\NavLayoutController::class, 'reset']);
        // First-run setup wizard (open-source Phase 1, web half).
        $g->get('/setup/status',   [\App\Controllers\SetupController::class, 'status']);
        $g->put('/setup/org',      [\App\Controllers\SetupController::class, 'saveOrg']);
        $g->get('/setup/cron',     [\App\Controllers\SetupController::class, 'cron']);
        $g->post('/setup/complete',[\App\Controllers\SetupController::class, 'complete']);

        // Organization branding (open-source Phase 4). No auth: used pre-login.
        $g->get('/public/branding', [\App\Controllers\SetupController::class, 'publicBranding']);

        // Org-wide module enable/disable (open-source Phase 2).
        $g->get('/public/modules', [\App\Controllers\ModulesController::class, 'publicState']); // no auth: lets the SPA gate public routes
        $g->get('/modules', [\App\Controllers\ModulesController::class, 'get']);
        $g->put('/modules', [\App\Controllers\ModulesController::class, 'save']);
        $g->post('/modules/reset', [\App\Controllers\ModulesController::class, 'reset']);
        $g->get('/admin/payment-settings', [PaymentSettingsController::class, 'get']);
        $g->put('/admin/payment-settings', [PaymentSettingsController::class, 'update']);

        // Help Center (3.3) — read for any member; authoring needs admin.config
        $g->get('/help/articles', [HelpController::class, 'list']);
        $g->get('/help/articles/{slug}', [HelpController::class, 'get']);
        $g->get('/admin/help/articles', [HelpController::class, 'adminList']);
        $g->get('/admin/help/articles/{id:[0-9]+}', [HelpController::class, 'adminGet']);
        $g->post('/admin/help/articles', [HelpController::class, 'create']);
        $g->put('/admin/help/articles/{id:[0-9]+}', [HelpController::class, 'update']);
        $g->delete('/admin/help/articles/{id:[0-9]+}', [HelpController::class, 'delete']);

        // Guided Tours (Release 3.3)
        $g->get('/tours', [TourController::class, 'list']);
        $g->get('/tours/{tour_key}', [TourController::class, 'get']);
        $g->get('/admin/tours', [TourController::class, 'adminList']);
        $g->post('/admin/tours', [TourController::class, 'create']);
        $g->put('/admin/tours/{tour_id:[0-9]+}', [TourController::class, 'update']);
        $g->delete('/admin/tours/{tour_id:[0-9]+}', [TourController::class, 'delete']);

        // College Scholarships
        $g->get('/college-scholarships', [CollegeScholarshipsController::class, 'board']);
        $g->get('/college-scholarships/alerts', [CollegeScholarshipsController::class, 'alerts']);
        $g->get('/college-scholarships/stats', [CollegeScholarshipsController::class, 'stats']);
        $g->get('/college-scholarships/seasons', [CollegeScholarshipsController::class, 'seasons']);
        $g->get('/college-scholarships/manage', [CollegeScholarshipsController::class, 'manageList']);
        $g->get('/college-scholarships/applications', [CollegeScholarshipsController::class, 'report']);
        $g->get('/college-scholarships/my-applications', [CollegeScholarshipsController::class, 'myApplications']);
        $g->get('/college-scholarships/members/{id:[0-9]+}/applications', [CollegeScholarshipsController::class, 'memberApplications']);
        $g->get('/college-scholarships/members/{id:[0-9]+}/tracker', [CollegeScholarshipsController::class, 'tracker']);
        $g->post('/college-scholarships/members/{id:[0-9]+}/follow/{sid:[0-9]+}', [CollegeScholarshipsController::class, 'memberFollow']);
        $g->delete('/college-scholarships/members/{id:[0-9]+}/follow/{sid:[0-9]+}', [CollegeScholarshipsController::class, 'memberUnfollow']);
        $g->post('/college-scholarships/members/{id:[0-9]+}/apply/{sid:[0-9]+}', [CollegeScholarshipsController::class, 'memberApply']);
        $g->delete('/college-scholarships/members/{id:[0-9]+}/apply/{sid:[0-9]+}', [CollegeScholarshipsController::class, 'memberWithdraw']);
        $g->post('/college-scholarships', [CollegeScholarshipsController::class, 'create']);
        $g->post('/college-scholarships/rollover', [CollegeScholarshipsController::class, 'rollover']);
        $g->put('/college-scholarships/applications/{app_id:[0-9]+}', [CollegeScholarshipsController::class, 'setOutcome']);
        $g->post('/college-scholarships/applications/{app_id:[0-9]+}/requirements', [CollegeScholarshipsController::class, 'addRequirement']);
        $g->put('/college-scholarships/requirements/{req_id:[0-9]+}', [CollegeScholarshipsController::class, 'updateRequirement']);
        $g->delete('/college-scholarships/requirements/{req_id:[0-9]+}', [CollegeScholarshipsController::class, 'deleteRequirement']);
        $g->put('/college-scholarships/{id:[0-9]+}', [CollegeScholarshipsController::class, 'update']);
        $g->delete('/college-scholarships/{id:[0-9]+}', [CollegeScholarshipsController::class, 'delete']);
        $g->post('/college-scholarships/{id:[0-9]+}/tag', [CollegeScholarshipsController::class, 'tagYouth']);
        $g->post('/college-scholarships/{id:[0-9]+}/follow', [CollegeScholarshipsController::class, 'follow']);
        $g->delete('/college-scholarships/{id:[0-9]+}/follow', [CollegeScholarshipsController::class, 'unfollow']);
        $g->post('/college-scholarships/{id:[0-9]+}/apply', [CollegeScholarshipsController::class, 'apply']);
        $g->delete('/college-scholarships/{id:[0-9]+}/apply', [CollegeScholarshipsController::class, 'withdraw']);
        $g->post('/college-scholarships/{id:[0-9]+}/dismiss', [CollegeScholarshipsController::class, 'dismiss']);
        $g->delete('/college-scholarships/{id:[0-9]+}/dismiss', [CollegeScholarshipsController::class, 'undismiss']);

        // Calendar holidays (#118) — federal auto + admin TRC closures
        $g->get('/holidays', [HolidaysController::class, 'inRange']);
        $g->get('/admin/holidays', [HolidaysController::class, 'adminList']);
        $g->post('/admin/holidays', [HolidaysController::class, 'create']);
        $g->put('/admin/holidays/{id:[0-9]+}', [HolidaysController::class, 'update']);
        $g->delete('/admin/holidays/{id:[0-9]+}', [HolidaysController::class, 'delete']);
        $g->get('/admin/email-settings', [EmailSettingsController::class, 'get']);
        $g->put('/admin/email-settings', [EmailSettingsController::class, 'update']);
        $g->post('/admin/email-settings/test', [EmailSettingsController::class, 'test']);
        $g->get('/admin/github-settings', [\App\Controllers\GitHubSettingsController::class, 'get']);
        $g->put('/admin/github-settings', [\App\Controllers\GitHubSettingsController::class, 'update']);
        $g->post('/admin/github-settings/test', [\App\Controllers\GitHubSettingsController::class, 'test']);

        // ── Teams (read endpoints) ──
        $g->get('/teams/', [TeamsController::class, 'list']);
        $g->post('/teams/', [TeamsController::class, 'create']);
        $g->get('/teams/current-season', [TeamsController::class, 'currentSeason2']);
        $g->get('/teams/member/{member_id:[0-9]+}', [TeamsController::class, 'memberTeams']);
        $g->post('/teams/seasons', [TeamsController::class, 'createSeason']);
        $g->post('/teams/seasons/create-all', [TeamsController::class, 'createSeasonsForAll']);
        $g->post('/teams/seasons/roll-rosters', [TeamsController::class, 'rollRostersForward']);
        $g->post('/teams/seasons/first-reg-reset', [TeamsController::class, 'resetSeasonFirstReg']);
        $g->get('/teams/seasons/{season_id:[0-9]+}/members', [TeamsController::class, 'seasonMembers']);
        $g->get('/teams/seasons/{season_id:[0-9]+}/leadership', [TeamsController::class, 'seasonLeadership']);
        $g->post('/teams/seasons/{season_id:[0-9]+}/leadership', [TeamsController::class, 'assignLeadership']);
        $g->delete('/teams/seasons/{season_id:[0-9]+}/leadership/{member_id:[0-9]+}', [TeamsController::class, 'removeLeadership']);
        $g->patch('/teams/seasons/{season_id:[0-9]+}', [TeamsController::class, 'updateSeason']);
        $g->patch('/teams/seasons/{season_id:[0-9]+}/theme', [TeamsController::class, 'updateTheme']);
        $g->patch('/teams/seasons/{season_id:[0-9]+}/photo', [TeamsController::class, 'updateTeamPhoto']);
        $g->get('/teams/seasons/{season_id:[0-9]+}', [TeamsController::class, 'season']);
        $g->post('/teams/members', [TeamsController::class, 'addMember']);
        $g->get('/teams/members/{assignment_id:[0-9]+}', [TeamsController::class, 'getMember']);
        $g->patch('/teams/members/{assignment_id:[0-9]+}', [TeamsController::class, 'updateMember']);
        $g->delete('/teams/members/{assignment_id:[0-9]+}', [TeamsController::class, 'removeMember']);
        $g->delete('/teams/members/{assignment_id:[0-9]+}/purge', [TeamsController::class, 'purgeMember']);
        $g->get('/teams/{team_id:[0-9]+}/seasons', [TeamsController::class, 'teamSeasons']);
        $g->get('/teams/{team_id:[0-9]+}', [TeamsController::class, 'get']);

        // ── Visitors ──
        $g->get('/visitors/statuses', [VisitorsController::class, 'statuses']);
        $g->get('/visitors/stats', [VisitorsController::class, 'stats']);
        $g->get('/visitors/followups', [VisitorsController::class, 'followups']);
        $g->post('/visitors/followups/send-reminders', [VisitorsController::class, 'sendFollowupRemindersNow']);
        $g->get('/visitors/analytics', [VisitorsController::class, 'analytics']);
        $g->get('/visitors/campers/search', [VisitorsController::class, 'searchCampers']);
        $g->get('/visitors/duplicate-members', [VisitorsController::class, 'duplicateMembers']);
        $g->get('/visitors/duplicate-visitors', [VisitorsController::class, 'duplicateVisitors']);
        $g->post('/visitors/{visitor_id:[0-9]+}/merge-visitor', [VisitorsController::class, 'mergeVisitor']);
        $g->post('/visitors/{visitor_id:[0-9]+}/interactions', [VisitorsController::class, 'addInteraction']);
        $g->post('/visitors/{visitor_id:[0-9]+}/email', [VisitorsController::class, 'sendEmail']);
        $g->post('/visitors/{visitor_id:[0-9]+}/followup-done', [VisitorsController::class, 'completeFollowup']);
        $g->post('/visitors/{visitor_id:[0-9]+}/archive', [VisitorsController::class, 'archive']);
        $g->post('/visitors/{visitor_id:[0-9]+}/unarchive', [VisitorsController::class, 'unarchive']);
        $g->post('/visitors/{visitor_id:[0-9]+}/visited', [VisitorsController::class, 'markVisitedToday']);
        $g->delete('/visitors/interactions/{interaction_id:[0-9]+}', [VisitorsController::class, 'deleteInteraction']);
        $g->get('/visitors/', [VisitorsController::class, 'list']);
        $g->post('/visitors/', [VisitorsController::class, 'create']);   // public kiosk
        $g->get('/visitors/{visitor_id:[0-9]+}/prefill', [VisitorsController::class, 'prefill']);
        $g->get('/visitors/{visitor_id:[0-9]+}', [VisitorsController::class, 'get']);
        $g->patch('/visitors/{visitor_id:[0-9]+}', [VisitorsController::class, 'update']);
        $g->delete('/visitors/{visitor_id:[0-9]+}', [VisitorsController::class, 'delete']);   // System Administrator only
        $g->post('/visitors/{visitor_id:[0-9]+}/convert', [VisitorsController::class, 'convert']);

        // ── Seasons (FIRST seasons + participation) ──
        $g->get('/seasons/', [SeasonsController::class, 'list']);
        $g->post('/seasons/', [SeasonsController::class, 'create']);
        $g->get('/seasons/member/{member_id:[0-9]+}', [SeasonsController::class, 'memberParticipation']);
        $g->put('/seasons/member/{member_id:[0-9]+}/season/{season_id:[0-9]+}', [SeasonsController::class, 'upsertParticipation']);
        $g->patch('/seasons/{season_id:[0-9]+}', [SeasonsController::class, 'update']);
        $g->delete('/seasons/{season_id:[0-9]+}', [SeasonsController::class, 'delete']);

        // ── Families ──
        $g->get('/families/member/{member_id:[0-9]+}', [FamiliesController::class, 'getMemberFamily']);
        $g->get('/families/', [FamiliesController::class, 'list']);
        $g->post('/families/', [FamiliesController::class, 'create']);
        $g->patch('/families/{family_id:[0-9]+}/members/{member_id:[0-9]+}', [FamiliesController::class, 'updateMember']);
        $g->delete('/families/{family_id:[0-9]+}/members/{member_id:[0-9]+}', [FamiliesController::class, 'removeMember']);
        $g->post('/families/{family_id:[0-9]+}/members', [FamiliesController::class, 'addMember']);
        $g->patch('/families/{family_id:[0-9]+}', [FamiliesController::class, 'update']);
        $g->delete('/families/{family_id:[0-9]+}', [FamiliesController::class, 'delete']);

        // ── Programs ──
        $g->get('/programs/', [ProgramsController::class, 'list']);
        $g->post('/programs/', [ProgramsController::class, 'create']);
        $g->patch('/programs/{program_id:[0-9]+}', [ProgramsController::class, 'update']);

        // ── Reports (JSON) ──
        $g->get('/reports/member-directory', [ReportsController::class, 'memberDirectory']);
        $g->get('/reports/active-members', [ReportsController::class, 'activeMembers']);
        $g->get('/reports/certifications-by-member', [ReportsController::class, 'certificationsByMember']);
        $g->get('/reports/certifications-by-member/csv', [ReportsController::class, 'certificationsByMemberCsv']);
        $g->get('/reports/youth-by-grade', [ReportsController::class, 'youthByGrade']);
        $g->get('/reports/youth-by-grade/csv', [ReportsController::class, 'youthByGradeCsv']);
        $g->get('/reports/certification-options', [ReportsController::class, 'certificationOptions']);
        $g->get('/reports/certification-holders', [ReportsController::class, 'certificationHolders']);
        $g->get('/reports/team-list', [ReportsController::class, 'teamList']);
        $g->get('/reports/enrollment-status', [ReportsController::class, 'enrollmentStatus']);
        $g->get('/reports/youth-special-notes', [ReportsController::class, 'youthSpecialNotes']);
        $g->get('/reports/employer-matching', [ReportsController::class, 'employerMatching']);
        $g->get('/reports/attendance-summary', [ReportsController::class, 'attendanceSummary']);
        $g->get('/reports/not-checked-in', [ReportsController::class, 'notCheckedIn']);
        $g->get('/reports/activity-impact', [ReportsController::class, 'activityImpact']);
        // CSV exports for the report tables above (the "Export CSV" buttons).
        $g->get('/reports/team-list/csv', [ReportsController::class, 'teamListCsv']);
        $g->get('/reports/member-directory/csv', [ReportsController::class, 'memberDirectoryCsv']);
        $g->get('/reports/enrollment-status/csv', [ReportsController::class, 'enrollmentStatusCsv']);
        $g->get('/reports/activity-impact/csv', [ReportsController::class, 'activityImpactCsv']);
        $g->get('/reports/permissions', [ReportsController::class, 'permissionsReport']);
        $g->get('/reports/classroom-email-readiness', [ReportsController::class, 'classroomEmailReadiness']);

        // ── Checkin ──
        $g->post('/checkin/', [CheckinController::class, 'toggle']);   // kiosk toggle (auth required: station account or member, F6)
        $g->get('/checkin/today-events', [CheckinController::class, 'todayEvents']);
        $g->get('/checkin/my-status', [CheckinController::class, 'myCheckinStatus']);
        $g->get('/checkin/active', [CheckinController::class, 'activeCheckins']);
        $g->get('/checkin/member/{member_id:[0-9]+}', [CheckinController::class, 'memberCheckins']);
        $g->get('/checkin/event/{event_id:[0-9]+}/roster', [CheckinController::class, 'roster']);
        $g->get('/checkin/event/{event_id:[0-9]+}', [CheckinController::class, 'eventCheckins']);
        $g->post('/checkin/event/{event_id:[0-9]+}/checkout-all', [CheckinController::class, 'eventCheckoutAll']);
        $g->post('/checkin/event/{event_id:[0-9]+}/checkout/{member_id:[0-9]+}', [CheckinController::class, 'eventCheckout']);
        $g->delete('/checkin/event/{event_id:[0-9]+}/attendee/{member_id:[0-9]+}', [CheckinController::class, 'removeAttendee']);
        $g->patch('/checkin/{checkin_id:[0-9]+}', [CheckinController::class, 'adjustTimes']);
        $g->delete('/checkin/{checkin_id:[0-9]+}', [CheckinController::class, 'deleteCheckin']);
        $g->post('/checkin/member/{member_id:[0-9]+}', [CheckinController::class, 'createManualCheckin']);

        // ── FLL attendance quick-tracking kiosk ──
        $g->get ('/fll-attendance/today',  [FllAttendanceController::class, 'today']);
        $g->get ('/fll-attendance/roster', [FllAttendanceController::class, 'roster']);
        $g->post('/fll-attendance/mark',   [FllAttendanceController::class, 'mark']);
        $g->post('/fll-attendance/close',  [FllAttendanceController::class, 'close']);

        // ── Incident Reports ── (all gated inside the controller on incidents.* keys)
        $g->post  ('/incidents', [IncidentsController::class, 'submit']);
        $g->get   ('/incidents', [IncidentsController::class, 'list']);
        $g->get   ('/incidents/mine', [IncidentsController::class, 'mine']);
        $g->get   ('/incidents/stats', [IncidentsController::class, 'stats']);
        $g->get   ('/incidents/{id:[0-9]+}', [IncidentsController::class, 'get']);
        $g->post  ('/incidents/{id:[0-9]+}/notes', [IncidentsController::class, 'addNote']);
        $g->post  ('/incidents/{id:[0-9]+}/triage', [IncidentsController::class, 'triage']);
        $g->post  ('/incidents/{id:[0-9]+}/assign', [IncidentsController::class, 'assign']);
        $g->post  ('/incidents/{id:[0-9]+}/notify-parent', [IncidentsController::class, 'notifyParent']);
        $g->post  ('/incidents/{id:[0-9]+}/share-parent', [IncidentsController::class, 'shareParent']);
        $g->post  ('/incidents/{id:[0-9]+}/tasks', [IncidentsController::class, 'linkTask']);
        $g->delete('/incidents/{id:[0-9]+}/tasks/{task_id:[0-9]+}', [IncidentsController::class, 'unlinkTask']);
        $g->post  ('/incidents/{id:[0-9]+}/close', [IncidentsController::class, 'close']);
        $g->post  ('/incidents/{id:[0-9]+}/attachments', [IncidentsController::class, 'upload']);
        $g->get   ('/incidents/{id:[0-9]+}/attachments/{attachment_id:[0-9]+}', [IncidentsController::class, 'serveAttachment']);
        $g->get   ('/first-aid', [IncidentsController::class, 'firstAidList']);
        $g->post  ('/first-aid', [IncidentsController::class, 'firstAidSave']);
        $g->post  ('/first-aid/{id:[0-9]+}/promote', [IncidentsController::class, 'firstAidPromote']);
        $g->get   ('/admin/incident-settings', [IncidentSettingsController::class, 'get']);
        $g->post  ('/admin/incident-settings', [IncidentSettingsController::class, 'save']);
        $g->post  ('/admin/incident-settings/test', [IncidentSettingsController::class, 'test']);

        // ── Enrollment ──
        $g->get('/enrollment/my-tc-gate', [EnrollmentController::class, 'myTcGate']);
        $g->get('/enrollment/my-alerts', [EnrollmentController::class, 'myEnrollmentAlerts']);
        $g->get('/enrollment/current-year', [EnrollmentController::class, 'currentYear']);
        $g->get('/enrollment/fees', [EnrollmentController::class, 'getFees']);
        $g->put('/enrollment/fees', [EnrollmentController::class, 'setFees']);
        $g->get('/enrollment/consent-sections', [EnrollmentController::class, 'getConsentSections']);
        $g->put('/enrollment/admin/consent-sections', [EnrollmentController::class, 'setConsentSections']);
        $g->get('/enrollment/member/{member_id:[0-9]+}/consents', [EnrollmentController::class, 'memberConsents']);
        $g->get('/handbook', [EnrollmentController::class, 'getHandbook']);
        $g->put('/admin/handbook', [EnrollmentController::class, 'setHandbook']);
        $g->post('/admin/handbook/upload', [EnrollmentController::class, 'uploadHandbook']);
        $g->get('/enrollment/preview-fee', [EnrollmentController::class, 'previewFee']);
        $g->get('/admin/backups', [SystemBackupController::class, 'list']);
        $g->post('/admin/backups/run', [SystemBackupController::class, 'runNow']);

        // ── FLL Season Planning ──
        // Public (no login) — the emailed visitor join link. The token is the
        // authorization: single-use, expiring, scoped to one visitor.
        $g->get('/public/visitor-signup/{token}', [VisitorSignupController::class, 'resolve']);
        $g->post('/public/visitor-signup/{token}', [VisitorSignupController::class, 'submit']);
        // Public raffle signup (no auth; the slug is the identifier)
        $g->get('/public/raffle/{slug}', [\App\Controllers\RafflesController::class, 'publicGet']);
        $g->post('/public/raffle/{slug}/purchase', [\App\Controllers\RafflesController::class, 'publicPurchase']);

        // No-login employer / matching-gift form (personalized token link emailed to parents & mentors).
        $g->get('/public/employer/{token}', [\App\Controllers\EmployerFormController::class, 'get']);
        $g->post('/public/employer/{token}', [\App\Controllers\EmployerFormController::class, 'save']);

        // Serve an uploaded image through PHP (works even where the host blocks static
        // /uploads/). No auth: <img> tags can't send a token; filenames are random hex.
        $g->get('/public/upload/{name}', [\App\Controllers\UploadsController::class, 'serve']);
        // Admin raffle management (staff-gated in the controller)
        $g->get('/raffles', [\App\Controllers\RafflesController::class, 'list']);
        $g->post('/raffles', [\App\Controllers\RafflesController::class, 'create']);
        $g->get('/raffles/{raffle_id:[0-9]+}', [\App\Controllers\RafflesController::class, 'get']);
        $g->patch('/raffles/{raffle_id:[0-9]+}', [\App\Controllers\RafflesController::class, 'update']);
        $g->delete('/raffles/{raffle_id:[0-9]+}', [\App\Controllers\RafflesController::class, 'delete']);
        $g->get('/raffles/{raffle_id:[0-9]+}/orders', [\App\Controllers\RafflesController::class, 'orders']);
        $g->get('/raffles/{raffle_id:[0-9]+}/tickets', [\App\Controllers\RafflesController::class, 'tickets']);
        $g->post('/raffles/{raffle_id:[0-9]+}/booth-sale', [\App\Controllers\RafflesController::class, 'boothSale']);
        $g->post('/raffles/{raffle_id:[0-9]+}/draw', [\App\Controllers\RafflesController::class, 'drawWinner']);
        $g->post('/visitors/{visitor_id:[0-9]+}/signup-link', [VisitorSignupController::class, 'mintLink']);

        // Public (no login) — the open volunteer sign-up form embedded on the marketing
        // site via an iframe. Two tracks: /public/mailing-list just captures a contact,
        // /public/volunteer-signup creates a Volunteer member account.
        $g->get('/public/volunteer-signup', [VolunteerSignupController::class, 'intro']);
        $g->post('/public/volunteer-signup', [VolunteerSignupController::class, 'submit']);
        $g->post('/public/mailing-list', [VolunteerSignupController::class, 'subscribe']);
        // Public (no login) — camps & programs mailing list (QR code / website link).
        $g->post('/public/program-interest', [VolunteerSignupController::class, 'programInterest']);
        // Staff (Mentor+) — manage the mailing list.
        $g->get('/mailing-list/subscribers', [VolunteerSignupController::class, 'listSubscribers']);
        $g->patch('/mailing-list/subscribers/{id:[0-9]+}', [VolunteerSignupController::class, 'setSubscribed']);

        // Public (no login) — the emailed family availability form.
        $g->get('/public/season-availability/{token}', [SeasonPlanningController::class, 'resolveInvite']);
        $g->post('/public/season-availability/{token}', [SeasonPlanningController::class, 'submitInvite']);
        // Logged-in family + admin.
        $g->get('/season-planning/my-form', [SeasonPlanningController::class, 'myForm']);
        $g->post('/season-planning/my-form', [SeasonPlanningController::class, 'saveMyForm']);
        $g->get('/season-planning/dashboard', [SeasonPlanningController::class, 'dashboard']);
        $g->get('/season-planning/preferences', [SeasonPlanningController::class, 'preferences']);
        $g->post('/season-planning/admin-save', [SeasonPlanningController::class, 'adminSave']);
        $g->post('/season-planning/invites', [SeasonPlanningController::class, 'sendInvites']);
        $g->post('/season-planning/exclude-family', [SeasonPlanningController::class, 'excludeFamily']);
        $g->post('/season-planning/restore-family', [SeasonPlanningController::class, 'restoreFamily']);
        // Planning board (Phase 2)
        $g->get('/season-planning/board', [SeasonPlanningController::class, 'board']);
        $g->post('/season-planning/board/seed', [SeasonPlanningController::class, 'seedBoard']);
        $g->post('/season-planning/board/team', [SeasonPlanningController::class, 'addTeam']);
        $g->get('/season-planning/board/available-teams', [SeasonPlanningController::class, 'availableTeams']);
        $g->patch('/season-planning/board/team/{team_id:[0-9]+}', [SeasonPlanningController::class, 'updateTeam']);
        $g->delete('/season-planning/board/team/{team_id:[0-9]+}', [SeasonPlanningController::class, 'deleteTeam']);
        $g->post('/season-planning/board/place', [SeasonPlanningController::class, 'place']);
        $g->post('/season-planning/board/unplace', [SeasonPlanningController::class, 'unplace']);
        $g->post('/season-planning/board/suggest', [SeasonPlanningController::class, 'suggest']);
        $g->post('/season-planning/board/publish', [SeasonPlanningController::class, 'publish']);
        $g->post('/season-planning/board/assign-night', [SeasonPlanningController::class, 'assignNight']);
        $g->post('/season-planning/board/availability', [SeasonPlanningController::class, 'setAvailability']);
        $g->post('/season-planning/board/hide-mentor', [SeasonPlanningController::class, 'hideMentor']);
        $g->post('/season-planning/board/unhide-mentor', [SeasonPlanningController::class, 'unhideMentor']);
        $g->get('/season-planning/eligibility', [SeasonPlanningController::class, 'eligibilitySettings']);
        $g->post('/season-planning/eligibility', [SeasonPlanningController::class, 'saveEligibilitySettings']);
        $g->get('/enrollment/admin/season-summary', [EnrollmentController::class, 'seasonSummary']);
        $g->post('/enrollment/admin/close-season', [EnrollmentController::class, 'closeSeason']);
        $g->post('/enrollment/admin/reset-shirt-sizes', [EnrollmentController::class, 'resetShirtSizes']);
        $g->get('/enrollment/{enrollment_id:[0-9]+}/payment-plan', [\App\Controllers\PaymentPlanController::class, 'get']);
        $g->get('/enrollment/{enrollment_id:[0-9]+}/receipt-recipient', [EnrollmentController::class, 'receiptRecipient']);
        $g->post('/enrollment/{enrollment_id:[0-9]+}/payment-plan', [\App\Controllers\PaymentPlanController::class, 'create']);
        $g->patch('/enrollment/{enrollment_id:[0-9]+}/payment-plan', [\App\Controllers\PaymentPlanController::class, 'updatePlan']);
        $g->delete('/enrollment/{enrollment_id:[0-9]+}/payment-plan', [\App\Controllers\PaymentPlanController::class, 'delete']);
        $g->post('/enrollment/{enrollment_id:[0-9]+}/payment-plan/send-confirmation', [\App\Controllers\PaymentPlanController::class, 'sendConfirmation']);
        $g->patch('/enrollment/installments/{installment_id:[0-9]+}/reminder', [\App\Controllers\PaymentPlanController::class, 'toggleInstallmentReminder']);
        $g->post('/enrollment/installments/{installment_id:[0-9]+}/pay', [\App\Controllers\PaymentPlanController::class, 'recordPayment']);
        $g->delete('/enrollment/installments/{installment_id:[0-9]+}/pay', [\App\Controllers\PaymentPlanController::class, 'unrecordPayment']);
        $g->post('/enrollment/installments/{installment_id:[0-9]+}/pay-online', [PaymentsController::class, 'payInstallment']);
        $g->post('/enrollment/payment-plans/send-reminders', [\App\Controllers\PaymentPlanController::class, 'sendRemindersNow']);
        $g->get('/members/me/payment-plans', [\App\Controllers\PaymentPlanController::class, 'myPlans']);
        $g->post('/enrollment/rollover/preview', [EnrollmentController::class, 'rolloverPreview']);
        $g->post('/enrollment/rollover/commit', [EnrollmentController::class, 'rolloverCommit']);
        // ── Online payments (Square / PayPal) ──
        $g->get('/payments/options', [PaymentsController::class, 'options']);
        $g->get('/payments/manual-methods', [PaymentsController::class, 'manualMethods']);
        $g->post('/payments/donate', [PaymentsController::class, 'donate']);
        $g->get('/enrollments/{enrollment_id:[0-9]+}/pay-quote', [PaymentsController::class, 'enrollmentQuote']);
        $g->post('/enrollments/{enrollment_id:[0-9]+}/pay', [PaymentsController::class, 'payEnrollment']);
        $g->get('/spotlight/events', [SpotlightController::class, 'events']);
        $g->get('/spotlight/me', [SpotlightController::class, 'me']);
        $g->get('/spotlight/event/{event_id:[0-9]+}', [SpotlightController::class, 'get']);
        $g->post('/spotlight/event/{event_id:[0-9]+}/activate', [SpotlightController::class, 'activate']);
        $g->post('/spotlight/event/{event_id:[0-9]+}/pick', [SpotlightController::class, 'pick']);
        $g->get('/members/{member_id:[0-9]+}/reflections', [ReflectionsController::class, 'get']);
        $g->put('/members/{member_id:[0-9]+}/reflections', [ReflectionsController::class, 'save']);
        $g->get('/medical/{member_id:[0-9]+}', [MedicalController::class, 'get']);
        $g->post('/medical/{member_id:[0-9]+}', [MedicalController::class, 'save']);
        $g->get('/members/{member_id:[0-9]+}/pay-quote', [PaymentsController::class, 'memberPayQuote']);        // combined per-youth
        $g->post('/members/{member_id:[0-9]+}/pay-enrollments', [PaymentsController::class, 'payMemberEnrollments']);
        $g->get('/members/me/family-pay-quote', [PaymentsController::class, 'familyPayQuote']);
        $g->post('/members/me/pay-family', [PaymentsController::class, 'payFamily']);
        $g->post('/members/{member_id:[0-9]+}/shirt-size', [PaymentsController::class, 'saveMemberShirt']);
        $g->get('/payments/return/{payment_id:[0-9]+}', [PaymentsController::class, 'returnFromProvider']); // browser redirect, no auth
        $g->get('/payments/cancel/{payment_id:[0-9]+}', [PaymentsController::class, 'cancelFromProvider']); // browser redirect, no auth
        $g->post('/webhooks/{provider}', [PaymentsController::class, 'webhook']);                           // provider callback, signature-verified
        $g->get('/enrollment/admin/renewal-reminder', [EnrollmentController::class, 'renewalReminderGet']);
        $g->put('/enrollment/admin/renewal-reminder', [EnrollmentController::class, 'renewalReminderSet']);
        $g->get('/enrollment/mentor-tc/{member_id:[0-9]+}/history', [EnrollmentController::class, 'mentorTcHistory']);
        $g->get('/enrollment/mentor-tc/{member_id:[0-9]+}', [EnrollmentController::class, 'mentorTc']);
        $g->post('/enrollment/mentor-tc/{member_id:[0-9]+}/sign', [EnrollmentController::class, 'signMentorTc']);
        $g->get('/enrollment/member/{member_id:[0-9]+}/enrollment-status', [EnrollmentController::class, 'memberEnrollmentStatus']);
        $g->get('/enrollment/member/{member_id:[0-9]+}', [EnrollmentController::class, 'memberEnrollments']);
        $g->post('/enrollment/', [EnrollmentController::class, 'create']);
        $g->post('/enrollment/{enrollment_id:[0-9]+}/sign-tc', [EnrollmentController::class, 'signTc']);
        $g->post('/enrollment/{enrollment_id:[0-9]+}/details', [EnrollmentController::class, 'saveDetails']);
        $g->post('/members/{member_id:[0-9]+}/request-payment-plan', [EnrollmentController::class, 'requestPaymentPlan']);

        // FIRST Development Program
        $g->get('/fdp', [FdpController::class, 'list']);
        $g->get('/fdp/eligible', [FdpController::class, 'eligible']);
        $g->post('/fdp/board-review/schedule', [FdpController::class, 'scheduleBoardReview']);
        $g->get('/fdp/interviews', [FdpController::class, 'listInterviews']);
        $g->post('/fdp/interviews', [FdpController::class, 'requestInterview']);
        $g->patch('/fdp/interviews/{id:[0-9]+}', [FdpController::class, 'updateInterview']);
        $g->post('/fdp/interviews/{id:[0-9]+}/place', [FdpController::class, 'placeOnTeam']);
        $g->get('/fdp/review-rubric', [FdpController::class, 'reviewRubricEndpoint']);
        $g->get('/fdp/pipeline', [FdpController::class, 'pipeline']);
        $g->post('/fdp/send-reminders', [FdpController::class, 'sendRemindersNow']);
        $g->get('/fdp/team-cert-needs', [FdpController::class, 'teamCertNeeds']);
        $g->put('/fdp/team-cert-needs', [FdpController::class, 'setTeamCertNeeds']);
        $g->get('/fdp/member/{member_id:[0-9]+}', [FdpController::class, 'forMember']);
        $g->put('/fdp/member/{member_id:[0-9]+}/progress', [FdpController::class, 'setProgress']);
        $g->post('/fdp/assign', [FdpController::class, 'assign']);
        $g->post('/fdp/assign-eligible', [FdpController::class, 'assignEligible']);
        $g->post('/fdp/transfer-fee', [FdpController::class, 'transferFee']);
        $g->post('/fdp/{id:[0-9]+}/graduate', [FdpController::class, 'graduate']);
        $g->patch('/fdp/{id:[0-9]+}', [FdpController::class, 'update']);
        $g->delete('/fdp/{id:[0-9]+}', [FdpController::class, 'remove']);
        // Resume builder (youth self-service; parent + FDP manager can view).
        $g->get('/resume/me', [ResumeController::class, 'mine']);
        $g->put('/resume/me', [ResumeController::class, 'save']);
        $g->get('/resume/options', [ResumeController::class, 'options']);
        $g->get('/resume/member/{member_id:[0-9]+}', [ResumeController::class, 'forMember']);
        $g->post('/resume/member/{member_id:[0-9]+}/complete', [ResumeController::class, 'markComplete']);
        $g->put('/resume/member/{member_id:[0-9]+}/uploaded-url', [ResumeController::class, 'setMemberUpload']);
        $g->post('/enrollment/{member_id:[0-9]+}/reset-tc', [EnrollmentController::class, 'resetTc']);
        $g->patch('/enrollment/{enrollment_id:[0-9]+}', [EnrollmentController::class, 'update']);
        $g->delete('/enrollment/{enrollment_id:[0-9]+}', [EnrollmentController::class, 'delete']);
        $g->get('/enrollment/{enrollment_id:[0-9]+}', [EnrollmentController::class, 'getEnrollment']);

        // ── Roles (YLC + mentor compliance) ──
        $g->get('/roles/config/ylc-roles', [RolesController::class, 'ylcRoles']);
        $g->get('/roles/config/expertise', [RolesController::class, 'expertise']);
        $g->get('/roles/ylc/terms', [RolesController::class, 'ylcTerms']);
        $g->get('/roles/ylc', [RolesController::class, 'ylcList']);
        $g->get('/roles/youth-compliance', [RolesController::class, 'youthCompliance']);
        $g->get('/roles/youth/{member_id:[0-9]+}', [RolesController::class, 'getYouth']);
        $g->post('/roles/youth/{member_id:[0-9]+}/ylc-terms', [RolesController::class, 'addYlcTerm']);
        $g->put('/roles/youth/{member_id:[0-9]+}', [RolesController::class, 'upsertYouth']);
        $g->delete('/roles/ylc-terms/{record_id:[0-9]+}', [RolesController::class, 'deleteYlcTerm']);
        $g->get('/roles/adults', [RolesController::class, 'adults']);
        $g->get('/roles/compliance/expiring', [RolesController::class, 'expiring']);
        $g->get('/roles/compliance/items', [RolesController::class, 'complianceItems']);
        $g->put('/roles/compliance/items', [RolesController::class, 'saveComplianceItems']);
        $g->get('/roles/adult/{member_id:[0-9]+}/compliance-history', [RolesController::class, 'complianceHistory']);
        $g->post('/roles/adult/{member_id:[0-9]+}/compliance-record', [RolesController::class, 'addComplianceRecord']);
        $g->delete('/roles/adult/{member_id:[0-9]+}/compliance-record/{record_id:[0-9]+}', [RolesController::class, 'deleteComplianceRecord']);
        $g->get('/roles/adult/{member_id:[0-9]+}', [RolesController::class, 'getAdult']);
        $g->put('/roles/adult/{member_id:[0-9]+}', [RolesController::class, 'upsertAdult']);

        // ── Events (core; logistics/hotels/recurring deferred) ──
        // ── Calendar feeds (#43) — public .ics endpoints carry no auth; the
        // personal feed is gated by an opaque token in the URL. ──
        $g->get('/calendar/public.ics', [CalendarController::class, 'publicFeed']);
        $g->get('/calendar/feed/{token}.ics', [CalendarController::class, 'personalFeed']);
        $g->get('/calendar/feed/{token}', [CalendarController::class, 'personalFeed']);
        $g->get('/calendar/my-subscription', [CalendarController::class, 'mySubscription']);
        $g->post('/calendar/my-subscription/rotate', [CalendarController::class, 'rotateToken']);

        // Mentor unavailability (informational calendar overlay)
        $g->get('/mentor-unavailability', [\App\Controllers\MentorAvailabilityController::class, 'list']);
        $g->post('/mentor-unavailability', [\App\Controllers\MentorAvailabilityController::class, 'create']);
        $g->put('/mentor-unavailability/{id:[0-9]+}', [\App\Controllers\MentorAvailabilityController::class, 'update']);
        $g->delete('/mentor-unavailability/{id:[0-9]+}', [\App\Controllers\MentorAvailabilityController::class, 'delete']);

        $g->get('/events/types', [EventsController::class, 'types']);
        $g->get('/events/upcoming', [EventsController::class, 'upcoming']);
        $g->get('/events/birthdays', [EventsController::class, 'birthdays']);
        $g->post('/events/preview-recurrence', [EventsController::class, 'previewRecurrence']);
        $g->post('/events/recurring', [EventsController::class, 'createRecurring']);
        $g->get('/events/recurring/{group_id}', [EventsController::class, 'getRecurrenceGroup']);
        $g->delete('/events/recurring/{group_id}', [EventsController::class, 'deleteRecurrenceGroup']);
        $g->patch('/events/rooms/{room_id:[0-9]+}', [EventsController::class, 'updateRoom']);
        $g->post('/events/rooms/{room_id:[0-9]+}/assign', [EventsController::class, 'assignRoom']);
        $g->delete('/events/rooms/{room_id:[0-9]+}/assign/{member_id:[0-9]+}', [EventsController::class, 'removeFromRoom']);
        $g->get('/events/team/{team_season_id:[0-9]+}', [EventsController::class, 'teamEvents']);
        $g->get('/events/', [EventsController::class, 'list']);
        $g->post('/events/', [EventsController::class, 'create']);
        $g->get('/events/{event_id:[0-9]+}/attendance', [EventsController::class, 'attendance']);
        // #152 Event coverage sign-ups (SignupGenius-style)
        $g->get('/events/{event_id:[0-9]+}/signups', [EventSignupsController::class, 'list']);
        $g->post('/events/{event_id:[0-9]+}/signups', [EventSignupsController::class, 'createSlot']);
        $g->post('/events/{event_id:[0-9]+}/signups/bulk', [EventSignupsController::class, 'bulkCreate']);
        $g->patch('/events/signups/slots/{slot_id:[0-9]+}', [EventSignupsController::class, 'updateSlot']);
        $g->delete('/events/signups/slots/{slot_id:[0-9]+}', [EventSignupsController::class, 'deleteSlot']);
        $g->post('/events/signups/slots/{slot_id:[0-9]+}/signup', [EventSignupsController::class, 'signUp']);
        $g->delete('/events/signups/responses/{response_id:[0-9]+}', [EventSignupsController::class, 'cancel']);
        // "What are you bringing" / potluck sign-up (0207). Literal /events/bring/... before numeric-id patterns.
        $g->delete('/events/bring/signups/{signup_id:[0-9]+}', [EventBringController::class, 'cancelSignup']);
        $g->get('/events/{event_id:[0-9]+}/bring', [EventBringController::class, 'list']);
        $g->post('/events/{event_id:[0-9]+}/bring', [EventBringController::class, 'saveConfig']);
        $g->post('/events/{event_id:[0-9]+}/bring/signup', [EventBringController::class, 'signUp']);
        // Transportation planning (0221) — "How will you get to this event?"
        $g->get('/events/{event_id:[0-9]+}/transport', [EventTransportController::class, 'list']);
        $g->post('/events/{event_id:[0-9]+}/transport/config', [EventTransportController::class, 'saveConfig']);
        $g->post('/events/{event_id:[0-9]+}/transport/respond', [EventTransportController::class, 'respond']);
        $g->post('/events/{event_id:[0-9]+}/transport/assign', [EventTransportController::class, 'assign']);
        $g->get('/events/{event_id:[0-9]+}/logistics', [EventsController::class, 'getLogistics']);
        $g->put('/events/{event_id:[0-9]+}/logistics', [EventsController::class, 'upsertLogistics']);
        // ── Team fundraising ──
        $g->post('/events/fundraising/repoint-season', [FundraisingController::class, 'repointSeason']);
        $g->get('/events/{event_id:[0-9]+}/fundraising', [FundraisingController::class, 'get']);
        $g->put('/events/{event_id:[0-9]+}/fundraising', [FundraisingController::class, 'setConfig']);
        $g->put('/events/{event_id:[0-9]+}/fundraising/teams', [FundraisingController::class, 'setTeams']);
        $g->patch('/events/{event_id:[0-9]+}/fundraising/teams/{team_season_id:[0-9]+}', [FundraisingController::class, 'setExpected']);
        $g->post('/events/{event_id:[0-9]+}/fundraising/calculate', [FundraisingController::class, 'calculate']);
        $g->post('/events/{event_id:[0-9]+}/fundraising/finalize', [FundraisingController::class, 'finalize']);
        $g->get('/events/{event_id:[0-9]+}/fundraising/my-distribution', [FundraisingController::class, 'myDistribution']);
        $g->post('/events/{event_id:[0-9]+}/fundraising/my-distribution', [FundraisingController::class, 'setMyDistribution']);
        $g->get('/members/{member_id:[0-9]+}/earnings-todo', [FundraisingController::class, 'earningsTodo']);

        // ── Grant Tracking ──
        $g->post('/grants/repoint-season', [GrantsController::class, 'repointSeason']);
        $g->get('/grants/', [GrantsController::class, 'list']);
        $g->get('/grants/reminders', [GrantsController::class, 'reminders']);
        $g->post('/grants/{grant_id:[0-9]+}/mark-submitted', [GrantsController::class, 'markSubmitted']);
        $g->get('/grants/reports', [GrantsController::class, 'reports']);
        $g->post('/grants/', [GrantsController::class, 'create']);
        $g->get('/grants/{grant_id:[0-9]+}', [GrantsController::class, 'get']);
        $g->patch('/grants/{grant_id:[0-9]+}', [GrantsController::class, 'update']);
        $g->delete('/grants/{grant_id:[0-9]+}', [GrantsController::class, 'delete']);
        $g->put('/grants/{grant_id:[0-9]+}/teams', [GrantsController::class, 'setTeams']);
        $g->patch('/grants/teams/{grant_team_id:[0-9]+}', [GrantsController::class, 'updateTeam']);
        $g->post('/grants/{grant_id:[0-9]+}/correspondence', [GrantsController::class, 'addCorrespondence']);
        $g->delete('/grants/correspondence/{correspondence_id:[0-9]+}', [GrantsController::class, 'deleteCorrespondence']);
        $g->post('/grants/{grant_id:[0-9]+}/fields', [GrantsController::class, 'addField']);
        $g->patch('/grants/fields/{field_id:[0-9]+}', [GrantsController::class, 'updateField']);
        $g->delete('/grants/fields/{field_id:[0-9]+}', [GrantsController::class, 'deleteField']);

        // ── Sponsors ──
        $g->get('/sponsors/', [SponsorsController::class, 'list']);
        $g->get('/sponsors/reminders', [SponsorsController::class, 'reminders']);
        $g->get('/sponsors/reports', [SponsorsController::class, 'reports']);
        $g->post('/sponsors/', [SponsorsController::class, 'create']);
        $g->get('/sponsors/{sponsor_id:[0-9]+}', [SponsorsController::class, 'get']);
        $g->patch('/sponsors/{sponsor_id:[0-9]+}', [SponsorsController::class, 'update']);
        $g->delete('/sponsors/{sponsor_id:[0-9]+}', [SponsorsController::class, 'delete']);
        $g->post('/sponsors/{sponsor_id:[0-9]+}/contributions', [SponsorsController::class, 'addContribution']);
        $g->patch('/sponsors/contributions/{contribution_id:[0-9]+}', [SponsorsController::class, 'updateContribution']);
        $g->delete('/sponsors/contributions/{contribution_id:[0-9]+}', [SponsorsController::class, 'deleteContribution']);
        $g->post('/sponsors/{sponsor_id:[0-9]+}/deliverables', [SponsorsController::class, 'addDeliverable']);
        $g->patch('/sponsors/deliverables/{deliverable_id:[0-9]+}', [SponsorsController::class, 'updateDeliverable']);
        $g->delete('/sponsors/deliverables/{deliverable_id:[0-9]+}', [SponsorsController::class, 'deleteDeliverable']);
        $g->post('/sponsors/{sponsor_id:[0-9]+}/contacts', [SponsorsController::class, 'addContact']);
        $g->delete('/sponsors/contacts/{contact_id:[0-9]+}', [SponsorsController::class, 'deleteContact']);

        // ── Waitlist (Recruitment) ──
        // Canonical meeting-night preference (read/prefill + save), staff-facing.
        $g->get('/night-prefs', [NightPrefsController::class, 'get']);
        $g->get('/night-prefs/member/{member_id:[0-9]+}', [NightPrefsController::class, 'forMember']);
        $g->post('/night-prefs', [NightPrefsController::class, 'save']);

        $g->get('/waitlist/', [WaitlistController::class, 'list']);
        $g->post('/waitlist/', [WaitlistController::class, 'add']);
        $g->get('/waitlist/summary', [WaitlistController::class, 'summary']);
        $g->get('/waitlist/nights', [WaitlistController::class, 'nights']);
        $g->post('/waitlist/nights', [WaitlistController::class, 'addNight']);
        $g->patch('/waitlist/nights/{night_id:[0-9]+}', [WaitlistController::class, 'updateNight']);
        $g->delete('/waitlist/nights/{night_id:[0-9]+}', [WaitlistController::class, 'deleteNight']);
        $g->patch('/waitlist/{entry_id:[0-9]+}', [WaitlistController::class, 'update']);
        $g->delete('/waitlist/{entry_id:[0-9]+}', [WaitlistController::class, 'remove']);
        $g->post('/waitlist/{entry_id:[0-9]+}/offer', [WaitlistController::class, 'offer']);
        $g->post('/waitlist/{entry_id:[0-9]+}/respond', [WaitlistController::class, 'respond']);

        // ── Schools & Partners (Recruitment) ──
        $g->get('/schools/', [SchoolsController::class, 'list']);
        $g->post('/schools/', [SchoolsController::class, 'create']);
        $g->get('/schools/{school_id:[0-9]+}', [SchoolsController::class, 'get']);
        $g->patch('/schools/{school_id:[0-9]+}', [SchoolsController::class, 'update']);
        $g->delete('/schools/{school_id:[0-9]+}', [SchoolsController::class, 'delete']);
        $g->post('/schools/{school_id:[0-9]+}/contacts', [SchoolsController::class, 'addContact']);
        $g->patch('/schools/contacts/{contact_id:[0-9]+}', [SchoolsController::class, 'updateContact']);
        $g->delete('/schools/contacts/{contact_id:[0-9]+}', [SchoolsController::class, 'deleteContact']);
        $g->post('/schools/{school_id:[0-9]+}/engagements', [SchoolsController::class, 'addEngagement']);
        $g->delete('/schools/engagements/{engagement_id:[0-9]+}', [SchoolsController::class, 'deleteEngagement']);

        // ── Mentor Prospects (Recruitment) ──
        $g->get('/mentor-prospects/', [MentorProspectsController::class, 'list']);
        $g->post('/mentor-prospects/', [MentorProspectsController::class, 'create']);
        $g->patch('/mentor-prospects/{prospect_id:[0-9]+}', [MentorProspectsController::class, 'update']);
        $g->delete('/mentor-prospects/{prospect_id:[0-9]+}', [MentorProspectsController::class, 'delete']);
        $g->post('/mentor-prospects/{prospect_id:[0-9]+}/convert', [MentorProspectsController::class, 'convert']);
        $g->post('/mentor-prospects/{prospect_id:[0-9]+}/to-sponsor', [MentorProspectsController::class, 'toSponsor']);
        $g->post('/recruitment/import', [RecruitmentImportController::class, 'import']);

        // ── Scholarship Funds ──
        // Scholarship applications (Phase B): apply → review → award
        $g->post('/scholarships/applications', [ScholarshipApplicationsController::class, 'submit']);
        $g->get('/scholarships/applications/mine', [ScholarshipApplicationsController::class, 'mine']);
        // Must be declared before the {application_id} route so "prefill" isn't
        // swallowed as an id segment.
        $g->get('/scholarships/applications/prefill', [ScholarshipApplicationsController::class, 'prefill']);
        $g->get('/scholarships/applications', [ScholarshipApplicationsController::class, 'list']);
        $g->get('/scholarships/applications/{application_id:[0-9]+}', [ScholarshipApplicationsController::class, 'get']);
        $g->delete('/scholarships/applications/{application_id:[0-9]+}', [ScholarshipApplicationsController::class, 'delete']);
        $g->patch('/scholarships/applications/{application_id:[0-9]+}/review', [ScholarshipApplicationsController::class, 'review']);
        $g->get('/scholarships/applications/{application_id:[0-9]+}/enrollments', [ScholarshipApplicationsController::class, 'applicationEnrollments']);
        $g->post('/scholarships/applications/{application_id:[0-9]+}/award', [ScholarshipApplicationsController::class, 'award']);
        $g->post('/scholarships/applications/{application_id:[0-9]+}/notify', [ScholarshipApplicationsController::class, 'resendNotifications']);
        $g->post('/scholarships/awards/{award_id:[0-9]+}/reverse', [ScholarshipApplicationsController::class, 'reverseAward']);
        // Phase 3 — fund ledger (allocations + awards + balances, per season)
        $g->get('/scholarships/fund-ledger', [ScholarshipApplicationsController::class, 'fundLedger']);
        $g->post('/scholarships/funds/{fund_id:[0-9]+}/allocations', [ScholarshipApplicationsController::class, 'addAllocation']);
        // Phase 4 — award expiration + staff-confirmed clawback
        $g->get('/scholarships/expiring-awards', [ScholarshipApplicationsController::class, 'expiringAwards']);
        $g->post('/scholarships/awards/{award_id:[0-9]+}/claw-back', [ScholarshipApplicationsController::class, 'clawBack']);
        // Phase 5 — printable TRCF Board report
        $g->get('/scholarships/board-report', [ScholarshipApplicationsController::class, 'boardReport']);
        // Phase 6 — season close-out summary
        $g->get('/scholarships/season-closeout', [ScholarshipApplicationsController::class, 'seasonCloseout']);
        // Member groups (YLC, committees) + group events
        $g->get('/groups', [GroupsController::class, 'list']);
        $g->post('/groups', [GroupsController::class, 'create']);
        $g->get('/groups/mine/events', [GroupsController::class, 'myUpcomingEvents']);
        $g->get('/groups/{group_id:[0-9]+}', [GroupsController::class, 'get']);
        $g->patch('/groups/{group_id:[0-9]+}', [GroupsController::class, 'update']);
        $g->delete('/groups/{group_id:[0-9]+}', [GroupsController::class, 'delete']);
        $g->put('/groups/{group_id:[0-9]+}/members', [GroupsController::class, 'setMembers']);

        // Meeting minutes (#107) — YLC + action items (assignee/due/status on the meeting)
        $g->get('/meetings', [MinutesController::class, 'list']);
        $g->get('/meetings/manage-scope', [MinutesController::class, 'manageScope']);
        $g->get('/meetings/event-options', [MinutesController::class, 'eventOptions']);
        $g->post('/meetings', [MinutesController::class, 'create']);
        $g->get('/meetings/{meeting_id:[0-9]+}', [MinutesController::class, 'get']);
        $g->patch('/meetings/{meeting_id:[0-9]+}', [MinutesController::class, 'update']);
        $g->delete('/meetings/{meeting_id:[0-9]+}', [MinutesController::class, 'delete']);
        $g->put('/meetings/{meeting_id:[0-9]+}/attendees', [MinutesController::class, 'setAttendees']);
        $g->post('/meetings/{meeting_id:[0-9]+}/lock', [MinutesController::class, 'lock']);
        $g->post('/meetings/{meeting_id:[0-9]+}/unlock', [MinutesController::class, 'unlock']);
        $g->post('/meetings/{meeting_id:[0-9]+}/actions', [MinutesController::class, 'addAction']);
        $g->patch('/meetings/actions/{action_id:[0-9]+}', [MinutesController::class, 'updateAction']);
        $g->delete('/meetings/actions/{action_id:[0-9]+}', [MinutesController::class, 'deleteAction']);

        // Invoicing & third-party (school) payers
        $g->get('/invoices/family/{family_id:[0-9]+}', [InvoicesController::class, 'familyInvoice']);
        $g->get('/invoices/school/{school_id:[0-9]+}', [InvoicesController::class, 'schoolInvoice']);
        $g->post('/invoices/school/{school_id:[0-9]+}/send', [InvoicesController::class, 'sendSchoolInvoice']);
        $g->post('/school-payments', [InvoicesController::class, 'recordSchoolPayment']);
        $g->post('/school-payments/{id:[0-9]+}/reverse', [InvoicesController::class, 'reverseSchoolPayment']);
        $g->get('/scholarships/funds', [ScholarshipsController::class, 'list']);
        $g->post('/scholarships/funds', [ScholarshipsController::class, 'create']);
        $g->patch('/scholarships/funds/{fund_id:[0-9]+}', [ScholarshipsController::class, 'update']);

        // ── Event Sponsorship ──
        $g->get('/events/{event_id:[0-9]+}/sponsorship', [EventSponsorshipController::class, 'get']);
        $g->patch('/events/{event_id:[0-9]+}/sponsorship', [EventSponsorshipController::class, 'updateSettings']);
        $g->post('/events/{event_id:[0-9]+}/sponsorship/packages', [EventSponsorshipController::class, 'addPackage']);
        $g->patch('/events/sponsorship/packages/{package_id:[0-9]+}', [EventSponsorshipController::class, 'updatePackage']);
        $g->delete('/events/sponsorship/packages/{package_id:[0-9]+}', [EventSponsorshipController::class, 'deletePackage']);
        $g->post('/events/{event_id:[0-9]+}/sponsorship/pipeline', [EventSponsorshipController::class, 'addPipeline']);
        $g->patch('/events/sponsorship/pipeline/{entry_id:[0-9]+}', [EventSponsorshipController::class, 'updatePipeline']);
        $g->delete('/events/sponsorship/pipeline/{entry_id:[0-9]+}', [EventSponsorshipController::class, 'deletePipeline']);

        // ── Room & Resource Reservations ──
        $g->get('/reservations/', [ReservationsController::class, 'list']);
        $g->get('/reservations/pending-count', [ReservationsController::class, 'pendingCount']);
        $g->get('/reservations/for-event/{event_id:[0-9]+}', [ReservationsController::class, 'forEvent']);
        $g->get('/reservations/resources', [ReservationsController::class, 'resources']);
        $g->post('/reservations/resources', [ReservationsController::class, 'createResource']);
        $g->patch('/reservations/resources/{resource_id:[0-9]+}', [ReservationsController::class, 'updateResource']);
        $g->delete('/reservations/resources/{resource_id:[0-9]+}', [ReservationsController::class, 'deleteResource']);
        $g->post('/reservations/', [ReservationsController::class, 'create']);
        $g->get('/reservations/{reservation_id:[0-9]+}', [ReservationsController::class, 'get']);
        $g->patch('/reservations/{reservation_id:[0-9]+}', [ReservationsController::class, 'update']);
        $g->post('/reservations/{reservation_id:[0-9]+}/decision', [ReservationsController::class, 'decision']);
        $g->post('/reservations/{reservation_id:[0-9]+}/cancel', [ReservationsController::class, 'cancel']);
        $g->delete('/reservations/{reservation_id:[0-9]+}', [ReservationsController::class, 'delete']);

        // ── Hall of Fame ──
        $g->get('/hof/', [HallOfFameController::class, 'list']);
        $g->get('/hof/eligible', [HallOfFameController::class, 'eligible']);
        $g->post('/hof/', [HallOfFameController::class, 'create']);
        $g->post('/hof/from-member/{member_id:[0-9]+}', [HallOfFameController::class, 'createFromMember']);
        $g->get('/hof/{hof_id:[0-9]+}', [HallOfFameController::class, 'get']);
        $g->patch('/hof/{hof_id:[0-9]+}', [HallOfFameController::class, 'update']);
        $g->post('/hof/{hof_id:[0-9]+}/publish', [HallOfFameController::class, 'setPublished']);
        $g->delete('/hof/{hof_id:[0-9]+}', [HallOfFameController::class, 'delete']);

        // ── Feedback (bugs & feature requests) ──
        $g->get('/feedback/', [FeedbackController::class, 'list']);
        $g->get('/feedback/open-count', [FeedbackController::class, 'openCount']);
        $g->post('/feedback/', [FeedbackController::class, 'create']);
        $g->post('/feedback/bulk', [FeedbackController::class, 'bulkUpdate']);
        $g->get('/feedback/{feedback_id:[0-9]+}', [FeedbackController::class, 'get']);
        $g->patch('/feedback/{feedback_id:[0-9]+}', [FeedbackController::class, 'update']);
        $g->delete('/feedback/{feedback_id:[0-9]+}', [FeedbackController::class, 'delete']);
        $g->post('/feedback/{feedback_id:[0-9]+}/comments', [FeedbackController::class, 'addComment']);
        $g->post('/feedback/{feedback_id:[0-9]+}/github', [FeedbackController::class, 'pushToGithub']);
        $g->post('/feedback/{feedback_id:[0-9]+}/github-comment', [FeedbackController::class, 'commentToGithub']);

        // ── Repair / Maintenance tickets ──
        $g->get('/repairs/', [RepairsController::class, 'list']);
        $g->get('/repairs/open-count', [RepairsController::class, 'openCount']);
        $g->get('/repairs/assets', [RepairsController::class, 'assets']);
        $g->post('/repairs/', [RepairsController::class, 'create']);
        $g->get('/repairs/{repair_id:[0-9]+}', [RepairsController::class, 'get']);
        $g->patch('/repairs/{repair_id:[0-9]+}', [RepairsController::class, 'update']);
        $g->delete('/repairs/{repair_id:[0-9]+}', [RepairsController::class, 'delete']);
        $g->post('/repairs/{repair_id:[0-9]+}/updates', [RepairsController::class, 'addUpdate']);
        $g->post('/repairs/{repair_id:[0-9]+}/claim', [RepairsController::class, 'claim']);
        $g->post('/repairs/{repair_id:[0-9]+}/parts', [RepairsController::class, 'addPart']);
        $g->patch('/repairs/parts/{part_id:[0-9]+}', [RepairsController::class, 'updatePart']);
        $g->delete('/repairs/parts/{part_id:[0-9]+}', [RepairsController::class, 'deletePart']);
        $g->post('/repairs/{repair_id:[0-9]+}/correspondence', [RepairsController::class, 'addCorrespondence']);
        $g->patch('/repairs/correspondence/{corr_id:[0-9]+}', [RepairsController::class, 'updateCorrespondence']);
        $g->delete('/repairs/correspondence/{corr_id:[0-9]+}', [RepairsController::class, 'deleteCorrespondence']);

        // ── Team Financials (QuickBooks import) ──
        $g->post('/finance/preview', [FinanceController::class, 'preview']);
        $g->post('/finance/imports', [FinanceController::class, 'createImport']);
        $g->get('/finance/imports', [FinanceController::class, 'listImports']);
        $g->delete('/finance/imports/{import_id:[0-9]+}', [FinanceController::class, 'deleteImport']);
        $g->get('/finance/segments', [FinanceController::class, 'segments']);
        $g->put('/finance/segments', [FinanceController::class, 'setSegmentMap']);
        $g->get('/finance/by-team', [FinanceController::class, 'byTeam']);

        // ── Announcements (#94) ──
        $g->get('/announcements', [AnnouncementsController::class, 'list']);
        $g->post('/announcements', [AnnouncementsController::class, 'create']);
        $g->patch('/announcements/{announcement_id:[0-9]+}', [AnnouncementsController::class, 'update']);
        $g->delete('/announcements/{announcement_id:[0-9]+}', [AnnouncementsController::class, 'delete']);

        // ── Season transition readiness checklist ──
        $g->get('/admin/season-transition', [SeasonTransitionController::class, 'get']);
        $g->post('/admin/season-transition/item', [SeasonTransitionController::class, 'setItem']);
        $g->post('/events/{event_id:[0-9]+}/rooms', [EventsController::class, 'addRoom']);
        $g->get('/events/{event_id:[0-9]+}', [EventsController::class, 'get']);
        $g->patch('/events/{event_id:[0-9]+}', [EventsController::class, 'update']);
        $g->delete('/events/{event_id:[0-9]+}', [EventsController::class, 'delete']);

        // ── Event participants / RSVP (app/modules/event_participants) ──
        $g->get('/members/{member_id:[0-9]+}/upcoming-events', [ParticipantsController::class, 'memberUpcoming']);
        $g->get('/events/{event_id:[0-9]+}/participants/statuses', [ParticipantsController::class, 'participantStatuses']);
        $g->get('/events/{event_id:[0-9]+}/participants/room-assignments', [EventsController::class, 'roomAssignments']);
        $g->get('/events/{event_id:[0-9]+}/participants', [ParticipantsController::class, 'list']);
        $g->post('/events/{event_id:[0-9]+}/participants/bulk-team', [ParticipantsController::class, 'bulkTeam']);
        $g->post('/events/{event_id:[0-9]+}/participants/bulk-type', [ParticipantsController::class, 'bulkType']);
        $g->post('/events/{event_id:[0-9]+}/participants', [ParticipantsController::class, 'add']);
        $g->patch('/events/{event_id:[0-9]+}/participants/{participant_id:[0-9]+}', [ParticipantsController::class, 'update']);
        $g->delete('/events/{event_id:[0-9]+}/participants/{participant_id:[0-9]+}', [ParticipantsController::class, 'remove']);
        $g->get('/events/{event_id:[0-9]+}/my-rsvp', [ParticipantsController::class, 'myRsvp']);
        $g->post('/events/rsvp-bulk', [ParticipantsController::class, 'bulkRsvp']);
        $g->post('/events/{event_id:[0-9]+}/rsvp', [ParticipantsController::class, 'rsvp']);
        // PUBLIC (no login) — RSVP from an emailed token link (#96).
        $g->get('/events/{event_id:[0-9]+}/rsvp-link/{token}', [ParticipantsController::class, 'rsvpByToken']);

        // ── Email open/click tracking (public — hit by mail clients/browsers) ──
        $g->get('/action-items', [ActionItemsController::class, 'counts']);

        // ── Trends / time-series analytics ──
        $g->get('/trends/metrics', [\App\Controllers\TrendsController::class, 'metrics']);
        $g->get('/trends/series', [\App\Controllers\TrendsController::class, 'series']);
        $g->get('/trends/retention', [\App\Controllers\TrendsController::class, 'retention']);

        // ── Usage tracking + User Activity report ──
        $g->post('/usage/track', [\App\Controllers\UsageController::class, 'track']);
        $g->get('/reports/usage', [\App\Controllers\UsageController::class, 'report']);

        // ── Reports Engine (custom report builder) ──
        $g->get('/reports/engine/datasets', [\App\Controllers\ReportEngineController::class, 'datasets']);
        $g->post('/reports/engine/preview', [\App\Controllers\ReportEngineController::class, 'preview']);
        $g->get('/reports/engine', [\App\Controllers\ReportEngineController::class, 'list']);
        $g->post('/reports/engine', [\App\Controllers\ReportEngineController::class, 'create']);
        $g->get('/reports/engine/permissions', [\App\Controllers\ReportEngineController::class, 'permissionsList']);
        $g->put('/reports/engine/permissions', [\App\Controllers\ReportEngineController::class, 'permissionsSave']);
        $g->delete('/reports/engine/permissions/{id:[0-9]+}', [\App\Controllers\ReportEngineController::class, 'permissionsDelete']);
        $g->get('/reports/engine/{id:[0-9]+}', [\App\Controllers\ReportEngineController::class, 'get']);
        $g->put('/reports/engine/{id:[0-9]+}', [\App\Controllers\ReportEngineController::class, 'update']);
        $g->delete('/reports/engine/{id:[0-9]+}', [\App\Controllers\ReportEngineController::class, 'delete']);
        $g->post('/reports/engine/{id:[0-9]+}/run', [\App\Controllers\ReportEngineController::class, 'run']);

        // ── Scheduled (emailed) reports ──
        $g->get('/reports/engine/schedules', [\App\Controllers\ReportScheduleController::class, 'list']);
        $g->put('/reports/engine/schedules/{sid:[0-9]+}', [\App\Controllers\ReportScheduleController::class, 'update']);
        $g->delete('/reports/engine/schedules/{sid:[0-9]+}', [\App\Controllers\ReportScheduleController::class, 'delete']);
        $g->get('/reports/engine/{id:[0-9]+}/schedules', [\App\Controllers\ReportScheduleController::class, 'forReport']);
        $g->post('/reports/engine/{id:[0-9]+}/schedules', [\App\Controllers\ReportScheduleController::class, 'create']);

        $g->get('/track/o/{token}', [TrackingController::class, 'open']);
        $g->get('/track/c/{token}', [TrackingController::class, 'click']);

        // ── Communications (app/modules/communications, prefix /comms) ──
        $g->get('/comms/templates/categories', [CommunicationsController::class, 'templateCategories']);
        $g->get('/comms/templates/variables', [CommunicationsController::class, 'templateVariables']);
        $g->get('/comms/email-links', [CommunicationsController::class, 'getEmailLinks']);
        $g->put('/comms/email-links', [CommunicationsController::class, 'setEmailLinks']);
        $g->get('/comms/templates/{template_id:[0-9]+}', [CommunicationsController::class, 'getTemplate']);
        $g->get('/comms/templates', [CommunicationsController::class, 'listTemplates']);
        $g->post('/comms/templates', [CommunicationsController::class, 'createTemplate']);
        $g->patch('/comms/templates/{template_id:[0-9]+}', [CommunicationsController::class, 'updateTemplate']);
        $g->delete('/comms/templates/{template_id:[0-9]+}', [CommunicationsController::class, 'deleteTemplate']);
        $g->get('/comms/layouts', [CommunicationsController::class, 'listLayouts']);
        $g->post('/comms/layouts', [CommunicationsController::class, 'createLayout']);
        $g->get('/comms/layouts/{layout_id:[0-9]+}', [CommunicationsController::class, 'getLayout']);
        $g->patch('/comms/layouts/{layout_id:[0-9]+}', [CommunicationsController::class, 'updateLayout']);
        $g->delete('/comms/layouts/{layout_id:[0-9]+}', [CommunicationsController::class, 'deleteLayout']);
        $g->post('/comms/preview', [CommunicationsController::class, 'preview']);
        $g->post('/comms/send', [CommunicationsController::class, 'send']);
        $g->get('/comms/team-seasons', [CommunicationsController::class, 'teamSeasonsForPicker']);
        $g->post('/comms/resolve-recipients', [CommunicationsController::class, 'resolveRecipients']);
        $g->post('/comms/attachments', [CommunicationsController::class, 'uploadAttachment']);
        $g->delete('/comms/attachments/{attachment_id:[0-9]+}', [CommunicationsController::class, 'deleteAttachment']);
        $g->post('/comms/send-bulk', [CommunicationsController::class, 'sendBulk']);
        // PUBLIC (no login) — unsubscribe from mass emails via the emailed link (#100).
        $g->get('/comms/unsubscribe/{token}', [CommunicationsController::class, 'unsubscribe']);
        $g->get('/comms/drafts', [CommunicationsController::class, 'listDrafts']);
        $g->get('/comms/drafts/{draft_id:[0-9]+}', [CommunicationsController::class, 'getDraft']);
        $g->post('/comms/drafts', [CommunicationsController::class, 'saveDraft']);
        $g->put('/comms/drafts/{draft_id:[0-9]+}', [CommunicationsController::class, 'saveDraft']);
        $g->delete('/comms/drafts/{draft_id:[0-9]+}', [CommunicationsController::class, 'deleteDraft']);
        $g->get('/comms/messages', [CommunicationsController::class, 'messageHistory']);
        $g->get('/comms/threads/recipient', [CommunicationsController::class, 'recipientThreads']);
        $g->get('/comms/threads/{thread_id:[0-9]+}', [CommunicationsController::class, 'getThread']);
        $g->patch('/comms/threads/{thread_id:[0-9]+}/close', [CommunicationsController::class, 'closeThread']);
        $g->get('/comms/preference-types', [CommunicationsController::class, 'preferenceTypesEndpoint']);
        $g->get('/comms/preferences/{member_id:[0-9]+}/types', [CommunicationsController::class, 'preferenceTypesEndpoint']);
        $g->get('/comms/preferences/{member_id:[0-9]+}', [CommunicationsController::class, 'getPreferences']);
        $g->put('/comms/preferences/{member_id:[0-9]+}', [CommunicationsController::class, 'updatePreferences']);

        // ── Uploads (app/modules/uploads, prefix /uploads) ──
        $g->post('/uploads/photo', [UploadsController::class, 'photo']);
        $g->post('/uploads/team-asset', [UploadsController::class, 'teamAsset']);
        $g->post('/uploads/document', [UploadsController::class, 'document']);

        // ── Activity / Time Logging (app/modules/activity, prefix /activity) ──
        // "Feature Names" — the named-feature glossary, any signed-in member.
        $g->get('/feature-names', [FeatureNamesController::class, 'list']);

        // "My Volunteering" — opportunities + the member's own per-event hours report.
        $g->get('/volunteering/opportunities', [VolunteeringController::class, 'opportunities']);
        $g->get('/volunteering/my-hours', [VolunteeringController::class, 'myHours']);

        $g->get('/activity/areas', [ActivityController::class, 'areas']);
        $g->get('/activity/seasons', [ActivityController::class, 'seasons']);
        $g->get('/activity/impact', [ActivityController::class, 'orgImpact']);
        $g->get('/activity/member/{member_id:[0-9]+}/uncategorized', [ActivityController::class, 'uncategorized']);
        $g->get('/activity/member/{member_id:[0-9]+}/loggable-events', [ActivityController::class, 'loggableEvents']);
        $g->get('/activity/member/{member_id:[0-9]+}/summary', [ActivityController::class, 'memberSummary']);
        $g->get('/activity/member/{member_id:[0-9]+}', [ActivityController::class, 'memberEntries']);
        $g->post('/activity/entries', [ActivityController::class, 'createEntry']);
        $g->post('/activity/entries/bulk', [ActivityController::class, 'createEntries']);
        $g->get('/activity/member/{member_id:[0-9]+}/checkins', [ActivityController::class, 'checkinsForDay']);
        $g->post('/activity/entries/{entry_id:[0-9]+}/verify', [ActivityController::class, 'verifyEntry']);
        $g->patch('/activity/entries/{entry_id:[0-9]+}', [ActivityController::class, 'editEntry']);
        $g->delete('/activity/entries/{entry_id:[0-9]+}', [ActivityController::class, 'deleteEntry']);
        $g->get('/activity/team/{team_season_id:[0-9]+}/summary', [ActivityController::class, 'teamSummary']);
        $g->post('/activity/checkin/{checkin_id:[0-9]+}/tag', [ActivityController::class, 'tagCheckout']);
        $g->post('/activity/checkin/{checkin_id:[0-9]+}/classify', [ActivityController::class, 'classifyCheckin']);

        // ── Resource Tracking (app/modules/resources, prefix /resources) ──
        $g->get('/resources/types', [ResourcesController::class, 'listTypes']);
        $g->post('/resources/types', [ResourcesController::class, 'createType']);
        $g->patch('/resources/types/{type_id:[0-9]+}', [ResourcesController::class, 'updateType']);
        $g->delete('/resources/types/{type_id:[0-9]+}', [ResourcesController::class, 'deactivateType']);
        $g->get('/resources/trc', [ResourcesController::class, 'listTrcResources']);
        $g->get('/resources/requests', [ResourcesController::class, 'pendingRequests']);
        $g->get('/resources/access-log', [ResourcesController::class, 'accessLog']);
        $g->post('/resources/season-rollover', [ResourcesController::class, 'seasonRollover']);
        $g->get('/resources/team/{team_season_id:[0-9]+}', [ResourcesController::class, 'listTeamResources']);
        $g->post('/resources/', [ResourcesController::class, 'createResource']);
        $g->post('/resources/{resource_id:[0-9]+}/request', [ResourcesController::class, 'requestAccess']);
        $g->post('/resources/{resource_id:[0-9]+}/grant', [ResourcesController::class, 'grantAccess']);
        $g->post('/resources/{resource_id:[0-9]+}/revoke', [ResourcesController::class, 'revokeAccess']);
        $g->patch('/resources/{resource_id:[0-9]+}', [ResourcesController::class, 'updateResource']);
        $g->delete('/resources/{resource_id:[0-9]+}', [ResourcesController::class, 'deleteResource']);

        // ── Shopping List (app/modules/shopping, prefix /shopping) ──
        $g->get('/shopping/stores', [ShoppingController::class, 'listStores']);
        $g->post('/shopping/stores', [ShoppingController::class, 'createStore']);
        $g->patch('/shopping/stores/{store_id:[0-9]+}', [ShoppingController::class, 'updateStore']);
        $g->get('/shopping/categories', [ShoppingController::class, 'listCategories']);
        $g->post('/shopping/categories', [ShoppingController::class, 'createCategory']);
        $g->patch('/shopping/categories/{category_id:[0-9]+}', [ShoppingController::class, 'updateCategory']);
        $g->get('/shopping/staples', [ShoppingController::class, 'listStaples']);
        $g->post('/shopping/staples', [ShoppingController::class, 'createStaple']);
        $g->delete('/shopping/staples/{staple_id:[0-9]+}', [ShoppingController::class, 'deleteStaple']);
        $g->get('/shopping/items', [ShoppingController::class, 'listItems']);
        $g->get('/shopping/items/history', [ShoppingController::class, 'history']);
        $g->post('/shopping/items', [ShoppingController::class, 'addItem']);
        $g->post('/shopping/items/{item_id:[0-9]+}/claim', [ShoppingController::class, 'claimItem']);
        $g->post('/shopping/items/{item_id:[0-9]+}/unclaim', [ShoppingController::class, 'unclaimItem']);
        $g->post('/shopping/items/{item_id:[0-9]+}/got-it', [ShoppingController::class, 'gotIt']);
        $g->post('/shopping/items/{item_id:[0-9]+}/reopen', [ShoppingController::class, 'reopenItem']);
        $g->patch('/shopping/items/{item_id:[0-9]+}', [ShoppingController::class, 'updateItem']);
        $g->delete('/shopping/items/{item_id:[0-9]+}', [ShoppingController::class, 'deleteItem']);

        // ── Certifications (app/modules/certifications, prefix /certifications) ──
        $g->get('/certifications/badges', [CertificationsController::class, 'listBadges']);
        $g->post('/certifications/badges', [CertificationsController::class, 'createBadge']);
        $g->patch('/certifications/badges/{badge_id:[0-9]+}', [CertificationsController::class, 'updateBadge']);
        $g->delete('/certifications/badges/{badge_id:[0-9]+}', [CertificationsController::class, 'deleteBadge']);
        $g->get('/certifications/tool-clearances', [CertificationsController::class, 'toolClearances']);
        $g->get('/certifications/leaderboard', [CertificationsController::class, 'leaderboard']);
        $g->get('/certifications/settings', [CertificationsController::class, 'getSettings']);
        $g->put('/certifications/settings', [CertificationsController::class, 'updateSettings']);
        $g->get('/certifications/member/{member_id:[0-9]+}/badges', [CertificationsController::class, 'memberBadges']);
        $g->get('/certifications/member/{member_id:[0-9]+}', [CertificationsController::class, 'memberCerts']);
        $g->post('/certifications/import-progress', [CertificationsController::class, 'importProgressChart']);
        $g->post('/certifications/member/{member_id:[0-9]+}', [CertificationsController::class, 'awardCert']);
        $g->delete('/certifications/member/{member_id:[0-9]+}/{certification_id:[0-9]+}', [CertificationsController::class, 'removeMemberCert']);
        $g->get('/certifications/team/{team_season_id:[0-9]+}', [CertificationsController::class, 'teamCerts']);
        // Certification Quiz Engine (LMS) — author side, hidden behind cert_lms gates.
        $g->get('/certifications/{cert_id:[0-9]+}/quiz', [CertificationsController::class, 'getQuiz']);
        $g->put('/certifications/{cert_id:[0-9]+}/quiz', [CertificationsController::class, 'upsertQuiz']);
        $g->post('/certifications/{cert_id:[0-9]+}/quiz/questions', [CertificationsController::class, 'addQuizQuestion']);
        $g->post('/certifications/{cert_id:[0-9]+}/quiz/publish', [CertificationsController::class, 'publishQuiz']);
        $g->patch('/cert-quiz/questions/{question_id:[0-9]+}', [CertificationsController::class, 'updateQuizQuestion']);
        $g->delete('/cert-quiz/questions/{question_id:[0-9]+}', [CertificationsController::class, 'deleteQuizQuestion']);
        // Learner side (take + auto-grade + auto-award), gated on canTakeLms.
        $g->get('/certifications/{cert_id:[0-9]+}/quiz/mine', [CertificationsController::class, 'myQuiz']);
        $g->post('/certifications/{cert_id:[0-9]+}/quiz/start', [CertificationsController::class, 'startQuiz']);
        $g->post('/cert-quiz/attempts/{attempt_id:[0-9]+}/submit', [CertificationsController::class, 'submitQuiz']);
        $g->get('/cert-quiz/attempts/{attempt_id:[0-9]+}', [CertificationsController::class, 'getAttempt']);
        // Gradebook (manager side), gated on canManageLms.
        $g->get('/certifications/{cert_id:[0-9]+}/quiz/attempts', [CertificationsController::class, 'quizAttempts']);
        $g->patch('/cert-quiz/attempts/{attempt_id:[0-9]+}/grade', [CertificationsController::class, 'gradeAttempt']);
        $g->get('/certifications/', [CertificationsController::class, 'listCerts']);
        $g->post('/certifications/', [CertificationsController::class, 'createCert']);
        $g->patch('/certifications/{cert_id:[0-9]+}', [CertificationsController::class, 'updateCert']);
        $g->delete('/certifications/{cert_id:[0-9]+}', [CertificationsController::class, 'deleteCert']);

        // ── Member onboarding checklist (YPT & co.) ──
        $g->get('/onboarding/catalog', [OnboardingController::class, 'catalog']);
        $g->get('/onboarding/me', [OnboardingController::class, 'mine']);
        $g->get('/onboarding/outstanding', [OnboardingController::class, 'outstanding']);
        $g->post('/onboarding/work/bulk', [OnboardingController::class, 'assignWorkBulk']);
        $g->post('/onboarding/resume-task/bulk', [OnboardingController::class, 'assignResumeBulk']);
        $g->get('/onboarding/members/{member_id:[0-9]+}', [OnboardingController::class, 'forMember']);
        $g->post('/onboarding/members/{member_id:[0-9]+}/assign', [OnboardingController::class, 'assign']);
        $g->post('/onboarding/members/{member_id:[0-9]+}/work', [OnboardingController::class, 'assignWork']);
        $g->post('/onboarding/tasks/{id:[0-9]+}/complete', [OnboardingController::class, 'complete']);
        $g->delete('/onboarding/tasks/{id:[0-9]+}', [OnboardingController::class, 'unassign']);

        // ── Season Strategy — Goals (prefix /strategy) ──
        $g->get('/strategy/goals', [SeasonGoalsController::class, 'overview']);
        $g->get('/strategy/team/{team_season_id:[0-9]+}/goals', [SeasonGoalsController::class, 'listGoals']);
        $g->post('/strategy/team/{team_season_id:[0-9]+}/goals', [SeasonGoalsController::class, 'createGoal']);
        $g->put('/strategy/team/{team_season_id:[0-9]+}/mission', [SeasonGoalsController::class, 'setMission']);
        $g->patch('/strategy/goals/{goal_id:[0-9]+}', [SeasonGoalsController::class, 'updateGoal']);
        $g->delete('/strategy/goals/{goal_id:[0-9]+}', [SeasonGoalsController::class, 'deleteGoal']);
        $g->get('/strategy/goals/{goal_id:[0-9]+}/updates', [SeasonGoalsController::class, 'listUpdates']);
        $g->post('/strategy/goals/{goal_id:[0-9]+}/updates', [SeasonGoalsController::class, 'logProgress']);
        $g->delete('/strategy/goal-updates/{update_id:[0-9]+}', [SeasonGoalsController::class, 'deleteProgress']);
        $g->get('/strategy/goals/{goal_id:[0-9]+}/evidence', [SeasonGoalsController::class, 'evidenceTrail']);
        $g->get('/strategy/team/{team_season_id:[0-9]+}/goals.csv', [SeasonGoalsController::class, 'goalsCsv']);
        // Portfolio (Phase 2)
        $g->get('/strategy/portfolios', [PortfolioController::class, 'overview']);
        $g->get('/strategy/team/{team_season_id:[0-9]+}/portfolio', [PortfolioController::class, 'getPortfolio']);
        $g->patch('/strategy/portfolio/{portfolio_id:[0-9]+}', [PortfolioController::class, 'updatePortfolio']);
        $g->post('/strategy/portfolio/{portfolio_id:[0-9]+}/seed-template', [PortfolioController::class, 'seedTemplate']);
        $g->post('/strategy/portfolio/{portfolio_id:[0-9]+}/pieces', [PortfolioController::class, 'createPiece']);
        $g->post('/strategy/portfolio/{portfolio_id:[0-9]+}/reorder', [PortfolioController::class, 'reorderPieces']);
        $g->post('/strategy/portfolio/{portfolio_id:[0-9]+}/captures', [PortfolioController::class, 'createCapture']);
        $g->patch('/strategy/portfolio-pieces/{piece_id:[0-9]+}', [PortfolioController::class, 'updatePiece']);
        $g->delete('/strategy/portfolio-pieces/{piece_id:[0-9]+}', [PortfolioController::class, 'deletePiece']);
        $g->post('/strategy/portfolio-pieces/{piece_id:[0-9]+}/link', [PortfolioController::class, 'linkResource']);
        $g->delete('/strategy/portfolio-captures/{capture_id:[0-9]+}', [PortfolioController::class, 'deleteCapture']);
        $g->get('/strategy/team/{team_season_id:[0-9]+}/portfolio/manifest.csv', [PortfolioController::class, 'manifestCsv']);
        $g->get('/strategy/team/{team_season_id:[0-9]+}/portfolio/content-pack', [PortfolioController::class, 'contentPack']);
        // Readiness (Phase 4)
        $g->get('/strategy/team/{team_season_id:[0-9]+}/readiness', [ReadinessController::class, 'readiness']);
        $g->get('/strategy/readiness/criteria', [ReadinessController::class, 'listCriteria']);
        $g->put('/strategy/readiness/criteria', [ReadinessController::class, 'saveCriteria']);

        // ── Planning (app/modules/planning, prefix /planning) ──
        $g->get('/planning/teams', [PlanningController::class, 'planningTeams']);
        $g->get('/planning/trc/members', [PlanningController::class, 'trcMembersList']);
        $g->get('/planning/trc/tasks', [PlanningController::class, 'listTrcTasks']);
        $g->post('/planning/trc/tasks', [PlanningController::class, 'createTrcTask']);
        $g->get('/planning/my-tasks', [PlanningController::class, 'listMyTasks']);
        $g->get('/planning/private-tasks', [PlanningController::class, 'listPrivateTasks']);
        $g->get('/planning/team/{team_season_id:[0-9]+}/members', [PlanningController::class, 'teamMembers']);
        $g->get('/planning/team/{team_season_id:[0-9]+}/plan', [PlanningController::class, 'getPlan']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/reschedule', [PlanningController::class, 'reschedule']);
        $g->get('/planning/team/{team_season_id:[0-9]+}/deadlines', [PlanningController::class, 'listDeadlines']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/deadlines', [PlanningController::class, 'createDeadline']);
        $g->delete('/planning/deadlines/{deadline_id:[0-9]+}', [PlanningController::class, 'deleteDeadline']);
        // Team Issue Log (#126)
        $g->get('/planning/team/{team_season_id:[0-9]+}/issues', [TeamIssuesController::class, 'list']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/issues', [TeamIssuesController::class, 'create']);
        $g->get('/planning/issues/{issue_id:[0-9]+}', [TeamIssuesController::class, 'get']);
        $g->patch('/planning/issues/{issue_id:[0-9]+}', [TeamIssuesController::class, 'update']);
        $g->delete('/planning/issues/{issue_id:[0-9]+}', [TeamIssuesController::class, 'delete']);
        $g->post('/planning/issues/{issue_id:[0-9]+}/comments', [TeamIssuesController::class, 'addComment']);
        // Team Member Roles (#127)
        $g->get('/planning/team/{team_season_id:[0-9]+}/roles', [TeamRolesController::class, 'list']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/roles', [TeamRolesController::class, 'create']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/roles/reorder', [TeamRolesController::class, 'reorder']);
        $g->patch('/planning/roles/{role_id:[0-9]+}', [TeamRolesController::class, 'update']);
        $g->delete('/planning/roles/{role_id:[0-9]+}', [TeamRolesController::class, 'delete']);

        // Wish List (#3.6)
        $g->get('/wishlist', [WishListController::class, 'list']);
        $g->post('/wishlist', [WishListController::class, 'create']);
        $g->patch('/wishlist/{wish_id:[0-9]+}', [WishListController::class, 'update']);
        $g->delete('/wishlist/{wish_id:[0-9]+}', [WishListController::class, 'delete']);
        $g->post('/wishlist/{wish_id:[0-9]+}/fulfill', [WishListController::class, 'fulfill']);
        $g->get('/wishlist/{wish_id:[0-9]+}/donations', [WishListController::class, 'donations']);
        $g->patch('/wishlist/donations/{donation_id:[0-9]+}', [WishListController::class, 'updateDonation']);
        $g->delete('/wishlist/donations/{donation_id:[0-9]+}', [WishListController::class, 'deleteDonation']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/categories', [PlanningController::class, 'createCategory']);
        $g->get('/planning/team/{team_season_id:[0-9]+}/tasks', [PlanningController::class, 'listTasks']);
        $g->post('/planning/team/{team_season_id:[0-9]+}/tasks', [PlanningController::class, 'createTask']);
        $g->patch('/planning/categories/{category_id:[0-9]+}', [PlanningController::class, 'updateCategory']);
        $g->delete('/planning/categories/{category_id:[0-9]+}', [PlanningController::class, 'deleteCategory']);
        $g->post('/planning/categories/{category_id:[0-9]+}/activities', [PlanningController::class, 'createActivity']);
        $g->patch('/planning/activities/{activity_id:[0-9]+}', [PlanningController::class, 'updateActivity']);
        $g->delete('/planning/activities/{activity_id:[0-9]+}', [PlanningController::class, 'deleteActivity']);
        $g->patch('/planning/tasks/{task_id:[0-9]+}', [PlanningController::class, 'editTask']);
        $g->post('/planning/tasks/{task_id:[0-9]+}/assign-team', [PlanningController::class, 'assignTeamTask']);
        $g->post('/planning/tasks/{task_id:[0-9]+}/claim', [PlanningController::class, 'claimTask']);
        $g->post('/planning/tasks/{task_id:[0-9]+}/complete', [PlanningController::class, 'completeTask']);
        $g->post('/planning/tasks/{task_id:[0-9]+}/reopen', [PlanningController::class, 'reopenTask']);
        $g->post('/planning/tasks/{task_id:[0-9]+}/progress', [PlanningController::class, 'addProgress']);
        $g->delete('/planning/tasks/progress/{update_id:[0-9]+}', [PlanningController::class, 'deleteProgress']);
        $g->delete('/planning/tasks/{task_id:[0-9]+}', [PlanningController::class, 'deleteTask']);
        $g->get('/planning/member/{member_id:[0-9]+}/assignments', [PlanningController::class, 'memberAssignments']);

        // ── Inventory base (app/modules/inventory/router.py, prefix /inventory) ──
        $g->get('/inventory/categories', [InventoryController::class, 'listCategories']);
        $g->post('/inventory/categories', [InventoryController::class, 'createCategory']);
        $g->get('/inventory/asset-categories', [InventoryController::class, 'listAssetCategories']);
        $g->post('/inventory/asset-categories', [InventoryController::class, 'createAssetCategory']);
        $g->patch('/inventory/asset-categories/{asset_category_id:[0-9]+}', [InventoryController::class, 'updateAssetCategory']);
        $g->delete('/inventory/asset-categories/{asset_category_id:[0-9]+}', [InventoryController::class, 'deleteAssetCategory']);
        $g->post('/inventory/categories/backfill', [InventoryController::class, 'backfillCategoryLinks']);
        // ── TRC social media links (#59) ──
        $g->get('/social/links', [SocialController::class, 'list']);
        $g->post('/social/links', [SocialController::class, 'add']);
        $g->put('/social/links/{index:[0-9]+}', [SocialController::class, 'update']);
        $g->delete('/social/links/{index:[0-9]+}', [SocialController::class, 'delete']);
        $g->post('/inventory/items/merge-team-clones', [InventoryController::class, 'mergeTeamClones']);
        $g->get('/inventory/categories/{category_id:[0-9]+}/vendors', [InventoryController::class, 'categoryVendors']);
        $g->patch('/inventory/categories/{category_id:[0-9]+}', [InventoryController::class, 'updateCategory']);
        $g->delete('/inventory/categories/{category_id:[0-9]+}', [InventoryController::class, 'deleteCategory']);
        $g->get('/inventory/vendors', [InventoryController::class, 'listVendors']);
        $g->post('/inventory/vendors', [InventoryController::class, 'createVendor']);
        $g->patch('/inventory/vendors/{vendor_id:[0-9]+}/toggle', [InventoryController::class, 'toggleVendor']);
        $g->patch('/inventory/vendors/{vendor_id:[0-9]+}', [InventoryController::class, 'updateVendor']);
        $g->delete('/inventory/vendors/{vendor_id:[0-9]+}', [InventoryController::class, 'deleteVendor']);
        $g->get('/inventory/locations', [InventoryController::class, 'listLocations']);
        $g->post('/inventory/locations', [InventoryController::class, 'createLocation']);
        $g->patch('/inventory/locations/{location_id:[0-9]+}', [InventoryController::class, 'updateLocation']);
        $g->delete('/inventory/locations/{location_id:[0-9]+}', [InventoryController::class, 'deactivateLocation']);
        $g->get('/inventory/locations/{location_id:[0-9]+}/contents', [InventoryController::class, 'locationContents']);
        $g->get('/inventory/category-names', [InventoryController::class, 'categoryNames']);
        $g->get('/inventory/summary', [InventoryController::class, 'summary']);
        $g->get('/inventory/items', [InventoryController::class, 'listItems']);
        $g->post('/inventory/items', [InventoryController::class, 'createItem']);
        $g->post('/inventory/items/bulk', [InventoryController::class, 'createItemsBulk']);
        $g->post('/inventory/items/import', [InventoryController::class, 'importItems']);
        $g->get('/inventory/items/lookup', [InventoryController::class, 'itemLookup']);
        $g->get('/inventory/items/by-tag/{asset_tag}', [InventoryController::class, 'itemByTag']);
        $g->get('/inventory/items/{item_id:[0-9]+}', [InventoryController::class, 'getItem']);
        $g->patch('/inventory/items/{item_id:[0-9]+}', [InventoryController::class, 'updateItem']);
        $g->post('/inventory/items/{item_id:[0-9]+}/move', [InventoryController::class, 'moveItem']);
        $g->post('/inventory/items/{item_id:[0-9]+}/transfer', [InventoryController::class, 'transferStock']);
        $g->put('/inventory/items/{item_id:[0-9]+}/location-bin', [InventoryController::class, 'setLocationBin']);
        $g->put('/inventory/items/{item_id:[0-9]+}/kit-components', [InventoryController::class, 'setKitComponents']);
        $g->put('/inventory/items/{item_id:[0-9]+}/sources', [InventoryController::class, 'setItemSources']);
        $g->post('/inventory/items/{item_id:[0-9]+}/photos', [InventoryController::class, 'addItemPhotos']);
        $g->put('/inventory/items/{item_id:[0-9]+}/photos/order', [InventoryController::class, 'reorderItemPhotos']);
        $g->patch('/inventory/photos/{photo_id:[0-9]+}', [InventoryController::class, 'updateItemPhoto']);
        $g->delete('/inventory/photos/{photo_id:[0-9]+}', [InventoryController::class, 'deleteItemPhoto']);
        $g->post('/inventory/items/{item_id:[0-9]+}/reactivate', [InventoryController::class, 'reactivateItem']);
        $g->delete('/inventory/items/{item_id:[0-9]+}/permanent', [InventoryController::class, 'deleteItemPermanent']);
        $g->delete('/inventory/items/{item_id:[0-9]+}', [InventoryController::class, 'retireItem']);

        // ── Inventory checkout + battery (inventory/checkout_router.py) ──
        $g->get('/inventory/my-checkouts', [InventoryCheckoutController::class, 'myCheckouts']);
        $g->get('/inventory/checkouts', [InventoryCheckoutController::class, 'listCheckouts']);
        $g->post('/inventory/checkouts', [InventoryCheckoutController::class, 'createCheckout']);
        $g->post('/inventory/checkouts/{checkout_id:[0-9]+}/request-extension', [InventoryCheckoutController::class, 'requestExtension']);
        $g->post('/inventory/checkouts/{checkout_id:[0-9]+}/extension/{decision:approve|deny}', [InventoryCheckoutController::class, 'decideExtension']);
        $g->patch('/inventory/checkouts/{checkout_id:[0-9]+}', [InventoryCheckoutController::class, 'updateCheckout']);
        $g->post('/inventory/checkouts/{checkout_id:[0-9]+}/approve', [InventoryCheckoutController::class, 'approveCheckout']);
        $g->post('/inventory/checkouts/{checkout_id:[0-9]+}/return', [InventoryCheckoutController::class, 'returnCheckout']);
        $g->post('/inventory/checkouts/{checkout_id:[0-9]+}/cancel', [InventoryCheckoutController::class, 'cancelCheckout']);
        $g->get('/inventory/items/{item_id:[0-9]+}/battery-tests', [InventoryCheckoutController::class, 'listBatteryTests']);
        $g->post('/inventory/items/{item_id:[0-9]+}/battery-tests', [InventoryCheckoutController::class, 'addBatteryTest']);

        // ── Inventory reports + season rollover (inventory/reports_router.py) ──
        $g->get('/inventory/reports/overview', [InventoryReportsController::class, 'overview']);
        $g->get('/inventory/reports/spend', [InventoryReportsController::class, 'spend']);
        $g->get('/inventory/reports/low-stock', [InventoryReportsController::class, 'lowStock']);
        $g->get('/inventory/reports/open-pos', [InventoryReportsController::class, 'openPos']);
        $g->get('/inventory/reports/backorders', [InventoryReportsController::class, 'backorders']);
        $g->get('/inventory/season-rollover/preview', [InventoryReportsController::class, 'rolloverPreview']);
        $g->post('/inventory/season-rollover', [InventoryReportsController::class, 'runRollover']);

        // ── Inventory purchasing: budgets, donations, shipping, BOMs (purchasing_router.py) ──
        $g->get('/inventory/teams/{team_season_id:[0-9]+}/budget', [PurchasingController::class, 'getBudget']);
        $g->get('/inventory/teams/{team_season_id:[0-9]+}/adhoc-expenses', [PurchasingController::class, 'listAdhoc']);
        $g->post('/inventory/teams/{team_season_id:[0-9]+}/adhoc-expenses', [PurchasingController::class, 'createAdhoc']);
        $g->delete('/inventory/adhoc-expenses/{expense_id:[0-9]+}', [PurchasingController::class, 'deleteAdhoc']);
        $g->post('/inventory/teams/{team_season_id:[0-9]+}/budget', [PurchasingController::class, 'createBudgetCategory']);
        $g->put('/inventory/teams/{team_season_id:[0-9]+}/carryover', [PurchasingController::class, 'setCarryover']);
        $g->patch('/inventory/budget/{category_id:[0-9]+}', [PurchasingController::class, 'updateBudgetCategory']);
        $g->delete('/inventory/budget/{category_id:[0-9]+}', [PurchasingController::class, 'deleteBudgetCategory']);
        $g->post('/inventory/budget/{category_id:[0-9]+}/donations', [PurchasingController::class, 'addDonation']);
        $g->patch('/inventory/donations/{donation_id:[0-9]+}', [PurchasingController::class, 'updateDonation']);
        $g->delete('/inventory/donations/{donation_id:[0-9]+}', [PurchasingController::class, 'deleteDonation']);
        $g->get('/inventory/shipping-addresses', [PurchasingController::class, 'listShippingAddresses']);
        $g->post('/inventory/shipping-addresses', [PurchasingController::class, 'addShippingAddress']);
        $g->put('/inventory/shipping-addresses/{index:[0-9]+}', [PurchasingController::class, 'updateShippingAddress']);
        $g->delete('/inventory/shipping-addresses/{index:[0-9]+}', [PurchasingController::class, 'deleteShippingAddress']);
        $g->get('/inventory/boms', [PurchasingController::class, 'listBoms']);
        $g->post('/inventory/boms', [PurchasingController::class, 'createBom']);
        $g->get('/inventory/boms/{bom_id:[0-9]+}', [PurchasingController::class, 'getBom']);
        $g->patch('/inventory/boms/{bom_id:[0-9]+}', [PurchasingController::class, 'updateBom']);
        $g->delete('/inventory/boms/{bom_id:[0-9]+}/permanent', [PurchasingController::class, 'deleteBomPermanent']);
        $g->delete('/inventory/boms/{bom_id:[0-9]+}', [PurchasingController::class, 'cancelBom']);
        $g->post('/inventory/boms/{bom_id:[0-9]+}/lines', [PurchasingController::class, 'addBomLine']);
        $g->patch('/inventory/boms/{bom_id:[0-9]+}/lines/{line_id:[0-9]+}', [PurchasingController::class, 'updateBomLine']);
        $g->delete('/inventory/boms/{bom_id:[0-9]+}/lines/{line_id:[0-9]+}', [PurchasingController::class, 'deleteBomLine']);
        $g->post('/inventory/boms/{bom_id:[0-9]+}/ready', [PurchasingController::class, 'markReady']);
        $g->post('/inventory/boms/{bom_id:[0-9]+}/recall', [PurchasingController::class, 'recallBom']);
        $g->post('/inventory/boms/{bom_id:[0-9]+}/reject', [PurchasingController::class, 'rejectBom']);
        $g->post('/inventory/boms/{bom_id:[0-9]+}/order', [PurchasingController::class, 'markOrdered']);

        // ── Inventory purchase orders + receiving (po_router.py) ──
        $g->get('/inventory/pos', [POController::class, 'listPos']);
        $g->post('/inventory/pos', [POController::class, 'createPo']);
        $g->get('/inventory/pos/{po_id:[0-9]+}/quickbooks.csv', [POController::class, 'quickbooksExport']);
        $g->get('/inventory/pos/{po_id:[0-9]+}', [POController::class, 'getPo']);
        $g->patch('/inventory/pos/{po_id:[0-9]+}', [POController::class, 'updatePo']);
        $g->post('/inventory/pos/{po_id:[0-9]+}/boms/{bom_id:[0-9]+}', [POController::class, 'addBomToPo']);
        $g->delete('/inventory/pos/{po_id:[0-9]+}/boms/{bom_id:[0-9]+}', [POController::class, 'removeBomFromPo']);
        $g->post('/inventory/pos/{po_id:[0-9]+}/fees', [POController::class, 'chargeFees']);
        $g->delete('/inventory/pos/{po_id:[0-9]+}/fees', [POController::class, 'clearFees']);
        $g->post('/inventory/pos/{po_id:[0-9]+}/submit', [POController::class, 'submitPo']);
        $g->post('/inventory/pos/{po_id:[0-9]+}/cancel', [POController::class, 'cancelPo']);
        $g->delete('/inventory/pos/{po_id:[0-9]+}/permanent', [POController::class, 'deletePoPermanent']);
        $g->post('/inventory/pos/{po_id:[0-9]+}/receive-all', [POController::class, 'receiveAll']);
        $g->post('/inventory/bom-lines/{line_id:[0-9]+}/receive', [POController::class, 'receiveLine']);
        $g->post('/inventory/bom-lines/{line_id:[0-9]+}/receive-split', [POController::class, 'receiveSplit']);

        // ── Admin console (app/modules/admin/router.py, prefix /admin) ──
        $g->get('/admin/security-settings', [AdminController::class, 'getSecuritySettings']);
        $g->put('/admin/security-settings', [AdminController::class, 'updateSecuritySettings']);
        $g->get('/admin/login-attempts', [AdminController::class, 'listLoginAttempts']);
        $g->get('/admin/stats', [AdminController::class, 'stats']);
        $g->get('/admin/permission-catalog', [AdminController::class, 'permissionCatalog']);
        $g->get('/admin/roles', [AdminController::class, 'listRoles']);
        $g->post('/admin/roles', [AdminController::class, 'createRole']);
        $g->get('/admin/roles/{role_id:[0-9]+}/permissions', [AdminController::class, 'getRolePermissions']);
        $g->put('/admin/roles/{role_id:[0-9]+}/permissions', [AdminController::class, 'setRolePermissions']);
        $g->get('/admin/roles/{role_id:[0-9]+}/members', [AdminController::class, 'getRoleMembers']);
        $g->patch('/admin/roles/{role_id:[0-9]+}/toggle', [AdminController::class, 'toggleRole']);
        $g->patch('/admin/roles/{role_id:[0-9]+}', [AdminController::class, 'updateRole']);
        $g->delete('/admin/roles/{role_id:[0-9]+}', [AdminController::class, 'deleteRole']);
        $g->get('/admin/members/{member_id:[0-9]+}/roles', [AdminController::class, 'getMemberRoles']);
        $g->post('/admin/members/assign-role', [AdminController::class, 'assignRole']);
        $g->get('/admin/members/merge-preview', [MergeController::class, 'preview']);
        $g->post('/admin/members/merge', [MergeController::class, 'execute']);
        $g->delete('/admin/members/{member_id:[0-9]+}/roles/{role_id:[0-9]+}', [AdminController::class, 'removeRole']);
        $g->post('/admin/members/{member_id:[0-9]+}/reset-password', [AdminController::class, 'resetPassword']);
        $g->post('/admin/impersonate', [AdminController::class, 'impersonate']);
        $g->get('/admin/programs', [AdminController::class, 'listPrograms']);
        $g->post('/admin/programs', [AdminController::class, 'createProgram']);
        $g->patch('/admin/programs/{program_id:[0-9]+}', [AdminController::class, 'updateProgram']);
        $g->get('/admin/audit-log', [AdminController::class, 'auditLog']);
        $g->get('/admin/profile-layout', [AdminController::class, 'getProfileLayout']);
        $g->put('/admin/profile-layout', [AdminController::class, 'setProfileLayout']);
        $g->get('/admin/team-pane-layout', [AdminController::class, 'getTeamPaneLayout']);
        $g->put('/admin/team-pane-layout', [AdminController::class, 'setTeamPaneLayout']);
        $g->get('/admin/stations', [AdminController::class, 'listStations']);
        $g->post('/admin/stations', [AdminController::class, 'createStation']);
        $g->post('/admin/stations/{station_id:[0-9]+}/password', [AdminController::class, 'resetStationPassword']);
        $g->patch('/admin/stations/{station_id:[0-9]+}', [AdminController::class, 'setStationActive']);
        $g->delete('/admin/stations/{station_id:[0-9]+}', [AdminController::class, 'deleteStation']);

        // ── Summer Camp — camps, campers, registrations (separate from members).
        //    Phase 1: season config + public-registration toggle, programs, sessions. ──
        $g->get('/camp/public/registration', [CampController::class, 'publicRegistration']);
        $g->post('/camp/public/register', [CampController::class, 'publicRegister']);
        $g->get('/camp/seasons', [CampController::class, 'listSeasons']);
        $g->get('/camp/seasons/current', [CampController::class, 'currentSeason']);
        $g->post('/camp/seasons', [CampController::class, 'saveSeason']);
        $g->patch('/camp/seasons/{season_id:[0-9]+}', [CampController::class, 'saveSeason']);
        $g->patch('/camp/seasons/{season_id:[0-9]+}/registration', [CampController::class, 'toggleRegistration']);
        $g->get('/camp/programs', [CampController::class, 'listPrograms']);
        $g->post('/camp/programs', [CampController::class, 'saveProgram']);
        $g->patch('/camp/programs/{program_id:[0-9]+}', [CampController::class, 'saveProgram']);
        $g->get('/camp/sessions', [CampController::class, 'listSessions']);
        $g->post('/camp/sessions', [CampController::class, 'saveSession']);
        $g->patch('/camp/sessions/{session_id:[0-9]+}', [CampController::class, 'saveSession']);
        $g->delete('/camp/sessions/{session_id:[0-9]+}', [CampController::class, 'deleteSession']);
        $g->get('/camp/sessions/{session_id:[0-9]+}/attendance', [CampController::class, 'getAttendance']);
        $g->get('/camp/registrations', [CampController::class, 'listRegistrations']);
        $g->get('/camp/email-recipients', [CampController::class, 'emailRecipients']);
        $g->post('/camp/registrations', [CampController::class, 'createRegistration']);
        $g->patch('/camp/registrations/{reg_id:[0-9]+}', [CampController::class, 'updateRegistration']);
        $g->post('/camp/attendance', [CampController::class, 'markAttendance']);
        $g->get('/camp/staffing', [CampController::class, 'getStaffing']);
        $g->post('/camp/staffing/assign', [CampController::class, 'assignWorker']);
        $g->post('/camp/campers/{camper_id:[0-9]+}/convert-to-member', [CampController::class, 'convertToMember']);
        $g->get('/camp/staff-apps', [CampController::class, 'listStaffApps']);
        $g->post('/camp/staff-apps', [CampController::class, 'saveStaffApp']);
        $g->patch('/camp/staff-apps/{app_id:[0-9]+}', [CampController::class, 'saveStaffApp']);
        $g->get('/camp/contacts', [CampController::class, 'listContacts']);
        $g->patch('/camp/contacts/{contact_id:[0-9]+}', [CampController::class, 'updateContact']);
        $g->get('/camp/contacts/export', [CampController::class, 'exportContacts']);
        $g->get('/camp/resources', [CampController::class, 'listResources']);
        $g->post('/camp/resources', [CampController::class, 'saveResource']);
        $g->patch('/camp/resources/{resource_id:[0-9]+}', [CampController::class, 'saveResource']);
        $g->delete('/camp/resources/{resource_id:[0-9]+}', [CampController::class, 'deleteResource']);
        $g->get('/camp/report', [CampController::class, 'report']);
        $g->post('/camp/import-contacts', [CampController::class, 'importContacts']);
        $g->post('/camp/import-staff', [CampController::class, 'importStaffApps']);

        // ── Scouting (#NN) — FTC competition scouting: pre-event prediction
        //    (ftcscout.org), pit/match/observation capture, offline sync, analysis. ──
        $g->get('/scouting/seasons', [ScoutingController::class, 'seasons']);
        $g->post('/scouting/seasons', [ScoutingController::class, 'saveSeason']);
        $g->get('/scouting/seasons/{season_id:[0-9]+}', [ScoutingController::class, 'getSeason']);

        $g->get('/scouting/events', [ScoutingController::class, 'listEvents']);
        $g->post('/scouting/events', [ScoutingController::class, 'createEvent']);
        $g->get('/scouting/events/{event_id:[0-9]+}', [ScoutingController::class, 'getEvent']);
        $g->patch('/scouting/events/{event_id:[0-9]+}', [ScoutingController::class, 'patchEvent']);
        $g->get('/scouting/events/{event_id:[0-9]+}/bundle', [ScoutingController::class, 'bundle']);
        $g->post('/scouting/events/{event_id:[0-9]+}/sync-preevent', [ScoutingController::class, 'syncPreEvent']);
        $g->post('/scouting/events/{event_id:[0-9]+}/sync-schedule', [ScoutingController::class, 'syncSchedule']);
        $g->post('/scouting/events/{event_id:[0-9]+}/sync-live', [ScoutingController::class, 'syncLive']);
        $g->get('/scouting/events/{event_id:[0-9]+}/board', [ScoutingController::class, 'preEventBoard']);
        $g->get('/scouting/events/{event_id:[0-9]+}/match-projections', [ScoutingController::class, 'matchProjections']);
        $g->get('/scouting/events/{event_id:[0-9]+}/pre-event-table', [ScoutingController::class, 'preEventTable']);
        $g->get('/scouting/events/{event_id:[0-9]+}/team-summaries', [ScoutingController::class, 'teamSummaries']);
        $g->get('/scouting/events/{event_id:[0-9]+}/team/{team_number:[0-9]+}/report', [ScoutingController::class, 'teamReport']);
        $g->delete('/scouting/events/{event_id:[0-9]+}', [ScoutingController::class, 'deleteEvent']);
        $g->post('/scouting/events/{event_id:[0-9]+}/matches/{match_num:[0-9]+}/reveal', [ScoutingController::class, 'revealMatch']);
        $g->get('/scouting/events/{event_id:[0-9]+}/reconcile', [ScoutingController::class, 'reconcile']);
        $g->get('/scouting/events/{event_id:[0-9]+}/live-performance', [ScoutingController::class, 'livePerformance']);
        $g->get('/scouting/events/{event_id:[0-9]+}/live-rankings', [ScoutingController::class, 'liveRankings']);
        $g->get('/scouting/events/{event_id:[0-9]+}/playoff-bracket', [ScoutingController::class, 'playoffBracket']);
        $g->get('/scouting/events/{event_id:[0-9]+}/alliance-model', [ScoutingController::class, 'allianceModel']);

        $g->get('/scouting/matches', [ScoutingController::class, 'listMatches']);
        $g->get('/scouting/matches/preview', [ScoutingController::class, 'matchPreview']);

        $g->patch('/scouting/events/{event_id:[0-9]+}/teams/{team_number:[0-9]+}/priority', [ScoutingController::class, 'setPriority']);
        $g->get('/scouting/events/{event_id:[0-9]+}/teams/{team_number:[0-9]+}/photos', [ScoutingController::class, 'listRobotPhotos']);
        $g->post('/scouting/events/{event_id:[0-9]+}/teams/{team_number:[0-9]+}/photos', [ScoutingController::class, 'uploadRobotPhoto']);
        $g->patch('/scouting/events/{event_id:[0-9]+}/teams/{team_number:[0-9]+}/photos/{photo_id:[0-9]+}/profile', [ScoutingController::class, 'setProfilePhoto']);
        $g->delete('/scouting/events/{event_id:[0-9]+}/teams/{team_number:[0-9]+}/photos/{photo_id:[0-9]+}', [ScoutingController::class, 'deleteRobotPhoto']);
        $g->post('/scouting/events/{event_id:[0-9]+}/watchlist', [ScoutingController::class, 'saveWatchlist']);
        $g->get('/scouting/pit-reports', [ScoutingController::class, 'listPit']);
        $g->post('/scouting/pit-reports', [ScoutingController::class, 'createPit']);
        $g->patch('/scouting/pit-reports/{report_id:[0-9]+}/ignore', [ScoutingController::class, 'setPitIgnore']);

        $g->get('/scouting/match-records', [ScoutingController::class, 'listMatchRecords']);
        $g->post('/scouting/match-records', [ScoutingController::class, 'upsertMatchRecord']);
        $g->patch('/scouting/match-records/{record_id:[0-9]+}/ignore', [ScoutingController::class, 'setMatchIgnore']);

        $g->get('/scouting/observations', [ScoutingController::class, 'listObservations']);
        $g->post('/scouting/observations', [ScoutingController::class, 'createObservation']);

        $g->post('/scouting/sync', [ScoutingController::class, 'syncBatch']);

        // TODO: port remaining modules here, one at a time, verifying JSON parity
        // against the running Python API (visitors, enrollment, checkin, events,
        // teams, roles, reports, admin, inventory, shopping, certifications,
        // planning, activity, resources, …).
    });

    // Org-wide module enable/disable: 404 a disabled optional module's API.
    $apiGroup->add(new \App\Core\ModuleGuard());
};
