/**
 * Volunteer Module
 * ================
 * A single public, no-login sign-up form embedded on the marketing site
 * (tulsaroboticscenter.org) via an iframe pointing at /volunteer. A submission
 * creates a Volunteer member and adds them to the mailing list — see
 * VolunteerSignupController on the backend.
 *
 * No nav item or dashboard tile: the page is reached only by its public URL.
 */
import VolunteerSignup from "./pages/VolunteerSignup";
import ProgramInterest from "./pages/ProgramInterest";

export const volunteerModule = {
  id: "volunteer",

  routes: [
    // Public, no-login sign-up form (embedded on the WordPress site via iframe).
    { path: "/volunteer", element: VolunteerSignup, public: true },
    // Public, no-login "join our mailing list" for camps & program updates (QR code / link).
    { path: "/subscribe", element: ProgramInterest, public: true },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],

  navItem: null,
  dashboardTile: null,
};
