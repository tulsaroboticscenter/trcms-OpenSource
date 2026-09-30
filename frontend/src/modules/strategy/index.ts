/**
 * Season Strategy module (Phase 1 Goals + Phase 2 Portfolio).
 *   /goals — cross-team Season Goals overview.
 *   /portfolio — cross-team Inspire/Impact portfolio tracker.
 * Per-team Goals and Portfolio panes are embedded on the team-season page (TeamProfile).
 * Readiness is a later phase.
 */
import GoalsOverview from "./pages/GoalsOverview";
import PortfolioOverview from "./pages/PortfolioOverview";

export { default as TeamGoalsPanel } from "./components/TeamGoalsPanel";
export { default as TeamPortfolioPanel } from "./components/TeamPortfolioPanel";
export { default as TeamReadinessPanel } from "./components/TeamReadinessPanel";

export const strategyModule = {
  id: "strategy",

  routes: [
    { path: "/goals", element: GoalsOverview },
    { path: "/portfolio", element: PortfolioOverview },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Season Goals",
    to: "/goals",
    iconName: "Target",
    requiredRoles: [] as string[],
    requiredPermission: "goals.view",   // hidden unless the role has View Season Goals
  },

  dashboardTile: {
    label: "Season Goals",
    to: "/goals",
    iconName: "Target",
    color: "#00695c",
    description: "Measurable team goals, owners, and progress.",
    requiredRoles: [] as string[],
    requiredPermission: "goals.view",
  },
};
