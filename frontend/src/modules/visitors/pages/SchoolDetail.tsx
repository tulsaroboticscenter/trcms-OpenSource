/**
 * SchoolDetail — a school/partner relationship: contacts, engagement history, and
 * attribution (prospects/enrollments credited to this school).
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { schoolsApi, type SchoolDetail as School } from "../schoolsApi";
import { ArrowLeft, Plus, Trash2, Mail, Phone } from "lucide-react";

export default function SchoolDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [sc, setSc] = useState<School | null>(null);
  const [contact, setContact] = useState({ name: "", title: "", email: "", phone: "" });
  const [addingContact, setAddingContact] = useState(false);
  const [eng, setEng] = useState({ type: "presentation", notes: "", engaged_on: new Date().toISOString().slice(0, 10) });

  const load = useCallback(() => { schoolsApi.get(Number(id)).then(setSc); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!sc) return <div style={s.page}><p style={s.muted}>Loading…</p></div>;

  const patch = async (d: Record<string, unknown>) => setSc(await schoolsApi.update(sc.id, d));
  async function addContact() {
    if (!contact.name.trim()) return;
    setSc(await schoolsApi.addContact(sc!.id, contact));
    setContact({ name: "", title: "", email: "", phone: "" }); setAddingContact(false);
  }
  async function addEngagement() {
    setSc(await schoolsApi.addEngagement(sc!.id, eng));
    setEng({ type: "presentation", notes: "", engaged_on: new Date().toISOString().slice(0, 10) });
  }
  async function remove() {
    if (confirm(`Delete "${sc!.name}"? This removes its contacts and engagement history.`)) { await schoolsApi.remove(sc!.id); navigate("/visitors/schools"); }
  }

  return (
    <div style={s.page}>
      <button style={s.back} onClick={() => navigate("/visitors/schools")}><ArrowLeft size={14} /> Schools</button>
      <div style={s.head}>
        <div>
          <input style={s.nameIn} value={sc.name} onChange={(e) => setSc({ ...sc, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })} />
          <div style={s.metaRow}>
            <select style={s.metaSel} value={sc.type ?? ""} onChange={(e) => patch({ type: e.target.value })}>
              {["elementary", "middle", "high", "library", "community", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input style={s.metaIn} placeholder="District" defaultValue={sc.district ?? ""} onBlur={(e) => patch({ district: e.target.value })} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={{ padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            onClick={() => navigate(`/invoices/school/${sc.id}`)}>Invoice & payments</button>
          <button style={s.del} onClick={remove}><Trash2 size={14} /></button>
        </div>
      </div>

      {/* Attribution */}
      <div style={s.attr}>
        <Stat label="Prospects" value={sc.prospects ?? 0} />
        <Stat label="Enrolled" value={sc.enrolled ?? 0} color="#2e7d32" />
        <Stat label="Engagements" value={sc.engagement_count ?? 0} />
      </div>

      {/* Contacts */}
      <div style={s.section}>Contacts</div>
      {sc.contacts.map((c) => (
        <div key={c.id} style={s.row}>
          <div style={{ flex: 1 }}>
            <div style={s.rowName}>{c.name}{c.title ? <span style={s.title}> · {c.title}</span> : null}</div>
            <div style={s.rowMeta}>
              {c.email && <a style={s.link} href={`mailto:${c.email}`}><Mail size={11} /> {c.email}</a>}
              {c.phone && <span style={s.link}><Phone size={11} /> {c.phone}</span>}
            </div>
          </div>
          <button style={s.iconX} onClick={async () => { if (confirm("Delete contact?")) setSc(await schoolsApi.deleteContact(c.id)); }}><Trash2 size={13} /></button>
        </div>
      ))}
      {sc.contacts.length === 0 && <p style={s.muted}>No contacts yet.</p>}
      {addingContact ? (
        <div style={s.addForm}>
          <div style={s.formRow}>
            <input style={s.fin} placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            <input style={s.fin} placeholder="Title (STEM teacher…)" value={contact.title} onChange={(e) => setContact({ ...contact, title: e.target.value })} />
          </div>
          <div style={s.formRow}>
            <input style={s.fin} placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            <input style={s.fin} placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            <button style={s.saveSm} onClick={addContact}>Add</button>
          </div>
        </div>
      ) : <button style={s.addBtn} onClick={() => setAddingContact(true)}><Plus size={13} /> Add contact</button>}

      {/* Engagements */}
      <div style={s.section}>Engagement history</div>
      <div style={s.addForm}>
        <div style={s.formRow}>
          <select style={s.fin} value={eng.type} onChange={(e) => setEng({ ...eng, type: e.target.value })}>
            {["visit", "presentation", "demo", "fair", "flyer", "call", "email", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input style={s.fin} type="date" value={eng.engaged_on} onChange={(e) => setEng({ ...eng, engaged_on: e.target.value })} />
        </div>
        <div style={s.formRow}>
          <input style={{ ...s.fin, flex: 3 }} placeholder="What happened / outcome (e.g. assembly, 40 students)" value={eng.notes} onChange={(e) => setEng({ ...eng, notes: e.target.value })} />
          <button style={s.saveSm} onClick={addEngagement}>Log</button>
        </div>
      </div>
      {sc.engagements.map((e) => (
        <div key={e.id} style={s.row}>
          <div style={{ flex: 1 }}>
            <div style={s.rowName}><span style={s.engType}>{e.type}</span> {e.notes}</div>
            <div style={s.rowMeta}>{e.engaged_on}{e.member_name ? ` · ${e.member_name}` : ""}{e.outcome ? ` · ${e.outcome}` : ""}</div>
          </div>
          <button style={s.iconX} onClick={async () => { if (confirm("Delete engagement?")) setSc(await schoolsApi.deleteEngagement(e.id)); }}><Trash2 size={13} /></button>
        </div>
      ))}
      {sc.engagements.length === 0 && <p style={s.muted}>No engagement logged yet.</p>}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return <div style={s.stat}><div style={{ ...s.statVal, ...(color ? { color } : {}) }}>{value}</div><div style={s.statLabel}>{label}</div></div>;
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 800, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  nameIn: { fontSize: 22, fontWeight: 800, color: "#1a3a5c", border: "1px solid transparent", borderRadius: 6, padding: "2px 6px", background: "transparent", width: "100%" },
  metaRow: { display: "flex", gap: 8, marginTop: 6, paddingLeft: 6 },
  metaSel: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, textTransform: "capitalize" },
  metaIn: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5 },
  del: { background: "#fff", border: "1px solid #f3cfcf", color: "#c62828", borderRadius: 7, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  attr: { display: "flex", gap: 24, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px", margin: "12px 0 16px" },
  stat: { textAlign: "center" },
  statVal: { fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  statLabel: { fontSize: 11, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 },
  section: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, margin: "18px 0 8px" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 7 },
  rowName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  title: { fontWeight: 400, color: "#778" },
  rowMeta: { fontSize: 12.5, color: "#778", marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" },
  link: { display: "inline-flex", alignItems: "center", gap: 4, color: "#1565c0", textDecoration: "none", fontSize: 12.5 },
  engType: { fontWeight: 700, color: "#1565c0", textTransform: "capitalize" },
  iconX: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 3 },
  muted: { color: "#889", fontSize: 13.5, margin: "4px 0" },
  addForm: { background: "#f8fafc", border: "1px dashed #cdd7e3", borderRadius: 8, padding: 10, marginBottom: 8 },
  formRow: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  fin: { flex: 1, minWidth: 120, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  saveSm: { background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, padding: "7px 13px", fontSize: 13, fontWeight: 600, color: "#1565c0", cursor: "pointer", marginTop: 4 },
};
