import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { teamsApi, type TeamSeasonDetail, type RosterMember, type TeamLeadership } from "../api";
import { TeamInterviewsPanel } from "../../fdp";
import {
  Edit2, ArrowLeft, Users, Trophy,
  ExternalLink, ChevronDown, ChevronUp, Award,
  PlusCircle, CheckCircle, XCircle, PiggyBank, FileText,
  Camera, Image as ImageIcon, CalendarDays, ListChecks, ClipboardList, Clock, Boxes, AlertTriangle, UsersRound, Palette, Target, Gauge,
} from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import TeamBudgetPanel from "../../inventory/components/TeamBudgetPanel";
import TeamBomsPanel from "../../inventory/components/TeamBomsPanel";
import TeamEventsPanel from "../../events/components/TeamEventsPanel";
import TeamReportsPanel from "../components/TeamReportsPanel";
import { TeamCertScorePanel } from "../../certifications";
import { SeasonPlanPanel, TeamIssuesPanel, TeamRolesPanel } from "../../planning";
import { TeamGoalsPanel, TeamPortfolioPanel, TeamReadinessPanel } from "../../strategy";
import { TeamTimeImpactPanel } from "../../activity";
import { TeamResourcesPanel } from "../../resources";
import DraggablePanel from "../../members/components/DraggablePanel";
import { usePanelLayout } from "../../members/hooks/usePanelLayout";
import { resolveTheme, THEME_PRESETS, THEME_FONTS } from "../theme";
import { currentSeasonLabel } from "../../../core/dateUtils";

// Default top-to-bottom order of the team-profile panes. A member's custom
// drag order is saved per-user (server-side) under this pref key.
const TEAM_PANE_ORDER = ["leadership", "roster", "social", "discord", "events", "plan", "goals", "portfolio", "readiness", "issues", "teamroles", "interviews", "certs", "time", "resources", "budget", "boms", "reports"];

export default function TeamProfile() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack("/teams");
  const { isAdmin, hasRole, canRead, canWrite, user } = useAuth();
  const [themeOpen, setThemeOpen] = useState(false);
  const [season, setSeason] = useState<TeamSeasonDetail | null>(null);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [leadership, setLeadership] = useState<TeamLeadership | null>(null);
  // Team-leadership editor (managers): who + which role to assign.
  const [leadAdd, setLeadAdd] = useState(false);
  const [leadMember, setLeadMember] = useState("");
  const [leadRole, setLeadRole] = useState("");
  const [leadBusy, setLeadBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const { order: paneOrder, setOrder: setPaneOrder } = usePanelLayout(TEAM_PANE_ORDER, "team_profile_panels");

  // Admin-configured tab assignment for the panes (global). Falls back to a
  // single untabbed column if it can't be loaded.
  const [tabs, setTabs] = useState<{ key: string; label: string }[]>([]);
  const [tabPlacement, setTabPlacement] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>("");
  const [searchParams] = useSearchParams();
  useEffect(() => {
    api.get("/api/v1/admin/team-pane-layout")
      .then(({ data }) => { setTabs(data.tabs ?? []); setTabPlacement(data.placement ?? {}); })
      .catch(() => { /* untabbed fallback */ });
  }, []);

  // Deep link: when arriving with ?activity=, switch to whichever tab holds the
  // season-plan pane so SeasonPlanPanel mounts and can open the activity editor.
  useEffect(() => {
    if (searchParams.get("activity")) setActiveTab(tabPlacement["plan"] ?? "general");
  }, [searchParams, tabPlacement]);

  const canEdit = isAdmin || hasRole("Admin", "System Administrator", "Mentor");
  const isSysAdmin = hasRole("System Administrator");
  const id = parseInt(seasonId!);

  // Season switcher — gated by the teams.season_history permission (Admin → Role
  // Management). Without it the list comes back as just the current season, so the
  // picker stays hidden; the server also blocks loading a past season by URL.
  const canSeeSeasonHistory = canRead("teams.season_history");
  const [teamSeasons, setTeamSeasons] = useState<TeamSeasonDetail[]>([]);
  // The season the calendar says we're in — labelled "(current)" in the picker.
  const activeSeasonId = teamSeasons.find((s) => s.season === currentSeasonLabel())?.id ?? null;
  useEffect(() => {
    if (!season || !canSeeSeasonHistory) { setTeamSeasons([]); return; }
    teamsApi.getSeasons(season.team_id).then(setTeamSeasons).catch(() => setTeamSeasons([]));
  }, [season, canSeeSeasonHistory]);

  const reloadRoster = () => { teamsApi.getSeasonMembers(id).then(setRoster); };
  const purgeMember = async (m: RosterMember) => {
    if (!confirm(`Permanently remove ${m.first_name} ${m.last_name} from this team for this season? This deletes their roster spot entirely (other seasons are unaffected).`)) return;
    try { await teamsApi.purgeMember(m.id); reloadRoster(); }
    catch { alert("Could not remove the member. Please try again."); }
  };

  // Own vs. other team — drives which view permission applies.
  const isOwnTeam = !!season && !!user?.team_ids?.includes(season.team_id);
  useEffect(() => {
    if (!id) return;
    teamsApi.seasonLeadership(Number(id)).then(setLeadership).catch(() => setLeadership(null));
  }, [id]);

  async function assignLeader() {
    if (!id || !leadMember || !leadRole) return;
    setLeadBusy(true);
    try {
      const d = await teamsApi.assignLeadership(Number(id), Number(leadMember), leadRole);
      setLeadership(d); setLeadAdd(false); setLeadMember(""); setLeadRole("");
    } finally { setLeadBusy(false); }
  }
  async function removeLeader(memberId: number) {
    if (!id) return;
    setLeadBusy(true);
    try { setLeadership(await teamsApi.removeLeadership(Number(id), memberId)); }
    finally { setLeadBusy(false); }
  }

  const canViewRoster = season ? canRead(isOwnTeam ? "teams.roster_own" : "teams.roster_others") : false;

  useEffect(() => {
    teamsApi.getSeason(id).then(setSeason).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!season) return;
    if (!canViewRoster) { setRoster([]); setRosterLoading(false); return; }
    setRosterLoading(true);
    teamsApi.getSeasonMembers(id).then(setRoster).finally(() => setRosterLoading(false));
  }, [season, canViewRoster, id]);

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (!season) return <div style={styles.center}>Team season not found.</div>;

  const activeRoster = roster.filter((m) => m.status === "active");
  const inactiveRoster = roster.filter((m) => m.status !== "active");
  const youth = activeRoster.filter((m) => m.member_type === "youth");
  const mentors = activeRoster.filter((m) => m.member_type === "mentor");

  let discordLinks: { name: string; url: string }[] = [];
  try {
    if (season.discord_links) discordLinks = JSON.parse(season.discord_links);
  } catch { /* ignore */ }

  const hasSocial = !!(season.instagram || season.tiktok || season.youtube || season.x_account || season.website);

  // ── Drag-to-reorder handlers (order persists per-user via usePanelLayout) ──
  function handleDragStart(pid: string) { setDragging(pid); }
  function handleDragOver(e: React.DragEvent, pid: string) { e.preventDefault(); setDragOver(pid); }
  function handleDragEnd() { setDragging(null); setDragOver(null); }
  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragging || dragging === targetId) { handleDragEnd(); return; }
    const next = [...paneOrder];
    const from = next.indexOf(dragging);
    if (from !== -1) next.splice(from, 1);
    const to = next.indexOf(targetId);
    next.splice(to === -1 ? next.length : to, 0, dragging);
    setPaneOrder(next);
    handleDragEnd();
  }

  // Pane definitions: id -> { title, icon, content, show }. Rendered in the
  // user's saved order; hidden panes (no data) are skipped.
  const planTitle = (
    <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      Season Plan
      <button style={styles.taskBoardBtn} onClick={(e) => { e.stopPropagation(); navigate(`/team-tasks/${id}`); }}>
        <ClipboardList size={12} /> Task Board
      </button>
    </span>
  );
  const paneDefs: Record<string, { title: React.ReactNode; icon?: React.ReactNode; show: boolean; content: React.ReactNode }> = {
    leadership: {
      title: `Team Leadership${leadership?.leaders.length ? ` (${leadership.leaders.length})` : ""}`,
      icon: <Award size={14} />,
      // Managers see the pane even when empty, so they can assign the first leader.
      show: (leadership?.leaders.length ?? 0) > 0 || !!leadership?.can_manage,
      content: (
        <div>
          <div style={styles.leadershipGrid}>
            {(leadership?.leaders ?? []).map((l) => (
              <div key={l.ylc_id} style={styles.leaderCard}>
                <Link to={`/members/${l.member_id}`} style={styles.leaderCardLink}>
                  <span style={styles.leaderAvatar}>
                    {l.photo_url ? <img src={l.photo_url} style={styles.avatarImg} alt="" />
                      : <span style={styles.avatarInitials}>{l.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>}
                  </span>
                  <span style={styles.leaderName}>{l.name}</span>
                  <span style={styles.leaderRole}>{l.role}</span>
                </Link>
                {leadership?.can_manage && (
                  <button style={styles.leaderRemove} title="Remove from this team's leadership"
                    disabled={leadBusy} onClick={() => removeLeader(l.member_id)}>×</button>
                )}
              </div>
            ))}
            {(leadership?.leaders.length ?? 0) === 0 && (
              <p style={styles.sub}>No team leadership assigned yet.</p>
            )}
          </div>

          {leadership?.can_manage && (leadAdd ? (
            <div style={styles.leadForm}>
              <select style={styles.leadSelect} value={leadMember} onChange={(e) => setLeadMember(e.target.value)}>
                <option value="">Choose a team member…</option>
                {leadership.candidates.map((c) => (
                  <option key={c.member_id} value={c.member_id}>
                    {c.name}{c.current_role ? ` — currently ${c.current_role}` : ""}
                  </option>
                ))}
              </select>
              <select style={styles.leadSelect} value={leadRole} onChange={(e) => setLeadRole(e.target.value)}>
                <option value="">Choose a role…</option>
                {leadership.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button style={styles.leadAssignBtn} disabled={!leadMember || !leadRole || leadBusy} onClick={assignLeader}>
                {leadBusy ? "Saving…" : "Assign"}
              </button>
              <button style={styles.leadCancelBtn} onClick={() => { setLeadAdd(false); setLeadMember(""); setLeadRole(""); }}>Cancel</button>
            </div>
          ) : (
            <button style={styles.leadAddBtn} onClick={() => setLeadAdd(true)}>+ Assign team leadership</button>
          ))}
          {leadership?.can_manage && (
            <p style={styles.leadHint}>Team roles are tied to this team, so a member who leads another team won't show here unless assigned to this one.</p>
          )}
        </div>
      ),
    },
    roster: {
      title: canViewRoster
        ? `Roster (${youth.length} ${youth.length === 1 ? "member" : "members"} · ${mentors.length} ${mentors.length === 1 ? "mentor" : "mentors"})`
        : "Roster",
      icon: <Users size={14} />, show: true,
      content: !canViewRoster ? (
        <p style={styles.sub}>You don't have permission to view this team's roster.</p>
      ) : rosterLoading ? <p style={styles.sub}>Loading roster…</p> : (
        <>
          {youth.length > 0 && (<><div style={styles.rosterGroupLabel}>Youth Members ({youth.length})</div>
            {youth.map((m) => <RosterRow key={m.id} member={m} canEdit={canEdit} onEdit={() => navigate(`/teams/member/${m.id}/edit`)} canRemove={isSysAdmin} onRemove={() => purgeMember(m)} />)}</>)}
          {mentors.length > 0 && (<><div style={styles.rosterGroupLabel}>Mentors ({mentors.length})</div>
            {mentors.map((m) => <RosterRow key={m.id} member={m} canEdit={canEdit} onEdit={() => navigate(`/teams/member/${m.id}/edit`)} canRemove={isSysAdmin} onRemove={() => purgeMember(m)} />)}</>)}
          {activeRoster.length === 0 && (<p style={styles.sub}>No active members yet.{canEdit && " Use 'Add Member' to build the roster."}</p>)}
          {inactiveRoster.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button style={styles.toggleBtn} onClick={() => setShowInactive(!showInactive)}>
                {showInactive ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {showInactive ? "Hide" : "Show"} inactive / transferred ({inactiveRoster.length})
              </button>
              {showInactive && inactiveRoster.map((m) => (
                <RosterRow key={m.id} member={m} canEdit={canEdit} onEdit={() => navigate(`/teams/member/${m.id}/edit`)} dimmed canRemove={isSysAdmin} onRemove={() => purgeMember(m)} />
              ))}
            </div>
          )}
        </>
      ),
    },
    social: {
      title: "Social Media", icon: <ExternalLink size={14} />, show: hasSocial,
      content: (
        <>
          {season.instagram && <SocialRow icon="📸" label="Instagram" href={`https://instagram.com/${season.instagram.replace("@", "")}`} handle={season.instagram} />}
          {season.tiktok && <SocialRow icon="🎵" label="TikTok" href={`https://tiktok.com/@${season.tiktok.replace("@", "")}`} handle={season.tiktok} />}
          {season.youtube && <SocialRow icon="▶️" label="YouTube" href={season.youtube} handle="Channel" />}
          {season.x_account && <SocialRow icon="🐦" label="X / Twitter" href={`https://x.com/${season.x_account.replace("@", "")}`} handle={season.x_account} />}
          {season.website && <SocialRow icon="🌐" label="Website" href={season.website} handle="Visit" />}
        </>
      ),
    },
    discord: {
      title: "Discord Channels", icon: <ExternalLink size={14} />, show: discordLinks.length > 0,
      content: (<>{discordLinks.map((d, i) => (
        <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" style={styles.discordLink}>
          <span style={styles.discordIcon}>#</span>{d.name}
          <ExternalLink size={11} style={{ marginLeft: "auto", opacity: 0.4 }} />
        </a>
      ))}</>),
    },
    events: { title: "Team Events", icon: <CalendarDays size={14} />, show: true, content: <TeamEventsPanel teamSeasonId={id} /> },
    plan: { title: planTitle, icon: <ListChecks size={14} />, show: true, content: <SeasonPlanPanel teamSeasonId={id} /> },
    goals: { title: "Goals", icon: <Target size={14} />, show: canRead("goals.view"), content: <TeamGoalsPanel teamSeasonId={id} /> },
    portfolio: { title: "Portfolio", icon: <FileText size={14} />, show: canRead("portfolio.view"), content: <TeamPortfolioPanel teamSeasonId={id} /> },
    readiness: { title: "Readiness", icon: <Gauge size={14} />, show: canRead("strategy.readiness.view"), content: <TeamReadinessPanel teamSeasonId={id} /> },
    issues: { title: "Issue Log", icon: <AlertTriangle size={14} />, show: true, content: <TeamIssuesPanel teamSeasonId={id} /> },
    interviews: { title: "FDP Interviews", icon: <UsersRound size={14} />, show: true, content: <TeamInterviewsPanel teamSeasonId={id} /> },
    teamroles: { title: "Team Roles", icon: <UsersRound size={14} />, show: true, content: <TeamRolesPanel teamSeasonId={id} /> },
    certs: { title: "Certification Score", icon: <Award size={14} />, show: true, content: <TeamCertScorePanel teamSeasonId={id} /> },
    time: { title: "Time & Impact", icon: <Clock size={14} />, show: true, content: <TeamTimeImpactPanel teamSeasonId={id} /> },
    resources: { title: "Resources", icon: <Boxes size={14} />, show: true, content: <TeamResourcesPanel teamSeasonId={id} /> },
    budget: { title: "Team Budget", icon: <PiggyBank size={14} />, show: true, content: <TeamBudgetPanel teamSeasonId={id} /> },
    boms: { title: "Purchasing (BOMs)", icon: <FileText size={14} />, show: true, content: <TeamBomsPanel teamSeasonId={id} /> },
    // Hidden from youth for now (team reporting still needs work); mentors/
    // parents/admins keep it.
    reports: { title: "Reports", icon: <FileText size={14} />, show: user?.member_type !== "youth", content: <TeamReportsPanel teamSeasonId={id} /> },
  };
  // Group visible panes into the admin-defined tabs. If tabs haven't loaded,
  // fall back to one untabbed column (original behavior).
  const visiblePaneIds = paneOrder.filter((pid) => paneDefs[pid]?.show);
  const tabOf = (pid: string) => tabPlacement[pid] ?? "general";
  const tabsReady = tabs.length > 0;
  const nonEmptyTabs = tabs.filter((t) => visiblePaneIds.some((pid) => tabOf(pid) === t.key));
  const showTabs = tabsReady && nonEmptyTabs.length > 1;
  const effectiveActive = showTabs
    ? (nonEmptyTabs.some((t) => t.key === activeTab) ? activeTab : nonEmptyTabs[0].key)
    : "";
  const orderedPanes = (showTabs ? visiblePaneIds.filter((pid) => tabOf(pid) === effectiveActive) : visiblePaneIds)
    .map((pid) => ({ id: pid, ...paneDefs[pid] }));

  const theme = resolveTheme(season.theme_preset, season.theme_font, season.theme_accent);
  const canTheme = canEdit || canWrite("teams.theme");
  const canPhoto = canEdit || canWrite("teams.photo");
  const canManageRoster = isAdmin || canWrite("teams.roster_manage");

  return (
    <div style={{ ...styles.page, background: theme.pageBg, padding: 16, borderRadius: 12 }}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          <ArrowLeft size={14} /> All Teams
        </button>
        {(canEdit || canTheme || canManageRoster) && (
          <div style={{ display: "flex", gap: 8 }}>
            {canTheme && (
              <button style={styles.themeBtn} onClick={() => setThemeOpen(true)}>
                <Palette size={13} /> Theme
              </button>
            )}
            {canEdit && (
            <button style={styles.editBtn} onClick={() => navigate(`/teams/season/${id}/edit`)}>
              <Edit2 size={13} /> Edit Profile
            </button>)}
            {canManageRoster && (
              <button style={styles.addMemberBtn} onClick={() => navigate(`/teams/season/${id}/roster/add`)}>
                <PlusCircle size={13} /> Add Member
              </button>
            )}
          </div>
        )}
      </div>

      {/* Team banner photo — team leaders (teams.photo) can change it, not just mentors/admins */}
      <TeamBanner season={season} canEdit={canPhoto}
        onUploaded={(url) => { teamsApi.updateTeamPhoto(id, url).then(() => setSeason({ ...season, team_photo_url: url })); }} />

      {/* Hero */}
      <div style={styles.hero}>
        <div style={styles.heroLeft}>
          <TeamLogo season={season} canEdit={canEdit}
            onUploaded={(url) => { teamsApi.updateSeason(id, { team_logo_url: url }).then(() => setSeason({ ...season, team_logo_url: url })); }} />
          <div>
            <div style={styles.heroTeamNum}>#{season.team_number} · {season.program_name}</div>
            <h1 style={{ ...styles.heroName, color: theme.heading, fontFamily: theme.fontFamily }}>{season.team_name ?? `Team ${season.team_number}`}</h1>
            <div style={styles.heroBadges}>
              <StatusBadge status={season.status} />
              <span style={styles.seasonBadge}>{season.season}</span>
              {(season.seasons_competed ?? 0) > 0 && (
                <span style={styles.seasonsBadge}>
                  <Trophy size={11} /> {season.seasons_competed} season{season.seasons_competed !== 1 ? "s" : ""} competed
                </span>
              )}
            </div>
            {season.robot_name && (
              <div style={styles.robotName}>🤖 {season.robot_name}</div>
            )}
          </div>
        </div>

        {/* Robot photo */}
        {season.robot_photo_url && (
          <img src={season.robot_photo_url} style={styles.robotPhoto} alt="Robot" />
        )}
      </div>

      {showTabs && (
        <div style={styles.tabBar}>
          {nonEmptyTabs.map((t) => (
            <button
              key={t.key}
              style={{ ...styles.tabBtn, ...(t.key === effectiveActive ? { ...styles.tabBtnActive, background: theme.accent, borderColor: theme.accent, color: theme.accentText } : {}) }}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {orderedPanes.map((p) => (
          <DraggablePanel
            key={p.id}
            id={p.id}
            title={p.title}
            icon={p.icon}
            dragging={dragging}
            dragOver={dragOver}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            collapseScope={`team_${id}_`}
          >
            {p.content}
          </DraggablePanel>
        ))}
      </div>

      {/* Season history — switch to a prior season of this team (permission-gated). */}
      {canSeeSeasonHistory && teamSeasons.length > 1 && (
        <div style={styles.seasonHistoryBar}>
          <span style={styles.seasonHistoryLabel}>Viewing season</span>
          <select
            style={styles.seasonHistorySel}
            value={id}
            onChange={(e) => navigate(`/teams/season/${e.target.value}`)}
          >
            {teamSeasons.map((s) => (
              <option key={s.id} value={s.id}>{s.season}{s.id === activeSeasonId ? " (current)" : ""}</option>
            ))}
          </select>
          {activeSeasonId !== null && id !== activeSeasonId && (
            <span style={styles.pastSeasonNote}>
              You're viewing a past season — its plan, roster, budget and BOMs are as they were.
            </span>
          )}
        </div>
      )}

      {themeOpen && (
        <ThemeEditor season={season} onClose={() => setThemeOpen(false)}
          onSaved={(s) => { setSeason(s); setThemeOpen(false); }} />
      )}
    </div>
  );
}

// Curated theme picker: preset + font + accent color. Saves via the
// permission-gated theme endpoint (team captains + mentors/admins).
function ThemeEditor({ season, onClose, onSaved }: {
  season: TeamSeasonDetail; onClose: () => void; onSaved: (s: TeamSeasonDetail) => void;
}) {
  const [preset, setPreset] = useState(season.theme_preset ?? "classic");
  const [font, setFont] = useState(season.theme_font ?? "sans");
  const [accent, setAccent] = useState(season.theme_accent ?? "");
  const [saving, setSaving] = useState(false);
  const preview = resolveTheme(preset, font, accent);

  async function save() {
    setSaving(true);
    try {
      const updated = await teamsApi.updateTheme(season.id, {
        theme_preset: preset, theme_font: font, theme_accent: accent || null,
      });
      onSaved(updated);
    } catch { setSaving(false); }
  }
  function reset() { setPreset("classic"); setFont("sans"); setAccent(""); }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}><Palette size={16} /> Team Page Theme</div>

        {/* Live preview */}
        <div style={{ background: preview.pageBg, borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid #e2e8f0" }}>
          <div style={{ color: preview.heading, fontFamily: preview.fontFamily, fontWeight: 800, fontSize: 22 }}>
            {season.team_name ?? `Team ${season.team_number}`}
          </div>
          <div style={{ display: "inline-block", marginTop: 8, background: preview.accent, color: preview.accentText, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
            Active tab
          </div>
        </div>

        <div style={styles.fieldLabel}>Theme</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {THEME_PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              style={{ ...styles.presetChip, ...(preset === p.key ? { borderColor: p.accent, boxShadow: `0 0 0 2px ${p.accent}33` } : {}) }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: p.accent, display: "inline-block" }} />
              {p.label}
            </button>
          ))}
        </div>

        <div style={styles.fieldLabel}>Heading font</div>
        <select value={font} onChange={(e) => setFont(e.target.value)} style={styles.select}>
          {THEME_FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>

        <div style={{ ...styles.fieldLabel, marginTop: 14 }}>Accent color (optional)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : preview.accent}
            onChange={(e) => setAccent(e.target.value)} style={{ width: 44, height: 32, border: "1px solid #cdd7e3", borderRadius: 6, background: "none" }} />
          {accent && <button style={styles.linkBtn} onClick={() => setAccent("")}>Use theme default</button>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
          <button style={styles.resetBtn} onClick={reset}>Reset to Classic</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={styles.saveThemeBtn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Theme"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The square box to the left of the team name/number/status. Displays the team
// logo; editors can click it to upload or change the logo image.
function TeamLogo({ season, canEdit, onUploaded }: {
  season: TeamSeasonDetail; canEdit: boolean; onUploaded: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState(false);
  const url = season.team_logo_url;

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("File must be under 5 MB."); return; }
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/api/v1/uploads/team-asset?asset_type=logo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(data.url);
    } catch {
      setError("Upload failed. Please try again.");
    } finally { setUploading(false); }
  }

  const box = url
    ? <img src={url} style={styles.heroLogo} alt="Team logo" />
    : <div style={styles.heroLogoPlaceholder}><Trophy size={40} color="#1a3a5c" /></div>;

  if (!canEdit) return box;

  return (
    <div style={{ position: "relative", cursor: "pointer" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => !uploading && fileRef.current?.click()}
      title={url ? "Change team logo" : "Add team logo"}>
      {box}
      {(hover || uploading || !url) && (
        <div style={styles.logoOverlay}>
          <Camera size={16} color="#fff" />
          <span style={styles.logoOverlayText}>{uploading ? "Uploading…" : url ? "Change" : "Add logo"}</span>
        </div>
      )}
      {error && <div style={styles.logoError}>{error}</div>}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

function TeamBanner({ season, canEdit, onUploaded }: {
  season: TeamSeasonDetail; canEdit: boolean; onUploaded: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const url = season.team_photo_url;

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("File must be under 5 MB."); return; }
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/api/v1/uploads/team-asset?asset_type=banner", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(data.url);
    } catch {
      setError("Upload failed. Please try again.");
    } finally { setUploading(false); }
  }

  if (!url && !canEdit) return null;

  return (
    <div style={{ ...styles.banner, ...(url ? {} : styles.bannerEmpty) }}>
      {url
        ? <img src={url} style={styles.bannerImg} alt="Team banner" />
        : <div style={styles.bannerPlaceholderText}><ImageIcon size={22} color="#bbb" /> Add a team photo</div>}
      {canEdit && (
        <button style={styles.bannerBtn} onClick={() => !uploading && fileRef.current?.click()} disabled={uploading}>
          <Camera size={13} /> {uploading ? "Uploading…" : url ? "Change photo" : "Upload photo"}
        </button>
      )}
      {error && <div style={styles.bannerError}>{error}</div>}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

function RosterRow({ member: m, canEdit, onEdit, dimmed = false, canRemove = false, onRemove }: {
  member: RosterMember;
  canEdit: boolean;
  onEdit: () => void;
  dimmed?: boolean;
  canRemove?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div style={{ ...styles.rosterRow, opacity: dimmed ? 0.55 : 1 }}>
      <Link to={`/members/${m.member_id}`} style={styles.rosterAvatar}>
        {m.photo_url
          ? <img src={m.photo_url} style={styles.avatarImg} alt="" />
          : <span style={styles.avatarInitials}>{m.first_name[0]}{m.last_name[0]}</span>
        }
      </Link>
      <div style={styles.rosterInfo}>
        <Link to={`/members/${m.member_id}`} style={styles.rosterName}>
          {m.first_name} {m.last_name}
        </Link>
        <div style={styles.rosterMeta}>
          {m.primary_role && <span style={styles.roleTag}>{m.primary_role}</span>}
          {m.secondary_role && <span style={styles.roleTagSecondary}>{m.secondary_role}</span>}
        </div>
        <div style={styles.rosterStats}>
          <span>{m.robotics_experience_years}yr robotics</span>
          <span>·</span>
          <span>{m.seasons_on_team} season{m.seasons_on_team !== 1 ? "s" : ""} on team</span>
        </div>
      </div>
      <div style={styles.rosterFlags}>
        {m.member_type !== "youth" && (
          <>
            <FlagIcon ok={!!m.registered_on_first} label="FIRST" />
            <FlagIcon ok={!!m.first_consent_release} label="C&R" />
            <FlagIcon ok={!!m.background_check} label="BG" />
            <FlagIcon ok={!!m.ypt} label="YPT" />
            <FlagIcon ok={!!m.role_specific} label="Role" />
          </>
        )}
        {m.status !== "active" && (
          <span style={styles.inactiveTag}>{m.status.replace("_", " ")}</span>
        )}
      </div>
      {canEdit && (
        <button style={styles.editRowBtn} onClick={onEdit}>Edit</button>
      )}
      {canRemove && onRemove && (
        <button style={styles.removeRowBtn} onClick={onRemove} title="Permanently remove from this team (System Administrator)">
          <XCircle size={14} />
        </button>
      )}
    </div>
  );
}

function FlagIcon({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      {ok
        ? <CheckCircle size={13} color="#2e7d32" />
        : <XCircle size={13} color="#ccc" />
      }
      <div style={{ fontSize: 9, color: "#aaa", marginTop: 1 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = { active: "#2e7d32", inactive: "#757575", development_only: "#e65100" };
  return <span style={{ ...styles.heroBadge, background: c[status] ?? "#999" }}>{status.replace("_", " ")}</span>;
}


function SocialRow({ icon, label, href, handle }: { icon: string; label: string; href: string; handle: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={styles.socialRow}>
      <span>{icon}</span>
      <span style={styles.socialLabel}>{label}</span>
      <span style={styles.socialHandle}>{handle}</span>
      <ExternalLink size={11} style={{ opacity: 0.4 }} />
    </a>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  editBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  themeBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: 20, width: 440, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  modalTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, color: "#1a3a5c", marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: 600, color: "#475569", marginBottom: 6 },
  presetChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#334155" },
  select: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, width: "100%" },
  resetBtn: { background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 },
  cancelBtn: { padding: "8px 14px", background: "#f1f5f9", color: "#334155", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  saveThemeBtn: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  addMemberBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },

  banner: { position: "relative", width: "100%", height: 380, maxHeight: "60vh", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#1a3a5c" },
  bannerEmpty: { height: 180, maxHeight: "none", background: "#f0f4f8", border: "2px dashed #d4dde8", display: "flex", alignItems: "center", justifyContent: "center" },
  bannerImg: { width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" },
  bannerPlaceholderText: { display: "flex", alignItems: "center", gap: 8, color: "#aaa", fontSize: 14, fontWeight: 600 },
  bannerBtn: { position: "absolute", bottom: 12, right: 12, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, backdropFilter: "blur(2px)" },
  bannerError: { position: "absolute", bottom: 12, left: 12, background: "#c62828", color: "#fff", fontSize: 12, padding: "4px 10px", borderRadius: 5 },

  hero: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" },
  heroLeft: { display: "flex", alignItems: "center", gap: 20 },
  heroLogo: { width: 80, height: 80, objectFit: "contain", borderRadius: 8, border: "1px solid #e2e8f0" },
  heroLogoPlaceholder: { width: 80, height: 80, background: "#f0f4f8", borderRadius: 8, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" },
  logoOverlay: { position: "absolute", inset: 0, borderRadius: 8, background: "rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 },
  logoOverlayText: { color: "#fff", fontSize: 10, fontWeight: 700 },
  logoError: { position: "absolute", top: 84, left: 0, width: 160, fontSize: 11, color: "#dc2626" },
  heroTeamNum: { fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 2 },
  heroName: { margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  heroBadges: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  heroBadge: { padding: "3px 10px", borderRadius: 12, color: "#fff", fontSize: 12, fontWeight: 600, textTransform: "capitalize" as const },
  seasonBadge: { padding: "3px 10px", borderRadius: 12, background: "#e3f2fd", color: "#1565c0", fontSize: 12, fontWeight: 600 },
  seasonsBadge: { display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 12, background: "#fff8e1", color: "#f57c00", fontSize: 12, fontWeight: 600 },
  robotName: { fontSize: 13, color: "#666", marginTop: 4 },
  robotPhoto: { maxHeight: 160, maxWidth: 240, objectFit: "contain", borderRadius: 8, border: "1px solid #e2e8f0" },

  bodyGrid: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" },

  rosterSection: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem" },
  sectionTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 10, marginBottom: 12 },
  sub: { color: "#888", fontSize: 13 },
  rosterGroupLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "12px 0 6px", paddingBottom: 4, borderBottom: "1px solid #f0f4f8" },

  rosterRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f8fafc" },
  leadershipGrid: { display: "flex", flexWrap: "wrap", gap: 12 },
  leaderCard: { position: "relative", width: 104, border: "1px solid #eef1f5", borderRadius: 10, background: "#fff" },
  leaderCardLink: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "12px 8px", textDecoration: "none", textAlign: "center" },
  leaderRemove: { position: "absolute", top: 4, right: 6, width: 18, height: 18, lineHeight: "16px", borderRadius: "50%", border: "1px solid #f0c8c8", background: "#fff", color: "#c62828", fontSize: 13, cursor: "pointer", padding: 0 },
  leaderAvatar: { width: 52, height: 52, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", color: "#fff", fontWeight: 700, fontSize: 16 },
  leaderName: { fontSize: 12.5, fontWeight: 600, color: "#1a3a5c", lineHeight: 1.25 },
  leaderRole: { fontSize: 11, color: "#556", background: "#eef2f6", borderRadius: 10, padding: "1px 9px" },
  leadForm: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" },
  leadSelect: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  leadAssignBtn: { padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  leadCancelBtn: { padding: "7px 12px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, cursor: "pointer" },
  leadAddBtn: { marginTop: 12, padding: "7px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  leadHint: { fontSize: 11.5, color: "#8b98a6", marginTop: 8, lineHeight: 1.4 },
  rosterAvatar: { width: 36, height: 36, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, textDecoration: "none" },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  avatarInitials: { color: "#fff", fontSize: 13, fontWeight: 700 },
  rosterInfo: { flex: 1 },
  rosterName: { display: "block", fontWeight: 600, fontSize: 14, color: "#1a3a5c", textDecoration: "none", marginBottom: 2 },
  rosterMeta: { display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 2 },
  roleTag: { padding: "1px 7px", background: "#1a3a5c", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 600 },
  roleTagSecondary: { padding: "1px 7px", background: "#e3f2fd", color: "#1565c0", borderRadius: 10, fontSize: 10, fontWeight: 600 },
  rosterStats: { fontSize: 11, color: "#aaa", display: "flex", gap: 4 },
  rosterFlags: { display: "flex", gap: 8, alignItems: "center" },
  inactiveTag: { fontSize: 10, padding: "1px 6px", background: "#f5f5f5", color: "#888", borderRadius: 8, textTransform: "capitalize" as const },
  editRowBtn: { padding: "3px 10px", fontSize: 11, border: "1px solid #ccc", borderRadius: 4, background: "#fff", cursor: "pointer" },
  removeRowBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 6px", border: "1px solid #f2c2c2", borderRadius: 4, background: "#fff", color: "#c62828", cursor: "pointer" },
  toggleBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, padding: "4px 0" },

  infoCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 12 },
  infoCardTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 10, borderBottom: "1px solid #f0f4f8", paddingBottom: 6 },

  // Collapsible pane
  paneCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  paneHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" as const },
  paneTitleWrap: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  paneBody: { padding: "0 16px 16px" },
  socialRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, color: "#333", textDecoration: "none", borderBottom: "1px solid #f8fafc" },
  socialLabel: { color: "#888", minWidth: 64, fontSize: 12 },
  socialHandle: { flex: 1, color: "#1565c0", fontWeight: 500 },
  discordLink: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, textDecoration: "none", color: "#5865f2", fontSize: 13, background: "#f0f0ff", marginBottom: 4 },
  discordIcon: { fontWeight: 900, fontSize: 15, color: "#5865f2" },

  manageGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginTop: 16 },
  taskBoardBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", background: "#fff", color: "#00838f", border: "1px solid #b2dfdb", borderRadius: 12, cursor: "pointer", fontSize: 11, fontWeight: 700 },
  manageCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem" },
  tabBar: { display: "flex", gap: 4, marginBottom: 16, borderBottom: "2px solid #e2e8f0" },
  tabBtn: { padding: "9px 20px", background: "none", border: "none", borderBottom: "3px solid transparent", marginBottom: -2, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#888" },
  tabBtnActive: { color: "#1a3a5c", borderBottomColor: "#1a3a5c" },
  seasonHistoryBar: { marginTop: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  seasonHistoryLabel: { fontSize: 12.5, fontWeight: 700, color: "#667" },
  seasonHistorySel: { padding: "6px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, background: "#fff", cursor: "pointer" },
  pastSeasonNote: { fontSize: 12, color: "#8a5a00", background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 7, padding: "4px 9px" },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline" },
};
