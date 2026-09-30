import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NotebookPen, Plus, ClipboardList } from "lucide-react";
import { minutesApi, type MeetingSummary, type EventHit } from "../api";
import InlineHelp from "../../help/InlineHelp";

export default function MinutesList() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const group = params.get("group") || "YLC";
  // Who may create/manage this group's minutes is group-aware (a private group like the
  // Program Team is run by its tagged members, not just any Mentor), so ask the server.
  const [canManage, setCanManage] = useState(false);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [eventId, setEventId] = useState("");           // "" = new entry, not tied to an event
  const [events, setEvents] = useState<EventHit[]>([]);

  async function load() { setLoading(true); setMeetings(await minutesApi.list(group)); setLoading(false); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [group]);
  useEffect(() => { minutesApi.manageScope(group).then((s) => setCanManage(s.can_manage)).catch(() => setCanManage(false)); }, [group]);

  function startCreate() {
    setCreating(true);
    minutesApi.eventOptions(group).then(setEvents).catch(() => setEvents([]));
  }

  // Tie the new minutes to a group event: adopt its name/date as a starting point.
  function pickEvent(id: string) {
    setEventId(id);
    const ev = events.find((e) => String(e.id) === id);
    if (ev) {
      if (!title.trim()) setTitle(`${group} — ${ev.name}`);
      if (!date && ev.event_date) setDate(ev.event_date);
    }
  }

  async function create() {
    if (!title.trim()) return;
    const m = await minutesApi.create({ title, meeting_date: date || undefined, group_label: group, event_id: eventId ? Number(eventId) : undefined });
    setCreating(false); setTitle(""); setDate(""); setEventId("");
    navigate(`/minutes/${m.id}`);
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={s.head}>
        <h1 style={s.h1}><NotebookPen size={22} style={{ verticalAlign: -3, marginRight: 8 }} />{group} Meeting Minutes <InlineHelp helpKey="ylc-minutes" /></h1>
        {canManage && <button style={s.new} onClick={startCreate}><Plus size={15} /> New meeting</button>}
      </div>

      {creating && (
        <div style={s.createCard}>
          <div style={s.createRow}>
            <span style={s.fieldLabel}>Tie to a {group} event</span>
            <select style={s.in} value={eventId} onChange={(e) => pickEvent(e.target.value)}>
              <option value="">New entry — not tied to an event</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.event_date ? ` · ${ev.event_date}` : ""}</option>)}
            </select>
          </div>
          <div style={s.createRow}>
            <input style={{ ...s.in, flex: 1 }} placeholder="Meeting title (e.g. September YLC)" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <input style={s.in} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div style={s.createRow}>
            <button style={s.save} onClick={create}>Create</button>
            <button style={s.cancel} onClick={() => { setCreating(false); setEventId(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <p style={s.muted}>Loading…</p> : meetings.length === 0 ? <p style={s.muted}>No meeting minutes yet.</p> : (
        <div style={s.list}>
          {meetings.map((m) => (
            <button key={m.id} style={s.row} onClick={() => navigate(`/minutes/${m.id}`)}>
              <div>
                <div style={s.title}>{m.title}</div>
                <div style={s.meta}>{m.meeting_date ?? "No date"}{m.location ? ` · ${m.location}` : ""}</div>
              </div>
              {m.action_count > 0 && (
                <span style={s.actions}><ClipboardList size={13} /> {m.open_actions} open / {m.action_count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  new: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  createCard: { display: "flex", flexDirection: "column", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: 14, marginBottom: 14 },
  createRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  fieldLabel: { fontSize: 12.5, color: "#556", fontWeight: 600, minWidth: 120 },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5 },
  save: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  cancel: { padding: "8px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, cursor: "pointer" },
  muted: { color: "#889", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "13px 16px", cursor: "pointer", textAlign: "left", width: "100%" },
  title: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  meta: { fontSize: 12.5, color: "#667", marginTop: 3 },
  actions: { fontSize: 12, color: "#e65100", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" },
};
