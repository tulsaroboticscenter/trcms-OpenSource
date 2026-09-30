import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { invoicesApi } from "./api";

/**
 * Admin control on an enrollment: record that a school / activity fund covers
 * part or all of this youth's registration. Reduces the family's amount due and
 * creates a receivable the school is invoiced for.
 */
export default function RecordSchoolPayment({ enrollmentId, memberId, onRecorded }: { enrollmentId: number; memberId: number; onRecorded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [schools, setSchools] = useState<{ id: number; name: string }[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open && schools.length === 0) {
      api.get("/api/v1/schools/").then((r) => setSchools((r.data as { id: number; name: string }[]) ?? [])).catch(() => {});
    }
  }, [open, schools.length]);

  async function record() {
    if (!schoolId || !amount) { setMsg("Choose a school and amount."); return; }
    setBusy(true); setMsg("");
    try {
      await invoicesApi.recordSchoolPayment({ school_id: Number(schoolId), member_id: memberId, enrollment_id: enrollmentId, amount: parseFloat(amount), note });
      setMsg("Recorded — the family's balance was reduced.");
      setAmount(""); setNote("");
      onRecorded?.();
    } catch (e: unknown) {
      setMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not record.");
    } finally { setBusy(false); }
  }

  if (!open) {
    return <button style={st.link} onClick={() => setOpen(true)}>+ A school / activity fund is paying part of this</button>;
  }
  return (
    <div style={st.box}>
      <div style={st.row}>
        <select style={st.sel} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
          <option value="">School / fund…</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input style={st.amt} type="number" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <input style={st.noteIn} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button style={st.save} disabled={busy} onClick={record}>Record school payment</button>
        <button style={st.cancel} onClick={() => setOpen(false)}>Cancel</button>
        {msg && <span style={st.msg}>{msg}</span>}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  link: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, padding: "6px 0", textAlign: "left" },
  box: { marginTop: 8, padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7 },
  row: { display: "flex", gap: 8, marginBottom: 8 },
  sel: { flex: 1, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  amt: { width: 100, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  noteIn: { width: "100%", padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 8 },
  save: { padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  cancel: { padding: "7px 12px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, cursor: "pointer" },
  msg: { fontSize: 12, color: "#2e7d32" },
};
