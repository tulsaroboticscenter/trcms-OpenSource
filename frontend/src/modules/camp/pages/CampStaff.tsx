import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../../../core/AuthContext";
import { campApi, type CampSeason, type CampStaffApp } from "../api";
import CampTabs from "../components/CampTabs";
import { Plus, X, Upload } from "lucide-react";

const STATUSES = ["pending", "accepted", "declined", "withdrawn"];

export default function CampStaff() {
  const { canWrite } = useAuth();
  const canManage = canWrite("camp.manage");
  const [season, setSeason] = useState<CampSeason | null>(null);
  const [apps, setApps] = useState<CampStaffApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<CampStaffApp>>({});
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function doImport(file: File) {
    try {
      const r = await campApi.importStaff(file, season?.id);
      flash(`Imported ${r.created} staff application(s).${r.errors.length ? ` ${r.errors.length} row(s) had issues.` : ""}`);
      load();
    } catch { flash("Import failed — check the file format."); }
    if (fileRef.current) fileRef.current.value = "";
  }

  const load = useCallback(async () => {
    const s = await campApi.currentSeason().catch(() => null);
    setSeason(s);
    setApps(await campApi.listStaffApps(s?.id).catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }
  async function setStatus(a: CampStaffApp, status: string) {
    await campApi.saveStaffApp({ id: a.id, status });
    setApps((xs) => xs.map((x) => x.id === a.id ? { ...x, status } : x));
  }
  async function add() {
    if (!form.name?.trim()) { flash("Name is required."); return; }
    await campApi.saveStaffApp({ ...form, season_id: season?.id });
    setAdding(false); setForm({}); flash("Staff application saved."); load();
  }

  if (loading) return <div style={st.page}><CampTabs /><p style={st.muted}>Loading…</p></div>;

  return (
    <div style={st.page}>
      <CampTabs />
      {msg && <div style={st.flash}>{msg}</div>}
      <div style={st.toolbar}>
        <span style={st.count}>{apps.length} application{apps.length === 1 ? "" : "s"}</span>
        {canManage && <>
          <button style={st.importBtn} onClick={() => fileRef.current?.click()}><Upload size={14} /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); }} />
        </>}
        {canManage && !adding && <button style={st.addBtn} onClick={() => setAdding(true)}><Plus size={14} /> Add staff application</button>}
      </div>

      {adding && (
        <div style={st.card}>
          <div style={st.editorHead}><strong>New staff application</strong><button style={st.iconBtn} onClick={() => setAdding(false)}><X size={16} /></button></div>
          <div style={st.grid}>
            <F label="Name *"><input style={st.in} value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></F>
            <F label="Email"><input style={st.in} value={form.email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="auto-links to a member if matched" /></F>
            <F label="Phone"><input style={st.in} value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></F>
            <F label="Affiliation"><input style={st.in} value={form.affiliation ?? ""} onChange={(e) => setForm((f) => ({ ...f, affiliation: e.target.value }))} placeholder="Mentor, alumnus, parent…" /></F>
            <F label="Sessions"><input style={st.in} value={form.sessions_applied ?? ""} onChange={(e) => setForm((f) => ({ ...f, sessions_applied: e.target.value }))} /></F>
            <F label="Roles"><input style={st.in} value={form.roles_applied ?? ""} onChange={(e) => setForm((f) => ({ ...f, roles_applied: e.target.value }))} /></F>
            <F label="Shirt size"><input style={st.in} value={form.shirt_size ?? ""} onChange={(e) => setForm((f) => ({ ...f, shirt_size: e.target.value }))} /></F>
          </div>
          <div style={st.actions}><button style={st.ghost} onClick={() => setAdding(false)}>Cancel</button><button style={st.addBtn} onClick={add}>Save</button></div>
        </div>
      )}

      <div style={st.card}>
        {apps.length === 0 ? <p style={st.muted}>No staff applications yet.</p> : (
          <div style={st.listWrap}>
            <table style={st.table}>
              <thead><tr><th style={st.th}>Applicant</th><th style={st.th}>Contact</th><th style={st.th}>Sessions / Roles</th><th style={st.th}>Status</th></tr></thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} style={st.tr}>
                    <td style={st.td}><strong>{a.name}</strong>{a.member_id && <span style={st.memberTag}> · Member</span>}<div style={st.sub}>{[a.affiliation, a.prior_summers && `prior: ${a.prior_summers}`, a.first_experience && `${a.first_experience} yrs FIRST`].filter(Boolean).join(" · ")}</div></td>
                    <td style={st.td}>{a.email}<div style={st.sub}>{a.phone}{a.shirt_size ? ` · shirt ${a.shirt_size}` : ""}</div></td>
                    <td style={st.td}>{a.sessions_applied}<div style={st.sub}>{a.roles_applied}</div></td>
                    <td style={st.td}><select style={st.cellSel} disabled={!canManage} value={a.status} onChange={(e) => setStatus(a, e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.lbl}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  muted: { color: "#888", fontSize: 14 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  count: { fontSize: 12, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  importBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, marginLeft: "auto" },
  ghost: { padding: "8px 14px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 14 },
  editorHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#667", padding: 4, display: "flex" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px 14px", marginBottom: 8 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  listWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "8px", verticalAlign: "top", borderBottom: "1px solid #f4f6fa" },
  sub: { fontSize: 11, color: "#99a", marginTop: 2 },
  memberTag: { fontSize: 11, fontWeight: 700, color: "#2e7d32" },
  cellSel: { padding: "4px 6px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 12, background: "#fff" },
};
