/**
 * My Volunteering Module
 * ======================
 * A self-service page for volunteers, mentors and parents: find opportunities
 * (events seeking volunteers + other upcoming events) and report the time given,
 * totalled per event with a printable statement for employer volunteer-time reporting.
 *
 * Gated on volunteering.view (seeded for Volunteer / Mentor / Parent). Add another role
 * later — e.g. Sponsor — by granting the permission in Role Management.
 */
import MyVolunteering from "./pages/MyVolunteering";

export const volunteeringModule = {
  id: "volunteering",

  routes: [
    { path: "/volunteering", element: MyVolunteering },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "My Volunteering",
    to: "/volunteering",
    iconName: "Handshake",
    requiredRoles: [] as string[],
    requiredPermission: "volunteering.view",
  },

  dashboardTile: {
    label: "My Volunteering",
    to: "/volunteering",
    iconName: "Handshake",
    color: "#c2185b",
    description: "Find volunteer opportunities and print a report of the hours you've given.",
    requiredRoles: [] as string[],
    requiredPermission: "volunteering.view",
  },
};
