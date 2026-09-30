/**
 * SpotlightMemberPanel — the member side of "Who's It?". Appears on their own page
 * only while a spotlight is running on a meeting they're checked into. The answer is
 * hidden by default and shows ONLY while the button is held down. It reports on the
 * caller alone — the API never tells them who the pick is when it isn't them.
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "../../../core/api";
import { Hand } from "lucide-react";

export interface MeState { active: boolean; event_name?: string; picked?: boolean; am_i_it?: boolean }

/**
 * Owns the "is a spotlight running for me?" state. Lives here but is called by the
 * PROFILE, so the profile can drop the whole pane (card, heading and all) when
 * nothing is running — a component that renders null still leaves an empty titled
 * card behind. The profile passes the state back down to the panel below.
 */
export function useSpotlightMe() {
  const [state, setState] = useState<MeState>({ active: false });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try { const { data } = await api.get("/api/v1/spotlight/me"); setState(data); }
    catch { setState({ active: false }); }
    finally { setLoaded(true); }
  }, []);

  // Poll gently so the pane appears/disappears as the leader turns it on and off.
  useEffect(() => { reload(); const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);

  return { state, reload, loaded };
}

export default function SpotlightMemberPanel({ state, reload }: { state: MeState; reload: () => Promise<void> }) {
  const [held, setHeld] = useState(false);
  const [checking, setChecking] = useState(false);
  const load = reload;

  // Re-check on press so the answer is always current at the moment they look.
  async function press() {
    setChecking(true);
    await load();
    setChecking(false);
    setHeld(true);
  }
  const release = () => setHeld(false);

  if (!state.active) return null;   // nothing running → pane stays out of the way

  return (
    <div style={s.wrap}>
      <div style={s.head}>Something's happening at <b>{state.event_name}</b>.</div>
      <button
        style={{ ...s.btn, ...(held ? (state.am_i_it ? s.itBtn : s.notItBtn) : {}) }}
        onMouseDown={press} onMouseUp={release} onMouseLeave={release}
        onTouchStart={(e) => { e.preventDefault(); press(); }} onTouchEnd={release} onTouchCancel={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {held
          ? (!state.picked ? <span style={s.pending}>Not picked yet…</span>
            : state.am_i_it ? <span style={s.itText}>You are it!</span> : <span style={s.notItText}>You are NOT it</span>)
          : <span style={s.prompt}><Hand size={18} /> Press and hold to see</span>}
      </button>
      <div style={s.hint}>{checking ? "Checking…" : "Hold the button down — it hides as soon as you let go."}</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { textAlign: "center" },
  head: { fontSize: 13.5, color: "#556", marginBottom: 12 },
  btn: {
    width: "100%", minHeight: 120, borderRadius: 14, border: "2px dashed #cdd7e3", background: "#f7fafc",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    userSelect: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent", transition: "background 0.08s",
  },
  itBtn: { background: "#2e7d32", borderColor: "#2e7d32", borderStyle: "solid" },
  notItBtn: { background: "#37474f", borderColor: "#37474f", borderStyle: "solid" },
  prompt: { display: "inline-flex", alignItems: "center", gap: 9, fontSize: 16, fontWeight: 700, color: "#546e7a" },
  itText: { fontSize: 34, fontWeight: 900, color: "#fff", letterSpacing: 0.5 },
  notItText: { fontSize: 26, fontWeight: 800, color: "#eceff1" },
  pending: { fontSize: 20, fontWeight: 700, color: "#546e7a" },
  hint: { fontSize: 11.5, color: "#98a3b0", marginTop: 8 },
};
