import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { api } from "../../../core/api";
import { reservationsApi, PURPOSES, type ReservationResource } from "../api";
import { CalendarClock, ArrowLeft, CalendarSearch, X } from "lucide-react";

interface EventHit { id: number; name: string; event_date: string; end_date?: string | null; start_time?: string | null; end_time?: string | null; }

interface TeamOpt { id: number; label: string; }

/** Split a stored "YYYY-MM-DD HH:MM:SS" into date + HH:MM for the inputs. */
function splitDT(v?: string): { date: string; time: string } {
  if (!v) return { date: "", time: "" };
  const [d, t] = v.replace("T", " ").split(" ");
  return { date: d ?? "", time: (t ?? "").slice(0, 5) };
}

export default function ReservationForm() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reservations");
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;

  const [resources, setResources] = useState<ReservationResource[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [purpose, setPurpose] = useState("personal");
  const [teamSeasonId, setTeamSeasonId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [usage, setUsage] = useState("");
  const [special, setSpecial] = useState("");
  const [eventId, setEventId] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventQuery, setEventQuery] = useState("");
  const [eventMatches, setEventMatches] = useState<EventHit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prefill date/time from an event (only fills blanks — never overwrites edits).
  function pickEvent(e: EventHit, force = false) {
    setEventId(String(e.id)); setEventName(e.name); setEventQuery(""); setEventMatches([]);
    if (force || !date) setDate(e.event_date);
    if ((force || !startTime) && e.start_time) setStartTime(e.start_time.slice(0, 5));
    if ((force || !endTime) && (e.end_time || e.start_time)) setEndTime((e.end_time || e.start_time)!.slice(0, 5));
  }

  useEffect(() => {
    reservationsApi.resources().then(setResources).catch(() => {});
    api.get("/api/v1/teams/").then((r) => {
      setTeams((r.data as { team_number: string; current_season?: { id: number; season: string; team_name?: string } }[])
        .filter((t) => t.current_season?.id)
        .map((t) => ({ id: t.current_season!.id, label: `#${t.team_number} ${t.current_season!.team_name ?? ""} · ${t.current_season!.season}` })));
    }).catch(() => {});
    if (isEdit) {
      reservationsApi.get(parseInt(id!)).then((r) => {
        setResourceId(String(r.resource_id));
        setPurpose(r.purpose);
        setTeamSeasonId(r.team_season_id ? String(r.team_season_id) : "");
        setEventId(r.event_id ? String(r.event_id) : ""); setEventName(r.event_name ?? "");
        const s = splitDT(r.start_at), e = splitDT(r.end_at);
        setDate(s.date); setStartTime(s.time); setEndTime(e.time);
        setUsage(r.usage_details ?? ""); setSpecial(r.special_considerations ?? "");
      }).catch(() => {});
    } else {
      // Deep-link with a date (?date=YYYY-MM-DD) — e.g. clicking a day on the calendar.
      const dateParam = searchParams.get("date");
      if (dateParam) setDate(dateParam);
      // Deep-link from an event page (?event=ID) — preselect + prefill the window.
      const evParam = searchParams.get("event");
      if (evParam) {
        api.get(`/api/v1/events/${evParam}`).then((r) => {
          const e = r.data as EventHit;
          pickEvent(e, true);
          setPurpose("trc");
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  // Debounced event search for the optional "tie to an event" picker.
  useEffect(() => {
    if (eventId || eventQuery.trim().length < 2) { setEventMatches([]); return; }
    const t = setTimeout(() => {
      api.get("/api/v1/events/", { params: { search: eventQuery.trim(), limit: 8 } })
        .then((r) => setEventMatches(((r.data.events ?? r.data) as EventHit[]) ?? []))
        .catch(() => setEventMatches([]));
    }, 250);
    return () => clearTimeout(t);
  }, [eventQuery, eventId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!resourceId) { setErr("Please choose a room or resource."); return; }
    if (!date || !startTime || !endTime) { setErr("Please set the date, start time, and end time."); return; }
    const payload = {
      resource_id: Number(resourceId),
      purpose,
      team_season_id: purpose === "team" ? (teamSeasonId ? Number(teamSeasonId) : null) : null,
      event_id: eventId ? Number(eventId) : null,
      usage_details: usage || null,
      special_considerations: special || null,
      start_at: `${date} ${startTime}`,
      end_at: `${date} ${endTime}`,
    };
    setSaving(true);
    try {
      if (isEdit) await reservationsApi.update(parseInt(id!), payload);
      else await reservationsApi.create(payload);
      navigate("/reservations");
    } catch (e2) {
      const ax = e2 as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not save the reservation.");
    } finally { setSaving(false); }
  }

  const rooms = resources.filter((r) => r.kind === "room");
  const equip = resources.filter((r) => r.kind === "equipment");

  return (
    <div style={st.wrap}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to calendar</button>
      <h1 style={st.heading}><CalendarClock size={20} style={{ verticalAlign: -3 }} /> {isEdit ? "Edit Reservation" : "New Reservation"}</h1>
      <p style={st.intro}>Request a room or resource. A mentor or admin will review and approve it before it appears on the shared calendar.</p>

      {err && <div style={st.err}>{err}</div>}

      <form onSubmit={submit} style={st.form}>
        <label style={st.label}>Room or Resource *
          <select style={st.input} value={resourceId} onChange={(e) => setResourceId(e.target.value)} required>
            <option value="">— Select —</option>
            {rooms.length > 0 && <optgroup label="Rooms">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
            {equip.length > 0 && <optgroup label="Equipment">{equip.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
          </select>
        </label>

        <label style={st.label}>Purpose *
          <div style={st.radioRow}>
            {PURPOSES.map((p) => (
              <label key={p.value} style={{ ...st.radio, ...(purpose === p.value ? st.radioOn : {}) }}>
                <input type="radio" name="purpose" value={p.value} checked={purpose === p.value} onChange={() => setPurpose(p.value)} style={{ marginRight: 6 }} />
                {p.label}
              </label>
            ))}
          </div>
        </label>

        {purpose === "team" && (
          <label style={st.label}>Which team? *
            <select style={st.input} value={teamSeasonId} onChange={(e) => setTeamSeasonId(e.target.value)} required>
              <option value="">— Select a team —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        )}

        <label style={st.label}>Tie to an event <span style={{ fontWeight: 400, color: "#99a" }}>(optional — e.g. reserve the lab for a CAD class)</span>
          {eventId ? (
            <div style={st.eventPicked}>
              <CalendarSearch size={14} /> <span style={{ flex: 1 }}>{eventName || `Event #${eventId}`}</span>
              <button type="button" style={st.eventClear} onClick={() => { setEventId(""); setEventName(""); }}><X size={13} /></button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input style={st.input} value={eventQuery} placeholder="Search an event…" onChange={(e) => setEventQuery(e.target.value)} />
              {eventMatches.length > 0 && (
                <div style={st.eventHits}>
                  {eventMatches.map((e) => (
                    <button type="button" key={e.id} style={st.eventHit} onClick={() => pickEvent(e)}>
                      {e.name} · {new Date(e.event_date + "T00:00:00").toLocaleDateString()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </label>

        <div style={st.dtRow}>
          <label style={{ ...st.label, flex: 1.4 }}>Date *
            <input type="date" style={st.input} value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label style={{ ...st.label, flex: 1 }}>Start *
            <input type="time" style={st.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </label>
          <label style={{ ...st.label, flex: 1 }}>End *
            <input type="time" style={st.input} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </label>
        </div>

        <label style={st.label}>Usage details
          <textarea style={{ ...st.input, minHeight: 70, resize: "vertical" }} value={usage} onChange={(e) => setUsage(e.target.value)}
            placeholder="What will you be doing? (e.g. printing a part, team build session, prototyping)" />
        </label>

        <label style={st.label}>Special considerations
          <textarea style={{ ...st.input, minHeight: 60, resize: "vertical" }} value={special} onChange={(e) => setSpecial(e.target.value)}
            placeholder="Anything the approver should know? (materials, supervision, after-hours access, etc.)" />
        </label>

        <div style={st.actions}>
          <button type="button" style={st.cancel} onClick={goBack}>Cancel</button>
          <button type="submit" disabled={saving} style={st.submit}>{saving ? "Saving…" : isEdit ? "Save Changes" : "Submit Request"}</button>
        </div>
      </form>
    </div>
  );
}

const RC = "#7b1fa2";
const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 640 },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 10, padding: 0 },
  heading: { margin: "0 0 4px", fontSize: 23, fontWeight: 700, color: "#1a3a5c" },
  intro: { color: "#778", fontSize: 14, marginTop: 0, marginBottom: 18 },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 14 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "#445" },
  input: { padding: "9px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, fontWeight: 400 },
  radioRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  radio: { display: "flex", alignItems: "center", padding: "8px 14px", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 500, fontSize: 14 },
  radioOn: { borderColor: RC, background: RC + "12", color: RC, fontWeight: 700 },
  dtRow: { display: "flex", gap: 12 },
  eventPicked: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500, color: "#1a3a5c", background: "#eef4fb", borderRadius: 6, padding: "9px 12px" },
  eventClear: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 2 },
  eventHits: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,.12)", zIndex: 10, maxHeight: 200, overflowY: "auto", marginTop: 3 },
  eventHit: { display: "block", width: "100%", textAlign: "left", padding: "8px 11px", background: "#fff", border: "none", borderBottom: "1px solid #f0f3f7", cursor: "pointer", fontSize: 13, color: "#1a3a5c" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 },
  cancel: { padding: "10px 18px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  submit: { padding: "10px 22px", background: RC, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
};
