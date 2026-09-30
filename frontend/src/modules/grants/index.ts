/**
 * Grant Tracking Module
 * =====================
 * Track grant opportunities, per-team eligibility/submission/award, correspondence,
 * custom fields, reminders, and reporting. Awards roll into each team's budget as a
 * fundraising "Grants" line that turns green when received.
 */
import GrantsList from "./pages/GrantsList";
import GrantForm from "./pages/GrantForm";
import GrantDetail from "./pages/GrantDetail";
import GrantReports from "./pages/GrantReports";

export const grantsModule = {
  id: "grants",

  routes: [
    { path: "/grants",          element: GrantsList   },
    { path: "/grants/new",      element: GrantForm    },
    { path: "/grants/reports",  element: GrantReports },
    { path: "/grants/:id",      element: GrantDetail  },
    { path: "/grants/:id/edit", element: GrantForm    },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Grants",
    to: "/grants",
    iconName: "DollarSign",
    requiredRoles: ["Admin", "System Administrator", "Mentor"] as string[],
  },

  dashboardTile: {
    label: "Grant Tracking",
    to: "/grants",
    iconName: "DollarSign",
    color: "#00695c",
    description: "Track grant opportunities, submissions, and awards.",
    requiredRoles: ["Admin", "System Administrator", "Mentor"] as string[],
  },
};
