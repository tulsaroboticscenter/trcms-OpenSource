/**
 * Frontend Module Registry
 * ========================
 * This is the ONLY file that needs to change when adding or removing a module.
 *
 * To ADD a module:    import it and add it to the MODULES array.
 * To REMOVE a module: comment out or delete its entry — nothing else changes.
 * To UPDATE a module: edit files inside that module's folder only.
 *
 * Each module exports:
 *   routes[]        — { path, element, public? }
 *   navItem         — { label, to, iconName, requiredRoles[] }
 *   dashboardTile   — { label, to, iconName, color, description, requiredRoles[] }
 */

import { membersModule }    from "./modules/members";
import { visitorsModule }   from "./modules/visitors";
import { checkinModule }    from "./modules/checkin";
import { enrollmentModule } from "./modules/enrollment";
import { teamsModule }      from "./modules/teams";
import { eventsModule }     from "./modules/events";
import { rolesModule }      from "./modules/roles";
import { reportsModule }    from "./modules/reports";
import { adminModule }      from "./modules/admin";
import { seasonsModule }    from "./modules/seasons";
import { familiesModule }        from "./modules/families";
import { communicationsModule }  from "./modules/communications";
import { inventoryModule }        from "./modules/inventory";
import { shoppingModule }         from "./modules/shopping";
import { certificationsModule }   from "./modules/certifications";
import { planningModule }          from "./modules/planning";
import { strategyModule }          from "./modules/strategy";
import { activityModule }          from "./modules/activity";
import { resourcesModule }         from "./modules/resources";
import { grantsModule }            from "./modules/grants";
import { reservationsModule }       from "./modules/reservations";
import { hallOfFameModule }         from "./modules/halloffame";
import { feedbackModule }            from "./modules/feedback";
import { campModule }                 from "./modules/camp";
import { repairsModule }              from "./modules/repairs";
import { financeModule }              from "./modules/finance";
import { announcementsModule }        from "./modules/announcements";
import { sponsorsModule }              from "./modules/sponsors";
import { invoicesModule }              from "./modules/invoices";
import { minutesModule }               from "./modules/minutes";
import { groupsModule }                from "./modules/groups";
import { fdpModule }                   from "./modules/fdp";
import { resumeModule }                from "./modules/resume";
import { myEquipmentModule }           from "./modules/myequipment";
import { seasonPlanningModule }         from "./modules/season-planning";
import { helpModule }                  from "./modules/help";
import { scholarshipsModule }          from "./modules/scholarships";
import { wishlistModule }              from "./modules/wishlist";
import { volunteerModule }             from "./modules/volunteer";
import { volunteeringModule }          from "./modules/volunteering";
import { featureNamesModule }          from "./modules/featurenames";
import { rafflesModule }               from "./modules/raffles";
import { incidentsModule }             from "./modules/incidents";

// ── Registered modules ────────────────────────────────────────────────────
const MODULES = [
  membersModule,
  visitorsModule,
  checkinModule,
  enrollmentModule,
  teamsModule,
  eventsModule,
  rolesModule,
  reportsModule,
  adminModule,
  seasonsModule,
  familiesModule,
  communicationsModule,
  inventoryModule,
  shoppingModule,
  certificationsModule,
  planningModule,
  strategyModule,
  activityModule,
  resourcesModule,
  grantsModule,
  reservationsModule,
  hallOfFameModule,
  feedbackModule,
  campModule,
  repairsModule,
  financeModule,
  announcementsModule,
  sponsorsModule,
  invoicesModule,
  minutesModule,
  groupsModule,
  fdpModule,
  resumeModule,
  myEquipmentModule,
  seasonPlanningModule,
  helpModule,
  scholarshipsModule,
  wishlistModule,
  volunteerModule,
  volunteeringModule,
  featureNamesModule,
  rafflesModule,
  incidentsModule,
];

// ── Derived exports (do not edit below this line) ─────────────────────────

/** All routes from all modules, flattened (tagged with their module id so routing
 *  can drop routes for modules the org has disabled — see App.tsx). */
export const allRoutes = MODULES.flatMap((m) =>
  m.routes.map((r) => ({ ...r, moduleId: m.id })));

/** Nav sidebar items for the current user (role + permission filtering in Layout) */
export const allNavItems = MODULES
  .filter((m) => m.navItem)
  .map((m) => ({ ...m.navItem!, moduleId: m.id }));

/** Dashboard tiles for the current user (role + permission filtering in Dashboard) */
export const allDashboardTiles = MODULES
  .filter((m) => m.dashboardTile)
  .map((m) => ({ ...m.dashboardTile!, moduleId: m.id }));
