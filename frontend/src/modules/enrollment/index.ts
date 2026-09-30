/**
 * Enrollment Module
 * =================
 * Annual enrollment per member per program (Aug 1 – Jul 31).
 * Handles payment recording, T&C electronic signing, enrollment status,
 * and annual season management (closing seasons, grace period, renewal reminders).
 */
import MemberEnrollments from "./pages/MemberEnrollments";
export { MemberEnrollments };

import EnrollmentMemberPage from "./pages/EnrollmentMemberPage";
import EnrollmentAdd from "./pages/EnrollmentAdd";
import EnrollmentEdit from "./pages/EnrollmentEdit";
import TCSign from "./pages/TCSign";
import MentorTCSign from "./pages/MentorTCSign";
import EnrollmentAdmin from "./pages/EnrollmentAdmin";
import FamilyCheckoutPage from "../payments/FamilyCheckoutPage";

export const enrollmentModule = {
  id: "enrollment",

  routes: [
    { path: "/pay/family",                        element: FamilyCheckoutPage },
    { path: "/enrollment/member/:memberId",      element: EnrollmentMemberPage },
    { path: "/enrollment/add/:memberId",          element: EnrollmentAdd },
    { path: "/enrollment/:enrollmentId/edit",     element: EnrollmentEdit },
    { path: "/enrollment/:enrollmentId/sign-tc",  element: TCSign },
    { path: "/enrollment/mentor-tc/:memberId/sign", element: MentorTCSign },
    { path: "/enrollment/admin",                  element: EnrollmentAdmin },
  ] satisfies { path: string; element: React.ComponentType }[],

  navItem: null,
  dashboardTile: null,
};
