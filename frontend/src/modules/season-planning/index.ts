/**
 * FLL Season Planning module (Phase 1).
 * - Public tokenized family availability form (no login).
 * - Admin: night capacity, send availability emails, track responses.
 */
import SeasonAvailabilityForm from "./pages/SeasonAvailabilityForm";
import SeasonPlanningAdmin from "./pages/SeasonPlanningAdmin";
import SeasonPlanningBoard from "./pages/SeasonPlanningBoard";
import SeasonPlanningPreferences from "./pages/SeasonPlanningPreferences";

export const seasonPlanningModule = {
  id: "season-planning",
  routes: [
    { path: "/season-availability/:token", element: SeasonAvailabilityForm, public: true },
    { path: "/season-planning",            element: SeasonPlanningAdmin },
    { path: "/season-planning/preferences", element: SeasonPlanningPreferences },
    { path: "/season-planning/board",      element: SeasonPlanningBoard },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],
  navItem: null,
  dashboardTile: null,
};
