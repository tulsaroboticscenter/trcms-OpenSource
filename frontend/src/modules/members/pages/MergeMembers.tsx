import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { membersApi, type MergePreview } from "../api";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, Search, X, GitMerge, AlertTriangle, ArrowRight } from "lucide-react";

interface Hit { id: number; first_name: string; last_name: string; member_number?: string; member_type?: string }
type Side = "duplicate" | "target";

const FIELD_LABELS: Record<string, string> = {
  email: "Email", phone: "Phone", alt_email1: "Alt Email 1", alt_email2: "Alt Email 2",
  address_line1: "Address 1", address_line2: "Address 2", city: "City", state: "State", zip_code: "ZIP",
  emergency_contact_name: "Emergency Contact", emergency_contact_phone: "Emergency Phone",
  emergency_contact_relationship: "Emergency Relationship",
  guardian1_name: "Guardian 1", guardian1_phone: "Guardian 1 Phone", guardian1_email: "Guardian 1 Email",
  guardian2_name: "Guardian 2", guardian2_phone: "Guardian 2 Phone", guardian2_email: "Guardian 2 Email",
  school: "School", birthday: "Birthday", shirt_size: "Shirt Size", special_notes: "Notes",
};

function MemberSearch({ label, picked, onPick, onClear, color }: {
  label: string; picked: Hit | null; onPick: (h: Hit) => void; onClear: () => void; color: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  async function search() {
    if (!q.trim()) { setHits([]); return; }
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(q.trim())}&include_archived=true&limit=10`);
    setHits(data.members ?? []);
  }
  return (
    <div style={{ ...st.sideBox, borderColor: color }}>
      <div style={{ ...st.sideLabel, color }}>{label}</div>
      {picked ? (
        <div style={st.pickedRow}>
          <span><strong>{picked.first_name} {picked.last_name}</strong>{picked.member_number ? ` · #${picked.member_number}` : ""}{picked.member_type ? ` · ${picked.member_type}` : ""}</span>
          <button style={st.clearBtn} onClick={onClear}><X size={13} /></button>
        </div>
      ) : (
        <>
          <div style={st.searchRow}>
            <input style={st.input} value={q} placeholder="Search member by name…" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())} />
            <button style={st.searchBtn} onClick={search}><Search size={14} /></button>
          </div>
          {hits.length > 0 && (
            <div style={st.hits}>
              {hits.map((h) => (
                <button type="button" key={h.id} style={st.hit} onClick={() => { onPick(h); setHits([]); setQ(""); }}>
                  {h.last_name}, {h.first_name}{h.member_number ? ` · #${h.member_number}` : ""}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MergeMembers() {
  const navigate = useNavigate();
  const goBack = useGoBack("/admin");
  const [dup, setDup] = useState<Hit | null>(null);
  const [tgt, setTgt] = useState<Hit | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Side>>({});
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadPreview() {
    if (!dup || !tgt) return;
    setError(""); setPreview(null);
    if (dup.id === tgt.id) { setError("Pick two different members."); return; }
    setBusy(true);
    try {
      const p = await membersApi.mergePreview(dup.id, tgt.id);
      setPreview(p);
      // Default each field to target, except fill blanks: if target empty and dup has a value, prefer duplicate.
      const c: Record<string, Side> = {};
      for (const f of p.contact_fields) {
        c[f.field] = (!f.target && f.duplicate) ? "duplicate" : "target";
      }
      setChoices(c);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not load the merge preview.");
    } finally { setBusy(false); }
  }

  async function execute() {
    if (!dup || !tgt || !preview) return;
    setBusy(true); setError("");
    try {
      await membersApi.mergeExecute(dup.id, tgt.id, choices);
      navigate(`/members/${tgt.id}`, { state: { success: "Members merged. Records moved to this account and the duplicate was removed." } });
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Merge failed.");
      setBusy(false);
    }
  }

  const confirmPhrase = dup ? `${dup.first_name} ${dup.last_name}` : "";
  const canExecute = !!preview && confirm.trim() === confirmPhrase && !busy;

  return (
    <div style={st.page}>
      <button onClick={goBack} style={st.back}><ArrowLeft size={14} /> Admin Console</button>
      <h1 style={st.h1}><GitMerge size={20} style={{ verticalAlign: -4 }} /> Merge Duplicate Members</h1>
      <p style={st.sub}>Move all records from a duplicate account onto the one you're keeping, then delete the duplicate. Review carefully — this cannot be undone.</p>

      {error && <div style={st.err}><AlertTriangle size={15} /> {error}</div>}

      <div style={st.sides}>
        <MemberSearch label="Duplicate (will be deleted)" picked={dup} onPick={setDup} onClear={() => { setDup(null); setPreview(null); }} color="#c62828" />
        <ArrowRight size={22} color="#aaa" style={{ flexShrink: 0, alignSelf: "center" }} />
        <MemberSearch label="Keep (target)" picked={tgt} onPick={setTgt} onClear={() => { setTgt(null); setPreview(null); }} color="#2e7d32" />
      </div>

      {dup && tgt && !preview && (
        <button style={st.previewBtn} onClick={loadPreview} disabled={busy}>{busy ? "Loading…" : "Preview Merge"}</button>
      )}

      {preview && (
        <>
          <div style={st.card}>
            <div style={st.cardTitle}>Records that will move to {preview.target.name}</div>
            {preview.record_counts.length === 0 ? <p style={st.muted}>No linked records on the duplicate.</p> : (
              <div style={st.countGrid}>
                {preview.record_counts.map((c) => (
                  <div key={c.table + c.column} style={st.countItem}><strong>{c.count}</strong> {c.table.replace(/_/g, " ")}</div>
                ))}
              </div>
            )}
            <div style={st.total}>{preview.total_records} record{preview.total_records === 1 ? "" : "s"} total</div>
          </div>

          <div style={st.card}>
            <div style={st.cardTitle}>Contact info — pick which to keep per field</div>
            <div style={st.fieldHead}><span /><span style={{ color: "#c62828" }}>Duplicate</span><span style={{ color: "#2e7d32" }}>Keep</span></div>
            {preview.contact_fields.filter((f) => f.duplicate || f.target).map((f) => (
              <div key={f.field} style={st.fieldRow}>
                <span style={st.fieldLabel}>{FIELD_LABELS[f.field] ?? f.field}</span>
                <label style={{ ...st.fieldOpt, ...(choices[f.field] === "duplicate" ? st.optSel : {}) }}>
                  <input type="radio" checked={choices[f.field] === "duplicate"} onChange={() => setChoices((c) => ({ ...c, [f.field]: "duplicate" }))} disabled={!f.duplicate} />
                  <span style={st.fieldVal}>{f.duplicate || <em style={st.blank}>(blank)</em>}</span>
                </label>
                <label style={{ ...st.fieldOpt, ...(choices[f.field] === "target" ? st.optSel : {}) }}>
                  <input type="radio" checked={choices[f.field] === "target"} onChange={() => setChoices((c) => ({ ...c, [f.field]: "target" }))} />
                  <span style={st.fieldVal}>{f.target || <em style={st.blank}>(blank)</em>}</span>
                </label>
              </div>
            ))}
          </div>

          <div style={st.confirmCard}>
            <div style={st.warn}><AlertTriangle size={16} /> This permanently deletes <strong>{preview.duplicate.name}</strong> (#{preview.duplicate.member_number}) after moving its records. Type <code style={st.code}>{confirmPhrase}</code> to confirm.</div>
            <div style={st.confirmRow}>
              <input style={st.input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Type "${confirmPhrase}"`} />
              <button style={{ ...st.mergeBtn, ...(canExecute ? {} : st.disabled) }} disabled={!canExecute} onClick={execute}>
                {busy ? "Merging…" : "Merge & Delete Duplicate"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  h1: { margin: 0, fontSize: 23, fontWeight: 800, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, marginTop: 4, marginBottom: 18 },
  err: { display: "flex", alignItems: "center", gap: 8, background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 },
  sides: { display: "flex", gap: 12, alignItems: "stretch", marginBottom: 14 },
  sideBox: { flex: 1, border: "2px solid #e2e8f0", borderRadius: 10, padding: 14, background: "#fff" },
  sideLabel: { fontSize: 12, fontWeight: 700, marginBottom: 8 },
  searchRow: { display: "flex", gap: 6 },
  input: { flex: 1, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, minWidth: 0 },
  searchBtn: { padding: "8px 12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" },
  hits: { display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 200, overflowY: "auto" },
  hit: { textAlign: "left", padding: "7px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#1a3a5c" },
  pickedRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 14, color: "#1a3a5c" },
  clearBtn: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex" },
  previewBtn: { padding: "10px 22px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14, marginBottom: 16 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  muted: { color: "#aaa", fontSize: 13, margin: 0 },
  countGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  countItem: { fontSize: 12, background: "#f0f4f8", borderRadius: 6, padding: "4px 10px", color: "#445", textTransform: "capitalize" },
  total: { marginTop: 10, fontSize: 12, fontWeight: 700, color: "#1a3a5c" },
  fieldHead: { display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  fieldRow: { display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 8, alignItems: "center", padding: "5px 0", borderTop: "1px solid #f0f4f8" },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#445" },
  fieldOpt: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#333", cursor: "pointer", padding: "4px 8px", borderRadius: 6, border: "1px solid transparent" },
  optSel: { background: "#f0f7ff", borderColor: "#cfe0f3" },
  fieldVal: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  blank: { color: "#bbb" },
  confirmCard: { background: "#fffaf2", border: "1px solid #f0d8a8", borderRadius: 10, padding: "1rem 1.25rem" },
  warn: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#8a5a00", lineHeight: 1.6, marginBottom: 12 },
  code: { fontFamily: "monospace", background: "#f0e6d2", padding: "1px 6px", borderRadius: 4, color: "#7a4f00", fontWeight: 700 },
  confirmRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  mergeBtn: { padding: "10px 18px", background: "#c62828", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" },
  disabled: { opacity: 0.45, cursor: "not-allowed" },
};
