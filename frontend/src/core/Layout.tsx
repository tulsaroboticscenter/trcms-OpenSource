import { type ReactNode, useRef, useEffect, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { LogOut, Home, Shield, Users, UserCheck, ClipboardList,
  Calendar, BarChart2, UsersRound, Package, Award, Mail, Bell, ShoppingCart, ListChecks, Clock, Boxes, DollarSign, CalendarClock, Trophy, MessageSquarePlus, Tent, Wrench, Megaphone, Handshake, FileText, Sparkles, CheckSquare, NotebookPen, GraduationCap, Gift, Target, Menu, X, HelpCircle, Search as SearchIcon, Map as MapIcon, ChevronDown, ChevronRight } from "lucide-react";
import HelpPanel from "../modules/help/HelpPanel";
import CommandPalette from "./CommandPalette";
import { useHelp } from "../modules/help/HelpContext";
import { api } from "./api";
import { allNavItems } from "../moduleRegistry";
import ConnectionBanner from "./ConnectionBanner";
import { useIsMobile } from "./useIsMobile";
import { useUsageTracker } from "./useUsageTracker";

// Icon lookup — maps iconName strings from module manifests to lucide components
const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Home, Shield, Users, UserCheck, ClipboardList,
  Calendar, BarChart2, UsersRound, Package, Award, Mail, Bell, ShoppingCart, ListChecks, Clock, Boxes, DollarSign, CalendarClock, Trophy, Tent, Wrench, Megaphone, Handshake, FileText, Sparkles, CheckSquare, NotebookPen, GraduationCap, Gift, Target,
};

// Active-aware style for a sidebar NavLink (the active highlight follows the
// current route; React Router clears it automatically on navigation).
const navStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties =>
  ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) });

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, isAdmin, hasRole, canViewModule, canRead, branding } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { open: helpOpen, helpKey, openHelp, closeHelp } = useHelp();

  // Close the mobile nav drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Emit the usage stream (page views + heartbeats) for the User Activity report.
  useUsageTracker(!!user && !user.is_kiosk);

  // "Needs your action" counts (approvals / overdue / BOMs) for the nav badges.
  const [actionCounts, setActionCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!user || user.is_kiosk) return;
    let alive = true;
    const load = () => api.get("/api/v1/action-items")
      .then((r) => { if (alive) setActionCounts((r.data?.modules ?? {}) as Record<string, number>); })
      .catch(() => {});
    load();
    const t = setInterval(load, 120000); // refresh every 2 min
    return () => { alive = false; clearInterval(t); };
  }, [user, location.pathname]);

  // The Admin console is reachable by a full admin OR anyone granted any single
  // administrative capability (so fine-tuned roles can use just what they have).
  const ADMIN_PERMS = ["admin.roles", "admin.programs", "admin.impersonate", "admin.password_reset",
    "admin.config", "admin.security", "admin.system_stats", "admin.layouts",
    "members.create", "members.merge", "members.archive", "members.system_permissions", "groups.manage"];
  const canSeeAdmin = isAdmin || ADMIN_PERMS.some((k) => canRead(k));

  // Sidebar organisation (admin-configurable, stored server-side). Null until loaded /
  // if it fails — in that case the nav falls back to a flat, ungrouped list.
  const [navSections, setNavSections] = useState<{ id: string; label: string; collapsed: boolean; items: string[] }[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("nav_collapsed") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    const load = () => api.get("/api/v1/nav-layout").then((r) => setNavSections(r.data?.sections ?? [])).catch(() => setNavSections([]));
    load();
    const h = () => load();
    window.addEventListener("trc:nav-layout-changed", h);
    return () => window.removeEventListener("trc:nav-layout-changed", h);
  }, []);
  function toggleSection(id: string, def: boolean) {
    setCollapsed((prev) => {
      const cur = prev[id] ?? def;
      const next = { ...prev, [id]: !cur };
      try { localStorage.setItem("nav_collapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // Scroll back to the top whenever the route changes, so a click that opens a
  // new page never leaves the user stranded partway down the previous scroll.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  // Filter nav items by role AND by per-role module visibility ("Not Visible").
  // Exception: a station/kiosk account is deny-by-default, so an explicit module
  // grant (e.g. giving the Check-In station access to Visitors) is enough to show
  // that item even though the station lacks the usual staff role. Non-kiosk users
  // are unaffected — their role gate still applies.
  const isKiosk = !!user?.is_kiosk;
  const visibleNav = allNavItems.filter((item) => {
    const { requiredRoles, moduleId } = item;
    if (!canViewModule(moduleId)) return false;
    // Optional permission gate: hide the item unless the user has read on this key.
    const reqPerm = (item as { requiredPermission?: string }).requiredPermission;
    if (reqPerm && !canRead(reqPerm)) return false;
    if (requiredRoles.length === 0 || hasRole(...requiredRoles)) return true;
    return isKiosk; // kiosk reaching here means the module was explicitly granted
  });

  // Every sidebar entry the user can see, keyed by route — module items plus the
  // hardcoded ones (YLC, Compliance, TRCF Board, Admin). The nav-layout config files
  // these into sections by route.
  type Entry = { route: string; label: string; iconName: string; badge: number };
  const entries: Entry[] = visibleNav.map((n) => ({ route: n.to, label: n.label, iconName: n.iconName, badge: actionCounts[n.moduleId] ?? 0 }));
  if (isAdmin || hasRole("Mentor")) entries.push({ route: "/roles/ylc", label: "YLC", iconName: "Award", badge: 0 });
  // YLC youth (and other non-mentor members of the council) reach their meeting page here —
  // /roles/ylc is the mentor-only management view, so they'd otherwise have no way in.
  else if ((user?.group_names ?? []).includes("YLC")) entries.push({ route: "/minutes?group=YLC", label: "YLC", iconName: "Award", badge: 0 });
  if (isAdmin) entries.push({ route: "/roles/compliance", label: "Compliance", iconName: "Shield", badge: 0 });
  if (isAdmin || (user?.group_names ?? []).includes("TRCF Board")) entries.push({ route: "/minutes?group=TRCF%20Board", label: "TRCF Board", iconName: "NotebookPen", badge: 0 });
  // Program Team minutes are visible to everyone (management stays limited to its members),
  // but never on a station/kiosk — a public-facing check-in screen shouldn't surface it.
  if (!isKiosk) entries.push({ route: "/minutes?group=Program%20Team", label: "Program Team", iconName: "NotebookPen", badge: 0 });
  if (canSeeAdmin) entries.push({ route: "/admin", label: "Admin", iconName: "Shield", badge: 0 });
  const entryByRoute = new Map(entries.map((e) => [e.route, e]));

  const renderEntry = (e: Entry) => {
    const Icon = ICON_MAP[e.iconName] ?? Home;
    return (
      <NavLink key={e.route} to={e.route} className="trc-nav-link" style={navStyle}>
        <Icon size={18} />
        <span>{e.label}</span>
        {e.badge > 0 && <span style={styles.navBadge} title={`${e.badge} item${e.badge === 1 ? "" : "s"} need your attention`}>{e.badge}</span>}
      </NavLink>
    );
  };

  return (
    <div style={{ ...styles.shell, ...(isMobile ? styles.shellMobile : {}) }}>
      {/* Mobile top bar with hamburger */}
      {isMobile && (
        <header style={styles.topbar}>
          <button style={styles.iconBtn} onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu size={24} />
          </button>
          {branding.logo_url
            ? <img src={branding.logo_url} alt={branding.name} style={styles.topbarLogo} />
            : <span style={styles.topbarWordmark}>{branding.short_name}</span>}
          <button style={styles.iconBtn} onClick={handleLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={20} />
          </button>
        </header>
      )}

      {/* Drawer backdrop */}
      {isMobile && drawerOpen && <div style={styles.backdrop} onClick={() => setDrawerOpen(false)} />}

      <nav
        style={{
          ...styles.sidebar,
          ...(isMobile ? styles.drawer : {}),
          ...(isMobile && !drawerOpen ? styles.drawerClosed : {}),
        }}
        onClick={() => isMobile && setDrawerOpen(false)}
      >
        <div style={styles.brand}>
          {isMobile && (
            <button style={styles.drawerClose} onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
          )}
          {branding.logo_url
            ? <img src={branding.logo_url} alt={branding.name} style={styles.brandLogo} />
            : <span style={styles.brandWordmark}>{branding.short_name}</span>}
        </div>
        <div style={styles.navLinks}>
          {/* Quick jump-to search — opens the command palette (also Ctrl/Cmd-K). */}
          {!isKiosk && (
            <button
              type="button"
              className="trc-nav-link"
              style={styles.searchBtn}
              onClick={() => window.dispatchEvent(new Event("trc:open-command"))}
            >
              <SearchIcon size={16} />
              <span style={{ flex: 1, textAlign: "left" }}>Search…</span>
              <kbd style={styles.searchKbd}>Ctrl K</kbd>
            </button>
          )}

          {/* NavLink applies the active style only to the current route (and clears
              it on navigation); `end` keeps Dashboard active only at exactly "/". */}
          {/* Dashboard always first */}
          <NavLink to="/" end className="trc-nav-link" style={navStyle}>
            <Home size={18} />
            <span>Dashboard</span>
          </NavLink>

          {/* Grouped, collapsible sections from the admin-configured nav layout. While it
              loads (or if it fails) fall back to a flat list so the nav is never empty. */}
          {navSections === null ? (
            entries.map(renderEntry)
          ) : (
            <>
              {navSections.map((section) => {
                const items = section.items.map((r) => entryByRoute.get(r)).filter(Boolean) as Entry[];
                if (items.length === 0) return null;
                const isCollapsed = collapsed[section.id] ?? section.collapsed;
                return (
                  <div key={section.id} style={styles.navGroup}>
                    <button type="button" style={styles.navSectionHeader}
                      onClick={() => toggleSection(section.id, section.collapsed)}
                      aria-expanded={!isCollapsed}>
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <span>{section.label}</span>
                    </button>
                    {!isCollapsed && items.map(renderEntry)}
                  </div>
                );
              })}
              {/* Anything not filed into a section (e.g. a newly-added module) shows here,
                  so nothing ever disappears until an admin files it. */}
              {(() => {
                const assigned = new Set(navSections.flatMap((s) => s.items));
                const leftover = entries.filter((e) => !assigned.has(e.route));
                if (leftover.length === 0) return null;
                const isCollapsed = collapsed["__more"] ?? false;
                return (
                  <div style={styles.navGroup}>
                    <button type="button" style={styles.navSectionHeader}
                      onClick={() => toggleSection("__more", false)} aria-expanded={!isCollapsed}>
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <span>More</span>
                    </button>
                    {!isCollapsed && leftover.map(renderEntry)}
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Discreet feedback link — kept out of the main module nav to reduce clutter */}
        <NavLink to="/feedback" className="trc-nav-link" style={({ isActive }) => ({ ...styles.feedbackLink, ...(isActive ? { color: "#fff" } : {}) })}>
          <MessageSquarePlus size={14} />
          <span>Report a bug / request a feature</span>
        </NavLink>

        <div style={styles.userSection}>
          <div style={styles.userName}>{user?.first_name} {user?.last_name}</div>
          <div style={styles.userRole}>{user?.roles[0] ?? user?.member_type}</div>
          <div style={styles.userBtns}>
            <button onClick={() => navigate("/change-password")} style={styles.changePwBtn} title="Change your password">
              <Shield size={12} /> Change PW
            </button>
            <button onClick={handleLogout} style={styles.logoutBtn}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </nav>
      <div style={{ ...styles.mainWrap, ...(isMobile ? styles.mainWrapMobile : {}) }} ref={mainRef}>
        {/* Connection-lost warning so a failed load is never mistaken for missing data */}
        <ConnectionBanner />
        {/* Impersonation banner */}
        {localStorage.getItem("trc_impersonating") && (
          <div style={styles.impersonateBanner}>
            👁 Impersonating role: <strong>{localStorage.getItem("trc_impersonating")}</strong>
            <button style={styles.stopImpersonateBtn} onClick={() => navigate("/admin/impersonate")}>
              Stop →
            </button>
          </div>
        )}
        {/* No-roles notice — the member has no system role assigned yet. */}
        {user && !user.is_kiosk && (() => {
          const roles = user.roles ?? [];
          const onlyDefault = roles.length === 0 || (roles.length === 1 && roles[0] === "Default");
          return onlyDefault;
        })() && (
          <div style={styles.noRolesBanner}>
            ⚠ Your user roles have not been set in the system. Please contact the Admin team to have your roles set.
          </div>
        )}
        <main style={{ ...styles.main, ...(isMobile ? styles.mainMobile : {}) }}>{children}</main>
      </div>

      {/* Profile shortcut — avatar top-right, opens your own profile */}
      {user && !user.is_kiosk && !isMobile && (
        <button style={styles.profileFab} onClick={() => navigate(`/members/${user.id}`)}
          title={`${user.first_name} ${user.last_name ?? ""} — open my profile`} aria-label="My profile">
          {user.photo_url
            ? <img src={user.photo_url} alt="" style={styles.profileFabImg} />
            : <span>{(user.first_name?.[0] ?? "") + (user.last_name?.[0] ?? "")}</span>}
        </button>
      )}

      {/* Global Site Map + Help — floating buttons */}
      {user && !user.is_kiosk && (
        <button style={styles.siteMapFab} onClick={() => navigate("/site-map")} title="Site Map — all features" aria-label="Site Map">
          <MapIcon size={22} />
        </button>
      )}
      {user && !user.is_kiosk && (
        <button style={styles.helpFab} onClick={() => openHelp()} title="Help" aria-label="Help">
          <HelpCircle size={22} />
        </button>
      )}
      <HelpPanel open={helpOpen} onClose={closeHelp} initialHelpKey={helpKey} />

      {/* Global jump-to command palette (Ctrl/Cmd-K) */}
      {user && !user.is_kiosk && <CommandPalette />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  helpFab: { position: "fixed", right: 18, bottom: 18, width: 46, height: 46, borderRadius: "50%", background: "#1a3a5c", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.28)", zIndex: 1100 },
  siteMapFab: { position: "fixed", right: 74, bottom: 18, width: 46, height: 46, borderRadius: "50%", background: "#37474f", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.28)", zIndex: 1100 },
  profileFab: { position: "fixed", top: 14, right: 18, width: 40, height: 40, borderRadius: "50%", background: "#1a3a5c", color: "#fff", border: "2px solid #fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.25)", zIndex: 1100, padding: 0 },
  profileFabImg: { width: "100%", height: "100%", objectFit: "cover" },
  shell: { display: "flex", minHeight: "100vh", background: "#f0f4f8" },
  shellMobile: { flexDirection: "column" },
  // Mobile top bar
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#000", color: "#fff", padding: "8px 12px", position: "sticky", top: 0, zIndex: 50, height: 52 },
  topbarLogo: { height: 30, width: "auto" },
  topbarWordmark: { fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: 0.5 },
  iconBtn: { background: "transparent", border: "none", color: "#fff", padding: 6, cursor: "pointer", display: "flex", alignItems: "center" },
  // Off-canvas drawer (mobile)
  drawer: { position: "fixed", top: 0, left: 0, height: "100vh", width: 260, zIndex: 60, transform: "translateX(0)", transition: "transform 0.22s ease", boxShadow: "2px 0 16px rgba(0,0,0,0.3)", overflowY: "auto" },
  drawerClosed: { transform: "translateX(-100%)", boxShadow: "none" },
  drawerClose: { position: "absolute", top: 10, right: 10, background: "transparent", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", padding: 4 },
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 55 },
  sidebar: { width: 220, background: "#000", color: "#fff", display: "flex", flexDirection: "column", padding: "1rem 0" },
  brand: { padding: "14px 16px", marginBottom: "0.5rem", background: "#000", borderBottom: "1px solid rgba(255,255,255,0.1)" },
  brandLogo: { width: "100%", height: "auto", display: "block" },
  brandWordmark: { fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: 1, display: "block", textAlign: "center", padding: "8px 0" },
  navLinks: { flex: 1, padding: "1rem 0" },
  navGroup: { marginBottom: 2 },
  navSectionHeader: { display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "9px 1.25rem 5px", background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left" },
  navBadge: { marginLeft: "auto", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "#e53935", color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 },
  searchBtn: { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 1.25rem", margin: "0 0 6px", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "none", borderLeft: "3px solid transparent", fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  searchKbd: { fontSize: 10, background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)", borderRadius: 4, padding: "2px 5px" },
  navLink: { display: "flex", alignItems: "center", gap: 10, padding: "10px 1.25rem", color: "rgba(255,255,255,0.75)", textDecoration: "none", fontSize: 14, borderLeft: "3px solid transparent" },
  // Use the full `borderLeft` shorthand (NOT borderLeftColor) — mixing shorthand
  // here with the shorthand on navLink made React leave the colored border behind
  // on items that were previously active.
  navLinkActive: { color: "#fff", background: "rgba(255,255,255,0.1)", borderLeft: "3px solid #4dabf7" },
  feedbackLink: { display: "flex", alignItems: "center", gap: 8, padding: "10px 1.25rem", color: "rgba(255,255,255,0.55)", textDecoration: "none", fontSize: 12.5, borderTop: "1px solid rgba(255,255,255,0.1)" },
  userSection: { padding: "1rem 1.25rem", borderTop: "1px solid rgba(255,255,255,0.1)" },
  userName: { fontWeight: 600, fontSize: 13 },
  userRole: { fontSize: 11, opacity: 0.6, marginBottom: 8 },
  userBtns: { display: "flex", gap: 6 },
  changePwBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.7)", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 },
  logoutBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.7)", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 },
  mainWrap: { flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" },
  mainWrapMobile: { width: "100%" },
  // Extra bottom padding on mobile so page content (e.g. a form's Submit
  // button) can scroll clear of the fixed Site Map / Help buttons.
  mainMobile: { padding: "1rem", paddingBottom: 88 },
  impersonateBanner: { background: "#4a148c", color: "#fff", padding: "8px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 12 },
  noRolesBanner: { background: "#fff3e0", color: "#8a5a00", borderBottom: "1px solid #ffcc80", padding: "10px 20px", fontSize: 13, fontWeight: 600 },
  stopImpersonateBtn: { marginLeft: "auto", padding: "4px 12px", background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  main: { flex: 1, padding: "2rem" },
};
