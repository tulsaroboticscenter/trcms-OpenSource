import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { activityApi, fmtHours, fmtMinutes, type Checkin, type TimeEntry } from "../../activity/api";
import { eventsApi, type TRCEvent } from "../../events/api";
import { DoorOpen, Pencil, Check, X, Trash2, Plus, CalendarSearch, Tag, ChevronDown, ChevronUp } from "lucide-react";

/**
 * A member's check-in history. The member can edit/delete/add their own
 * check-ins; doing so for someone else needs the checkin.manage permission
 * (the backend enforces this too).
 *
 * Check-in times are stored in UTC, so we convert to/from the viewer's local
 * time for display and the datetime-local inputs.
 */
const asUtcIso = (iso: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
const pad = (n: number) => String(n).padStart(2, "0");
/** stored UTC → "YYYY-MM-DDTHH:MM" in local time (for a datetime-local input). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(asUtcIso(iso));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** local datetime-local value → UTC ISO for the API. */
const localToUtc = (v: string) => new Date(v).toISOString();
const fmtTs = (iso: string | null) => (iso ? new Date(asUtcIso(iso)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const fmtDateLocal = (iso: string) => new Date(asUtcIso(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function MemberCheckinsPanel({ memberId }: { memberId: number }) {
  const { user, canWrite } = useAuth();
  const canEdit = user?.id === memberId || canWrite("checkin.manage");
  const [checkins, setCheckins] = useState<Checkin[] | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);   // show last 5 by default, expand for the rest

  const RECENT = 5;

  const load = useCallback(() => {
    activityApi.memberCheckins(memberId).then(setCheckins).catch(() => setCheckins([]));
  }, [memberId]);
  const loadEntries = useCallback(() => {
    activityApi.listEntries(memberId).then(setEntries).catch(() => setEntries([]));
  }, [memberId]);
  useEffect(load, [load]);
  useEffect(loadEntries, [loadEntries]);
  useEffect(() => { activityApi.areas(memberId).then((a) => setAreas(a.areas)).catch(() => {}); }, [memberId]);

  const refresh = () => { load(); loadEntries(); };

  return (
    <div>
      {canEdit && (
        <div style={st.toolbar}>
          <button style={st.addBtn} onClick={() => setAdding((v) => !v)}><Plus size={14} /> Add check-in</button>
        </div>
      )}
      {adding && <Editor memberId={memberId} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      {checkins === null ? <p style={st.muted}>Loading…</p>
        : checkins.length === 0 ? <p style={st.muted}>No check-ins recorded yet.</p>
        : <>
            <div style={st.list}>{(showAll ? checkins : checkins.slice(0, RECENT)).map((c) => (
              <Row key={c.id} c={c} canEdit={canEdit} areas={areas}
                entries={entries.filter((e) => e.checkin_id === c.id)} onChanged={refresh} />
            ))}</div>
            {checkins.length > RECENT && (
              <button style={st.showAll} onClick={() => setShowAll((v) => !v)}>
                {showAll
                  ? <><ChevronUp size={14} /> Show fewer</>
                  : <><ChevronDown size={14} /> Show all {checkins.length} check-ins</>}
              </button>
            )}
          </>}
    </div>
  );
}

/** Shared add/edit form. Pass `checkin` to edit, omit to add a new one. */
function Editor({ memberId, checkin, onDone, onCancel }: {
  memberId: number; checkin?: Checkin; onDone: () => void; onCancel: () => void;
}) {
  const [tin, setTin] = useState(checkin ? toLocalInput(checkin.time_in) : "");
  const [tout, setTout] = useState(checkin ? toLocalInput(checkin.time_out) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Optional: tie a backfilled check-in to an event (e.g. a missed weekly meeting).
  const [events, setEvents] = useState<TRCEvent[]>([]);
  const [eventQuery, setEventQuery] = useState("");
  const [eventId, setEventId] = useState<number | null>(null);
  const [eventName, setEventName] = useState("");

  useEffect(() => {
    if (checkin) return; // event picker is for new (backfilled) check-ins
    // Recent + upcoming events (last ~120 days forward) — enough to find a missed meeting.
    const from = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    eventsApi.list({ from_date: from }).then((r) => setEvents(r.events)).catch(() => {});
  }, [checkin]);

  const eventMatches = eventQuery.trim().length < 2 ? [] : events.filter((e) =>
    e.name.toLowerCase().includes(eventQuery.trim().toLowerCase())).slice(0, 8);

  async function save() {
    setErr("");
    if (!tin) { setErr("Enter a check-in date & time."); return; }
    if (tout && tout < tin) { setErr("Check-out can't be before check-in."); return; }
    setBusy(true);
    try {
      const payload = { time_in: localToUtc(tin), time_out: tout ? localToUtc(tout) : null };
      if (checkin) await activityApi.adjustCheckin(checkin.id, payload);
      else await activityApi.addCheckin(memberId, { ...payload, event_id: eventId });
      onDone();
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not save.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!checkin || !window.confirm("Delete this check-in? This can't be undone.")) return;
    setBusy(true);
    try { await activityApi.deleteCheckin(checkin.id); onDone(); }
    finally { setBusy(false); }
  }

  return (
    <div style={st.editCard}>
      <div style={st.editGrid}>
        <label style={st.field}><span style={st.lbl}>Check-in</span><input type="datetime-local" style={st.input} value={tin} onChange={(e) => setTin(e.target.value)} /></label>
        <label style={st.field}><span style={st.lbl}>Check-out <span style={st.hint}>{checkin ? "(blank = still in)" : "(optional)"}</span></span><input type="datetime-local" style={st.input} value={tout} onChange={(e) => setTout(e.target.value)} /></label>
      </div>
      {!checkin && (
        <div style={st.field}>
          <span style={st.lbl}>Event <span style={st.hint}>(optional — e.g. a missed meeting)</span></span>
          {eventId ? (
            <div style={st.eventPicked}>
              <CalendarSearch size={13} /> <span style={{ flex: 1 }}>{eventName}</span>
              <button style={st.eventClear} onClick={() => { setEventId(null); setEventName(""); }}><X size={12} /></button>
            </div>
          ) : (
            <>
              <input style={st.input} value={eventQuery} placeholder="Search an event to check into…" onChange={(e) => setEventQuery(e.target.value)} />
              {eventMatches.length > 0 && (
                <div style={st.eventHits}>
                  {eventMatches.map((e) => (
                    <button type="button" key={e.id} style={st.eventHit}
                      onClick={() => {
                        setEventId(e.id); setEventName(e.name); setEventQuery("");
                        // #41: prefill the check-in date/time from the event's schedule.
                        const startT = (e.start_time || "00:00").slice(0, 5);
                        const endT = (e.end_time || e.start_time || "00:00").slice(0, 5);
                        setTin(`${e.event_date}T${startT}`);
                        setTout(`${e.end_date || e.event_date}T${endT}`);
                      }}>
                      {e.name} · {new Date(e.event_date + "T00:00:00").toLocaleDateString()}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {err && <div style={st.err}>{err}</div>}
      <div style={st.editActions}>
        {checkin && <button style={st.delBtn} disabled={busy} onClick={remove}><Trash2 size={13} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button style={st.cancel} onClick={onCancel}><X size={13} /> Cancel</button>
        <button style={st.save} disabled={busy} onClick={save}><Check size={13} /> {checkin ? "Save" : "Add"}</button>
      </div>
    </div>
  );
}

function Row({ c, canEdit, areas, entries, onChanged }: {
  c: Checkin; canEdit: boolean; areas: string[]; entries: TimeEntry[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showAct, setShowAct] = useState(false);
  if (editing) return <Editor memberId={c.member_id} checkin={c} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  const entryDate = toLocalInput(c.time_in).slice(0, 10);
  return (
    <div style={st.rowWrap}>
      <div style={st.row}>
        <div style={st.date}>{fmtDateLocal(c.time_in)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.name}><DoorOpen size={13} style={{ verticalAlign: -2, marginRight: 4, color: "#00838f" }} />{c.event_name ?? "General TRC"}</div>
          <div style={st.sub}>{fmtTs(c.time_in)}{c.time_out ? `–${fmtTs(c.time_out)}` : " · still checked in"}</div>
        </div>
        <div style={st.dur} title={fmtMinutes(c.minutes)}>{c.time_out ? fmtHours(c.minutes) : "—"}</div>
        {canEdit && <button style={st.edit} title="Edit / delete" onClick={() => setEditing(true)}><Pencil size={13} /></button>}
      </div>

      {/* Activities logged against this check-in */}
      <button style={st.actToggle} onClick={() => setShowAct((v) => !v)}>
        {showAct ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <Tag size={12} />
        {entries.length === 0
          ? (canEdit ? "Add activities" : "No activities")
          : `${entries.length} ${entries.length === 1 ? "activity" : "activities"}`}
        {!showAct && entries.length > 0 && (
          <span style={st.actPeek}>{entries.map((e) => e.area || "—").join(", ")}</span>
        )}
      </button>
      {showAct && (
        <ActivitiesEditor memberId={c.member_id} checkinId={c.id} entryDate={entryDate}
          entries={entries} areas={areas} canEdit={canEdit} onChanged={onChanged} />
      )}
    </div>
  );
}

/** Edit/add/remove the activities (time entries) tied to one check-in. */
function ActivitiesEditor({ memberId, checkinId, entryDate, entries, areas, canEdit, onChanged }: {
  memberId: number; checkinId: number; entryDate: string; entries: TimeEntry[];
  areas: string[]; canEdit: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [newArea, setNewArea] = useState("");
  const [newHours, setNewHours] = useState("");

  async function saveArea(e: TimeEntry, area: string) {
    setBusy(true);
    try { await activityApi.editEntry(e.id, { area }); onChanged(); }
    finally { setBusy(false); }
  }
  async function saveHours(e: TimeEntry, hours: string) {
    const h = parseFloat(hours);
    if (isNaN(h) || h < 0) return;
    setBusy(true);
    try { await activityApi.editEntry(e.id, { hours: h }); onChanged(); }
    finally { setBusy(false); }
  }
  async function remove(e: TimeEntry) {
    if (!confirm("Remove this activity?")) return;
    setBusy(true);
    try { await activityApi.deleteEntry(e.id); onChanged(); }
    finally { setBusy(false); }
  }
  async function add() {
    const h = parseFloat(newHours);
    if (!newArea || isNaN(h) || h <= 0) return;
    setBusy(true);
    try {
      await activityApi.createEntry({ member_id: memberId, entry_date: entryDate, checkin_id: checkinId, area: newArea, hours: h });
      setNewArea(""); setNewHours(""); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div style={st.actBox}>
      {entries.length === 0 && !canEdit && <div style={st.actEmpty}>No activities logged for this check-in.</div>}
      {entries.map((e) => (
        <div key={e.id} style={st.actRow}>
          {canEdit ? (
            <>
              <select style={st.actArea} value={e.area ?? ""} disabled={busy} onChange={(ev) => saveArea(e, ev.target.value)}>
                <option value="">Area…</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
                {e.area && !areas.includes(e.area) && <option value={e.area}>{e.area}</option>}
              </select>
              <input style={st.actHours} type="number" step="0.25" min="0" defaultValue={(e.minutes / 60).toFixed(2)}
                disabled={busy} title="Hours" onBlur={(ev) => { const v = ev.target.value; if (parseFloat(v) !== e.minutes / 60) saveHours(e, v); }} />
              <span style={st.actHrLbl}>hrs</span>
              <button style={st.actDel} disabled={busy} title="Remove" onClick={() => remove(e)}><Trash2 size={12} /></button>
            </>
          ) : (
            <span style={st.actReadonly}>{e.area || "—"} · {fmtHours(e.minutes)}</span>
          )}
        </div>
      ))}
      {canEdit && (
        <div style={st.actAdd}>
          <select style={st.actArea} value={newArea} disabled={busy} onChange={(e) => setNewArea(e.target.value)}>
            <option value="">Add area…</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input style={st.actHours} type="number" step="0.25" min="0" placeholder="hrs" value={newHours}
            disabled={busy} onChange={(e) => setNewHours(e.target.value)} />
          <button style={st.actAddBtn} disabled={busy || !newArea || !(parseFloat(newHours) > 0)} onClick={add}>
            <Plus size={12} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  toolbar: { display: "flex", justifyContent: "flex-end", marginBottom: 8 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  showAll: { display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", marginTop: 8, padding: "7px 10px", background: "#f4f7fb", color: "#1565c0", border: "1px solid #dce6f2", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  rowWrap: { background: "#fff", border: "1px solid #eef1f5", borderRadius: 8, overflow: "hidden" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" },
  actToggle: { display: "flex", alignItems: "center", gap: 5, width: "100%", padding: "6px 10px", background: "#f8fafc", border: "none", borderTop: "1px solid #eef1f5", cursor: "pointer", fontSize: 12, color: "#607d8b", fontWeight: 600 },
  actPeek: { fontWeight: 400, color: "#90a4ae", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  actBox: { padding: "8px 10px", background: "#fbfdff", borderTop: "1px solid #eef1f5", display: "flex", flexDirection: "column", gap: 6 },
  actEmpty: { fontSize: 12, color: "#aaa" },
  actRow: { display: "flex", alignItems: "center", gap: 6 },
  actArea: { flex: "1 1 140px", minWidth: 0, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  actHours: { width: 64, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  actHrLbl: { fontSize: 11, color: "#90a4ae" },
  actDel: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 3, display: "flex" },
  actReadonly: { fontSize: 13, color: "#455a64" },
  actAdd: { display: "flex", alignItems: "center", gap: 6, paddingTop: 4, borderTop: "1px dashed #e2e8f0", marginTop: 2 },
  actAddBtn: { display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  date: { width: 96, fontSize: 12, fontWeight: 700, color: "#1a3a5c", flexShrink: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  sub: { fontSize: 12, color: "#888", marginTop: 1 },
  dur: { fontSize: 13, fontWeight: 700, color: "#1565c0", flexShrink: 0 },
  edit: { background: "none", border: "none", cursor: "pointer", color: "#1565c0", padding: 2 },
  editCard: { background: "#f8fafc", border: "1px solid #cdd7e3", borderRadius: 8, padding: 10, marginBottom: 8 },
  editGrid: { display: "flex", gap: 10, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 3 },
  lbl: { fontSize: 11, fontWeight: 700, color: "#778" },
  hint: { fontWeight: 400, color: "#aaa" },
  input: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  err: { color: "#c62828", fontSize: 12, marginTop: 6 },
  eventPicked: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1a3a5c", background: "#eef4fb", borderRadius: 6, padding: "7px 10px" },
  eventClear: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 2 },
  eventHits: { display: "flex", flexDirection: "column", gap: 3, marginTop: 4, maxHeight: 180, overflowY: "auto" },
  eventHit: { textAlign: "left", padding: "6px 9px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 12.5, color: "#1a3a5c" },
  editActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },
  delBtn: { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  cancel: { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
};
