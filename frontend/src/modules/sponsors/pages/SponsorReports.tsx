/**
 * SponsorReports — leadership totals: lifetime & outstanding, by scope / tier /
 * season / lifecycle state, and top sponsors.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { sponsorsApi, tierColor, money, type SponsorReports as Reports } from "../api";
import { ArrowLeft, TrendingUp, Clock } from "lucide-react";

export default function SponsorReports() {
  const navigate = useNavigate();
  const goBack = useGoBack("/sponsors");
  const [r, setR] = useState<Reports | null>(null);
  useEffect(() => { sponsorsApi.reports().then(setR).catch(() => setR(null)); }, []);
  if (!r) return <div style={s.page}><p style={s.muted}>Loading…</p></div>;

  const maxSeason = Math.max(1, ...r.by_season.map((x) => x.received));

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Sponsors</button>
      <h1 style={s.h1}>Sponsor Reports</h1>

      <div style={s.totals}>
        <div style={{ ...s.totCard, borderColor: "#a5d6a7" }}>
          <div style={s.totLabel}><TrendingUp size={14} color="#2e7d32" /> Lifetime received</div>
          <div style={{ ...s.totVal, color: "#2e7d32" }}>{money(r.lifetime_received)}</div>
        </div>
        <div style={{ ...s.totCard, borderColor: "#ffe0a3" }}>
          <div style={s.totLabel}><Clock size={14} color="#e65100" /> Outstanding pledged</div>
          <div style={{ ...s.totVal, color: "#e65100" }}>{money(r.outstanding_pledged)}</div>
        </div>
      </div>

      <div style={s.cols}>
        <Card title="By scope">
          {r.by_scope.map((x) => (
            <Line key={x.scope} label={x.scope === "program" ? "Program" : "Team"} sub={`${x.count} sponsor${x.count === 1 ? "" : "s"}`} value={money(x.received)} />
          ))}
        </Card>
        <Card title="By lifecycle state">
          {r.by_state.map((x) => <Line key={x.state} label={x.state} value={String(x.count)} cap />)}
          {r.by_state.length === 0 && <p style={s.muted}>No sponsors.</p>}
        </Card>
      </div>

      <Card title="By tier">
        {r.by_tier.map((x) => (
          <div key={x.tier} style={s.tierRow}>
            <span style={{ ...s.tierDot, background: tierColor(x.tier === "Untiered" ? null : x.tier) }} />
            <span style={s.tierName}>{x.tier}</span>
            <span style={s.tierCount}>{x.count}</span>
            <span style={s.tierAmt}>{money(x.received)}</span>
          </div>
        ))}
        {r.by_tier.length === 0 && <p style={s.muted}>No data.</p>}
      </Card>

      <Card title="Received by season">
        {r.by_season.map((x) => (
          <div key={x.season} style={s.barRow}>
            <span style={s.barLabel}>{x.season}</span>
            <div style={s.barTrack}><div style={{ ...s.barFill, width: `${(x.received / maxSeason) * 100}%` }} /></div>
            <span style={s.barVal}>{money(x.received)}</span>
          </div>
        ))}
        {r.by_season.length === 0 && <p style={s.muted}>No received contributions yet.</p>}
      </Card>

      <Card title="Top sponsors">
        {r.top_sponsors.map((x, i) => (
          <div key={x.id} style={s.topRow} onClick={() => navigate(`/sponsors/${x.id}`)}>
            <span style={s.topRank}>{i + 1}</span>
            <span style={s.topName}>{x.name}</span>
            <span style={s.topAmt}>{money(x.received)}</span>
          </div>
        ))}
        {r.top_sponsors.length === 0 && <p style={s.muted}>No received contributions yet.</p>}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={s.card}><div style={s.cardTitle}>{title}</div>{children}</div>;
}
function Line({ label, sub, value, cap }: { label: string; sub?: string; value: string; cap?: boolean }) {
  return (
    <div style={s.line}>
      <span style={{ ...s.lineLabel, ...(cap ? { textTransform: "capitalize" as const } : {}) }}>{label}{sub && <span style={s.lineSub}> · {sub}</span>}</span>
      <span style={s.lineVal}>{value}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  h1: { margin: "0 0 14px", fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  totals: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 },
  totCard: { background: "#fff", border: "1px solid", borderRadius: 10, padding: "14px 16px" },
  totLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#556" },
  totVal: { fontSize: 26, fontWeight: 800, marginTop: 4 },
  cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  muted: { color: "#889", fontSize: 13 },
  line: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #f0f4f8", fontSize: 14 },
  lineLabel: { color: "#1a3a5c", fontWeight: 600 },
  lineSub: { color: "#99a", fontWeight: 400, fontSize: 12 },
  lineVal: { color: "#1a3a5c", fontWeight: 700 },
  tierRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #f0f4f8" },
  tierDot: { width: 12, height: 12, borderRadius: 3, flexShrink: 0 },
  tierName: { flex: 1, fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  tierCount: { fontSize: 12, color: "#889", minWidth: 30, textAlign: "right" },
  tierAmt: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", minWidth: 90, textAlign: "right" },
  barRow: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0" },
  barLabel: { fontSize: 13, color: "#556", width: 82, flexShrink: 0 },
  barTrack: { flex: 1, height: 14, background: "#eef2f7", borderRadius: 7, overflow: "hidden" },
  barFill: { height: "100%", background: "#1565c0", borderRadius: 7 },
  barVal: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", width: 90, textAlign: "right" },
  topRow: { display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderTop: "1px solid #f0f4f8", cursor: "pointer" },
  topRank: { fontSize: 12, fontWeight: 800, color: "#99a", width: 18 },
  topName: { flex: 1, fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  topAmt: { fontSize: 14, fontWeight: 700, color: "#2e7d32" },
};
