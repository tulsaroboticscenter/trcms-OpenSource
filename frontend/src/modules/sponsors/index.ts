/**
 * Sponsors Module (2.0, Phase 1)
 * ==============================
 * Program vs. Team sponsors with a team-scoped outreach guardrail: everyone can
 * view; only members of an owning team may contact a team sponsor. Contributions
 * post to team/program fundraising budgets. Directory, profile, and management.
 */
import SponsorsList from "./pages/SponsorsList";
import SponsorForm from "./pages/SponsorForm";
import SponsorDetail from "./pages/SponsorDetail";
import SponsorReports from "./pages/SponsorReports";
import SponsorWall from "./pages/SponsorWall";
import ScholarshipApply from "./pages/ScholarshipApply";

export const sponsorsModule = {
  id: "sponsors",

  routes: [
    { path: "/sponsors",          element: SponsorsList   },
    { path: "/sponsors/reports",  element: SponsorReports },
    { path: "/sponsors/wall",     element: SponsorWall    },
    { path: "/scholarship/apply", element: ScholarshipApply },
    { path: "/sponsors/new",      element: SponsorForm    },
    { path: "/sponsors/:id",      element: SponsorDetail },
    { path: "/sponsors/:id/edit", element: SponsorForm   },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Sponsors",
    to: "/sponsors",
    iconName: "Handshake",
    requiredRoles: [] as string[], // visible to all; module permission governs
  },

  dashboardTile: {
    label: "Sponsors",
    to: "/sponsors",
    iconName: "Handshake",
    color: "#00796b",
    description: "Program & team sponsors, contributions, and outreach.",
    requiredRoles: [] as string[],
  },
};
