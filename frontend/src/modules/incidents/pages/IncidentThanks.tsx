import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

export default function IncidentThanks() {
  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 20, textAlign: "center" }}>
      <CheckCircle2 size={48} color="#2e7d32" />
      <h1 style={{ fontSize: 24, color: "#1a3a5c", margin: "12px 0 6px" }}>Report filed. Thank you.</h1>
      <p style={{ color: "#666", fontSize: 15 }}>
        It's been routed to the safety team. Because you filed anonymously, there's no receipt and
        no copy in "My Reports" — that's how we keep it anonymous. If anyone is in danger, call 911
        or the DHS hotline at 1‑800‑522‑3511.
      </p>
      <Link to="/" style={{ display: "inline-block", marginTop: 16, padding: "10px 18px", background: "#1a3a5c", color: "#fff", borderRadius: 8, textDecoration: "none" }}>Back to Dashboard</Link>
    </div>
  );
}
