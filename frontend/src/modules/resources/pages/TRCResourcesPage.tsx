import { useState, useEffect } from "react";
import ResourceList from "../components/ResourceList";
import AccessRequestsPanel from "../components/AccessRequestsPanel";
import { useAuth } from "../../../core/AuthContext";
import { enrollmentApi, type HandbookLink } from "../../enrollment/api";
import { Boxes, KeyRound, BookOpen, ExternalLink } from "lucide-react";

/** TRC-wide resources page — access gated by the resources.trc permission. */
export default function TRCResourcesPage() {
  const { canRead, canWrite } = useAuth();
  const canGrant = canWrite("resources.grant");
  const [tab, setTab] = useState<"resources" | "requests">("resources");
  const [handbook, setHandbook] = useState<HandbookLink | null>(null);

  useEffect(() => { enrollmentApi.getHandbook().then(setHandbook).catch(() => setHandbook(null)); }, []);

  if (!canRead("resources.trc")) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", textAlign: "center", color: "#888" }}>
        <Boxes size={36} color="#ccc" />
        <p>You don't have access to TRC resources. Ask an administrator if you need it.</p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 }}>
        <Boxes size={22} /> TRC Resources
      </h1>
      <p style={{ color: "#666", fontSize: 14, marginTop: 4, marginBottom: 18 }}>
        Shared tools, drives, documents, and links available across TRC. Request access to anything you need.
      </p>

      {handbook?.url?.trim() && (
        <a href={handbook.url.trim()} target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none",
            background: "#eef4fb", border: "1px solid #cdd7e3", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <BookOpen size={22} color="#1a3a5c" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: "#1a3a5c", fontSize: 15 }}>{handbook.title?.trim() || "TRC Handbook"}</div>
            <div style={{ fontSize: 12.5, color: "#556" }}>Program handbook, including the Code of Conduct and expectations for all participants.</div>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#1565c0", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
            Open <ExternalLink size={14} />
          </span>
        </a>
      )}

      {canGrant && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #e2e8f0" }}>
          <button onClick={() => setTab("resources")}
            style={tabStyle(tab === "resources")}><Boxes size={14} /> Resources</button>
          <button onClick={() => setTab("requests")}
            style={tabStyle(tab === "requests")}><KeyRound size={14} /> Access Requests</button>
        </div>
      )}

      {tab === "requests" && canGrant ? <AccessRequestsPanel scope="trc" /> : <ResourceList scope="trc" />}
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "none", border: "none",
    borderBottom: active ? "2px solid #1a3a5c" : "2px solid transparent", cursor: "pointer",
    fontSize: 14, fontWeight: 700, color: active ? "#1a3a5c" : "#94a3b8",
  };
}
