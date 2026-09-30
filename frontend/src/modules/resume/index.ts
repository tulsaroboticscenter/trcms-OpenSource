/**
 * Resume builder — self-service for every youth in the program.
 *
 * A guided questionnaire that, together with facts the system already holds (school,
 * grade, teams, seasons, certifications), renders a printable one-page resume. A
 * finished resume counts as the youth's "resume on file" for the FDP, and they can also
 * upload their own reformatted version. The Dev Program manager can assign "Build your
 * resume" as a task from the FDP roster.
 *
 * Shown to every member (requiredRoles: [] and no requiredPermission) — the page itself
 * is the youth's own resume; the save endpoint is youth-only.
 */
import ResumeBuilder from "./pages/ResumeBuilder";

export { default as ResumeBuilder } from "./pages/ResumeBuilder";
export { default as ResumeDocument } from "./components/ResumeDocument";
export * from "./api";

export const resumeModule = {
  id: "resume",
  routes: [
    { path: "/resume", element: ResumeBuilder },
    { path: "/resume/member/:memberId", element: ResumeBuilder },
  ] satisfies { path: string; element: React.ComponentType }[],
  navItem: {
    label: "My Resume",
    to: "/resume",
    iconName: "FileText",
    requiredRoles: [] as string[],
    // Visible by default (every real role is seeded read on resume.view); an admin can
    // turn it off for a role — e.g. Volunteer — in Role Management.
    requiredPermission: "resume.view",
  },
  dashboardTile: {
    label: "My Resume",
    to: "/resume",
    iconName: "FileText",
    color: "#0b5c4f",
    description: "Build a one-page resume from your robotics experience and print it to PDF.",
    requiredRoles: [] as string[],
    requiredPermission: "resume.view",
  },
};
