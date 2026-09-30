import MemberCheckin from "./pages/MemberCheckin";
import EventCheckin from "./pages/EventCheckin";
import FllAttendance from "./pages/FllAttendance";

export const checkinModule = {
  id: "checkin",

  routes: [
    { path: "/checkin",              element: MemberCheckin },
    { path: "/checkin/event/:eventId", element: EventCheckin },
    { path: "/checkin/fll",          element: FllAttendance },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Check-In",
    to: "/checkin",
    iconName: "ClipboardList",
    requiredRoles: [],
  },

  dashboardTile: {
    label: "Member Check-In",
    to: "/checkin",
    iconName: "ClipboardList",
    color: "#1565c0",
    description: "Event attendance check-in",
    requiredRoles: [],
  },
};
