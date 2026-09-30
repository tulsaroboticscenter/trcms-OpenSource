/**
 * My Equipment — self-service view of the gear a member currently has checked out, with
 * the ability to request a due-date extension (which goes to the inventory checkout queue
 * for approval). Shown to every member; the page only ever shows the viewer's own items.
 */
import MyEquipment from "./pages/MyEquipment";

export { default as MyEquipment } from "./pages/MyEquipment";

export const myEquipmentModule = {
  id: "myequipment",
  routes: [
    { path: "/my-equipment", element: MyEquipment },
  ] satisfies { path: string; element: React.ComponentType }[],
  navItem: {
    label: "My Equipment",
    to: "/my-equipment",
    iconName: "Package",
    requiredRoles: [] as string[],
    // Seeded read for every real role except Volunteer, so it's hidden for volunteers by
    // default; toggle it per role in Role Management.
    requiredPermission: "inventory.my_equipment",
  },
  dashboardTile: {
    label: "My Equipment",
    to: "/my-equipment",
    iconName: "Package",
    color: "#5b6c7f",
    description: "See what you have checked out and request a due-date extension.",
    requiredRoles: [] as string[],
    requiredPermission: "inventory.my_equipment",
  },
};
