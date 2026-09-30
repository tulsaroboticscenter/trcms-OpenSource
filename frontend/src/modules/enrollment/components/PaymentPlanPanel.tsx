/**
 * PaymentPlanPanel — admin builds and manages an enrollment's payment plan.
 * The admin sets the number of payments and edits each payment's amount and due date
 * (a "generate equal monthly" button gives a quick starting point). Custom amounts need
 * not sum to the balance — a mismatch is warned, not blocked. The family can be emailed
 * the full schedule up front, and automatic reminders can be suppressed per-plan or per
 * installment so the team can send them manually. Shown on the enrollment edit page.
 */
import { useState, useEffect, useCallback } from "react";
import { enrollmentApi, type PaymentPlan, type Installment } from "../api";
import { CalendarClock, Loader2, Trash2, Check, RotateCcw, Plus, Bell, BellOff, Mail } from "lucide-react";

const money = (n: number) => `$${n.toFixed(2)}`;
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstOfNextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); };

type Line = { due_date: string; amount: string; suppressed: boolean };

/** N equal monthly installments (last absorbs rounding), starting the 1st of next month. */
function equalMonthly(count: number, total: number): Line[] {
  const start = firstOfNextMonth();
  const base = Math.floor((total / count) * 100) / 100;
  const out: Line[] = [];
  for (let i = 0; i < count; i++) {
    const amt = i < count - 1 ? base : Math.round((total - base * (count - 1)) * 100) / 100;
    out.push({ due_date: iso(new Date(start.getFullYear(), start.getMonth() + i, 1)), amount: amt > 0 ? amt.toFixed(2) : "", suppressed: false });
  }
  return out;
}

export default function PaymentPlanPanel({ enrollmentId }: { enrollmentId: number }) {
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [scholarship, setScholarship] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [genCount, setGenCount] = useState("4");
  const [note, setNote] = useState("");
  const [planSuppress, setPlanSuppress] = useState(false);
  const [sendConfirm, setSendConfirm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    enrollmentApi.getPaymentPlan(enrollmentId).then((p) => { setPlan(p); setNote(p.note ?? ""); }).catch(() => setPlan(null));
  }, [enrollmentId]);
  useEffect(load, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const run = async (fn: () => Promise<PaymentPlan>, okMsg?: string) => {
    setErr(""); setBusy(true);
    try { const p = await fn(); setPlan(p); setNote(p.note ?? ""); if (okMsg) flash(okMsg); return p; }
    catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong."); }
    finally { setBusy(false); }
  };

  if (!plan) return null;
  const remaining = Math.max(0, plan.amount_due - (parseFloat(scholarship) || 0));

  // Seed the editor with a sensible default the first time we show it.
  const ensureLines = () => { if (lines.length === 0) setLines(equalMonthly(Math.max(1, parseInt(genCount) || 4), remaining)); };

  const scheduledTotal = lines.reduce((t, l) => t + (parseFloat(l.amount) || 0), 0);
  const matches = Math.abs(scheduledTotal - remaining) < 0.005;

  async function create() {
    const installments = lines
      .filter((l) => l.due_date && (parseFloat(l.amount) || 0) > 0)
      .map((l) => ({ due_date: l.due_date, amount: parseFloat(l.amount), reminders_suppressed: l.suppressed }));
    if (installments.length === 0) { setErr("Add at least one payment with a date and amount."); return; }
    await run(() => enrollmentApi.createPaymentPlan(enrollmentId, {
      scholarship_amount: parseFloat(scholarship) || 0,
      installments, note: note || undefined, reminders_suppressed: planSuppress, send_confirmation: sendConfirm,
    }), sendConfirm ? "Plan created — schedule emailed to the family." : "Plan created.");
  }

  return (
    <div style={s.card}>
      <div style={s.head}><CalendarClock size={16} /> Payment Plan</div>
      {err && <div style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}

      {!plan.has_plan ? (
        <>
          <p style={s.sub}>
            Build a plan for this enrollment's <strong>{money(plan.amount_due)}</strong> due. Enter any scholarship credit (subtracted first),
            then set each payment's date and amount — or generate an equal monthly schedule and tweak it.
          </p>
          {plan.amount_due <= 0 ? (
            <p style={s.warn}>Set an amount due on the enrollment (and save) before creating a plan.</p>
          ) : (
            <>
              <div style={s.setupRow}>
                <label style={s.lbl}>Scholarship credit</label>
                <div style={s.dollarWrap}><span style={s.dollar}>$</span>
                  <input style={s.dollarIn} inputMode="decimal" value={scholarship} placeholder="0"
                    onChange={(e) => setScholarship(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
                <span style={s.splitHint}>→ family pays {money(remaining)}</span>
              </div>

              <div style={s.genRow}>
                <span style={s.lbl}>Generate</span>
                <input style={s.genCount} inputMode="numeric" value={genCount}
                  onChange={(e) => setGenCount(e.target.value.replace(/[^0-9]/g, ""))} />
                <span style={s.genTxt}>equal monthly payments</span>
                <button type="button" style={s.genBtn} onClick={() => setLines(equalMonthly(Math.max(1, parseInt(genCount) || 4), remaining))}>Generate</button>
              </div>

              {lines.length === 0 && <button type="button" style={s.linkBtn} onClick={ensureLines}>Set up the schedule →</button>}

              {lines.length > 0 && (
                <>
                  <div style={s.schedHead}><span>#</span><span>Due date</span><span>Amount</span><span></span></div>
                  {lines.map((l, idx) => (
                    <div key={idx} style={s.schedRow}>
                      <span style={s.schedSeq}>{idx + 1}</span>
                      <input style={s.dateIn} type="date" value={l.due_date}
                        onChange={(e) => setLines((ls) => ls.map((x, i) => i === idx ? { ...x, due_date: e.target.value } : x))} />
                      <div style={s.dollarWrap}><span style={s.dollar}>$</span>
                        <input style={s.dollarIn} inputMode="decimal" value={l.amount} placeholder="0.00"
                          onChange={(e) => setLines((ls) => ls.map((x, i) => i === idx ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x))} />
                      </div>
                      <button type="button" title={l.suppressed ? "Reminders off for this payment" : "Reminders on"} style={s.iconBtn}
                        onClick={() => setLines((ls) => ls.map((x, i) => i === idx ? { ...x, suppressed: !x.suppressed } : x))}>
                        {l.suppressed ? <BellOff size={14} color="#c62828" /> : <Bell size={14} color="#889" />}
                      </button>
                      <button type="button" title="Remove" style={s.iconBtn} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}><Trash2 size={13} color="#c62828" /></button>
                    </div>
                  ))}
                  <button type="button" style={s.addLine} onClick={() => setLines((ls) => [...ls, { due_date: iso(firstOfNextMonth()), amount: "", suppressed: false }])}>
                    <Plus size={13} /> Add payment
                  </button>

                  <div style={{ ...s.totalRow, color: matches ? "#2e7d32" : "#b45309" }}>
                    Scheduled total: <strong>{money(scheduledTotal)}</strong>
                    {matches ? " ✓ matches balance" : ` — differs from the ${money(remaining)} balance`}
                  </div>

                  <textarea style={s.note} rows={2} placeholder="Optional note / terms (shown to the family in the confirmation email)"
                    value={note} onChange={(e) => setNote(e.target.value)} />

                  <label style={s.check}><input type="checkbox" checked={planSuppress} onChange={(e) => setPlanSuppress(e.target.checked)} /> Suppress automatic reminders (we'll send them manually)</label>
                  <label style={s.check}><input type="checkbox" checked={sendConfirm} onChange={(e) => setSendConfirm(e.target.checked)} /> Email the family this schedule now</label>

                  <button style={s.createBtn} disabled={busy} onClick={create}>
                    {busy ? <Loader2 size={14} className="spin" /> : "Create plan"}
                  </button>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div style={s.summary}>
            <Stat label="Amount due" value={money(plan.amount_due)} />
            {plan.scholarship_amount > 0 && <Stat label="Scholarship" value={`− ${money(plan.scholarship_amount)}`} color="#2e7d32" />}
            <Stat label="Family pays" value={money(plan.family_total)} />
            <Stat label="Paid" value={money(plan.family_paid)} color="#1565c0" />
            <Stat label="Remaining" value={money(plan.family_remaining)} color={plan.family_remaining > 0 ? "#e65100" : "#2e7d32"} />
          </div>
          {!plan.schedule_matches && (
            <div style={s.warnBox}>Scheduled installments total {money(plan.scheduled_total)}, which doesn't match the {money(plan.family_total)} the family owes.</div>
          )}

          <div style={s.list}>
            {plan.installments.map((i) => <Row key={i.id} i={i} busy={busy} run={run} />)}
          </div>

          {/* Plan-level controls */}
          <div style={s.controls}>
            <label style={s.check}>
              <input type="checkbox" checked={plan.reminders_suppressed} disabled={busy}
                onChange={(e) => run(() => enrollmentApi.updatePaymentPlan(enrollmentId, { reminders_suppressed: e.target.checked }), e.target.checked ? "Automatic reminders suppressed." : "Automatic reminders on.")} />
              Suppress automatic reminders for this plan
            </label>
            <div style={s.confirmRow}>
              <button style={s.confirmBtn} disabled={busy} onClick={() => run(() => enrollmentApi.sendPlanConfirmation(enrollmentId), "Schedule emailed to the family.")}>
                <Mail size={13} /> {plan.confirmation_sent_at ? "Resend schedule email" : "Email schedule to family"}
              </button>
              {plan.confirmation_sent_at && <span style={s.sentNote}>last sent {fmtDate(plan.confirmation_sent_at.slice(0, 10))}</span>}
            </div>
            <div style={s.noteRow}>
              <textarea style={s.note} rows={2} placeholder="Plan note / terms" value={note} onChange={(e) => setNote(e.target.value)} />
              <button style={s.saveNote} disabled={busy || note === (plan.note ?? "")} onClick={() => run(() => enrollmentApi.updatePaymentPlan(enrollmentId, { note }), "Note saved.")}>Save note</button>
            </div>
          </div>

          <button style={s.removeBtn} disabled={busy}
            onClick={() => { if (confirm("Remove this payment plan? Any recorded payments will be cleared.")) run(() => enrollmentApi.deletePaymentPlan(enrollmentId)); }}>
            <Trash2 size={13} /> Remove plan
          </button>
        </>
      )}
    </div>
  );
}

function Row({ i, busy, run }: { i: Installment; busy: boolean; run: (fn: () => Promise<PaymentPlan>, okMsg?: string) => void }) {
  const [method, setMethod] = useState("check");
  const paid = i.status === "paid";
  const overdue = !paid && new Date(i.due_date + "T00:00:00") < new Date(new Date().toDateString());
  return (
    <div style={{ ...s.row, ...(paid ? s.rowPaid : overdue ? s.rowOverdue : {}) }}>
      <div style={s.rowSeq}>#{i.seq}</div>
      <div style={s.rowMid}>
        <div style={s.rowDue}>Due {fmtDate(i.due_date)}{overdue && <span style={s.overdueTag}>overdue</span>}{i.reminders_suppressed && <span style={s.mutedTag}>reminders off</span>}</div>
        <div style={s.rowAmt}>{money(i.amount)}
          {paid && <span style={s.paidNote}> · paid {i.method}{i.reference ? ` (${i.reference})` : ""}{i.paid_date ? ` ${fmtDate(i.paid_date)}` : ""}</span>}
        </div>
      </div>
      {!paid && (
        <button style={s.iconBtn} title={i.reminders_suppressed ? "Reminders off — click to enable" : "Reminders on — click to suppress"}
          disabled={busy} onClick={() => run(() => enrollmentApi.toggleInstallmentReminder(i.id, !i.reminders_suppressed))}>
          {i.reminders_suppressed ? <BellOff size={14} color="#c62828" /> : <Bell size={14} color="#889" />}
        </button>
      )}
      {paid ? (
        <button style={s.undoBtn} disabled={busy} title="Undo payment" onClick={() => run(() => enrollmentApi.unpayInstallment(i.id))}>
          <RotateCcw size={12} /> Undo
        </button>
      ) : (
        <div style={s.payControls}>
          <select style={s.methodSel} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="check">Check</option>
            <option value="cash">Cash</option>
          </select>
          <button style={s.payBtn} disabled={busy} onClick={() => run(() => enrollmentApi.payInstallment(i.id, { method }))}>
            <Check size={12} /> Record
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div style={s.stat}><div style={{ ...s.statVal, color: color ?? "#1a3a5c" }}>{value}</div><div style={s.statLbl}>{label}</div></div>;
}

const s: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginTop: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 700, color: "#1a3a5c", marginBottom: 8 },
  sub: { fontSize: 13, color: "#667", margin: "0 0 10px", lineHeight: 1.5 },
  err: { padding: "8px 11px", background: "#fdecea", color: "#c62828", borderRadius: 8, fontSize: 12.5, marginBottom: 8 },
  ok: { padding: "8px 11px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 8, fontSize: 12.5, marginBottom: 8 },
  warn: { fontSize: 12, color: "#8a5a00", marginTop: 6 },
  warnBox: { padding: "8px 11px", background: "#fff8f0", border: "1px solid #f3d9a0", color: "#8a5a00", borderRadius: 8, fontSize: 12.5, marginBottom: 10 },
  setupRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 },
  lbl: { fontSize: 13, color: "#445", fontWeight: 600 },
  dollarWrap: { display: "flex", alignItems: "center", border: "1px solid #cdd7e3", borderRadius: 7, overflow: "hidden" },
  dollar: { padding: "0 8px", color: "#889", fontSize: 13, background: "#f4f7fa" },
  dollarIn: { width: 88, padding: "7px 8px", border: "none", fontSize: 13, textAlign: "right", outline: "none" },
  splitHint: { fontSize: 12.5, color: "#556" },
  genRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: "1px dashed #e2e8f0" },
  genCount: { width: 44, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, textAlign: "center" },
  genTxt: { fontSize: 13, color: "#556" },
  genBtn: { padding: "6px 12px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f5", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  schedHead: { display: "grid", gridTemplateColumns: "26px 1fr 118px 30px 30px", gap: 8, fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.3, padding: "0 2px 4px" },
  schedRow: { display: "grid", gridTemplateColumns: "26px 1fr 118px 30px 30px", gap: 8, alignItems: "center", marginBottom: 6 },
  schedSeq: { fontWeight: 800, color: "#90a4ae", textAlign: "center" },
  dateIn: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  iconBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" },
  addLine: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", background: "#fff", color: "#1565c0", border: "1px dashed #cfe0f5", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5, marginTop: 2 },
  totalRow: { fontSize: 13, margin: "10px 0", fontWeight: 600 },
  note: { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, resize: "vertical", fontFamily: "inherit" },
  check: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#445", margin: "8px 0" },
  createBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#8e24aa", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, marginTop: 6 },
  summary: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  stat: { flex: "1 1 90px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8, padding: "8px 10px", textAlign: "center" },
  statVal: { fontSize: 15, fontWeight: 800 },
  statLbl: { fontSize: 11, color: "#778", marginTop: 2 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8 },
  rowPaid: { background: "#f1f8f2", borderColor: "#cfe9d3" },
  rowOverdue: { background: "#fff8f3", borderColor: "#ffd9b8" },
  rowSeq: { fontWeight: 800, color: "#90a4ae", width: 26 },
  rowMid: { flex: 1, minWidth: 0 },
  rowDue: { fontSize: 12.5, color: "#556", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  overdueTag: { fontSize: 10, fontWeight: 700, color: "#e65100", background: "#ffe0c2", borderRadius: 5, padding: "1px 6px" },
  mutedTag: { fontSize: 10, fontWeight: 700, color: "#c62828", background: "#fdecea", borderRadius: 5, padding: "1px 6px" },
  rowAmt: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  paidNote: { fontSize: 11.5, fontWeight: 400, color: "#2e7d32" },
  payControls: { display: "flex", alignItems: "center", gap: 6 },
  methodSel: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5 },
  payBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 11px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 },
  undoBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fff", color: "#667", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 11.5 },
  controls: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2f6" },
  confirmRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "6px 0" },
  confirmBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#fff", color: "#1565c0", border: "1px solid #cfe0f5", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  sentNote: { fontSize: 12, color: "#889" },
  noteRow: { display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 },
  saveNote: { padding: "7px 13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" },
  removeBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5, marginTop: 12 },
};
