/**
 * Shopping List Module
 * ====================
 * A shared list of things members need bought on a store run.
 *   /shopping — the list (add, claim, "got it"), filterable by store.
 */
import ShoppingList from "./pages/ShoppingList";

export const shoppingModule = {
  id: "shopping",

  routes: [
    { path: "/shopping", element: ShoppingList },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Shopping List",
    to: "/shopping",
    iconName: "ShoppingCart",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "Shopping List",
    to: "/shopping",
    iconName: "ShoppingCart",
    color: "#e65100",
    description: "Add things we need; check off what you buy.",
    requiredRoles: [] as string[],
  },
};
