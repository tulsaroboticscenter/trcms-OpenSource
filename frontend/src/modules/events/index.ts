/**
 * Events Module
 * =============
 * Calendar view, event management, and full logistical support for travel events.
 *
 * Routes:
 *   /events                      — month/list calendar view
 *   /events/add                  — create new event
 *   /events/:id                  — event detail
 *   /events/:id/edit             — edit event
 *   /events/:id/logistics        — travel logistics (hotel, equipment, meals)
 */
import EventCalendar from "./pages/EventCalendar";
import EventDetail from "./pages/EventDetail";
import EventForm from "./pages/EventForm";
import EventLogistics from "./pages/EventLogistics";

export const eventsModule = {
  id: "events",

  routes: [
    { path: "/events",              element: EventCalendar },
    { path: "/events/add",          element: EventForm },
    { path: "/events/:id",          element: EventDetail },
    { path: "/events/:id/edit",     element: EventForm },
    { path: "/events/:id/logistics",element: EventLogistics },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Events",
    to: "/events",
    iconName: "Calendar",
    requiredRoles: [],
  },

  dashboardTile: {
    label: "Events & Calendar",
    to: "/events",
    iconName: "Calendar",
    color: "#e65100",
    description: "Schedule and manage events",
    requiredRoles: [],
  },
};
