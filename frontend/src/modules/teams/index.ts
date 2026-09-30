/**
 * Teams Module
 * ============
 * Team profiles, per-season rosters, role assignments, social media, robot tracking.
 *
 * Key routes:
 *   /teams                          — team list by program
 *   /teams/add                      — create new team (admin)
 *   /teams/:teamId                  — team detail (redirects to current season)
 *   /teams/season/:seasonId         — season profile with roster
 *   /teams/season/:seasonId/edit    — edit season details
 *   /teams/season/:seasonId/roster/add  — add member to roster
 *   /teams/member/:assignmentId/edit    — edit a roster member's role/status
 */
export { default as MemberTeamsPanel } from "./components/MemberTeamsPanel";

import TeamList from "./pages/TeamList";
import TeamProfile from "./pages/TeamProfile";
import TeamAdd from "./pages/TeamAdd";
import TeamSeasonEdit from "./pages/TeamSeasonEdit";
import RosterAddMember from "./pages/RosterAddMember";
import RosterEditMember from "./pages/RosterEditMember";

export const teamsModule = {
  id: "teams",

  routes: [
    { path: "/teams",                                   element: TeamList },
    { path: "/teams/add",                               element: TeamAdd },
    { path: "/teams/season/:seasonId",                  element: TeamProfile },
    { path: "/teams/season/:seasonId/edit",             element: TeamSeasonEdit },
    { path: "/teams/season/:seasonId/roster/add",       element: RosterAddMember },
    { path: "/teams/member/:assignmentId/edit",         element: RosterEditMember },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: {
    label: "Teams",
    to: "/teams",
    iconName: "UsersRound",
    requiredRoles: [],
  },

  dashboardTile: {
    label: "Team Information",
    to: "/teams",
    iconName: "UsersRound",
    color: "#6a1b9a",
    description: "View team profiles and rosters",
    requiredRoles: [],
  },
};
