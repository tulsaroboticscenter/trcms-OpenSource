/**
 * FIRST Development Program (FDP) — every youth in FTC/FRC starts here and stays
 * until they graduate. No fee, so it's tracked separately from enrollments.
 */
import FdpRoster from "./pages/FdpRoster";

export { default as FdpPanel } from "./components/FdpPanel";
export { default as TeamInterviewsPanel } from "./components/TeamInterviewsPanel";
export { default as FdpWorkPanel } from "./components/FdpWorkPanel";
export * from "./api";

export const fdpModule = {
  id: "fdp",
  routes: [
    { path: "/fdp", element: FdpRoster },
  ] satisfies { path: string; element: React.ComponentType }[],
  // Gated on fdp.manage, which defaults to 'none' and is granted to Admin, Mentor
  // and System Administrator — so exactly the people who run the program see it.
  // Before this the roster had no link anywhere and could only be reached by typing
  // the URL.
  navItem: {
    label: "Dev Program",
    to: "/fdp",
    iconName: "Target",
    requiredRoles: [] as string[],
    requiredPermission: "fdp.manage",
  },
  dashboardTile: {
    label: "Dev Program",
    to: "/fdp",
    iconName: "Target",
    color: "#00695c",
    description: "FIRST Development Program roster, progress, board of review and interviews.",
    requiredRoles: [] as string[],
    requiredPermission: "fdp.manage",
  },
};
