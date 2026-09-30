/**
 * Groups Module (3.0) — reusable member groups (YLC, committees, crews).
 * A group has members and can be tied to events; a group's upcoming events show
 * on its page and on each member's dashboard.
 */
import GroupsList from "./pages/GroupsList";
import GroupDetail from "./pages/GroupDetail";

export const groupsModule = {
  id: "groups",
  routes: [
    { path: "/groups", element: GroupsList },
    { path: "/groups/:id", element: GroupDetail },
  ] satisfies { path: string; element: React.ComponentType }[],
  navItem: null,        // reached from the Admin console, not the main sidebar
  dashboardTile: null,
};
