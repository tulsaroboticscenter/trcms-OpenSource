/**
 * Team Season Planning Module
 * ===========================
 *   /team-tasks            — the Team Task board (kiosk-friendly; team picker)
 *   /team-tasks/:id        — a specific team's task board
 * The Season Plan is embedded on the Team profile; the "My Activities" pane is
 * embedded on the Dashboard and Member profile.
 */
import TeamTaskBoard from "./pages/TeamTaskBoard";

export { default as SeasonPlanPanel } from "./components/SeasonPlanPanel";
export { default as MyActivitiesPanel } from "./components/MyActivitiesPanel";
export { default as MyPrivateTasksPanel } from "./components/MyPrivateTasksPanel";
export { default as TeamIssuesPanel } from "./components/TeamIssuesPanel";
export { default as TeamRolesPanel } from "./components/TeamRolesPanel";

export const planningModule = {
  id: "planning",

  routes: [
    { path: "/team-tasks", element: TeamTaskBoard },
    { path: "/team-tasks/:teamSeasonId", element: TeamTaskBoard },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "TRC/Team Tasks",
    to: "/team-tasks",
    iconName: "ListChecks",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "TRC/Team Tasks",
    to: "/team-tasks",
    iconName: "ListChecks",
    color: "#00838f",
    description: "Quick task board for TRC and each team — claim and complete tasks.",
    requiredRoles: [] as string[],
  },
};
