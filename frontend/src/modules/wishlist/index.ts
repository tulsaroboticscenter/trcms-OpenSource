/**
 * Wish List Module
 * ================
 * TRC-wide and per-team wish lists. Each wish links to an external vendor page,
 * carries a price, quantity, and priority. When a donation arrives, "Fulfill"
 * records the donor (member / sponsor / free-form name) and, for asset wishes,
 * can spawn a tracked inventory asset that carries the donation for the life of
 * the asset.
 */
import WishListPage from "./pages/WishListPage";

export const wishlistModule = {
  id: "wishlist",

  routes: [
    { path: "/wishlist", element: WishListPage },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Wish List",
    to: "/wishlist",
    iconName: "Gift",
    requiredRoles: ["Admin", "System Administrator", "Mentor", "Executive Director", "Team Leader"] as string[],
  },

  dashboardTile: {
    label: "Wish List",
    to: "/wishlist",
    iconName: "Gift",
    color: "#6a1b9a",
    description: "Things TRC and teams would like — link items, set priority, track donations.",
    requiredRoles: ["Admin", "System Administrator", "Mentor", "Executive Director", "Team Leader"] as string[],
  },
};
