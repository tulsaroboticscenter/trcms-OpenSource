import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { grantsApi, STATUSES, SCOPES, type Grant } from "../api";
import { PlusCircle, BarChart2, Search, Award } from "lucide-react";

const statusMeta = (s: string) => STATUSES.find((x) => x.value === s) ?? { label: s, color: "#888" };
const scopeLabel = (s: string) => SCOPES.find((x) => x.value === s)?.label ?? s;

export default function GrantsList() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canManage = canWrite("grants.manage");
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [status, setStatus] = useState("");
  const [funder, setFunder] = useState("");
  const [season, setSeason] = useState("");
  const [seasons, setSeasons] = useState<string[]>([]);

  function load() {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (funder) params.funder = funder;
    if (season) params.season = season;
    grantsApi.list(params).then(setGrants).catch(() => setGrants([]));
  }
  useEffect(() => { load(); }, [status, season]); // eslint-disable-line react-hooks/exhaustive-deps
  // Seasons come from Season Manager so the filter matches what grants are tagged with.
  useEffect(() => { api.get("/api/v1/seasons/").then((r) => setSeasons((r.data as { season: string }[]).map((x) => x.season))).catch(() => {}); }, []);

  return (
    <div>
      <div style={st.head}>
        <h1 style={st.heading}><Award size={22} style={{ verticalAlign: -3 }} /> Grant Tracking</h1>
        <div style={st.headBtns}>
          <button style={st.reportBtn} onClick={() => navigate("/grants/reports")}><BarChart2 size={15} /> Reports</button>
          {canManage && <button style={st.addBtn} onClick={() => navigate("/grants/new")}><PlusCircle size={15} /> New Grant</button>}
        </div>
      </div>

      <div style={st.toolbar}>
        <div style={st.searchRow}>
          <Search size={15} color="#888" />
          <input style={st.search} placeholder="Filter by funder…" value={funder}
            onChange={(e) => setFunder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <select style={st.select} value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="">All seasons</option>
          {seasons.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
        </select>
        <select style={st.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button style={st.searchBtn} onClick={load}>Apply</button>
      </div>

      {grants === null ? <p style={st.muted}>Loading…</p> : grants.length === 0 ? (
        <p style={st.muted}>No grants yet.{canManage && " Click “New Grant” to add one."}</p>
      ) : (
        <div style={st.table}>
          <div style={st.theadRow}>
            <span style={{ flex: 2 }}>Grant</span><span style={{ flex: 1 }}>Funder</span>
            <span style={{ width: 84 }}>Season</span>
            <span style={{ width: 110 }}>Scope</span><span style={{ width: 120 }}>Status</span>
            <span style={{ width: 100, textAlign: "right" }}>Requested</span><span style={{ width: 100, textAlign: "right" }}>Received</span>
          </div>
          {grants.map((g) => {
            const m = statusMeta(g.status);
            return (
              <div key={g.id} style={st.row} onClick={() => navigate(`/grants/${g.id}`)}>
                <div style={{ flex: 2 }}>
                  <div style={st.name}>{g.name}</div>
                  <div style={st.sub}>{g.team_count ?? 0} team{(g.team_count ?? 0) !== 1 ? "s" : ""} · {g.awarded_count ?? 0} awarded · {g.recurrence === "annual" ? "Annual" : g.recurrence === "one_time" ? "One-time" : "Other"}{g.restricted_funds ? " · Restricted" : ""}</div>
                </div>
                <span style={{ flex: 1, color: "#555" }}>{g.funder_name ?? "—"}</span>
                <span style={{ width: 84, color: "#667", fontSize: 12.5 }} title="Season this grant funds">{g.season ?? "—"}</span>
                <span style={{ width: 110, color: "#555", fontSize: 13 }}>{scopeLabel(g.scope)}</span>
                <span style={{ width: 120 }}><span style={{ ...st.badge, color: m.color, background: m.color + "22" }}>{m.label}</span></span>
                <span style={{ width: 100, textAlign: "right" }}>${(g.total_requested ?? 0).toLocaleString()}</span>
                <span style={{ width: 100, textAlign: "right", fontWeight: 700, color: (g.total_received ?? 0) > 0 ? "#2e7d32" : "#999" }}>${(g.total_received ?? 0).toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  headBtns: { display: "flex", gap: 8 },
  reportBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  toolbar: { display: "flex", gap: 10, marginBottom: 16, alignItems: "center" },
  searchRow: { display: "flex", alignItems: "center", gap: 6, flex: 1, border: "1px solid #ccc", borderRadius: 6, padding: "0 10px", background: "#fff" },
  search: { flex: 1, padding: "9px 0", border: "none", outline: "none", fontSize: 14 },
  select: { padding: "9px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  searchBtn: { padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  table: { display: "flex", flexDirection: "column", gap: 4 },
  theadRow: { display: "flex", alignItems: "center", gap: 10, padding: "4px 14px", fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer" },
  name: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  sub: { fontSize: 12, color: "#888", marginTop: 2 },
  badge: { padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
};
