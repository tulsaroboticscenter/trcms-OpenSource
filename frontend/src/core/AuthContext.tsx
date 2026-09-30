import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "./api";

interface EnrollmentStatus {
  enrolled: boolean;
  enrollment_year: number;
  in_grace_period: boolean;
  grace_days_remaining?: number;
  grace_ends?: string;
  can_participate: boolean;
  tc_ok?: boolean;
  requires_tc?: boolean;
  payment_ok?: boolean;
}

interface RenewalReminder {
  enabled: boolean;
  message: string;
  target_year: number;
}

interface ComplianceItemStatus {
  status: "valid" | "expiring_soon" | "expired" | "unknown";
  days_remaining?: number;
  expires_date?: string;
  expiring_soon: boolean;
  expired: boolean;
  completed_date?: string;
}

export interface ComplianceWarning {
  is_compliant: boolean;
  has_warning: boolean;
  ypt: ComplianceItemStatus;
  background_check: ComplianceItemStatus;
  config: { ypt_valid_years: number; bgcheck_valid_years: number; warning_days: number };
}

interface AuthUser {
  id: number;
  member_number: string;
  username: string;
  first_name: string;
  last_name: string;
  member_type: string;
  roles: string[];
  is_kiosk?: boolean;
  photo_url?: string;
  force_password_change: boolean;
  enrollment_status?: EnrollmentStatus;
  renewal_reminder?: RenewalReminder;
  compliance_warning?: ComplianceWarning;
  permissions?: Record<string, "write" | "read" | "none">;
  module_permissions?: Record<string, "write" | "read" | "none">;
  team_ids?: number[];
  group_names?: string[];
  teams?: { team_season_id: number; team_number?: number; team_name?: string }[];
  /** Org-wide disabled modules (open-source Phase 2). Hidden for everyone, incl. supers. */
  disabled_modules?: string[];
  /** First-run setup (Phase 1): false only on a fresh install pending the wizard. */
  setup_complete?: boolean;
}

export interface Branding {
  name: string;
  short_name: string;
  tagline: string;
  logo_url: string;
}
const DEFAULT_BRANDING: Branding = { name: "TRCMS", short_name: "TRCMS", tagline: "Program Management System", logo_url: "" };

interface AuthContextValue {
  user: AuthUser | null;
  /** Organization branding (name / wordmark / logo), loaded pre-login. */
  branding: Branding;
  /** True while we're validating a stored token on boot (before user is known).
   * Guards routing so a deep link isn't discarded before auth resolves. */
  authLoading: boolean;
  login: (username: string, password: string, code?: string, remember?: boolean) => Promise<"ok" | "2fa">;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
  isAdmin: boolean;
  /** Is a module visible to this user? (org-wide enable + module-level "Not Visible" check) */
  canViewModule: (moduleId: string) => boolean;
  /** Is a module enabled org-wide? (independent of this user's permissions) */
  isModuleEnabled: (moduleId: string) => boolean;
  /** Can this user edit a given resource key (e.g. "members.profile")? */
  canWrite: (resourceKey: string) => boolean;
  /** Can this user at least view a given resource key? */
  canRead: (resourceKey: string) => boolean;
  clearForcePasswordChange: () => void;
  /** Re-fetch the current user (e.g. after signing T&C) so gates re-evaluate. */
  refreshUser: () => Promise<void>;
  /** For station/kiosk accounts: the page they should land on after login
   * (their dedicated function), or null for everyone else. */
  kioskLanding: string | null;
}

/** Maps a station role to the function page that station exists to run. */
const STATION_LANDING: Record<string, string> = {
  "Event Check-In Station": "/checkin",
  "Visitor Registration Station": "/checkin/visitor",
  "Parts Room Station": "/inventory/checkouts",
  "Team Tasks Station": "/team-tasks",
  "FLL Attendance Station": "/checkin/fll",
  // "Generic Station" intentionally omitted → falls back to the dashboard.
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Org-wide disabled modules (open-source Phase 2). Held separately from `user`
  // so it's known even when signed out — that lets us gate a disabled module's
  // PUBLIC routes (e.g. the embedded volunteer sign-up form) for anonymous
  // visitors, not just authenticated members.
  const [disabledModules, setDisabledModules] = useState<Set<string>>(new Set());
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  // Start in the loading state only when there's a token to validate; otherwise
  // there's nothing to wait for and routing can decide immediately.
  const [authLoading, setAuthLoading] = useState<boolean>(() => !!localStorage.getItem("trc_token"));

  useEffect(() => {
    const token = localStorage.getItem("trc_token");
    if (token) fetchMe().finally(() => setAuthLoading(false));
    // Always fetch the org's module state (no auth) so public routes gate correctly
    // even before login. fetchMe also refreshes this from /auth/me.
    api.get("/api/v1/public/modules")
      .then((r) => setDisabledModules(new Set(r.data?.disabled ?? [])))
      .catch(() => {}); // fail open — leave everything enabled
    // Organization branding (no auth) — for the login page, top bar, and title.
    api.get("/api/v1/public/branding")
      .then((r) => { if (r.data?.name) { setBranding({ ...DEFAULT_BRANDING, ...r.data }); document.title = `${r.data.name} — ${r.data.tagline ?? "TRCMS"}`; } })
      .catch(() => {});
  }, []);

  async function fetchMe() {
    try {
      const { data } = await api.get("/api/v1/auth/me");
      setUser({ ...data, force_password_change: !!data.force_password_change });
      if (Array.isArray(data.disabled_modules)) setDisabledModules(new Set(data.disabled_modules));
    } catch {
      localStorage.removeItem("trc_token");
    }
  }

  async function login(username: string, password: string, code?: string, remember?: boolean): Promise<"ok" | "2fa"> {
    const form = new URLSearchParams({ username, password });
    if (code) form.set("code", code);
    if (remember) form.set("remember", "1");
    const { data } = await api.post("/api/v1/auth/token", form);
    // 2FA is on for this user and no (valid) code was supplied yet.
    if (data.two_factor_required && !data.access_token) return "2fa";
    localStorage.setItem("trc_token", data.access_token);
    await fetchMe();
    return "ok";
  }

  function logout() {
    localStorage.removeItem("trc_token");
    setUser(null);
  }

  function hasRole(...roles: string[]) {
    if (!user) return false;
    if (user.roles.includes("System Administrator") || user.roles.includes("Admin")) return true;
    return roles.some((r) =>
      user.roles.includes(r) ||
      // "Mentor" covers the whole adult-mentor family (e.g. "Mentor - Lead",
      // "Mentor - Junior"), keyed off member_type so it never grants a youth.
      (r === "Mentor" && user.member_type === "mentor")
    );
  }

  // Only System Administrator bypasses configured permissions. "Admin" is a
  // normal role whose permissions are managed in Role Management, so its
  // restrictions must actually take effect in the UI.
  const isSuper = !!user && user.roles.includes("System Administrator");

  /** Module visible unless explicitly set to "none" for this user. Supers always see everything. */
  // Station/kiosk accounts are deny-by-default: anything not explicitly
  // granted is hidden, even if the key is unset.
  const isKiosk = !!user?.is_kiosk;

  // The function page a station should land on after login (first matching role).
  const kioskLanding = isKiosk
    ? (user!.roles.map((r) => STATION_LANDING[r]).find(Boolean) ?? null)
    : null;

  // Org-wide module enable/disable (open-source Phase 2). A module the org has
  // turned off is hidden for EVERYONE — including System Administrators — in nav,
  // tiles, dashboard panes, the command palette and routing (including public
  // routes). Admins re-enable it from Admin → Modules (the full catalog regardless).
  function isModuleEnabled(moduleId: string) {
    return !disabledModules.has(moduleId);
  }

  function canViewModule(moduleId: string) {
    if (!isModuleEnabled(moduleId)) return false; // org-wide off → hidden for all
    if (isSuper) return true;
    const lvl = user?.module_permissions?.[moduleId];
    if (isKiosk) return lvl === "read" || lvl === "write"; // deny unless granted
    return lvl !== "none"; // default visible when unset
  }

  function canWrite(resourceKey: string) {
    if (isSuper) return true;
    const lvl = user?.permissions?.[resourceKey];
    if (isKiosk) return lvl === "write"; // deny unless explicitly writable
    return lvl === undefined || lvl === "write"; // default writable when unset
  }

  function canRead(resourceKey: string) {
    if (isSuper) return true;
    const lvl = user?.permissions?.[resourceKey];
    if (isKiosk) return lvl === "read" || lvl === "write"; // deny unless granted
    return lvl !== "none"; // default readable when unset
  }

  /** Called after a successful password change to clear the flag in local state. */
  function clearForcePasswordChange() {
    setUser((prev) => prev ? { ...prev, force_password_change: false } : prev);
  }

  return (
    <AuthContext.Provider value={{
      user, authLoading, login, logout, hasRole,
      isAdmin: hasRole("Admin", "System Administrator"),
      branding,
      canViewModule, isModuleEnabled, canWrite, canRead,
      clearForcePasswordChange,
      refreshUser: fetchMe,
      kioskLanding,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
