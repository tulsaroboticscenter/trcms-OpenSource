/**
 * Visitors Module
 * ===============
 * Public kiosk for visitor intake + admin lifecycle management.
 *
 * Routes:
 *   /checkin/visitor   — public kiosk (no auth), supports multi-youth entry
 *   /join/:token       — public self-signup from an emailed follow-up link
 *   /visitors          — admin list with lifecycle status filter and stats
 *   /visitors/:id      — visitor detail, status transitions, convert to member
 */
import VisitorCheckin from "./pages/VisitorCheckin";
import VisitorList from "./pages/VisitorList";
import VisitorDetail from "./pages/VisitorDetail";
import WaitlistPage from "./pages/WaitlistPage";
import SchoolsList from "./pages/SchoolsList";
import SchoolDetail from "./pages/SchoolDetail";
import RecruitingAnalytics from "./pages/RecruitingAnalytics";
import MentorProspects from "./pages/MentorProspects";
import RecruitImport from "./pages/RecruitImport";
import VisitorDuplicates from "./pages/VisitorDuplicates";
import JoinPage from "./pages/JoinPage";

export const visitorsModule = {
  id: "visitors",

  routes: [
    { path: "/checkin/visitor", element: VisitorCheckin, public: true },
    // Tokenised join link from a follow-up email — no login.
    { path: "/join/:token",     element: JoinPage, public: true },
    { path: "/visitors",        element: VisitorList },
    { path: "/visitors/waitlist", element: WaitlistPage },
    { path: "/visitors/schools", element: SchoolsList },
    { path: "/visitors/schools/:id", element: SchoolDetail },
    { path: "/visitors/analytics", element: RecruitingAnalytics },
    { path: "/visitors/mentors", element: MentorProspects },
    { path: "/visitors/import", element: RecruitImport },
    { path: "/visitors/duplicates", element: VisitorDuplicates },
    { path: "/visitors/:id",    element: VisitorDetail },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],

  navItem: {
    label: "Visitors",
    to: "/visitors",
    iconName: "UserCheck",
    requiredRoles: ["Admin", "System Administrator", "Mentor"],
  },

  dashboardTile: {
    label: "Visitor Check-In",
    to: "/checkin/visitor",
    iconName: "UserCheck",
    color: "#2e7d32",
    description: "Kiosk for new visitor intake",
    requiredRoles: [],
  },
};
