/**
 * Seasons Module
 * ==============
 * FIRST season definitions and per-member participation tracking.
 * Years of experience = count of seasons with at least one game checked.
 *
 * Routes:
 *   /admin/seasons   — admin table to manage season/game names
 *
 * Exports:
 *   SeasonParticipationPanel — embedded in MemberProfile
 */
export { default as SeasonParticipationPanel } from "./components/SeasonParticipationPanel";

import SeasonManager from "./pages/SeasonManager";

export const seasonsModule = {
  id: "seasons",

  routes: [
    { path: "/admin/seasons", element: SeasonManager },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: null,
  dashboardTile: null,
};
