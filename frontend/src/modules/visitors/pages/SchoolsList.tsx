/**
 * SchoolsList — Recruitment Phase 2. Schools/partners are TRC's primary channel
 * for reaching students. Each card shows engagement activity and attribution
 * (prospects and enrollments that came from that school).
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { schoolsApi, type School } from "../schoolsApi";
import { ArrowLeft, Plus, School as SchoolIcon, Search } from "lucide-react";

export default function SchoolsList() {
  const navigate = useNavigate();
  const goBack = useGoBack("/visitors");
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", type: "elementary", district: "" });

  const load = () => schoolsApi.list().then(setSchools).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function add() {
    if (!f.name.trim()) return;
    const sch = await schoolsApi.create(f);
    setAdding(false); setF({ name: "", type: "elementary", district: "" });
    navigate(`/visitors/schools/${sch.id}`);
  }

  const filtered = search.trim() ? schools.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())) : schools;

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Visitors</button>
      <div style={s.head}>
        <h1 style={s.h1}><SchoolIcon size={22} /> Schools & Partners</h1>
        <button style={s.newBtn} onClick={() => setAdding(true)}><Plus size={16} /> Add School</button>
      </div>
      <p style={s.sub}>Manage the schools and partners you engage to reach students, and see which ones actually produce inquiries and enrollments.</p>

      {adding && (
        <div style={s.addForm}>
          <input style={s.in} placeholder="School / partner name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select style={s.in} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {["elementary", "middle", "high", "library", "community", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input style={s.in} placeholder="District (optional)" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
          <div style={s.formActions}>
            <button style={s.cancel} onClick={() => setAdding(false)}>Cancel</button>
            <button style={s.save} onClick={add}>Create</button>
          </div>
        </div>
      )}

      <div style={s.searchWrap}><Search size={15} color="#889" /><input style={s.searchIn} placeholder="Search schools…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      {loading ? <p style={s.muted}>Loading…</p> : filtered.length === 0 ? <p style={s.muted}>No schools yet.</p> : (
        <div style={s.grid}>
          {filtered.map((sc) => (
            <button key={sc.id} style={{ ...s.card, ...(sc.is_active ? {} : { opacity: 0.6 }) }} onClick={() => navigate(`/visitors/schools/${sc.id}`)}>
              <div style={s.cardName}>{sc.name}</div>
              <div style={s.cardMeta}>{sc.type}{sc.district ? ` · ${sc.district}` : ""}</div>
              <div style={s.stats}>
                <span style={s.stat}><b>{sc.prospects ?? 0}</b> prospects</span>
                <span style={{ ...s.stat, color: "#2e7d32" }}><b>{sc.enrolled ?? 0}</b> enrolled</span>
                <span style={s.stat}><b>{sc.engagement_count ?? 0}</b> touches</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  newBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 14px" },
  addForm: { background: "#f8fafc", border: "1px dashed #cdd7e3", borderRadius: 8, padding: 12, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancel: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  searchWrap: { display: "flex", alignItems: "center", gap: 7, border: "1px solid #cdd7e3", borderRadius: 8, padding: "0 10px", marginBottom: 14, background: "#fff", maxWidth: 320 },
  searchIn: { border: "none", outline: "none", padding: "9px 0", fontSize: 14, width: "100%", background: "transparent" },
  muted: { color: "#889", fontSize: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 },
  card: { textAlign: "left", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, cursor: "pointer" },
  cardName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  cardMeta: { fontSize: 12.5, color: "#667", marginTop: 3, textTransform: "capitalize" },
  stats: { display: "flex", gap: 12, marginTop: 10, fontSize: 12.5, color: "#556", flexWrap: "wrap" },
  stat: { color: "#556" },
};
