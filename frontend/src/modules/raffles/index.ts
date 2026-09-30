/**
 * Raffles Module
 * ==============
 * Reusable prize-drawing tool. Staff create a raffle, open ticket sales, and either
 * sell online (guests scan a booth QR → public page → hosted card checkout) or record
 * in-person booth sales. Paid buyers can be routed into recruiting/volunteering/sponsor
 * pipelines via a short opt-in questionnaire. Numbered stubs print for a physical draw,
 * or a winner is drawn at random in-app.
 *
 * Public, no-login routes: /raffle/:slug (buy), /raffle/thanks, /raffle/canceled.
 * Staff routes (Mentor+): /raffles, /raffles/:id, /raffles/:id/print.
 */
import RafflesList from "./pages/RafflesList";
import RaffleDetail from "./pages/RaffleDetail";
import RafflePrint from "./pages/RafflePrint";
import RafflePublic from "./pages/RafflePublic";
import RaffleThanks from "./pages/RaffleThanks";

export const rafflesModule = {
  id: "raffles",

  routes: [
    // Public, no-login (the QR destination + payment return landings)
    { path: "/raffle/thanks",   element: RaffleThanks, public: true },
    { path: "/raffle/canceled", element: RaffleThanks, public: true },
    { path: "/raffle/:slug",    element: RafflePublic, public: true },
    // Staff
    { path: "/raffles",           element: RafflesList  },
    { path: "/raffles/:id",       element: RaffleDetail },
    { path: "/raffles/:id/print", element: RafflePrint  },
  ] satisfies { path: string; element: React.ComponentType; public?: boolean }[],

  navItem: {
    label: "Raffles",
    to: "/raffles",
    iconName: "Ticket",
    requiredRoles: [] as string[],
    requiredPermission: "raffles.manage", // configurable in Admin → Role Management
  },

  dashboardTile: {
    label: "Raffles",
    to: "/raffles",
    iconName: "Ticket",
    color: "#c2410c",
    description: "Prize drawings with online & booth ticket sales.",
    requiredRoles: [] as string[],
    requiredPermission: "raffles.manage",
  },
};
