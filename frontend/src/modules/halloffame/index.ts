/**
 * Hall of Fame Module
 * ===================
 * Celebrates graduating members so today's youth can see those who came before
 * them and the legacy they left. The gallery groups published members by
 * "Class of 20xx"; each member has a rich profile (teams, positions, awards,
 * honors, college/career, and links/documents). Members are created as an
 * editable snapshot from the member record ("Graduate Seniors") and stay hidden
 * (draft) until a manager publishes them.
 *
 * Viewing is open to all members (hof.view); creating/editing/publishing needs
 * hof.manage.
 */
import HallOfFameGallery from "./pages/HallOfFameGallery";
import HallOfFameDetail from "./pages/HallOfFameDetail";
import HallOfFameEdit from "./pages/HallOfFameEdit";
import GraduateSeniors from "./pages/GraduateSeniors";

export const hallOfFameModule = {
  id: "hof",

  routes: [
    { path: "/hall-of-fame",            element: HallOfFameGallery },
    { path: "/hall-of-fame/graduate",   element: GraduateSeniors   },
    { path: "/hall-of-fame/new",        element: HallOfFameEdit     },
    { path: "/hall-of-fame/:id",        element: HallOfFameDetail   },
    { path: "/hall-of-fame/:id/edit",   element: HallOfFameEdit     },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Hall of Fame",
    to: "/hall-of-fame",
    iconName: "Trophy",
    requiredRoles: [] as string[], // visible to all members; backend enforces view/manage
  },

  dashboardTile: {
    label: "Hall of Fame",
    to: "/hall-of-fame",
    iconName: "Trophy",
    color: "#b8860b",
    description: "Celebrating our graduates and the legacy they built.",
    requiredRoles: [] as string[],
  },
};
