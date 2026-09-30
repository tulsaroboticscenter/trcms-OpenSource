import ReportIncident from "./pages/ReportIncident";
import IncidentThanks from "./pages/IncidentThanks";
import MyReports from "./pages/MyReports";
import IncidentQueue from "./pages/IncidentQueue";
import IncidentDetail from "./pages/IncidentDetail";
import FirstAidLog from "./pages/FirstAidLog";
import IncidentSettings from "./pages/IncidentSettings";

export const incidentsModule = {
  id: "incidents",
  routes: [
    { path: "/incidents/new", element: ReportIncident },
    { path: "/incidents/thanks", element: IncidentThanks },
    { path: "/incidents/mine", element: MyReports },
    { path: "/incidents/:id", element: IncidentDetail },
    { path: "/incidents", element: IncidentQueue },
    { path: "/first-aid", element: FirstAidLog },
    { path: "/admin/incident-settings", element: IncidentSettings },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],
  navItem: {
    label: "Report an Incident",
    to: "/incidents/new",
    iconName: "ShieldAlert",
    requiredRoles: [] as string[],
    requiredPermission: "incidents.report",
  },
  dashboardTile: {
    label: "Report an Incident",
    to: "/incidents/new",
    iconName: "ShieldAlert",
    color: "#b23b3b",
    description: "File a safety, medical, injury, or conduct report — anonymous option.",
    requiredRoles: [] as string[],
    requiredPermission: "incidents.report",
  },
};
