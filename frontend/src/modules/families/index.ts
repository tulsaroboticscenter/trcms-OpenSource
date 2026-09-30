/**
 * Families Module
 * ===============
 * Associates members into family groups — parents, youth, siblings, spouses, etc.
 * Families are accessed entirely through the Member Profile panel.
 * No standalone route is needed.
 */
export { default as FamilyPanel } from "./components/FamilyPanel";

export const familiesModule = {
  id: "families",
  routes: [],          // no standalone routes — accessed via Member Profile
  navItem: null,
  dashboardTile: null,
};
