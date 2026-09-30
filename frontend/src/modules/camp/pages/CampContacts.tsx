import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../../../core/AuthContext";
import { campApi, type CampContact } from "../api";
import CampTabs from "../components/CampTabs";
import CampEmailModal from "../components/CampEmailModal";
import { Download, Upload, Search, Mail } from "lucide-react";

export default function CampContacts() {
  const { canWrite } = useAuth();
  const canManage = canWrite("camp.manage");
  const [contacts, setContacts] = useState<CampContact[]>([]);
  const [search, setSearch] = useState("");
  const [consentOnly, setConsentOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [emailContact, setEmailContact] = useState<{ email: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    campApi.listContacts({ ...(consentOnly ? { consent: 1 } : {}), ...(search ? { search } : {}) })
      .then(setContacts).catch(() => setContacts([])).finally(() => setLoading(false));
  }, [consentOnly, search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 4000); }

  async function patch(c: CampContact, data: Record<string, unknown>) {
    await campApi.updateContact(c.id, data);
    setContacts((cs) => cs.map((x) => x.id === c.id ? { ...x, ...data } as CampContact : x));
  }
  function exportCsv(consent: boolean) {
    const token = localStorage.getItem("trc_token");
    fetch(campApi.exportContactsUrl(consent), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob()).then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = consent ? "camp-promo-list.csv" : "camp-contacts.csv"; a.click();
      });
  }
  async function doImport(file: File) {
    try {
      const r = await campApi.importContacts(file);
      flash(`Imported ${r.contacts_created} contact(s), ${r.campers_created} camper(s), and ${r.registrations_created} registration(s).${r.errors.length ? ` ${r.errors.length} row(s) had issues.` : ""}`);
      load();
    } catch { flash("Import failed — check the file format."); }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div style={st.page}>
      <CampTabs />
      {msg && <div style={st.flash}>{msg}</div>}
      <p style={st.intro}>Parents/guardians and other interested people from camp registrations — your durable list for future promotion. Kept separate from members.</p>

      <div style={st.toolbar}>
        <div style={st.searchWrap}><Search size={14} color="#aaa" /><input style={st.search} placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <label style={st.chk}><input type="checkbox" checked={consentOnly} onChange={(e) => setConsentOnly(e.target.checked)} /> Consented only</label>
        <button style={st.btn} onClick={() => exportCsv(false)}><Download size={14} /> Export all</button>
        <button style={st.btnPrimary} onClick={() => exportCsv(true)}><Download size={14} /> Export promo list</button>
        {canManage && <>
          <button style={st.btn} onClick={() => fileRef.current?.click()}><Upload size={14} /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); }} />
        </>}
        <span style={st.count}>{contacts.length}</span>
      </div>

      <div style={st.card}>
        {loading ? <p style={st.muted}>Loading…</p> : contacts.length === 0 ? <p style={st.muted}>No contacts.</p> : (
          <div style={st.listWrap}>
            <table style={st.table}>
              <thead><tr><th style={st.th}>Name</th><th style={st.th}>Email</th><th style={st.th}>Phone</th><th style={st.thC}>Campers</th><th style={st.thC}>Promo OK</th><th style={st.thC}>Opted out</th><th style={st.th}>Source</th><th style={st.thC}></th></tr></thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} style={st.tr}>
                    <td style={st.td}><strong>{c.name}</strong>{c.member_id && <span style={st.memberTag}> · Member</span>}</td>
                    <td style={st.td}>{c.email}</td>
                    <td style={st.td}>{c.phone}</td>
                    <td style={st.tdC}>{c.camper_count}</td>
                    <td style={st.tdC}><input type="checkbox" disabled={!canManage} checked={c.marketing_consent} onChange={(e) => patch(c, { marketing_consent: e.target.checked })} /></td>
                    <td style={st.tdC}><input type="checkbox" disabled={!canManage} checked={c.opt_out} onChange={(e) => patch(c, { opt_out: e.target.checked })} /></td>
                    <td style={st.td}><span style={st.src}>{c.source}</span></td>
                    <td style={st.tdC}>
                      {canManage && c.email && !c.opt_out && (
                        <button style={st.emailBtn} title={`Email ${c.name}`} onClick={() => setEmailContact({ email: c.email!, name: c.name })}><Mail size={13} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {emailContact && <CampEmailModal singleContact={emailContact} onClose={() => setEmailContact(null)} />}
      <p style={st.hint}>"Export promo list" includes only contacts who consented and haven't opted out — use it for marketing emails. Import accepts a CSV of past registration responses (headers are matched loosely); it loads contacts, campers, and their camp registrations (auto-creating any camps it finds).</p>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  intro: { color: "#667", fontSize: 13, margin: "0 0 12px" },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  searchWrap: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #cdd7e3", borderRadius: 8, padding: "6px 10px", background: "#fff" },
  search: { border: "none", outline: "none", fontSize: 13, minWidth: 180 },
  chk: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#445" },
  btn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  btnPrimary: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  count: { fontSize: 12, color: "#888", marginLeft: "auto" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem" },
  listWrap: { overflowX: "auto" },
  muted: { color: "#888", fontSize: 14 },
  hint: { fontSize: 11.5, color: "#99a", marginTop: 10, lineHeight: 1.5 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  thC: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "8px", borderBottom: "1px solid #f4f6fa" },
  tdC: { padding: "8px", textAlign: "center", borderBottom: "1px solid #f4f6fa" },
  memberTag: { fontSize: 11, fontWeight: 700, color: "#2e7d32" },
  src: { fontSize: 11, color: "#99a" },
  emailBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "5px 9px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 6, cursor: "pointer" },
};
