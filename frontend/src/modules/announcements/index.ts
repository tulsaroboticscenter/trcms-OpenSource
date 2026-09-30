/**
 * Announcements Module (feedback #94)
 * ===================================
 * In-app announcements feed. Everyone with announcements.view sees active items;
 * announcements.manage can post/manage. Reached from the sidebar "Announcements".
 */
import AnnouncementsPage from "./pages/AnnouncementsPage";

export const announcementsModule = {
  id: "announcements",

  routes: [
    { path: "/announcements", element: AnnouncementsPage },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Announcements",
    to: "/announcements",
    iconName: "Megaphone",
    requiredRoles: [] as string[],
  },

  dashboardTile: {
    label: "Announcements",
    to: "/announcements",
    iconName: "Megaphone",
    color: "#e65100",
    description: "Program news and updates.",
    requiredRoles: [] as string[],
  },
};
