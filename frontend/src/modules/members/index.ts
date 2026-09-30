/**
 * Members Module
 * ==============
 * Provides member directory, profile view/edit, and add member.
 * Required roles to access: any authenticated user (profile view limited by RBAC).
 */
import MemberList from "./pages/MemberList";
import MemberProfile from "./pages/MemberProfile";
import MemberAdd from "./pages/MemberAdd";
import MemberImport from "./pages/MemberImport";
import ParentYouthEdit from "./pages/ParentYouthEdit";
import MergeMembers from "./pages/MergeMembers";
import EmployerForm from "./pages/EmployerForm";

export const membersModule = {
  id: "members",

  routes: [
    // Public, no-login: the personalized employer/matching-gift form emailed to parents & mentors.
    { path: "/employer/:token",    element: EmployerForm,   public: true },
    { path: "/members",            element: MemberList     },
    { path: "/members/add",        element: MemberAdd      },
    { path: "/members/import",     element: MemberImport   },
    { path: "/members/merge",      element: MergeMembers   },
    { path: "/members/youth/:id",  element: ParentYouthEdit },
    { path: "/members/:id",        element: MemberProfile  },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],

  navItem: {
    label: "Members",
    to: "/members",
    iconName: "Users",        // matches lucide-react icon name
    requiredRoles: [],        // empty = any authenticated user (further gated below)
    // Browsing/searching the member directory needs members.directory. Revoke it from a
    // role (e.g. Volunteer) in Role Management to hide the directory from them.
    requiredPermission: "members.directory",
  },

  dashboardTile: {
    label: "Member Directory",
    to: "/members",
    iconName: "Users",
    color: "#1a3a5c",
    description: "View and manage all members",
    requiredRoles: [],
    requiredPermission: "members.directory",
  },
};
