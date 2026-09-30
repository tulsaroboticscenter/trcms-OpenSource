import { useEffect, useState } from "react";
import { CalendarClock, Mail, Trash2, Plus } from "lucide-react";
import { reportEngineApi, type ReportScheduleItem } from "../api";

const DOW = [
  { v: 0, l: "Sunday" }, { v: 1, l: "Monday" }, { v: 2, l: "Tuesday" }, { v: 3, l: "Wednesday" },
  { v: 4, l: "Thursday" }, { v: 5, l: "Friday" }, { v: 6, l: "Saturday" },
];

/**
 * Manage email schedules for a saved report — add a cadence + recipients, list
 * and remove existing schedules. The cron delivers them as the report owner.
 */
export default function ReportSchedulePanel({ reportId }: { reportId: number }) {
  const [schedules, setSchedules] = useState<ReportScheduleItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [cadence, setCadence] = useState("weekly");
  const [dow, setDow] = useState(1);
  const [dom, setDom] = useState(1);
  const [hour, setHour] = useState(6);
  const [emails, setEmails] = useState("");
  const [err, setErr] = useState("");

  const reload = () => reportEngineApi.listSchedules(reportId).then(setSchedules).catch(() => {});
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [reportId]);

  async function add() {
    setErr("");
    if (!emails.trim()) { setErr("Enter at least one recipient email."); return; }
    try {
      await reportEngineApi.createSchedule(reportId, {
        cadence, send_hour: hour, recipient_emails: emails,
        ...(cadence === "weekly" ? { day_of_week: dow } : {}),
        ...(cadence === "monthly" ? { day_of_month: dom } : {}),
      });
      setEmails(""); setAdding(false); reload();
    } catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not create schedule."); }
  }

  async function remove(sid: number) {
    if (!confirm("Delete this email schedule?")) return;
    await reportEngineApi.deleteSchedule(sid).then(reload).catch(() => {});
  }

  return (
    <div style={st.box}>
      <div style={st.head}><CalendarClock size={15} color="#6a1b9a" /> Email schedule
        {!adding && <button style={st.addBtn} onClick={() => setAdding(true)}><Plus size={12} /> Add</button>}
      </div>

      {schedules.length === 0 && !adding && <p style={st.muted}>Not scheduled. Add a schedule to email this report automatically.</p>}

      {schedules.map((s) => (
        <div key={s.id} style={st.row}>
          <Mail size={13} color="#888" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={st.summary}>{s.summary}</div>
            <div style={st.emails}>{s.recipient_emails}{s.next_run_at ? ` · next ${s.next_run_at.slice(0, 16).replace("T", " ")}` : ""}</div>
          </div>
          <button style={st.del} onClick={() => remove(s.id)}><Trash2 size={13} /></button>
        </div>
      ))}

      {adding && (
        <div style={st.form}>
          <div style={st.formRow}>
            <select style={st.sel} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
            {cadence === "weekly" && (
              <select style={st.sel} value={dow} onChange={(e) => setDow(Number(e.target.value))}>
                {DOW.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
              </select>
            )}
            {cadence === "monthly" && (
              <select style={st.sel} value={dom} onChange={(e) => setDom(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>day {d}</option>)}
              </select>
            )}
            <select style={st.sel} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{((h % 12) || 12)}{h < 12 ? " AM" : " PM"}</option>)}
            </select>
          </div>
          <input style={st.input} placeholder="Recipient emails (comma-separated)" value={emails} onChange={(e) => setEmails(e.target.value)} />
          {err && <p style={st.err}>{err}</p>}
          <div style={st.formActions}>
            <button style={st.cancel} onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
            <button style={st.save} onClick={add}>Schedule</button>
          </div>
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  box: { marginTop: 16, border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, background: "#fff" },
  head: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3, background: "#f0f4f8", border: "none", borderRadius: 5, color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "3px 8px" },
  muted: { fontSize: 13, color: "#aaa", margin: "8px 0 0" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f2f5f8" },
  summary: { fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  emails: { fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  del: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 4 },
  form: { marginTop: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 },
  formRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  sel: { padding: "7px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  err: { color: "#c62828", fontSize: 12, margin: "6px 0 0" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  cancel: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "6px 16px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
