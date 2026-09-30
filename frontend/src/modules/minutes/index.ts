/**
 * Meeting Minutes Module (3.0) — #107
 * Built for the YLC: record meeting minutes and interactive action items that,
 * when assigned to a member, are mirrored into the Tasks module.
 */
import MinutesList from "./pages/MinutesList";
import MeetingDetail from "./pages/MeetingDetail";

export const minutesModule = {
  id: "minutes",
  routes: [
    { path: "/minutes", element: MinutesList },
    { path: "/minutes/:id", element: MeetingDetail },
  ] satisfies { path: string; element: React.ComponentType }[],
  navItem: null,        // reached from a group's page, not the main sidebar
  dashboardTile: null,
};
