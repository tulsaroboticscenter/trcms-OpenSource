/**
 * Roles Module
 * ============
 * Youth Leadership Council management and mentor compliance tracking.
 *
 * Also exports panel components that are embedded in MemberProfile:
 *   YouthRolePanel  — YLC status for youth members
 *   AdultRolePanel  — YPT/background compliance + expertise for mentors
 *
 * Routes:
 *   /roles/ylc          — YLC roster by term (admin/mentor)
 *   /roles/compliance   — mentor YPT & background check dashboard (admin only)
 */
export { default as YouthRolePanel } from "./components/YouthRolePanel";
export { default as AdultRolePanel } from "./components/AdultRolePanel";

import YLCManagement from "./pages/YLCManagement";
import MentorCompliance from "./pages/MentorCompliance";

export const rolesModule = {
  id: "roles",

  routes: [
    { path: "/roles/ylc",        element: YLCManagement },
    { path: "/roles/compliance", element: MentorCompliance },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: null,          // accessible via Admin menu, not main nav
  dashboardTile: null,    // not a dashboard tile — internal admin tool
};
