/**
 * SpotlightControlPanel — the meeting leader's "Who's It?" control, on their own
 * My Page. Turn it on for an event, pick someone at random from those checked in
 * (hidden until you press Reveal), shuffle, or hand-pick. Requires spotlight.manage.
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "../../../core/api";
import { Sparkles, Shuffle, Eye, EyeOff, Power, RefreshCw, Users } from "lucide-react";

interface EventOpt { event_id: number; name: string; event_date: string; present: number; is_active: boolean }
interface Person { member_id: number; name: string; member_type?: string; gone?: boolean }
interface State {
  event: { event_id: number; name: string; event_date: string };
  is_active: boolean; selected: Person | null; present: Person[]; present_count: number;
}

export default function SpotlightControlPanel() {
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadEvents = useCallback(() => {
    api.get("/api/v1/spotlight/events")
      .then(({ data }) => {
        setEvents(data);
        setEventId((cur) => cur ?? (data.find((e: EventOpt) => e.is_active)?.event_id ?? data[0]?.event_id ?? null));
      })
      .catch(() => setEvents([]));
  }, []);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const load = useCallback(() => {
    if (!eventId) { setState(null); return; }
    api.get(`/api/v1/spotlight/event/${eventId}`).then(({ data }) => setState(data)).catch(() => setState(null));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<{ data: State }>) {
    setBusy(true); setErr("");
    try { const { data } = await fn(); setState(data); loadEvents(); }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong."); }
    finally { setBusy(false); }
  }
  const toggle = () => act(() => api.post(`/api/v1/spotlight/event/${eventId}/activate`, { is_active: !state?.is_active }).then((r) => { setRevealed(false); return r; }));
  const pick = (memberId?: number) => act(() => api.post(`/api/v1/spotlight/event/${eventId}/pick`, memberId ? { member_id: memberId } : {}).then((r) => { setRevealed(false); return r; }));

  return (
    <div>
      <p style={s.intro}>Pick someone at random from the members checked into a meeting. They'll see “You are it!” on their own page — nobody sees anyone else's result.</p>

      <div style={s.row}>
        <select style={s.sel} value={eventId ?? ""} onChange={(e) => { setEventId(Number(e.target.value)); setRevealed(false); }}>
          {events.length === 0 && <option value="">No one is checked in right now</option>}
          {events.map((e) => <option key={e.event_id} value={e.event_id}>{e.name} — {e.present} here{e.is_active ? " • ON" : ""}</option>)}
        </select>
        <button style={s.ghost} onClick={() => { loadEvents(); load(); }} title="Refresh who's checked in"><RefreshCw size={13} /></button>
      </div>

      {!state ? <p style={s.muted}>Check-in someone to a meeting to get started.</p> : (
        <>
          <div style={s.statusRow}>
            <button style={{ ...s.power, background: state.is_active ? "#c62828" : "#00695c" }} onClick={toggle} disabled={busy}>
              <Power size={14} /> {state.is_active ? "Turn OFF" : "Turn ON"}
            </button>
            <span style={s.present}><Users size={13} /> {state.present_count} checked in</span>
            {state.is_active && <span style={s.live}>LIVE — members can check their status</span>}
          </div>

          {state.is_active && (
            <>
              <div style={s.stage}>
                {!state.selected ? (
                  <span style={s.stageEmpty}>No one picked yet.</span>
                ) : revealed ? (
                  <span style={s.name}>{state.selected.name}{state.selected.gone && <span style={s.gone}> (checked out)</span>}</span>
                ) : (
                  <span style={s.hidden}>• • • • •</span>
                )}
              </div>

              <div style={s.actions}>
                <button style={s.primary} onClick={() => pick()} disabled={busy || state.present_count === 0}>
                  <Sparkles size={14} /> {state.selected ? "Shuffle" : "Pick someone"}
                </button>
                {state.selected && (
                  <button style={s.reveal} onClick={() => setRevealed((r) => !r)}>
                    {revealed ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Reveal</>}
                  </button>
                )}
                {state.selected && <button style={s.ghostBtn} onClick={() => pick()} disabled={busy}><Shuffle size={13} /> Again</button>}
              </div>

              <div style={s.manualWrap}>
                <label style={s.manualLbl}>Or choose someone yourself:</label>
                <select style={s.sel} value="" onChange={(e) => e.target.value && pick(Number(e.target.value))} disabled={busy}>
                  <option value="">Pick a person…</option>
                  {state.present.map((p) => <option key={p.member_id} value={p.member_id}>{p.name}</option>)}
                </select>
              </div>
            </>
          )}
        </>
      )}
      {err && <div style={s.err}>{err}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  intro: { fontSize: 13, color: "#667", lineHeight: 1.55, margin: "0 0 12px" },
  row: { display: "flex", gap: 8, marginBottom: 12 },
  sel: { flex: 1, padding: "9px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5 },
  ghost: { padding: "8px 11px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 7, cursor: "pointer", color: "#556" },
  muted: { color: "#889", fontSize: 13.5 },
  statusRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  power: { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 13.5 },
  present: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: "#455", fontWeight: 600 },
  live: { fontSize: 10.5, fontWeight: 800, color: "#fff", background: "#2e7d32", borderRadius: 5, padding: "3px 8px", letterSpacing: 0.5 },
  stage: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 92, background: "#0f2b3d", borderRadius: 12, marginBottom: 12, padding: "12px 16px" },
  stageEmpty: { color: "#7d97a8", fontSize: 14, fontStyle: "italic" },
  hidden: { color: "#5e93b5", fontSize: 34, letterSpacing: 6, fontWeight: 700 },
  name: { color: "#fff", fontSize: 30, fontWeight: 800, textAlign: "center", lineHeight: 1.2 },
  gone: { color: "#ffab91", fontSize: 13, fontWeight: 600 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  primary: { display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 20px", background: "#00695c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  reveal: { display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  ghostBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "11px 14px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#455" },
  manualWrap: { display: "flex", flexDirection: "column", gap: 5 },
  manualLbl: { fontSize: 12, fontWeight: 600, color: "#556" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "9px 12px", color: "#c62828", fontSize: 13, marginTop: 10 },
};
