/**
 * Room & Resource Reservations Module
 * ===================================
 * Members request rooms (Computer Lab, Collab Labs) and equipment (3D printers,
 * CNC, Lathe) for a time window, stating purpose and usage. A Lead Mentor or
 * Admin (reservations.approve) approves/denies; approved bookings render on a
 * shared month calendar in the module's color. Resources are configured in the
 * module's "Manage Resources" admin (reservations.manage).
 */
import ReservationsCalendar from "./pages/ReservationsCalendar";
import ReservationForm from "./pages/ReservationForm";
import ReservationDetail from "./pages/ReservationDetail";
import ReservationsAdmin from "./pages/ReservationsAdmin";

export const reservationsModule = {
  id: "reservations",

  routes: [
    { path: "/reservations",          element: ReservationsCalendar },
    { path: "/reservations/new",      element: ReservationForm      },
    { path: "/reservations/manage",   element: ReservationsAdmin    },
    { path: "/reservations/:id/edit", element: ReservationForm      },
    // Clicking a reservation (on the calendar or an event page) opens its read-only
    // detail; the detail shows an Edit button only to those permitted to edit it.
    // Without this, /reservations/:id matched no route and fell through to the Dashboard.
    { path: "/reservations/:id",      element: ReservationDetail    },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Reservations",
    to: "/reservations",
    iconName: "CalendarClock",
    requiredRoles: [] as string[], // visible to all members; backend enforces view/approve/manage
  },

  dashboardTile: {
    label: "Reservations",
    to: "/reservations",
    iconName: "CalendarClock",
    color: "#7b1fa2",
    description: "Reserve rooms and equipment; mentors approve requests.",
    requiredRoles: [] as string[],
  },
};
