/**
 * College Scholarship Module
 * ==========================
 * Track outside college-scholarship opportunities for youth across each season:
 * a manager-maintained catalog with eligibility, youth follow/apply, and a
 * per-season application lifecycle for reporting. Distinct from the Sponsors
 * module's sponsor-funded scholarships (TRC awarding money to youth).
 */
import ScholarshipBoard from "./pages/ScholarshipBoard";
import ScholarshipManager from "./pages/ScholarshipManager";
import ScholarshipReports from "./pages/ScholarshipReports";

export const scholarshipsModule = {
  id: "scholarships",

  routes: [
    { path: "/scholarships",         element: ScholarshipBoard   },
    { path: "/scholarships/manage",  element: ScholarshipManager },
    { path: "/scholarships/reports", element: ScholarshipReports },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "College Scholarships",
    to: "/scholarships",
    iconName: "GraduationCap",
    requiredRoles: [] as string[], // visible to all; youth browse, managers maintain
  },

  dashboardTile: {
    label: "College Scholarships",
    to: "/scholarships",
    iconName: "GraduationCap",
    color: "#5e35b1",
    description: "Browse and follow outside college scholarship opportunities.",
    requiredRoles: [] as string[],
  },
};
