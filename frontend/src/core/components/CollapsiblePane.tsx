/**
 * CollapsiblePane
 * ===============
 * A card with a clickable header that minimizes/expands its body.
 * Collapsed state is remembered per pane via localStorage (storageKey).
 *
 * Use on any page for a minimizable section:
 *   <CollapsiblePane title="Reports" icon={<BarChart2 size={14}/>} storageKey="reports_overview">
 *     …content…
 *   </CollapsiblePane>
 */
import { useState, type ReactNode } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

export default function CollapsiblePane({
  title, icon, storageKey, defaultOpen = true, children, style,
}: {
  title: ReactNode;
  icon?: ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v === null ? defaultOpen : v === "1"; }
    catch { return defaultOpen; }
  });
  function toggle() {
    setOpen((o) => {
      const n = !o;
      try { localStorage.setItem(storageKey, n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });
  }
  return (
    <div style={{ ...st.card, ...style }}>
      <button style={st.header} onClick={toggle} title={open ? "Minimize" : "Expand"}>
        <span style={st.titleWrap}>{icon}<span>{title}</span></span>
        {open ? <ChevronUp size={16} color="#888" /> : <ChevronDown size={16} color="#888" />}
      </button>
      {open && <div style={st.body}>{children}</div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" },
  titleWrap: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  body: { padding: "0 16px 16px" },
};
