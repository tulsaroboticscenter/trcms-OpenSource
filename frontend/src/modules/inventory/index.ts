import InventoryCatalog from "./pages/InventoryCatalog";
import InventoryDashboard from "./pages/InventoryDashboard";
import ItemForm from "./pages/ItemForm";
import ItemDetail from "./pages/ItemDetail";
import VendorsManager from "./pages/VendorsManager";
import LocationsManager from "./pages/LocationsManager";
import WhereReport from "./pages/WhereReport";
import BomQueue from "./pages/BomQueue";
import BomCreate from "./pages/BomCreate";
import BomDetail from "./pages/BomDetail";
import BudgetsPage from "./pages/BudgetsPage";
import PoQueue from "./pages/PoQueue";
import PoDetail from "./pages/PoDetail";
import CheckoutsPage from "./pages/CheckoutsPage";
import ReportsPage from "./pages/ReportsPage";
import InventoryImport from "./pages/InventoryImport";
import LabelSheet from "./pages/LabelSheet";

export const inventoryModule = {
  id: "inventory",

  routes: [
    { path: "/inventory",                element: InventoryCatalog },
    { path: "/inventory/all",            element: InventoryDashboard },
    { path: "/inventory/labels",         element: LabelSheet },
    { path: "/inventory/import",         element: InventoryImport },
    { path: "/inventory/items/new",      element: ItemForm },
    { path: "/inventory/items/:id/edit", element: ItemForm },
    { path: "/inventory/items/:id",      element: ItemDetail },
    { path: "/inventory/vendors",        element: VendorsManager },
    { path: "/inventory/locations",      element: LocationsManager },
    { path: "/inventory/where",          element: WhereReport },
    { path: "/inventory/boms",           element: BomQueue },
    { path: "/inventory/boms/new",       element: BomCreate },
    { path: "/inventory/boms/:id",       element: BomDetail },
    { path: "/inventory/budgets",        element: BudgetsPage },
    { path: "/inventory/pos",            element: PoQueue },
    { path: "/inventory/pos/:id",        element: PoDetail },
    { path: "/inventory/checkouts",      element: CheckoutsPage },
    { path: "/inventory/reports",        element: ReportsPage },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Inventory",
    to: "/inventory",
    iconName: "Package",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "Inventory",
    to: "/inventory",
    iconName: "Package",
    color: "#00695c",
    description: "Assets, parts, consumables, and batteries",
    requiredRoles: [] as string[],
  },
};
