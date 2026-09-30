/**
 * Admin Console Module
 * ====================
 * System configuration, RBAC management, and operational controls.
 * All routes require Admin or System Administrator role.
 *
 * Routes:
 *   /admin                 — dashboard with system stats
 *   /admin/roles           — RBAC role management + member assignment
 *   /admin/programs        — program add/edit/deactivate
 *   /admin/impersonate     — test RBAC as any role
 *   /admin/reset-password  — reset any member's password
 */
import AdminDashboard from "./pages/AdminDashboard";
import VersionHistory from "./pages/VersionHistory";
import RoleManager from "./pages/RoleManager";
import ProgramManager from "./pages/ProgramManager";
import ImpersonateRole from "./pages/ImpersonateRole";
import PasswordReset from "./pages/PasswordReset";
import AuditLog from "./pages/AuditLog";
import ConfigOptions from "./pages/ConfigOptions";
import ShippingAddresses from "./pages/ShippingAddresses";
import SecuritySettings from "./pages/SecuritySettings";
import EmailSettings from "./pages/EmailSettings";
import PaymentSettings from "./pages/PaymentSettings";
import HelpAdmin from "../help/HelpAdmin";
import TourAdmin from "../help/TourAdmin";
import HolidaysAdmin from "../events/pages/HolidaysAdmin";
import GitHubSettings from "./pages/GitHubSettings";
import StationManager from "./pages/StationManager";
import SeasonTransitionChecklist from "./pages/SeasonTransitionChecklist";
import ResourceTypesManager from "../resources/pages/ResourceTypesManager";
import SocialLinksManager from "../social/pages/SocialLinksManager";
import SystemBackups from "./pages/SystemBackups";
import NavLayoutEditor from "./pages/NavLayoutEditor";
import ModuleManager from "./pages/ModuleManager";
import ComplianceSettings from "./pages/ComplianceSettings";
import ScholarshipFunds from "../sponsors/pages/ScholarshipFunds";
import ScholarshipBoardReport from "../sponsors/pages/ScholarshipBoardReport";
import ScholarshipReview from "../sponsors/pages/ScholarshipReview";

export const adminModule = {
  id: "admin",

  routes: [
    { path: "/admin",                element: AdminDashboard },
    { path: "/admin/version-history", element: VersionHistory },
    { path: "/admin/roles",          element: RoleManager },
    { path: "/admin/programs",       element: ProgramManager },
    { path: "/admin/impersonate",    element: ImpersonateRole },
    { path: "/admin/reset-password", element: PasswordReset },
    { path: "/admin/audit-log",      element: AuditLog },
    { path: "/admin/config",         element: ConfigOptions },
    { path: "/admin/shipping",       element: ShippingAddresses },
    { path: "/admin/security",       element: SecuritySettings },
    { path: "/admin/email",          element: EmailSettings },
    { path: "/admin/payments",       element: PaymentSettings },
    { path: "/admin/help",           element: HelpAdmin },
    { path: "/admin/tours",          element: TourAdmin },
    { path: "/admin/holidays",       element: HolidaysAdmin },
    { path: "/admin/github",         element: GitHubSettings },
    { path: "/admin/stations",       element: StationManager },
    { path: "/admin/season-transition", element: SeasonTransitionChecklist },
    { path: "/admin/resource-types", element: ResourceTypesManager },
    { path: "/admin/social",         element: SocialLinksManager },
    { path: "/admin/backups",        element: SystemBackups },
    { path: "/admin/sidebar",        element: NavLayoutEditor },
    { path: "/admin/modules",        element: ModuleManager },
    { path: "/admin/compliance",     element: ComplianceSettings },
    { path: "/admin/scholarship-funds", element: ScholarshipFunds },
    { path: "/admin/scholarship-funds/board-report", element: ScholarshipBoardReport },
    { path: "/admin/scholarship-applications", element: ScholarshipReview },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: null,       // Admin link is hard-coded in Layout (always last, admins only)
  dashboardTile: null, // accessed via sidebar, not the dashboard grid
};
