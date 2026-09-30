import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import DashboardPane from "./DashboardPane";
import { usePanelLayout, usePanelHidden } from "../modules/members/hooks/usePanelLayout";
import { useIsMobile } from "./useIsMobile";
import DiscordPortal from "../modules/teams/components/DiscordPortal";
import { allDashboardTiles } from "../moduleRegistry";
import {
  Users, UserCheck, ClipboardList, Calendar,
  Package, Cpu, Award, UsersRound, Home, Shield, BarChart2,
  Bell, Clock, AlertTriangle, ShoppingCart, User, ListChecks, Boxes, DollarSign, CalendarClock, Trophy, Wrench, Megaphone, Handshake, FileText, Sparkles, GraduationCap, Gift, Target, LayoutGrid, Eye,
} from "lucide-react";
import { MyActivitiesPanel, MyPrivateTasksPanel } from "../modules/planning";
import { MyTimeWeekPanel } from "../modules/activity";
import CheckinBanner from "../modules/activity/CheckinBanner";
import EarningsToDoBanner from "../modules/events/components/EarningsToDoBanner";
import MyYouthPanel from "../modules/members/components/MyYouthPanel";
import FamilyEnrollmentCheckout from "../modules/payments/FamilyEnrollmentCheckout";
import FamilyPaymentPlanPanel from "../modules/enrollment/components/FamilyPaymentPlanPanel";
import DonationBox from "../modules/payments/DonationBox";
import GrantRemindersBanner from "../modules/grants/components/GrantRemindersBanner";
import SponsorRemindersBanner from "../modules/sponsors/components/SponsorRemindersBanner";
import VisitorFollowupsBanner from "../modules/visitors/components/VisitorFollowupsBanner";
import EnrollmentAlertsBanner from "../modules/enrollment/components/EnrollmentAlertsBanner";
import MentorTcBanner from "../modules/enrollment/components/MentorTcBanner";
import SocialLinksPanel from "../modules/social/SocialLinksPanel";
import MyGroupEventsPanel from "../modules/groups/MyGroupEventsPanel";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Users, UserCheck, ClipboardList, Calendar,
  Package, Cpu, Award, UsersRound, Home, Shield, BarChart2, ShoppingCart, ListChecks, Clock, Boxes, DollarSign, CalendarClock, Trophy, Wrench, Megaphone, Handshake, FileText, Sparkles, GraduationCap, Gift, Target,
};

// Default top-to-bottom order of the arrangeable dashboard panes. A member's saved
// order overrides this; panes added here later append to the end of their layout.
const DEFAULT_DASH_ORDER = [
  "my_personal_tasks", "group_events", "my_youth", "family_checkout", "payment_plan",
  "donation", "earnings_todo", "my_time", "my_tasks",
];

export default function Dashboard() {
  const { user, hasRole, canViewModule, canRead, branding } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Filter tiles by role AND per-role module visibility ("Not Visible")
  const activeTiles = allDashboardTiles.filter((tile) =>
    (tile.requiredRoles.length === 0 || hasRole(...tile.requiredRoles)) && canViewModule(tile.moduleId)
    && (!(tile as { requiredPermission?: string }).requiredPermission || canRead((tile as { requiredPermission?: string }).requiredPermission!))
  );

  const enrollmentStatus = user?.enrollment_status;
  const renewalReminder = user?.renewal_reminder;
  const complianceWarning = user?.compliance_warning;

  // Per-user dashboard layout. Order and hidden set persist in ui_preferences, so
  // they follow the member between devices — same mechanism the member profile uses.
  const { order, setOrder } = usePanelLayout(DEFAULT_DASH_ORDER, "dashboard_panels");
  const { hidden, setHidden } = usePanelHidden("dashboard_hidden");
  const [arranging, setArranging] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  // Everything the dashboard *can* show, keyed by the IDs used in the saved order.
  const paneDefs: Record<string, { label: string; node: React.ReactNode }> = {
    my_personal_tasks: { label: "My Tasks",          node: user ? <MyPrivateTasksPanel /> : null },
    group_events:    { label: "My Group Events",     node: <MyGroupEventsPanel /> },
    my_youth:        { label: "My Youth",            node: <MyYouthPanel /> },
    family_checkout: { label: "Family Checkout",     node: <FamilyEnrollmentCheckout /> },
    payment_plan:    { label: "Payment Plan",        node: <FamilyPaymentPlanPanel /> },
    donation:        { label: "Donate",              node: <DonationBox /> },
    earnings_todo:   { label: "Apply Earnings",      node: user ? <EarningsToDoBanner memberId={user.id} /> : null },
    my_time:         { label: "My Time This Week",   node: user && canViewModule("activity") ? <MyTimeWeekPanel memberId={user.id} /> : null },
    my_tasks:        { label: "My Assigned Tasks",   node: user && canViewModule("planning") ? (
      <div style={styles.activitiesPane}>
        <div style={styles.activitiesHead}><ListChecks size={15} /> My Assigned Tasks</div>
        <MyActivitiesPanel memberId={user.id} />
      </div>
    ) : null },
  };

  const arrangeable = order
    .filter((id) => !hidden.includes(id) && paneDefs[id]?.node)
    .map((id) => ({ id, ...paneDefs[id] }));
  // Only offer to restore panes this member could actually see again.
  const hiddenPanes = hidden.filter((id) => paneDefs[id]?.node).map((id) => ({ id, ...paneDefs[id] }));

  const hide = (id: string) => setHidden([...hidden, id]);
  const restore = (id: string) => setHidden(hidden.filter((h) => h !== id));

  function handleDragOver(e: React.DragEvent, _id: string) { e.preventDefault(); }
  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragging || dragging === targetId) { setDragging(null); return; }
    const next = [...order];
    const from = next.indexOf(dragging);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) { setDragging(null); return; }
    next.splice(from, 1);
    next.splice(to, 0, dragging);
    setOrder(next);
    setDragging(null);
  }

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={{ ...styles.heading, ...(isMobile ? { fontSize: 22 } : {}) }}>Welcome back, {user?.first_name}!</h1>
          <p style={styles.sub}>{branding.name} — {branding.tagline}</p>
        </div>
        {/* TRC social links — compact, top-right; renders nothing if none configured */}
        <SocialLinksPanel variant="compact" />
      </div>

      {/* Quick links — straight to the member's own page and their team(s) */}
      <div style={styles.quickLinks}>
        <button style={styles.myPageBtn} onClick={() => navigate(`/members/${user?.id}`)}>
          <User size={14} /> My Page
        </button>
        {(user?.teams ?? []).map((t) => (
          <button key={t.team_season_id} style={styles.teamLinkBtn}
            onClick={() => navigate(`/teams/season/${t.team_season_id}`)}>
            <UsersRound size={14} /> {t.team_name}{t.team_number ? ` (#${t.team_number})` : ""}
          </button>
        ))}
      </div>

      {/* Check in to an event that's happening right now (#186) */}
      <CheckinBanner />

      {/* Login nudge: unpaid enrollments / incomplete T&C for self + family youth */}
      <EnrollmentAlertsBanner />

      {/* Mentors: renew the annual TRC T&C for the current season. */}
      <MentorTcBanner />

      {/* Grant reminders (visible to grant-permitted users) */}
      <GrantRemindersBanner />
      <SponsorRemindersBanner />
      <VisitorFollowupsBanner />

      {/* Arrangeable panes — order and hidden set are per-user (ui_preferences).
          Compliance/enrollment banners above are deliberately NOT in here: those
          are things we need people to see, not decorate around. */}
      {arrangeable.length > 0 && (
        <div style={styles.arrangeBar}>
          <button style={arranging ? styles.arrangeBtnOn : styles.arrangeBtn} onClick={() => setArranging((a) => !a)}>
            <LayoutGrid size={13} /> {arranging ? "Done arranging" : "Arrange panes"}
          </button>
          {arranging && <span style={styles.arrangeHint}>Drag a pane to move it. Changes save automatically.</span>}
          {hiddenPanes.length > 0 && (
            <div style={styles.hiddenChips}>
              <span style={styles.hiddenLbl}>Hidden:</span>
              {hiddenPanes.map((p) => (
                <button key={p.id} style={styles.restoreChip} onClick={() => restore(p.id)} title={`Show "${p.label}" again`}>
                  <Eye size={11} /> {p.label}
                </button>
              ))}
              <button style={styles.restoreAll} onClick={() => setHidden([])}>Show all</button>
            </div>
          )}
        </div>
      )}

      {arrangeable.map((p) => (
        <DashboardPane
          key={p.id} id={p.id} label={p.label} arranging={arranging} dragging={dragging}
          onHide={hide} onDragStart={setDragging} onDragOver={handleDragOver}
          onDrop={handleDrop} onDragEnd={() => setDragging(null)}
        >
          {p.node}
        </DashboardPane>
      ))}

      {/* Renewal reminder banner — set by admin */}
      {renewalReminder?.enabled && (
        <div style={styles.reminderBanner}>
          <Bell size={16} />
          <div style={{ flex: 1 }}>
            <strong>Enrollment Reminder</strong>
            <div style={styles.reminderMsg}>{renewalReminder.message}</div>
          </div>
          <button
            style={styles.enrollNowBtn}
            onClick={() => navigate(`/members/${user?.id}`)}
          >
            View My Enrollment →
          </button>
        </div>
      )}

      {/* Grace period warning — shown while inside the renewal window (through 8/31) */}
      {enrollmentStatus?.in_grace_period && (
        <div style={styles.graceBanner}>
          <Clock size={16} />
          <div style={{ flex: 1 }}>
            <strong>Grace Period Active</strong> — You haven't enrolled for the new season yet.
            <div style={styles.graceDetails}>
              Full access continues until <strong>{enrollmentStatus.grace_ends}</strong>{" "}
              ({enrollmentStatus.grace_days_remaining} day{enrollmentStatus.grace_days_remaining !== 1 ? "s" : ""} remaining).
              Please re-enroll soon.
            </div>
          </div>
          <button
            style={styles.enrollNowBtn}
            onClick={() => navigate(`/members/${user?.id}`)}
          >
            Enroll Now →
          </button>
        </div>
      )}

      {/* Not enrolled and grace period is over */}
      {enrollmentStatus && !enrollmentStatus.enrolled && !enrollmentStatus.in_grace_period && (
        <div style={styles.notEnrolledBanner}>
          <AlertTriangle size={16} />
          <div style={{ flex: 1 }}>
            <strong>Not Enrolled</strong> — You don't have an active enrollment for the{" "}
            {enrollmentStatus.enrollment_year}–{enrollmentStatus.enrollment_year + 1} season.
            Some features may be restricted until you enroll.
          </div>
          <button
            style={styles.enrollNowBtn}
            onClick={() => navigate(`/members/${user?.id}`)}
          >
            Enroll Now →
          </button>
        </div>
      )}

      {/* Compliance warning for mentors */}
      {complianceWarning && (complianceWarning.has_warning || !complianceWarning.is_compliant) && (
        <div style={{
          ...styles.graceBanner,
          background: !complianceWarning.is_compliant ? "#ffebee" : "#fff8e1",
          borderColor: !complianceWarning.is_compliant ? "#ef9a9a" : "#ffd54f",
          color: !complianceWarning.is_compliant ? "#c62828" : "#f57c00",
        }}>
          <Clock size={16} />
          <div style={{ flex: 1 }}>
            <strong>FIRST Compliance {complianceWarning.is_compliant ? "Expiring Soon" : "Expired"}</strong>
            <div style={{ marginTop: 3, fontWeight: 400 }}>
              {complianceWarning.ypt.expiring_soon && `YPT expires ${new Date(complianceWarning.ypt.expires_date!).toLocaleDateString()} (${complianceWarning.ypt.days_remaining}d). `}
              {complianceWarning.ypt.expired && `YPT expired. `}
              {complianceWarning.background_check.expiring_soon && `Background check expires ${new Date(complianceWarning.background_check.expires_date!).toLocaleDateString()} (${complianceWarning.background_check.days_remaining}d). `}
              {complianceWarning.background_check.expired && `Background check expired. `}
              Please renew to maintain mentor access.{" "}
              <span
                style={{ textDecoration: "underline", fontWeight: 600, cursor: "pointer" }}
                onClick={() => navigate("/help/youth-protection-training")}
              >
                View YPT instructions
              </span>
            </div>
          </div>
          <button style={styles.enrollNowBtn} onClick={() => navigate(`/members/${user?.id}`)}>
            Update Compliance →
          </button>
        </div>
      )}

      <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
        {/* Active module tiles */}
        {activeTiles.map(({ label, to, iconName, color, description }) => {
          const Icon = ICON_MAP[iconName] ?? Users;
          return (
            <button key={to} onClick={() => navigate(to)} style={{ ...styles.tile, ...(isMobile ? styles.tileMobile : {}), borderTopColor: color }}>
              <div style={{ ...styles.tileIcon, color, ...(isMobile ? { marginBottom: 6 } : {}) }}><Icon size={isMobile ? 26 : 32} /></div>
              <div style={styles.tileLabel}>{label}</div>
              {!isMobile && <div style={styles.tileDesc}>{description}</div>}
            </button>
          );
        })}
      </div>

      {/* Discord Portal — only shown to members who have active team assignments with Discord links */}
      <DiscordPortal />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  arrangeBar: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 12px" },
  arrangeBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 7, fontSize: 12.5, fontWeight: 600, color: "#4a5b6d", cursor: "pointer" },
  arrangeBtnOn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid #00695c", background: "#00695c", color: "#fff", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  arrangeHint: { fontSize: 12, color: "#7a8899" },
  hiddenChips: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  hiddenLbl: { fontSize: 11.5, fontWeight: 700, color: "#8b98a6", textTransform: "uppercase", letterSpacing: 0.4 },
  restoreChip: { display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", border: "1px dashed #b9c6d4", background: "#f7fafc", borderRadius: 20, fontSize: 11.5, fontWeight: 600, color: "#5a6b7d", cursor: "pointer" },
  restoreAll: { padding: "4px 9px", border: "none", background: "none", fontSize: 11.5, fontWeight: 700, color: "#00695c", cursor: "pointer", textDecoration: "underline" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" as const },
  heading: { margin: 0, fontSize: 28, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 12px", color: "#666", fontSize: 14 },
  quickLinks: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  activitiesPane: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 18 },
  activitiesHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 12 },
  myPageBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  teamLinkBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  reminderBanner: { display: "flex", alignItems: "flex-start", gap: 12, background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 10, padding: "14px 16px", marginBottom: 14, color: "#1565c0", fontSize: 13 },
  reminderMsg: { marginTop: 3, color: "#1565c0", fontWeight: 400 },
  graceBanner: { display: "flex", alignItems: "flex-start", gap: 12, background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 10, padding: "14px 16px", marginBottom: 14, color: "#e65100", fontSize: 13 },
  graceDetails: { marginTop: 3, color: "#e65100", fontWeight: 400 },
  notEnrolledBanner: { display: "flex", alignItems: "flex-start", gap: 12, background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 10, padding: "14px 16px", marginBottom: 14, color: "#c62828", fontSize: 13 },
  enrollNowBtn: { flexShrink: 0, padding: "7px 14px", background: "rgba(0,0,0,0.08)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "inherit", whiteSpace: "nowrap" as const },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1.25rem" },
  gridMobile: { gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" },
  tile: { background: "#fff", border: "1px solid #e2e8f0", borderTop: "4px solid #ccc", borderRadius: 10, padding: "1.5rem 1rem", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "pointer" },
  tileMobile: { padding: "1rem 0.5rem" },
  tileIcon: { marginBottom: 12 },
  tileLabel: { fontWeight: 700, fontSize: 14, color: "#1a3a5c", marginBottom: 4 },
  tileDesc: { fontSize: 12, color: "#888" },
};
