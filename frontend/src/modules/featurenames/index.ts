/**
 * Feature Names Module
 * ====================
 * A single in-app page (/feature-names) listing the nicknames the program gives new TRCMS
 * features, with the profile photo of the member each is named after. Visible to any
 * signed-in member; the list is served by FeatureNamesController.
 */
import FeatureNames from "./pages/FeatureNames";

export const featureNamesModule = {
  id: "feature_names",

  routes: [
    { path: "/feature-names", element: FeatureNames },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Feature Names",
    to: "/feature-names",
    iconName: "Sparkles",
    requiredRoles: [] as string[],
  },

  dashboardTile: null,
};
