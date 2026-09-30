/**
 * Invoicing Module (3.0)
 * ======================
 * Consolidated family invoices (multi-child discounts + scholarships + school
 * payments) and school invoices for third-party payers, with email + print.
 * No nav item — reached from the family panel and the school detail page.
 */
import FamilyInvoice from "./pages/FamilyInvoice";
import SchoolInvoice from "./pages/SchoolInvoice";

export const invoicesModule = {
  id: "invoices",
  routes: [
    { path: "/invoices/family/:familyId", element: FamilyInvoice },
    { path: "/invoices/school/:schoolId", element: SchoolInvoice },
  ] satisfies { path: string; element: React.ComponentType }[],
  navItem: null,
  dashboardTile: null,
};
