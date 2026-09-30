/**
 * Communications Module — Phase 1
 * ================================
 * Template library, compose/send from profiles, standalone compose page.
 *
 * Routes:
 *   /communications             — module dashboard
 *   /communications/compose     — standalone compose with recipient search
 *   /communications/templates   — template CRUD (admin/mentor)
 *   /communications/threads/:id — full thread view
 */
export { default as MessageHistoryPanel } from "./components/MessageHistoryPanel";
export { default as CommunicationPreferencesPanel } from "./components/CommunicationPreferencesPanel";

import CommsDashboard  from "./pages/CommsDashboard";
import ComposePage     from "./pages/ComposePage";
import TemplateManager from "./pages/TemplateManager";
import LayoutManager   from "./pages/LayoutManager";
import ThreadView      from "./pages/ThreadView";
import MessageHistory  from "./pages/MessageHistory";
import MailingList     from "./pages/MailingList";

export const communicationsModule = {
  id: "communications",

  routes: [
    { path: "/communications",              element: CommsDashboard },
    { path: "/communications/compose",      element: ComposePage },
    { path: "/communications/templates",    element: TemplateManager },
    { path: "/communications/layouts",      element: LayoutManager },
    { path: "/communications/history",      element: MessageHistory },
    { path: "/communications/mailing-list", element: MailingList },
    { path: "/communications/threads/:id",  element: ThreadView },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Communications",
    to: "/communications",
    iconName: "Mail",
    requiredRoles: ["Admin", "System Administrator", "Mentor"],
  },

  dashboardTile: null,
};
