import { useState } from "react";
import { RELEASES, APP_VERSION } from "../../../core/version";
import ReleaseHighlights from "../components/ReleaseHighlights";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, Tag, ChevronDown, ChevronRight } from "lucide-react";

export default function VersionHistory() {
  const goBack = useGoBack("/admin");
  const [open, setOpen] = useState<Record<string, boolean>>({ [RELEASES[0]?.version ?? ""]: true });

  return (
    <div style={st.page}>
      <button onClick={goBack} style={st.back}><ArrowLeft size={14} /> Admin Console</button>
      <h1 style={st.h1}>Version History</h1>
      <p style={st.sub}>Every release and what shipped in it. Items that came from Send Feedback link back to their entry.</p>

      <div style={st.list}>
        {RELEASES.map((rel) => {
          const isOpen = !!open[rel.version];
          return (
            <div key={rel.version} style={st.card}>
              <button style={st.head} onClick={() => setOpen((o) => ({ ...o, [rel.version]: !o[rel.version] }))} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown size={15} color="#888" /> : <ChevronRight size={15} color="#888" />}
                <span style={st.tag}><Tag size={13} /> {rel.version}{rel.version === APP_VERSION && <span style={st.current}>current</span>}{rel.date === "Pending" && <span style={st.upcoming}>in progress</span>}</span>
                <span style={st.meta}>Published by {rel.publisher} · {rel.date}</span>
                {!isOpen && <span style={st.count}>{rel.highlights.length} change{rel.highlights.length === 1 ? "" : "s"}</span>}
              </button>
              {isOpen && (
                <div style={st.body}>
                  <ReleaseHighlights highlights={rel.highlights} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10, fontWeight: 600 },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, marginTop: 4, marginBottom: 18 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem" },
  head: { display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", flexWrap: "wrap" },
  tag: { display: "flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  upcoming: { marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#5a6b7d", background: "#eef3f8", borderRadius: 8, padding: "1px 7px", textTransform: "uppercase" },
  current: { marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "1px 7px", textTransform: "uppercase" },
  meta: { fontSize: 12, color: "#888" },
  count: { marginLeft: "auto", fontSize: 12, color: "#999", background: "#f0f4f8", borderRadius: 10, padding: "2px 9px" },
  body: { marginTop: 10 },
  ul: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 },
  li: { fontSize: 14, color: "#2a2418", lineHeight: 1.5 },
  shipped: { marginTop: 12, borderTop: "1px solid #f0f4f8", paddingTop: 10 },
  shippedHead: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#00838f", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  fbChip: { fontSize: 12, fontWeight: 600, textDecoration: "none", border: "1px solid #e2e8f0", borderRadius: 14, padding: "3px 10px", background: "#fafbfc", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};
