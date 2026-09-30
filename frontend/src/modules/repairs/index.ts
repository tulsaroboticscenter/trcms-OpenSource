/**
 * Repair / Maintenance Ticket Module (feedback #90)
 * =================================================
 * Members report broken equipment; a coordinator (repairs.manage) assigns a
 * fixer and walks each ticket through the maintenance workflow
 * (Pending → In Progress → Waiting for Parts → Testing → Complete). Tickets can
 * link to a tracked inventory asset so the repair history follows the item.
 */
import RepairsList from "./pages/RepairsList";
import RepairForm from "./pages/RepairForm";
import RepairDetail from "./pages/RepairDetail";

export const repairsModule = {
  id: "repairs",

  routes: [
    { path: "/repairs",      element: RepairsList  },
    { path: "/repairs/new",  element: RepairForm   },
    { path: "/repairs/:id",  element: RepairDetail },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Repairs",
    to: "/repairs",
    iconName: "Wrench",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "Repair & Maintenance",
    to: "/repairs",
    iconName: "Wrench",
    color: "#b45309",
    description: "Report broken equipment and track repairs through to completion.",
    requiredRoles: [] as string[],
  },
};
