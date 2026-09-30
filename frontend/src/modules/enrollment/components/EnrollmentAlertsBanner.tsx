import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FileSignature, CreditCard, X } from "lucide-react";
import { enrollmentApi, type EnrollmentAlert } from "../api";

/**
 * Login nudge: if the signed-in user (or their family youth) has an enrollment
 * with an unpaid balance or incomplete Terms & Conditions this season, show a
 * banner with a direct button to sign the T&C or review & pay. Dismissible for
 * the session ("cancel").
 */
const DISMISS_KEY = "enrollmentAlertsDismissed";

export default function EnrollmentAlertsBanner() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<EnrollmentAlert[]>([]);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === "1");

  useEffect(() => {
    if (dismissed) return;
    enrollmentApi.myAlerts().then(setAlerts).catch(() => setAlerts([]));
  }, [dismissed]);

  if (dismissed || alerts.length === 0) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  // Group by youth: signing T&C once covers all of that youth's enrollments, and
  // payment is combined per youth — so show one row (one set of buttons) each.
  const byYouth = new Map<number, {
    memberId: number; name: string; needsTc: boolean; tcEnrollmentId: number | null; unpaidTotal: number; programs: string[];
  }>();
  for (const a of alerts) {
    let g = byYouth.get(a.member_id);
    if (!g) { g = { memberId: a.member_id, name: a.member_name, needsTc: false, tcEnrollmentId: null, unpaidTotal: 0, programs: [] }; byYouth.set(a.member_id, g); }
    if (!g.programs.includes(a.program_label)) g.programs.push(a.program_label);
    if (a.needs_tc) { g.needsTc = true; if (g.tcEnrollmentId === null) g.tcEnrollmentId = a.enrollment_id; }
    if (a.unpaid) g.unpaidTotal = Math.round((g.unpaidTotal + a.balance) * 100) / 100;
  }
  const youth = Array.from(byYouth.values());
  // When more than one youth owes a balance, the primary action is a single
  // combined checkout — otherwise a parent pays each child one at a time.
  const payableYouth = youth.filter((g) => g.unpaidTotal > 0);
  const familyTotal = Math.round(payableYouth.reduce((s, g) => s + g.unpaidTotal, 0) * 100) / 100;

  return (
    <div style={st.wrap}>
      <div style={st.headRow}>
        <div style={st.head}><AlertTriangle size={16} /> Enrollment items need your attention</div>
        <button style={st.close} title="Dismiss" onClick={dismiss}><X size={16} /></button>
      </div>

      {payableYouth.length > 1 && (
        <button style={st.payAllBtn} onClick={() => navigate("/pay/family")}>
          <CreditCard size={15} /> Pay for all {payableYouth.length} youth in one checkout — ${familyTotal.toFixed(2)}
        </button>
      )}

      <div style={st.list}>
        {youth.map((g) => (
          <div key={g.memberId} style={st.row}>
            <div style={st.info}>
              <span style={st.name}>{g.name}</span>
              <span style={st.prog}>{g.programs.join(" · ")}</span>
              <span style={st.needs}>
                {g.needsTc && <span style={st.tag}>Terms &amp; Conditions not signed</span>}
                {g.unpaidTotal > 0 && <span style={{ ...st.tag, ...st.due }}>Balance due ${g.unpaidTotal.toFixed(2)}</span>}
              </span>
            </div>
            <div style={st.actions}>
              {g.needsTc && g.tcEnrollmentId !== null && (
                <button style={st.signBtn} onClick={() => navigate(`/enrollment/${g.tcEnrollmentId}/sign-tc`)}>
                  <FileSignature size={13} /> Sign T&amp;C
                </button>
              )}
              {g.unpaidTotal > 0 && (
                <button style={st.payBtn} onClick={() => navigate(`/enrollment/member/${g.memberId}`)}>
                  <CreditCard size={13} /> Review &amp; Pay
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  head: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: "#e65100" },
  close: { background: "none", border: "none", cursor: "pointer", color: "#b26a00", padding: 2 },
  payAllBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "11px", marginBottom: 10, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, fontSize: 14.5, fontWeight: 800, cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #ffe0b2", borderRadius: 8, padding: "9px 12px", flexWrap: "wrap" },
  info: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  prog: { fontSize: 12, color: "#667" },
  needs: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 },
  tag: { fontSize: 11, fontWeight: 600, color: "#e65100", background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 10, padding: "1px 8px" },
  due: { color: "#c62828", background: "#fdecea", borderColor: "#f4b8b3" },
  actions: { display: "flex", gap: 6, flexShrink: 0 },
  signBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#e8850c", color: "#fff", border: "none", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  payBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
};
