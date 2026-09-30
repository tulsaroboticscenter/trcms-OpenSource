/**
 * Help module — the full User Manual page. The searchable ? panel and admin
 * authoring page live in Layout / the admin module; this just registers the
 * printable manual route.
 */
import HelpManual from "./HelpManual";
import HelpArticlePage from "./HelpArticlePage";

export const helpModule = {
  id: "help",
  routes: [
    { path: "/help/manual", element: HelpManual },
    // Dynamic, so it must not shadow /help/manual — react-router ranks the static
    // path higher, so the manual still wins.
    { path: "/help/:slug", element: HelpArticlePage },
  ] satisfies { path: string; element: React.ComponentType }[],
  navItem: null,
  dashboardTile: null,
};
