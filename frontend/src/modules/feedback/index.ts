/**
 * Feedback Module
 * ===============
 * In-app bug reports and feature requests. Any logged-in user can submit and
 * track their own; triagers (feedback.manage) see and manage all, including the
 * deployment-tracking fields (release, deployed date, fix notes).
 *
 * Intentionally has NO dashboard tile and NO main-nav item to keep the app
 * uncluttered — it's reached from a discreet "Send Feedback" link in the
 * sidebar footer (see core/Layout.tsx).
 */
import FeedbackList from "./pages/FeedbackList";
import FeedbackForm from "./pages/FeedbackForm";
import FeedbackDetail from "./pages/FeedbackDetail";

export const feedbackModule = {
  id: "feedback",

  routes: [
    { path: "/feedback",          element: FeedbackList   },
    { path: "/feedback/new",      element: FeedbackForm   },
    { path: "/feedback/:id",      element: FeedbackDetail },
    { path: "/feedback/:id/edit", element: FeedbackForm   },
  ] satisfies { path: string; element: React.ComponentType }[],

  // No nav item and no dashboard tile by design (reached from the sidebar footer).
  navItem: undefined,
  dashboardTile: undefined,
};
