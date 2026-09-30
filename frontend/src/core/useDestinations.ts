/**
 * useDestinations — one role-filtered list of everywhere the current user can go.
 *
 * Merges the module registry's nav items and dashboard tiles (deduped by route),
 * enriches them with a description + a functional "area" grouping, and appends the
 * handful of core destinations that live outside the module system (Dashboard,
 * YLC, Compliance, Admin, Feedback, the Site Map itself). Both the command palette
 * and the Site Map / feature index render from this, so they never drift apart.
 */
import { useMemo } from "react";
import { useAuth } from "./AuthContext";
import { allNavItems, allDashboardTiles } from "../moduleRegistry";

export interface Destination {
  label: string;
  to: string;
  iconName: string;
  description?: string;
  area: string;
  keywords?: string;
}

// Functional grouping for the feature index. Modules not listed fall to "More".
const AREA_BY_MODULE: Record<string, string> = {
  members: "People", visitors: "People", families: "People", enrollment: "People",
  certifications: "People", groups: "People",
  teams: "Teams & Season", planning: "Teams & Season", activity: "Teams & Season",
  minutes: "Teams & Season", seasons: "Teams & Season",
  events: "Events & Attendance", checkin: "Events & Attendance",
  reservations: "Events & Attendance", summer_camp: "Events & Attendance",
  finance: "Money & Fundraising", invoices: "Money & Fundraising", payments: "Money & Fundraising",
  grants: "Money & Fundraising", sponsors: "Money & Fundraising", scholarships: "Money & Fundraising",
  shopping: "Money & Fundraising", wishlist: "Money & Fundraising",
  inventory: "Inventory & Assets", repairs: "Inventory & Assets", resources: "Inventory & Assets",
  communications: "Communication", announcements: "Communication", social: "Communication",
  hof: "Recognition",
  reports: "Admin & System", admin: "Admin & System", roles: "Admin & System",
  help: "Admin & System", feedback: "Admin & System",
};

// Display order for the areas.
export const AREA_ORDER = [
  "People", "Teams & Season", "Events & Attendance", "Money & Fundraising",
  "Inventory & Assets", "Communication", "Recognition", "Admin & System", "More",
];

export function useDestinations(): Destination[] {
  const { hasRole, isAdmin, canRead, canViewModule, user } = useAuth();

  return useMemo(() => {
    const roleOk = (requiredRoles: string[]) => requiredRoles.length === 0 || hasRole(...requiredRoles);
    const byRoute = new Map<string, Destination>();

    const consider = (
      to: string, label: string, iconName: string, moduleId: string,
      requiredRoles: string[], description?: string, requiredPermission?: string,
    ) => {
      if (!canViewModule(moduleId) || !roleOk(requiredRoles)) return;
      if (requiredPermission && !canRead(requiredPermission)) return;
      const area = AREA_BY_MODULE[moduleId] ?? "More";
      const existing = byRoute.get(to);
      if (existing) {
        if (!existing.description && description) existing.description = description;
        return;
      }
      byRoute.set(to, { label, to, iconName, description, area });
    };

    for (const n of allNavItems) consider(n.to, n.label, n.iconName, n.moduleId, n.requiredRoles, undefined, (n as { requiredPermission?: string }).requiredPermission);
    for (const t of allDashboardTiles) consider(t.to, t.label, t.iconName, t.moduleId, t.requiredRoles, t.description, (t as { requiredPermission?: string }).requiredPermission);

    // Core destinations that aren't module-driven.
    const core: Destination[] = [];
    core.push({ label: "Dashboard", to: "/", iconName: "Home", area: "People", description: "Your home page and at-a-glance overview.", keywords: "home" });
    if (isAdmin || hasRole("Mentor")) core.push({ label: "YLC", to: "/roles/ylc", iconName: "Award", area: "Teams & Season", description: "Youth Leadership Council management." });
    // YLC youth (and other non-mentor council members) reach their meeting page here —
    // /roles/ylc is the mentor-only management view, so keep the command palette in sync
    // with the sidebar (Layout.tsx) rather than leaving them with no "YLC" result.
    else if ((user?.group_names ?? []).includes("YLC")) core.push({ label: "YLC", to: "/minutes?group=YLC", iconName: "Award", area: "Teams & Season", description: "Youth Leadership Council meetings, agenda and minutes.", keywords: "youth leadership council meeting minutes agenda" });
    if (isAdmin || (user?.group_names ?? []).includes("TRCF Board")) core.push({ label: "TRCF Board", to: "/minutes?group=TRCF%20Board", iconName: "NotebookPen", area: "Teams & Season", description: "TRCF board meetings, agendas and minutes.", keywords: "board foundation meeting minutes trcfb" });
    core.push({ label: "Program Team", to: "/minutes?group=Program%20Team", iconName: "NotebookPen", area: "Teams & Season", description: "Program Team meetings, agenda and notes.", keywords: "program team meeting minutes agenda notes" });
    if (isAdmin) core.push({ label: "Compliance", to: "/roles/compliance", iconName: "Shield", area: "Admin & System", description: "Mentor FIRST compliance tracking." });
    const ADMIN_PERMS = ["admin.roles", "admin.programs", "admin.impersonate", "admin.password_reset",
      "admin.config", "admin.security", "admin.system_stats", "admin.layouts",
      "members.create", "members.merge", "members.archive", "members.system_permissions", "groups.manage"];
    if (isAdmin || ADMIN_PERMS.some((k) => canRead(k))) core.push({ label: "Admin Console", to: "/admin", iconName: "Shield", area: "Admin & System", description: "System settings, roles, layouts, and configuration.", keywords: "settings configuration" });
    core.push({ label: "Report a bug / request a feature", to: "/feedback", iconName: "MessageSquarePlus", area: "Admin & System", description: "Send feedback to the TRCMS team." });
    core.push({ label: "Site Map (all features)", to: "/site-map", iconName: "Map", area: "Admin & System", description: "The full index of everything you can do in TRCMS.", keywords: "feature index everything list" });

    return [...byRoute.values(), ...core];
  }, [hasRole, isAdmin, canRead, canViewModule, user]);
}
