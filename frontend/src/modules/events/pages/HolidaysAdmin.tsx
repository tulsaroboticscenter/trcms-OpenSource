import { useEffect, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { Plus, Trash2, CalendarDays } from "lucide-react";
import { eventsApi, type TrcHoliday } from "../api";

/** Admin → manage TRC-specific holidays/closures shown on the calendar (#118). */
export default function HolidaysAdmin() {
  const goBack = useGoBack("/admin");
  const [rows, setRows] = useState<TrcHoliday[]>([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", holiday_date: "", end_date: "", recurring_annual: false });
  const [msg, setMsg] = useState("");

  const load = () => eventsApi.adminHolidays().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function add() {
    if (!f.name.trim() || !f.holiday_date) { setMsg("Name and date are required."); return; }
    setRows(await eventsApi.createHoliday({ name: f.name.trim(), holiday_date: f.holiday_date, end_date: f.end_date || null, recurring_annual: f.recurring_annual }));
    setAdding(false); setF({ name: "", holiday_date: "", end_date: "", recurring_annual: false }); setMsg("");
  }
  async function del(id: number) { if (confirm("Remove this holiday?")) setRows(await eventsApi.deleteHoliday(id)); }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <button style={s.back} onClick={goBack}>← Admin</button>
      <div style={s.head}>
        <h1 style={s.h1}><CalendarDays size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Holidays &amp; Closures</h1>
        <button style={s.new} onClick={() => setAdding((v) => !v)}><Plus size={15} /> Add</button>
      </div>
      <p style={s.sub}>US federal holidays appear on the Events Calendar automatically. Add TRC-specific closures or breaks here (a single day or a range; optionally repeating every year).</p>

      {adding && (
        <div style={s.form}>
          <input style={{ ...s.in, flex: 2 }} placeholder="Name (e.g. Winter Break)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label style={s.dlbl}>From <input style={s.in} type="date" value={f.holiday_date} onChange={(e) => setF({ ...f, holiday_date: e.target.value })} /></label>
          <label style={s.dlbl}>To <input style={s.in} type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></label>
          <label style={s.chk}><input type="checkbox" checked={f.recurring_annual} onChange={(e) => setF({ ...f, recurring_annual: e.target.checked })} /> Every year</label>
          <button style={s.save} onClick={add}>Save</button>
        </div>
      )}
      {msg && <div style={s.err}>{msg}</div>}

      <div style={s.list}>
        {rows.length === 0 && <p style={s.muted}>No TRC-specific holidays yet. Federal holidays still show automatically.</p>}
        {rows.map((h) => (
          <div key={h.id} style={s.row}>
            <div>
              <div style={s.name}>{h.name} {h.recurring_annual && <span style={s.tag}>every year</span>}</div>
              <div style={s.date}>{h.holiday_date}{h.end_date ? ` – ${h.end_date}` : ""}</div>
            </div>
            <button style={s.del} onClick={() => del(h.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  new: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13, margin: "6px 0 14px", lineHeight: 1.5 },
  form: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 12 },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5 },
  dlbl: { fontSize: 12, color: "#556", display: "flex", alignItems: "center", gap: 5 },
  chk: { fontSize: 13, color: "#334", display: "flex", alignItems: "center", gap: 5 },
  save: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  err: { color: "#c62828", fontSize: 12.5, marginBottom: 8 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 14px" },
  name: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  tag: { fontSize: 10.5, color: "#00695c", background: "#e0f2f1", borderRadius: 8, padding: "1px 7px", fontWeight: 700 },
  date: { fontSize: 12.5, color: "#778", marginTop: 2 },
  del: { background: "none", border: "1px solid #f0c5c5", color: "#c62828", borderRadius: 6, cursor: "pointer", padding: 6, display: "flex" },
  muted: { color: "#889", fontSize: 13.5 },
};
