import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { adminApi, type SystemStats } from "../api";
import { useAuth } from "../../../core/AuthContext";
import {
  Shield, AlertTriangle,
  Settings, Eye, Key, ChevronRight, ChevronDown, List, Sliders, Trophy, CalendarClock, MapPin, ShieldAlert, Monitor, Boxes, Tag, GitMerge, Share2, Mail, GitBranch, UsersRound, CreditCard, BookOpen, Compass, DatabaseBackup, GraduationCap,
} from "lucide-react";
import { RELEASES, APP_VERSION } from "../../../core/version";
import ReleaseHighlights from "../components/ReleaseHighlights";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { canRead, isAdmin, hasRole } = useAuth();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Each tool declares the permission that controls its visibility (`perm`),
  // so a role granted just that capability sees exactly that card. A few legacy
  // tools without a dedicated key fall back to `adminOnly`. Each tool also names
  // the category (`group`) it appears under on this page — see GROUPS below.
  const allTools = [
    { group: "access", title: "Role Management", desc: "Create, edit, and assign system roles. Control what each role can see and do.", icon: Shield, color: "#1a3a5c", path: "/admin/roles", perm: "admin.roles" },
    { group: "programs", title: "Program Management", desc: "Add, edit, or deactivate programs (FLLe, FLLc, FTC, FRC, FDP, etc.).", icon: Settings, color: "#2e7d32", path: "/admin/programs", perm: "admin.programs" },
    { group: "access", title: "Role Impersonation", desc: "Switch into any role to verify what members see. Essential for testing RBAC.", icon: Eye, color: "#6a1b9a", path: "/admin/impersonate", perm: "admin.impersonate" },
    { group: "access", title: "Password Reset", desc: "Reset any member's password. Members should change it on next login.", icon: Key, color: "#e65100", path: "/admin/reset-password", perm: "admin.password_reset" },
    { group: "config", title: "Configurable Options", desc: "Edit dropdown lists system-wide — payment methods, event types, roles, shirt sizes, and more.", icon: Sliders, color: "#00695c", path: "/admin/config", perm: "admin.config" },
    { group: "config", title: "Sidebar Organizer", desc: "Arrange the navigation into sections — rename, reorder, and file each item where it belongs. Applies for everyone.", icon: List, color: "#455a64", path: "/admin/sidebar", perm: "admin.config" },
    { group: "config", title: "Modules", desc: "Turn TRCMS features on or off for your whole organization. Everything stays installed; this controls what appears and works. Dependencies cascade.", icon: Boxes, color: "#3949ab", path: "/admin/modules", perm: "admin.config" },
    { group: "config", title: "Compliance Settings", desc: "Name the trainings and checks your org requires (e.g. Youth Protection Training, Background Check), choose which apply, and which must be current to check in.", icon: ShieldAlert, color: "#b71c1c", path: "/admin/compliance", perm: "admin.config" },
    { group: "config", title: "Shipping Addresses", desc: "Add, edit, or remove the 'ship to' addresses offered when placing a purchase order.", icon: MapPin, color: "#0277bd", path: "/admin/shipping", perm: "admin.config" },
    { group: "content", title: "Social Media Links", desc: "Manage the TRC social links shown on the dashboard and member profiles (Instagram, Facebook, YouTube, X, TikTok…).", icon: Share2, color: "#c2185b", path: "/admin/social", perm: "admin.config" },
    { group: "config", title: "Email Settings", desc: "Outbound mail (SMTP) + all notification addresses, including incident report routing. Per-address test buttons. Falls back to server .env if unset.", icon: Mail, color: "#00838f", path: "/admin/email", perm: "admin.config" },
    { group: "config", title: "Payment Settings", desc: "Enable/disable online providers (Square, PayPal), set the card fee %, and manage the manual payment methods (cash, check, scholarship…) the admin team can record.", icon: CreditCard, color: "#2e7d32", path: "/admin/payments", perm: "admin.config" },
    { group: "content", title: "Help Articles", desc: "Write and manage the in-app Help Center — searchable articles (Markdown) that appear behind the ? button for members, grouped by category and optionally limited by role.", icon: BookOpen, color: "#5e35b1", path: "/admin/help", perm: "admin.config" },
    { group: "content", title: "Guided Tours", desc: "Create and edit step-by-step guided tours that walk members through a screen with tooltips. Launched from the ? Help panel; a dashboard tour is auto-offered to new users.", icon: Compass, color: "#7e57c2", path: "/admin/tours", perm: "admin.config" },
    { group: "programs", title: "Holidays & Closures", desc: "Add TRC-specific holidays and closures to the Events Calendar (US federal holidays are shown automatically). Single dates or ranges, optionally repeating each year.", icon: CalendarClock, color: "#00838f", path: "/admin/holidays", perm: "admin.config" },
    { group: "config", title: "GitHub Integration", desc: "Connect TRCMS to GitHub so you can push a feedback item to an Issue on your development Project board in one click.", icon: GitBranch, color: "#24292f", path: "/admin/github", perm: "admin.config" },
    { group: "config", title: "Resource Types", desc: "Define the kinds of resources teams track (GitHub, Drive, software, docs…) and the attributes each one captures.", icon: Boxes, color: "#5d4037", path: "/admin/resource-types", perm: "resources.manage" },
    { group: "access", title: "Station Accounts", desc: "Always-on kiosk logins for the parts room, event check-in, and visitor registration. Locked-down, hidden from reports.", icon: Monitor, color: "#5d4037", path: "/admin/stations", perm: "admin.roles" },
    { group: "security", title: "Security", desc: "Account lockout, geo-restriction (US/Canada), and a log of failed login attempts with IP addresses.", icon: ShieldAlert, color: "#c62828", path: "/admin/security", perm: "admin.security" },
    { group: "security", title: "Audit Log", desc: "View an immutable record of every data change. Filter by table or actor.", icon: List, color: "#455a64", path: "/admin/audit-log", perm: "admin.security" },
    { group: "programs", title: "FIRST Season Manager", desc: "Add seasons and edit game names (FLL Explore, FLL Challenge, FTC, FRC, FDP). These appear as checkboxes on every member profile.", icon: Trophy, color: "#f57c00", path: "/admin/seasons", adminOnly: true },
    { group: "programs", title: "Season Transition", desc: "A tracked readiness checklist for rolling to the next season — verify each step (budgets, enrollment, T&C, compliance) before you transition, with a record of who did what.", icon: CalendarClock, color: "#1565c0", path: "/admin/season-transition", perm: "seasons.manage" },
    { group: "programs", title: "Enrollment Season Management", desc: "Close expired seasons, manage grace periods, and set renewal reminder notifications for members.", icon: CalendarClock, color: "#1565c0", path: "/enrollment/admin", adminOnly: true },
    { group: "programs", title: "Scholarship Funds", desc: "Internal scholarship fund management — per-season General-Fund allocations, deposits, the awards ledger with live available balance, season close-out, and the Board report.", icon: GraduationCap, color: "#00695c", path: "/admin/scholarship-funds", perm: "scholarships.applications" },
    { group: "programs", title: "Scholarship Applications", desc: "Review confidential family-aid scholarship applications — decide, add board notes, and apply awards to a youth's (or family's) enrollments from a fund.", icon: GraduationCap, color: "#00838f", path: "/admin/scholarship-applications", perm: "scholarships.applications" },
    { group: "access", title: "Merge Duplicate Members", desc: "Combine two accounts created for the same person — move all records onto one and delete the duplicate, with a review step.", icon: GitMerge, color: "#6a1b9a", path: "/members/merge", perm: "members.merge" },
    { group: "access", title: "Groups", desc: "Member groups like the YLC, committees, or crews. Manage membership and tie events to a group so they surface on members' dashboards.", icon: UsersRound, color: "#5e35b1", path: "/groups", perm: "groups.manage" },
    { group: "programs", title: "Season Planning (FLL)", desc: "Plan the FLL season: set per-night team/youth capacity, email families a no-login availability form (which nights work, who'll mentor), and track responses. Board + auto-assign coming next.", icon: CalendarClock, color: "#1565c0", path: "/season-planning", adminOnly: true },
    { group: "security", title: "System Backups", desc: "Weekly full backups of the database and application files, with automatic rotation. Monitor recent backups and trigger one on demand. Backups are stored securely off the website.", icon: DatabaseBackup, color: "#37474f", path: "/admin/backups", sysAdminOnly: true },
    { group: "safety", title: "Incident Queue", desc: "Review, triage, assign, and close incident reports — medical, injury, behavior, near-miss. Track age so nothing sits.", icon: ShieldAlert, color: "#b23b3b", path: "/incidents", perm: "incidents.queue" },
    { group: "safety", title: "First Aid Log", desc: "Quick log of minor first aid (ice packs, bandages, scrapes). Promote to a Medical incident report when it's more than that.", icon: AlertTriangle, color: "#c2410c", path: "/first-aid", perm: "incidents.first_aid_log" },
    // Incident report routing now lives in Admin → Email Settings (with the other notification addresses).
  ] as { group: string; title: string; desc: string; icon: typeof Shield; color: string; path: string; perm?: string; adminOnly?: boolean; sysAdminOnly?: boolean }[];

  const tools = allTools.filter((t) =>
    t.sysAdminOnly ? hasRole("System Administrator") : t.perm ? canRead(t.perm) : (t.adminOnly ? isAdmin : true));

  // Category order + labels for the grouped, collapsible tool list. A tool's
  // `group` key ties it to one of these sections; a group with no visible tools
  // (all filtered out by permissions) is hidden entirely.
  const GROUPS: { key: string; label: string; icon: typeof Shield }[] = [
    { key: "access", label: "People & Access", icon: UsersRound },
    { key: "programs", label: "Programs & Seasons", icon: Trophy },
    { key: "config", label: "System Configuration", icon: Sliders },
    { key: "content", label: "Content & Help", icon: BookOpen },
    { key: "safety", label: "Safety & Incidents", icon: ShieldAlert },
    { key: "security", label: "Security & Data", icon: ShieldAlert },
  ];

  // Per-user collapse state, persisted like the sidebar. Sections start collapsed
  // to keep the page uncluttered; expand what you need and it's remembered.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("admin_sections_collapsed");
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return Object.fromEntries(GROUPS.map((g) => [g.key, true]));
  });
  const toggleSection = (key: string) =>
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      try { localStorage.setItem("admin_sections_collapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  return (
    <div>
      <div style={styles.pageHeader}>
        <h1 style={styles.heading}>Admin Console</h1>
        <p style={styles.sub}>System configuration, RBAC, and operational controls</p>
      </div>

      {/* System Health Strip */}
      {!loading && stats && (
        <div style={styles.healthStrip}>
          <HealthChip label="Total Members" value={stats.members.total} color="#1a3a5c" />
          <HealthChip label="Active Enrollments" value={stats.enrollments.active} color="#2e7d32" />
          <HealthChip
            label="Unpaid Enrollments"
            value={stats.enrollments.unpaid}
            color={stats.enrollments.unpaid > 0 ? "#c62828" : "#2e7d32"}
            warn={stats.enrollments.unpaid > 0}
          />
          <HealthChip
            label="T&C Pending"
            value={stats.enrollments.unsigned_tc}
            color={stats.enrollments.unsigned_tc > 0 ? "#f57c00" : "#2e7d32"}
            warn={stats.enrollments.unsigned_tc > 0}
          />
          <HealthChip
            label="New Visitors"
            value={stats.visitors.new}
            color={stats.visitors.new > 0 ? "#1565c0" : "#888"}
          />
          <HealthChip label="Check-Ins Today" value={stats.checkins_today} color="#1565c0" />
          <HealthChip label="Active Teams" value={stats.active_teams} color="#6a1b9a" />
        </div>
      )}

      {/* Enrollment year context */}
      {stats && (
        <div style={styles.yearNote}>
          Showing data for enrollment year{" "}
          <strong>{stats.enrollment_year}–{stats.enrollment_year + 1}</strong>
        </div>
      )}

      {/* Member breakdown */}
      {stats && (
        <div style={styles.memberBreakdown}>
          <div style={styles.breakdownTitle}>Active Members by Type</div>
          <div style={styles.breakdownGrid}>
            {[
              { label: "Youth", value: stats.members.youth, color: "#1565c0" },
              { label: "Mentors", value: stats.members.mentor, color: "#2e7d32" },
              { label: "Parents", value: stats.members.parent, color: "#e65100" },
              { label: "Volunteers", value: stats.members.volunteer, color: "#6a1b9a" },
            ].map(({ label, value, color }) => (
              <div key={label} style={styles.breakdownItem}>
                <div style={{ ...styles.breakdownNum, color }}>{value}</div>
                <div style={styles.breakdownLabel}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin Tools — grouped into collapsible categories */}
      <h2 style={styles.toolsHeading}>Admin Tools</h2>
      <div style={styles.sections}>
        {GROUPS.map((grp) => {
          const groupTools = tools.filter((t) => t.group === grp.key);
          if (groupTools.length === 0) return null;
          const isOpen = !collapsed[grp.key];
          const GroupIcon = grp.icon;
          return (
            <div key={grp.key} style={styles.section}>
              <button style={styles.sectionHead} onClick={() => toggleSection(grp.key)}>
                <GroupIcon size={16} style={{ flexShrink: 0, color: "#1a3a5c" }} />
                <span style={styles.sectionTitle}>{grp.label}</span>
                <span style={styles.sectionCount}>{groupTools.length}</span>
                {isOpen ? <ChevronDown size={16} color="#889" /> : <ChevronRight size={16} color="#889" />}
              </button>
              {isOpen && (
                <div style={styles.toolsGrid}>
                  {groupTools.map((t) => {
                    const Icon = t.icon;
                    return (
                      <div key={t.path} style={styles.toolCard} onClick={() => navigate(t.path)}
                        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")}
                        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.05)")}
                      >
                        <div style={{ ...styles.toolIcon, color: t.color }}><Icon size={24} /></div>
                        <div style={styles.toolBody}>
                          <div style={styles.toolTitle}>{t.title}</div>
                          <div style={styles.toolDesc}>{t.desc}</div>
                        </div>
                        <ChevronRight size={16} color="#ccc" style={{ alignSelf: "center", flexShrink: 0 }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Version Log */}
      <h2 style={styles.toolsHeading}>Version Log</h2>
      <VersionLog />
    </div>
  );
}

/** Compact version summary — just the current release; full history on its own page. */
function VersionLog() {
  // Show the CURRENT released version (APP_VERSION), not RELEASES[0] — the top entry
  // is the still-empty running changelog for the next (pending) release.
  const rel = RELEASES.find((r) => r.version === APP_VERSION) ?? RELEASES[0];
  if (!rel) return null;
  return (
    <div style={styles.versionWrap}>
      <div style={styles.versionCard}>
        <div style={styles.versionHead}>
          <span style={styles.versionTag}><Tag size={13} /> {rel.version}<span style={styles.currentTag}>current</span></span>
          <span style={styles.versionMeta}>Published by {rel.publisher} · {rel.date}</span>
        </div>
        <ReleaseHighlights highlights={rel.highlights} />
      </div>
      <Link to="/admin/version-history" style={styles.versionHistoryLink}>
        View full version history <ChevronRight size={14} style={{ verticalAlign: -2 }} />
      </Link>
    </div>
  );
}

function HealthChip({ label, value, color, warn }: {
  label: string; value: number; color: string; warn?: boolean;
}) {
  return (
    <div style={{ ...styles.healthChip, borderColor: warn ? color : "#e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
        {warn && <AlertTriangle size={13} color={color} />}
        <span style={{ ...styles.healthNum, color }}>{value}</span>
      </div>
      <span style={styles.healthLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { marginBottom: 20 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  healthStrip: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  healthChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 14px", background: "#fff", border: "2px solid #e2e8f0", borderRadius: 8, minWidth: 90 },
  healthNum: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  healthLabel: { fontSize: 10, color: "#888", fontWeight: 600, marginTop: 3, textAlign: "center" as const },
  yearNote: { fontSize: 12, color: "#888", marginBottom: 14 },
  memberBreakdown: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.5rem", marginBottom: 20 },
  breakdownTitle: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 12 },
  breakdownGrid: { display: "flex", gap: 32 },
  breakdownItem: { textAlign: "center" as const },
  breakdownNum: { fontSize: 28, fontWeight: 800, lineHeight: 1 },
  breakdownLabel: { fontSize: 12, color: "#888", fontWeight: 600, marginTop: 3 },
  toolsHeading: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "0 0 12px" },
  sections: { display: "flex", flexDirection: "column" as const, gap: 10, marginBottom: 24 },
  section: { display: "flex", flexDirection: "column" as const, gap: 10 },
  sectionHead: { display: "flex", alignItems: "center", gap: 10, width: "100%", background: "#f7fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px", cursor: "pointer", textAlign: "left" as const },
  sectionTitle: { fontSize: 14.5, fontWeight: 700, color: "#1a3a5c", flex: 1 },
  sectionCount: { fontSize: 12, fontWeight: 700, color: "#667", background: "#e2e8f0", borderRadius: 10, padding: "2px 9px" },
  toolsGrid: { display: "flex", flexDirection: "column", gap: 10 },
  toolCard: { display: "flex", alignItems: "flex-start", gap: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", transition: "box-shadow 0.15s" },
  toolIcon: { flexShrink: 0, marginTop: 2 },
  toolBody: { flex: 1 },
  toolTitle: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", marginBottom: 3 },
  toolDesc: { fontSize: 13, color: "#666", lineHeight: 1.6 },
  versionWrap: { display: "flex", flexDirection: "column" as const, gap: 12, marginBottom: 24 },
  versionHistoryLink: { display: "inline-flex", alignItems: "center", gap: 4, color: "#1565c0", textDecoration: "none", fontSize: 13, fontWeight: 600, alignSelf: "flex-start" },
  versionCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem" },
  versionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #f0f4f8" },
  versionHeadBtn: { display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" as const, flexWrap: "wrap" as const },
  versionCount: { marginLeft: "auto", fontSize: 12, color: "#999", background: "#f0f4f8", borderRadius: 10, padding: "2px 9px" },
  versionTag: { display: "flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  currentTag: { fontSize: 10, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "2px 8px", textTransform: "uppercase" as const, letterSpacing: 0.4 },
  versionMeta: { fontSize: 12, color: "#888" },
  versionList: { margin: 0, paddingLeft: 18 },
  versionItem: { fontSize: 13, color: "#444", lineHeight: 1.6 },
};
