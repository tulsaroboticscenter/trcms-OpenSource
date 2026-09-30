import ResourceList from "./ResourceList";

/** Team resources — embedded as a pane on the team page (per team-season). */
export default function TeamResourcesPanel({ teamSeasonId }: { teamSeasonId: number }) {
  return <ResourceList scope="team" teamSeasonId={teamSeasonId} />;
}
