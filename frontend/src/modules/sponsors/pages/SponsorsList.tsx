/**
 * SponsorsList — the Sponsor Directory. Sponsors grouped into Program (TRC-wide)
 * and Team sections, color-coded by tier. Everyone can view; managers can add.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { sponsorsApi, tierColor, money, type SponsorSummary, type Lifecycle } from "../api";
import { Plus, Search, Building2, Users, ShieldAlert, BarChart2, Award } from "lucide-react";

const STATES: { key: Lifecycle | ""; label: string }[] = [
  { key: "", label: "All states" }, { key: "prospective", label: "Prospective" },
  { key: "active", label: "Active" }, { key: "lapsed", label: "Lapsed" }, { key: "declined", label: "Declined" },
];

export default function SponsorsList() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canManage = canWrite("sponsors.manage");
  const [rows, setRows] = useState<SponsorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<Lifecycle | "">("");

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (state) params.lifecycle_state = state;
    sponsorsApi.list(params).then(setRows).finally(() => setLoading(false));
  }, [state]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.primary_contact_name ?? "").toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const program = filtered.filter((r) => r.scope === "program");
  const team = filtered.filter((r) => r.scope === "team");

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h1 style={s.h1}>Sponsors</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.reportsBtn} onClick={() => navigate("/sponsors/wall")}><Award size={15} /> Wall</button>
          <button style={s.reportsBtn} onClick={() => navigate("/sponsors/reports")}><BarChart2 size={15} /> Reports</button>
          {canManage && (
            <button style={s.newBtn} onClick={() => navigate("/sponsors/new")}><Plus size={16} /> New Sponsor</button>
          )}
        </div>
      </div>
      <p style={s.sub}>Everyone can view all sponsors. Team sponsors may only be <strong>contacted</strong> by members of an owning team.</p>

      <div style={s.controls}>
        <div style={s.searchWrap}>
          <Search size={15} color="#889" />
          <input style={s.searchIn} placeholder="Search name or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={s.select} value={state} onChange={(e) => setState(e.target.value as Lifecycle | "")}>
          {STATES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : (
        <>
          <Section icon={<Building2 size={17} />} title="Program Sponsors" count={program.length} rows={program} navigate={navigate} />
          <Section icon={<Users size={17} />} title="Team Sponsors" count={team.length} rows={team} navigate={navigate} />
          {filtered.length === 0 && <p style={s.muted}>No sponsors yet.</p>}
        </>
      )}
    </div>
  );
}

function Section({ icon, title, count, rows, navigate }: {
  icon: React.ReactNode; title: string; count: number; rows: SponsorSummary[]; navigate: (to: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div style={s.section}>
      <div style={s.sectionHead}>{icon} {title} <span style={s.countChip}>{count}</span></div>
      <div style={s.grid}>
        {rows.map((r) => (
          <button key={r.id} style={s.card} onClick={() => navigate(`/sponsors/${r.id}`)}>
            <div style={{ ...s.tierBar, background: tierColor(r.tier) }} />
            <div style={s.cardBody}>
              <div style={s.cardTop}>
                <span style={s.cardName}>{r.name}</span>
                {r.youth_safety_flag && <ShieldAlert size={15} color="#c62828" aria-label="Youth safety flag" />}
              </div>
              <div style={s.cardMeta}>
                {r.tier && <span style={{ ...s.tierChip, background: tierColor(r.tier) }}>{r.tier}</span>}
                <span style={s.stateChip}>{r.lifecycle_state}</span>
              </div>
              {r.owning_teams.length > 0 && (
                <div style={s.teams}>{r.owning_teams.map((t) => t.label).join(", ")}</div>
              )}
              <div style={s.cardBottom}>
                <span>{money(r.received_total)} <span style={s.dim}>this season</span></span>
                {!r.can_contact && r.scope === "team" && <span style={s.lock}>view only</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  newBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  reportsBtn: { display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 14px" },
  controls: { display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" },
  searchWrap: { display: "flex", alignItems: "center", gap: 7, border: "1px solid #cdd7e3", borderRadius: 8, padding: "0 10px", flex: 1, minWidth: 220, background: "#fff" },
  searchIn: { border: "none", outline: "none", padding: "9px 0", fontSize: 14, width: "100%", background: "transparent" },
  select: { padding: "9px 10px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff" },
  muted: { color: "#889", fontSize: 14 },
  section: { marginBottom: 22 },
  sectionHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, color: "#1a3a5c", marginBottom: 10 },
  countChip: { fontSize: 12, fontWeight: 700, background: "#eef4fb", color: "#1565c0", borderRadius: 10, padding: "1px 9px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 },
  card: { display: "flex", textAlign: "left", padding: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, cursor: "pointer", overflow: "hidden" },
  tierBar: { width: 6, flexShrink: 0 },
  cardBody: { padding: "11px 13px", flex: 1, minWidth: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 },
  cardName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  cardMeta: { display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" },
  tierChip: { color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "1px 8px" },
  stateChip: { background: "#eef2f7", color: "#556", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "1px 8px", textTransform: "capitalize" },
  teams: { fontSize: 12, color: "#667", marginTop: 7 },
  cardBottom: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9, fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  dim: { fontWeight: 400, color: "#99a", fontSize: 11 },
  lock: { fontSize: 10.5, fontWeight: 700, color: "#889", background: "#f1f5f9", borderRadius: 5, padding: "1px 6px", textTransform: "uppercase" },
};
