/**
 * Team Financials Module (feedback #89)
 * =====================================
 * Imports QuickBooks report exports and rolls the actuals up per team, shown
 * alongside the budgets TRCMS already tracks. Gated by finance.view (see) and
 * finance.manage (import + map). Reached from the sidebar "Financials" item.
 */
import FinancePage from "./pages/FinancePage";

export const financeModule = {
  id: "finance",

  routes: [
    { path: "/finance", element: FinancePage },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Financials",
    to: "/finance",
    iconName: "DollarSign",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "Team Financials",
    to: "/finance",
    iconName: "DollarSign",
    color: "#2e7d32",
    description: "QuickBooks actuals rolled up per team.",
    requiredRoles: [] as string[],
  },
};
