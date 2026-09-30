/**
 * FamilyPaymentPlanPanel — parent dashboard. Shows the family's upcoming/overdue
 * enrollment payment-plan installments and offers to pay each by card (when online
 * payments are enabled); otherwise notes they can pay by check/cash at the center.
 */
import { useState, useEffect, useCallback } from "react";
import { enrollmentApi, type MyPaymentPlans } from "../api";
import { paymentsApi } from "../../payments/api";
import { CalendarClock, Loader2, CreditCard } from "lucide-react";

const money = (n: number) => `$${n.toFixed(2)}`;
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function FamilyPaymentPlanPanel() {
  const [data, setData] = useState<MyPaymentPlans | null>(null);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    enrollmentApi.myPaymentPlans().then(setData).catch(() => setData(null));
    paymentsApi.getOptions().then((o) => setProvider(o.providers[0]?.key ?? "")).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!data || data.installments.length === 0) return null;

  async function pay(installmentId: number) {
    setErr(""); setBusy(installmentId);
    try {
      const { redirect_url } = await enrollmentApi.payInstallmentOnline(installmentId, provider);
      window.location.href = redirect_url;
    } catch (e) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not start the payment.");
      setBusy(null);
    }
  }

  return (
    <div style={s.pane}>
      <div style={s.head}><CalendarClock size={15} /> Payment Plan</div>
      <p style={s.sub}>Your upcoming enrollment payments. Pay by card here, or by check or cash at the center.</p>
      {err && <div style={s.err}>{err}</div>}

      {data.installments.map((i) => (
        <div key={i.installment_id} style={{ ...s.row, ...(i.overdue ? s.rowOverdue : {}) }}>
          <div style={s.rowMid}>
            <div style={s.rowName}>{i.youth_name}{i.program ? ` · ${i.program}` : ""}</div>
            <div style={s.rowDue}>Payment {i.seq} · due {fmtDate(i.due_date)}{i.overdue && <span style={s.overdueTag}>overdue</span>}</div>
          </div>
          <div style={s.rowAmt}>{money(i.amount)}</div>
          {data.payments_enabled && provider ? (
            <button style={s.payBtn} disabled={busy === i.installment_id} onClick={() => pay(i.installment_id)}>
              {busy === i.installment_id ? <Loader2 size={13} className="spin" /> : <><CreditCard size={13} /> Pay</>}
            </button>
          ) : (
            <span style={s.payAtCenter}>pay at center</span>
          )}
        </div>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  pane: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 6 },
  sub: { fontSize: 12.5, color: "#667", margin: "0 0 12px", lineHeight: 1.5 },
  err: { padding: "8px 11px", background: "#fdecea", color: "#c62828", borderRadius: 8, fontSize: 12.5, marginBottom: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8, marginBottom: 6 },
  rowOverdue: { background: "#fff8f3", borderColor: "#ffd9b8" },
  rowMid: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  rowDue: { fontSize: 12, color: "#667", display: "flex", alignItems: "center", gap: 6, marginTop: 1 },
  overdueTag: { fontSize: 10, fontWeight: 700, color: "#e65100", background: "#ffe0c2", borderRadius: 5, padding: "1px 6px" },
  rowAmt: { fontSize: 15, fontWeight: 800, color: "#1a3a5c", minWidth: 60, textAlign: "right" },
  payBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  payAtCenter: { fontSize: 11.5, color: "#889", fontStyle: "italic" },
};
