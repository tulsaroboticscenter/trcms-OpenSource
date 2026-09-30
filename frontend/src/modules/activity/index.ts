/**
 * Activity / Time Logging Module
 * ==============================
 *   /my-time — log and review my time; categorize check-in sessions.
 * A team time-impact panel is embedded on the Team profile.
 */
import MyTimePage from "./pages/MyTimePage";

export { default as TeamTimeImpactPanel } from "./components/TeamTimeImpactPanel";
export { default as LogTimeModal } from "./components/LogTimeModal";
export { default as MyTimeWeekPanel } from "./components/MyTimeWeekPanel";

export const activityModule = {
  id: "activity",

  routes: [
    { path: "/my-time", element: MyTimePage },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "My Time",
    to: "/my-time",
    iconName: "Clock",
    requiredRoles: [] as string[],
    // Visible by default (every real role is seeded read on activity.my_time); an admin
    // can turn it off for a role — e.g. Volunteer — in Role Management.
    requiredPermission: "activity.my_time",
  },

  dashboardTile: {
    label: "My Time",
    to: "/my-time",
    iconName: "Clock",
    color: "#ff8f00",
    description: "Log your time on the robot, portfolio, outreach, and more.",
    requiredRoles: [] as string[],
    requiredPermission: "activity.my_time",
  },
};
