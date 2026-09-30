/**
 * SiteMap — the full feature index. Every place the current user can go, grouped
 * by functional area with a one-line "use this to…" description. Intentionally
 * NOT in the sidebar for now (reachable at /site-map and via the command palette),
 * so it stays a reference rather than adding nav clutter.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { Search, Map as MapIcon } from "lucide-react";
import { useDestinations } from "./useDestinations";
import { AREA_ORDER } from "./useDestinations";

const ICONS = Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;

export default function SiteMap() {
  const destinations = useDestinations();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? destinations.filter((d) => `${d.label} ${d.area} ${d.description ?? ""} ${d.keywords ?? ""}`.toLowerCase().includes(q))
      : destinations;
    const byArea = new Map<string, typeof filtered>();
    for (const d of filtered) {
      if (!byArea.has(d.area)) byArea.set(d.area, []);
      byArea.get(d.area)!.push(d);
    }
    return AREA_ORDER
      .filter((a) => byArea.has(a))
      .map((a) => ({ area: a, items: byArea.get(a)!.slice().sort((x, y) => x.label.localeCompare(y.label)) }));
  }, [destinations, query]);

  return (
    <div style={st.wrap}>
      <div style={st.head}>
        <h1 style={st.h1}><MapIcon size={22} style={{ verticalAlign: -4, marginRight: 8 }} />Site Map</h1>
        <p style={st.sub}>Everything you can do in TRCMS, grouped by area. Tip: press <kbd style={st.kbd}>Ctrl</kbd>+<kbd style={st.kbd}>K</kbd> anywhere to jump straight to any of these.</p>
      </div>

      <div style={st.searchRow}>
        <Search size={16} style={{ color: "#90a4ae" }} />
        <input style={st.input} placeholder="Filter features…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>

      {groups.length === 0 && <p style={st.empty}>No features match “{query}”.</p>}

      {groups.map(({ area, items }) => (
        <section key={area} style={st.section}>
          <h2 style={st.areaTitle}>{area}</h2>
          <div style={st.grid}>
            {items.map((d) => {
              const Icon = ICONS[d.iconName] ?? Icons.Circle;
              return (
                <button key={d.to} style={st.card} onClick={() => navigate(d.to)}>
                  <span style={st.cardIcon}><Icon size={18} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={st.cardLabel}>{d.label}</span>
                    {d.description && <span style={st.cardDesc}>{d.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { padding: "20px 24px", maxWidth: 1000, margin: "0 auto" },
  head: { marginBottom: 12 },
  h1: { fontSize: 24, margin: 0, color: "#1a237e" },
  sub: { color: "#546e7a", fontSize: 13, marginTop: 6 },
  kbd: { fontSize: 10, background: "#eef2f6", color: "#607d8b", borderRadius: 4, padding: "1px 5px", border: "1px solid #dce3ea" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #cfd8dc", borderRadius: 8, padding: "8px 12px", marginBottom: 18, maxWidth: 360 },
  input: { flex: 1, border: "none", outline: "none", fontSize: 14, color: "#263238" },
  empty: { color: "#90a4ae", fontSize: 14 },
  section: { marginBottom: 22 },
  areaTitle: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "#607d8b", margin: "0 0 10px", paddingBottom: 6, borderBottom: "1px solid #eceff1" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 },
  card: { display: "flex", alignItems: "flex-start", gap: 11, textAlign: "left", background: "#fff", border: "1px solid #eceff1", borderRadius: 10, padding: "12px 14px", cursor: "pointer" },
  cardIcon: { color: "#3949ab", flexShrink: 0, marginTop: 1 },
  cardLabel: { display: "block", fontSize: 14, fontWeight: 600, color: "#263238" },
  cardDesc: { display: "block", fontSize: 12, color: "#78909c", marginTop: 2, lineHeight: 1.35 },
};
