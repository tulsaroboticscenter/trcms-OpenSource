/**
 * Summer Camp Module
 * ==================
 * Tracks summer-camp seasons, camps (sessions), campers, and registrations —
 * deliberately separate from members so transient attendees don't clutter the
 * roster. Phase 1: the admin setup screen (season config + public-registration
 * toggle + editable waivers, programs, per-year sessions). Public registration
 * intake and registration processing arrive in later phases.
 *
 * Module id "summer_camp" matches the permission catalog group, so the nav entry
 * is hidden unless the user is granted camp.view / camp.manage.
 */
import CampAdmin from "./pages/CampAdmin";
import CampRegister from "./pages/CampRegister";
import CampRegistrations from "./pages/CampRegistrations";
import CampStaffing from "./pages/CampStaffing";
import CampStaff from "./pages/CampStaff";
import CampContacts from "./pages/CampContacts";
import CampResources from "./pages/CampResources";
import CampSpecialNotes from "./pages/CampSpecialNotes";
import CampReports from "./pages/CampReports";

export const campModule = {
  id: "summer_camp",

  routes: [
    { path: "/camp", element: CampAdmin },
    { path: "/camp/registrations", element: CampRegistrations },
    { path: "/camp/staffing", element: CampStaffing },
    { path: "/camp/staff", element: CampStaff },
    { path: "/camp/contacts", element: CampContacts },
    { path: "/camp/resources", element: CampResources },
    { path: "/camp/special-notes", element: CampSpecialNotes },
    { path: "/camp/reports", element: CampReports },
    // Public, no-login registration form (embedded on the WordPress site via iframe).
    { path: "/camp/register", element: CampRegister, public: true },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],

  navItem: {
    label: "Summer Camp",
    to: "/camp",
    iconName: "Tent",
    requiredRoles: [] as string[], // gated by camp.view via module visibility
  },

  dashboardTile: null, // intentionally no dashboard tile — keep the dashboard uncluttered
};
