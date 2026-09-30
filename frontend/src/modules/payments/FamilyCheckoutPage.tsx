/**
 * FamilyCheckoutPage — a standalone home for the combined family checkout so it can
 * be linked to directly (e.g. from a single youth's pay panel). The same panel also
 * lives on the parent dashboard; this just gives it its own URL for discoverability.
 */
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import FamilyEnrollmentCheckout from "./FamilyEnrollmentCheckout";

export default function FamilyCheckoutPage() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 18px" }}>
      <Link to="/" style={{ fontSize: 13, color: "#1565c0", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <ArrowLeft size={14} /> Back to dashboard
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a5c", margin: "10px 0 4px" }}>Pay for My Family</h1>
      <p style={{ fontSize: 13.5, color: "#667", margin: "0 0 16px", lineHeight: 1.5 }}>
        Pay for all of your youth in one checkout. Check the ones you want to pay for now — sibling discounts are already applied.
      </p>
      <FamilyEnrollmentCheckout />
    </div>
  );
}
