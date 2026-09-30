/**
 * Certification Program Module
 * ===========================
 *   /certifications — the catalog (sections, levels, status, earned counts).
 * A per-member certifications pane is embedded on the Member Profile.
 */
import CertificationCatalog from "./pages/CertificationCatalog";
import CertificationLeaderboard from "./pages/CertificationLeaderboard";
import BadgeManager from "./pages/BadgeManager";
import ToolClearances from "./pages/ToolClearances";
import CertQuizBuilder from "./pages/CertQuizBuilder";
import CertQuizTake from "./pages/CertQuizTake";
import CertQuizGradebook from "./pages/CertQuizGradebook";

export { default as MemberCertificationsPanel } from "./components/MemberCertificationsPanel";
export { default as TeamCertScorePanel } from "./components/TeamCertScorePanel";

export const certificationsModule = {
  id: "certifications",

  routes: [
    { path: "/certifications", element: CertificationCatalog },
    { path: "/certifications/leaderboard", element: CertificationLeaderboard },
    { path: "/certifications/badges", element: BadgeManager },
    { path: "/certifications/clearances", element: ToolClearances },
    // Quiz builder (Certification Quiz Engine) — reached from a cert row; gated in-page.
    { path: "/certifications/:certId/quiz", element: CertQuizBuilder },
    { path: "/certifications/:certId/quiz/take", element: CertQuizTake },
    { path: "/certifications/:certId/quiz/attempts", element: CertQuizGradebook },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Certifications",
    to: "/certifications",
    iconName: "Award",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "Certifications",
    to: "/certifications",
    iconName: "Award",
    color: "#6a1b9a",
    description: "Skill certifications, levels, and progress.",
    requiredRoles: [] as string[],
  },
};
