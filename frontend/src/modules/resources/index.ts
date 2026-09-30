/**
 * Resource Tracking Module
 * ========================
 *   /resources — TRC-wide resources (gated by resources.trc).
 * Team resources are embedded as a pane on the Team profile.
 * Resource types are managed in the admin console.
 */
import TRCResourcesPage from "./pages/TRCResourcesPage";

export { default as TeamResourcesPanel } from "./components/TeamResourcesPanel";

export const resourcesModule = {
  id: "resources",

  routes: [
    { path: "/resources", element: TRCResourcesPage },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Resources",
    to: "/resources",
    iconName: "Boxes",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "TRC Resources",
    to: "/resources",
    iconName: "Boxes",
    color: "#5d4037",
    description: "Shared tools, drives, documents, and links. Request access.",
    requiredRoles: [] as string[],
  },
};
