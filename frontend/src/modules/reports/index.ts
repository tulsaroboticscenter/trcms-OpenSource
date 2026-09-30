/**
 * Reports Module
 * ==============
 * Canned reports with CSV export, plus CSV import tool for bulk member loading.
 *
 * Routes:
 *   /reports                   — dashboard listing all available reports
 *   /reports/member-directory  — member directory with filters and CSV export
 *   /reports/team-list         — per-team rosters by season with CSV export
 *   /reports/enrollment-status — payment & T&C status for enrollment year
 *   /reports/attendance        — check-in counts and hours by member + date range
 *   /reports/import            — bulk member import from CSV
 */
import ReportsDashboard from "./pages/ReportsDashboard";
import ActiveMembersReport from "./pages/ActiveMembersReport";
import CertificationsByMemberReport from "./pages/CertificationsByMemberReport";
import YouthByGradeReport from "./pages/YouthByGradeReport";
import CertificationHoldersReport from "./pages/CertificationHoldersReport";
import MemberDirectoryReport from "./pages/MemberDirectoryReport";
import TeamListReport from "./pages/TeamListReport";
import EnrollmentReport from "./pages/EnrollmentReport";
import AttendanceReport from "./pages/AttendanceReport";
import NotAttendingReport from "./pages/NotAttendingReport";
import ActivityImpactReport from "./pages/ActivityImpactReport";
import PermissionsReport from "./pages/PermissionsReport";
import TrendsReport from "./pages/TrendsReport";
import RetentionReport from "./pages/RetentionReport";
import UsageReport from "./pages/UsageReport";
import ReportBuilder from "./pages/ReportBuilder";
import ReportAccessMatrix from "./pages/ReportAccessMatrix";
import ClassroomEmailReadinessReport from "./pages/ClassroomEmailReadinessReport";
import SpecialNotesReport from "./pages/SpecialNotesReport";
import EmployerMatchingReport from "./pages/EmployerMatchingReport";

export const reportsModule = {
  id: "reports",

  routes: [
    { path: "/reports",                    element: ReportsDashboard },
    { path: "/reports/active-members",     element: ActiveMembersReport },
    { path: "/reports/certifications-by-member", element: CertificationsByMemberReport },
    { path: "/reports/youth-by-grade",     element: YouthByGradeReport },
    { path: "/reports/certification-holders", element: CertificationHoldersReport },
    { path: "/reports/member-directory",   element: MemberDirectoryReport },
    { path: "/reports/team-list",          element: TeamListReport },
    { path: "/reports/enrollment-status",  element: EnrollmentReport },
    { path: "/reports/special-notes",      element: SpecialNotesReport },
    { path: "/reports/employer-matching",  element: EmployerMatchingReport },
    { path: "/reports/attendance",         element: AttendanceReport },
    { path: "/reports/not-attending",      element: NotAttendingReport },
    { path: "/reports/activity-impact",    element: ActivityImpactReport },
    { path: "/reports/trends",             element: TrendsReport },
    { path: "/reports/retention",          element: RetentionReport },
    { path: "/reports/usage",              element: UsageReport },
    { path: "/reports/builder",            element: ReportBuilder },
    { path: "/reports/report-access",      element: ReportAccessMatrix },
    { path: "/reports/classroom-email-readiness", element: ClassroomEmailReadinessReport },
    { path: "/reports/permissions",        element: PermissionsReport },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Reports",
    to: "/reports",
    iconName: "BarChart2",
    // Visibility is governed by Role Permissions: the "reports" module resolves
    // from the reports.view grant (default none, seeded for Admin + Mentor), so
    // admins control who sees Reports per role in Admin -> Role Permissions.
    requiredRoles: [] as string[],
  },

  dashboardTile: null,   // accessible via nav, not a primary dashboard tile
};
