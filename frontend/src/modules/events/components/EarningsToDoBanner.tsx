import { useState, useEffect, useCallback } from "react";
import { eventsApi, type EarningsTodo } from "../api";
import { DollarSign } from "lucide-react";
import ApplyEarningsModal from "./ApplyEarningsModal";

/**
 * Red "Apply Earnings" prompts for a member who earned funds at a fundraising
 * event but is on multiple eligible teams and hasn't yet chosen where the money
 * should go. Shown on the home dashboard so it's seen right after login.
 */
export default function EarningsToDoBanner({ memberId }: { memberId: number }) {
  const [todo, setTodo] = useState<EarningsTodo[]>([]);
  const [applyFor, setApplyFor] = useState<EarningsTodo | null>(null);

  const load = useCallback(() => {
    eventsApi.earningsTodo(memberId).then(setTodo).catch(() => setTodo([]));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  if (todo.length === 0) return null;

  return (
    <div style={st.wrap}>
      {todo.map((t) => (
        <div key={t.event_id} style={st.box}>
          <div style={st.text}>
            <DollarSign size={16} /> You earned funds at <strong>{t.event_name}</strong>. You're on more than one team —
            choose which team(s) should receive your earnings.
          </div>
          <button style={st.btn} onClick={() => setApplyFor(t)}>Apply Earnings</button>
        </div>
      ))}
      {applyFor && (
        <ApplyEarningsModal
          eventId={applyFor.event_id}
          eventName={applyFor.event_name}
          memberId={memberId}
          onClose={() => setApplyFor(null)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8, margin: "10px 0" },
  box: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8 },
  text: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#c62828", lineHeight: 1.4 },
  btn: { flexShrink: 0, padding: "8px 16px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 },
};
