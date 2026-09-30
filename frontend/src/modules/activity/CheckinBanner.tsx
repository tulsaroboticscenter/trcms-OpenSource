import { useEffect, useState, useCallback } from "react";
import { api } from "../../core/api";
import { useAuth } from "../../core/AuthContext";
import { LogIn, LogOut, Clock } from "lucide-react";

/**
 * #186 — a check-in card at the top of the dashboard. When an event is happening right now,
 * a member can check straight into it (or check out if already in) without going to the kiosk.
 * Renders nothing when the member isn't checked in and nothing is going on.
 */
interface EventNow { id: number; name: string; start_time: string | null; location: string | null; }
interface Status {
  open: { checkin_id: number; since: string; event_id: number | null; event_name: string | null } | null;
  events_now: EventNow[];
}

export default function CheckinBanner() {
  const { user } = useAuth();
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.get("/api/v1/checkin/my-status").then((r) => setSt(r.data as Status)).catch(() => setSt(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!user || !st) return null;
  const checkedIn = !!st.open;
  // Nothing to show: not checked in and no event on right now.
  if (!checkedIn && st.events_now.length === 0) return null;

  async function toggle(eventId: number | null) {
    setBusy(true); setMsg("");
    try {
      const { data } = await api.post("/api/v1/checkin/", { member_id: user!.id, event_id: eventId });
      if (data?.ok === false) { setMsg(data.message ?? "Could not check in."); }
      else { setMsg(data?.message ?? "Done."); }
      load();
    } catch {
      setMsg("Something went wrong. Please try the front-desk station.");
    } finally { setBusy(false); }
  }

  const sinceLabel = st.open ? new Date(st.open.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div style={box}>
      {checkedIn ? (
        <div style={row}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#1b5e20" }}>
            <Clock size={17} /> You're checked in{st.open?.event_name ? ` — ${st.open.event_name}` : ""} since {sinceLabel}.
          </span>
          <button style={{ ...btn, background: "#c62828" }} disabled={busy} onClick={() => toggle(st.open?.event_id ?? null)}>
            <LogOut size={15} /> {busy ? "…" : "Check out"}
          </button>
        </div>
      ) : (
        <div style={row}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#1b5e20" }}>
            <LogIn size={17} /> {st.events_now.length === 1 ? `${st.events_now[0].name} is happening now.` : "There's an event happening now."}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {st.events_now.map((e) => (
              <button key={e.id} style={btn} disabled={busy} onClick={() => toggle(e.id)}>
                <LogIn size={15} /> {busy ? "…" : (st.events_now.length === 1 ? "Check in" : `Check in — ${e.name}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 13, color: "#33691e", marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

const box: React.CSSProperties = { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 10, padding: "12px 16px", marginBottom: 12 };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" };
const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13.5 };
