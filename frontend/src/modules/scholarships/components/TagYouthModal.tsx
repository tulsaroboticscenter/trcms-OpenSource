/**
 * TagYouthModal — a mentor picks one or more youth to tag onto a scholarship. It
 * lands on each youth's Watchlist (College/Vo-Tech Prep tab) with an optional
 * personal note, and can email them a heads-up.
 */
import { useEffect, useRef, useState } from "react";
import { X, Search, Check, Mail } from "lucide-react";
import { membersApi } from "../../members/api";
import { scholarshipsApi, type Scholarship } from "../api";

interface YouthLite { id: number; first_name: string; last_name: string; member_number?: string }

export default function TagYouthModal({ scholarship, onClose, onDone }: {
  scholarship: Scholarship; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<YouthLite[]>([]);
  const [picked, setPicked] = useState<YouthLite[]>([]);
  const [note, setNote] = useState(`Hi! I wanted to make sure you saw the ${scholarship.name} scholarship — I think it could be a great fit for you.`);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // The list endpoint returns { total, members }. Include alumni: graduated
      // youth keep member_type "youth" (with an is_alumni flag) and may be
      // deactivated, so don't restrict to active — a recent grad is exactly who
      // a mentor wants to tag for college scholarships.
      membersApi.list({ member_type: "youth", ...(q.trim() ? { search: q.trim() } : {}) })
        .then((res: { members?: YouthLite[] }) => setResults((res.members ?? []).slice(0, 25)))
        .catch(() => setResults([]));
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const isPicked = (id: number) => picked.some((p) => p.id === id);
  const toggle = (y: YouthLite) => setPicked((p) => isPicked(y.id) ? p.filter((x) => x.id !== y.id) : [...p, y]);

  async function submit() {
    if (picked.length === 0) { setErr("Pick at least one youth."); return; }
    setBusy(true); setErr("");
    try {
      const r = await scholarshipsApi.tagYouth(scholarship.id, { member_ids: picked.map((p) => p.id), note: note.trim() || undefined, notify });
      const parts = [`Added to ${r.tagged} youth's Watchlist`];
      if (notify) parts.push(`${r.emailed} emailed`);
      onDone(parts.join(" · ") + ".");
    } catch (e) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not tag.");
    } finally { setBusy(false); }
  }

  return (
    <div style={st.backdrop} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.head}>
          <div>
            <div style={st.title}>Tag youth on a scholarship</div>
            <div style={st.subtitle}>{scholarship.name}</div>
          </div>
          <button style={st.x} onClick={onClose}><X size={18} /></button>
        </div>

        {picked.length > 0 && (
          <div style={st.chips}>
            {picked.map((p) => (
              <span key={p.id} style={st.chip}>{p.first_name} {p.last_name}
                <button style={st.chipX} onClick={() => toggle(p)}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}

        <div style={st.searchWrap}>
          <Search size={15} color="#999" />
          <input style={st.search} autoFocus placeholder="Search youth by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={st.list}>
          {results.length === 0 ? <div style={st.muted}>No youth found.</div> : results.map((y) => (
            <button key={y.id} style={{ ...st.row, ...(isPicked(y.id) ? st.rowOn : {}) }} onClick={() => toggle(y)}>
              <span>{y.first_name} {y.last_name}{y.member_number ? ` · ${y.member_number}` : ""}</span>
              {isPicked(y.id) && <Check size={15} color="#2e7d32" />}
            </button>
          ))}
        </div>

        <label style={st.lbl}>Note to the youth (optional)</label>
        <textarea style={st.textarea} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Hey Luke, ONEOK offers this for kids of ONEOK employees — you qualify!" />

        <label style={st.notifyRow}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <Mail size={14} /> Email the youth to let them know
        </label>

        {err && <div style={st.err}>{err}</div>}
        <div style={st.actions}>
          <button style={st.cancel} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={st.submit} onClick={submit} disabled={busy || picked.length === 0}>
            {busy ? "Tagging…" : `Add to Watchlist${picked.length ? ` (${picked.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  title: { fontSize: 17, fontWeight: 800, color: "#1a3a5c" },
  subtitle: { fontSize: 13, color: "#778", marginTop: 1 },
  x: { background: "none", border: "none", cursor: "pointer", color: "#889", padding: 2, display: "flex" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { display: "inline-flex", alignItems: "center", gap: 4, background: "#eef4fd", color: "#1a56c4", borderRadius: 14, padding: "3px 6px 3px 10px", fontSize: 12.5, fontWeight: 600 },
  chipX: { background: "none", border: "none", cursor: "pointer", color: "#1a56c4", display: "flex", padding: 0 },
  searchWrap: { display: "flex", alignItems: "center", gap: 7, border: "1px solid #cdd7e3", borderRadius: 8, padding: "8px 11px" },
  search: { flex: 1, border: "none", outline: "none", fontSize: 13.5 },
  list: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflowY: "auto", border: "1px solid #eef1f5", borderRadius: 8, padding: 4 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13.5, color: "#334", textAlign: "left", width: "100%" },
  rowOn: { background: "#f0f7f1" },
  muted: { color: "#98a3b0", fontSize: 13, padding: 8 },
  lbl: { fontSize: 12, fontWeight: 700, color: "#556", marginTop: 2 },
  textarea: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, minHeight: 64, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" },
  notifyRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#445", cursor: "pointer" },
  err: { color: "#c62828", fontSize: 12.5, background: "#ffebee", border: "1px solid #ffcdd2", borderRadius: 6, padding: "6px 10px" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  cancel: { padding: "8px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  submit: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" },
};
