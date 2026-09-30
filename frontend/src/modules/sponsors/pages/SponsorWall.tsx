/**
 * SponsorWall — recognition wall. Active sponsors grouped by tier (color-banded),
 * each showing its logo (or name) and linking to the sponsor's website. Read-only,
 * visible to all members. (Public exposure outside the app is an open decision.)
 */
import { useState, useEffect } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { sponsorsApi, tierColor, type SponsorSummary } from "../api";
import { ArrowLeft, Globe } from "lucide-react";

const TIER_ORDER = ["Gold", "Silver", "Bronze", "In-Kind Partner", "Community Supporter"];

export default function SponsorWall() {
  const goBack = useGoBack("/sponsors");
  const [rows, setRows] = useState<SponsorSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sponsorsApi.list({ lifecycle_state: "active" }).then(setRows).finally(() => setLoading(false));
  }, []);

  // Group by tier; untiered active sponsors go into a trailing "Supporters" bucket.
  const groups = new Map<string, SponsorSummary[]>();
  for (const r of rows) {
    const key = r.tier && TIER_ORDER.includes(r.tier) ? r.tier : "Supporters";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const orderedKeys = [...TIER_ORDER.filter((t) => groups.has(t)), ...(groups.has("Supporters") ? ["Supporters"] : [])];

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Sponsors</button>
      <h1 style={s.h1}>Our Sponsors</h1>
      <p style={s.sub}>With gratitude to the organizations that make our robotics programs possible.</p>

      {loading ? <p style={s.muted}>Loading…</p> : rows.length === 0 ? <p style={s.muted}>No active sponsors yet.</p> : (
        orderedKeys.map((tier) => (
          <div key={tier} style={s.tierBlock}>
            <div style={s.tierHead}>
              <span style={{ ...s.tierBadge, background: tierColor(tier === "Supporters" ? null : tier) }}>{tier}</span>
            </div>
            <div style={s.grid}>
              {groups.get(tier)!.map((sp) => {
                const inner = (
                  <>
                    {sp.logo_url
                      ? <img src={sp.logo_url} alt={sp.name} style={s.logo} />
                      : <span style={s.name}>{sp.name}</span>}
                    {sp.website && <span style={s.link}><Globe size={11} /> Visit</span>}
                  </>
                );
                return sp.website
                  ? <a key={sp.id} href={sp.website} target="_blank" rel="noreferrer" style={s.tile} title={sp.name}>{inner}</a>
                  : <div key={sp.id} style={s.tile} title={sp.name}>{inner}</div>;
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 960, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  h1: { margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "#1a3a5c", textAlign: "center" },
  sub: { color: "#667", fontSize: 14, textAlign: "center", margin: "0 0 24px" },
  muted: { color: "#889", fontSize: 14, textAlign: "center" },
  tierBlock: { marginBottom: 26 },
  tierHead: { textAlign: "center", marginBottom: 14 },
  tierBadge: { display: "inline-block", color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: 0.5, borderRadius: 14, padding: "4px 18px", textTransform: "uppercase" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 },
  tile: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 110, padding: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, textDecoration: "none", color: "#1a3a5c" },
  logo: { maxWidth: "100%", maxHeight: 64, objectFit: "contain" },
  name: { fontSize: 16, fontWeight: 700, color: "#1a3a5c", textAlign: "center" },
  link: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#1565c0", fontWeight: 600 },
};
