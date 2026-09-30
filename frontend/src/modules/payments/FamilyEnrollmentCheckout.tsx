/**
 * FamilyEnrollmentCheckout — parent dashboard panel to pay several youth's
 * enrollments in one invoice. Each youth's enrollments have a checkbox; each line
 * is charged its outstanding balance (the sibling discount is already baked into
 * that balance at signup, so it is NOT re-derived from payment order — doing so
 * double-applied the discount when siblings paid in separate transactions). A
 * donation can be added, and everything rolls up into one payment. Prices here
 * mirror the server, which recomputes authoritatively on pay.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paymentsApi, type FamilyPayQuote } from "./api";
import { enrollmentApi } from "../enrollment/api";
import { CreditCard, Loader2, AlertCircle, FileSignature } from "lucide-react";

const SHIRT_SIZES = ["YS", "YM", "YL", "AS", "AM", "AL", "AXL", "A2XL"];

export default function FamilyEnrollmentCheckout() {
  const navigate = useNavigate();
  const [q, setQ] = useState<FamilyPayQuote | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [provider, setProvider] = useState("");
  const [coverFee, setCoverFee] = useState(false);
  const [donation, setDonation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Alternatives to paying by card now — same three options as the individual enrollment
  // screen. "Pay with Cash/Check" is informational; "Request Payment Plan" emails whoever
  // arranges plans (one request per youth with a balance); scholarship navigates to the form.
  const [cashOpen, setCashOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState("");
  const [planErr, setPlanErr] = useState("");

  const apply = useCallback((data: FamilyPayQuote) => {
    setQ(data);
    setProvider((p) => p || data.providers[0]?.key || "");
    setSel((prev) => {
      // Keep the user's selection; add newly-ready enrollments not seen before.
      const next = new Set(prev);
      data.youth.forEach((y) => y.enrollments.forEach((e) => { if (e.ready && !prev.has(e.enrollment_id)) next.add(e.enrollment_id); }));
      return next;
    });
  }, []);

  const reload = useCallback(() => { paymentsApi.getFamilyPayQuote().then(apply).catch(() => setQ(null)); }, [apply]);
  useEffect(() => { reload(); }, [reload]);

  async function setShirt(memberId: number, size: string) {
    if (!size) return;
    setErr("");
    try { await paymentsApi.saveMemberShirt(memberId, size); reload(); }
    catch { setErr("Could not save the shirt size."); }
  }

  // Per-enrollment price mirroring the server's familyLineItems: each selected line
  // is charged its outstanding balance. The sibling tier is already stored in that
  // balance at signup, so it is not re-derived here.
  const prices = useMemo(() => {
    const out = new Map<number, number>();
    if (!q) return out;
    for (const y of q.youth) {
      for (const e of y.enrollments) {
        if (!sel.has(e.enrollment_id)) continue;
        out.set(e.enrollment_id, Math.round(e.balance * 100) / 100);
      }
    }
    return out;
  }, [q, sel]);

  const enrollTotal = useMemo(() => {
    let t = 0; prices.forEach((v) => (t += v)); return Math.round(t * 100) / 100;
  }, [prices]);
  const donationNum = Math.max(0, parseFloat(donation) || 0);
  const grandTotal = Math.round((enrollTotal + donationNum) * 100) / 100;

  if (!q || q.youth.length === 0) return null;   // nothing payable → hide the panel

  function toggle(id: number) {
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function pay() {
    if (!q) return;
    setErr(""); setBusy(true);
    try {
      const { redirect_url } = await paymentsApi.payFamily([...sel], provider, coverFee, donationNum);
      window.location.href = redirect_url;
    } catch (e) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not start the payment.");
      setBusy(false);
    }
  }

  const anyBlocked = q.youth.some((y) => y.enrollments.some((e) => !e.ready));

  // Request a payment plan for the family — one request per youth shown (a parent is an
  // authorized guardian for each). Succeeds if any request goes through.
  async function requestPlan() {
    if (!q) return;
    setPlanBusy(true); setPlanMsg(""); setPlanErr("");
    try {
      const results = await Promise.allSettled(q.youth.map((y) => enrollmentApi.requestPaymentPlan(y.member_id)));
      if (results.some((r) => r.status === "fulfilled")) {
        setPlanMsg("Your payment plan request has been sent. We'll be in touch to set it up.");
      } else {
        setPlanErr("Could not send the request. Please try again, or email us directly.");
      }
    } catch {
      setPlanErr("Could not send the request. Please try again, or email us directly.");
    } finally { setPlanBusy(false); }
  }

  return (
    <div style={s.pane}>
      <div style={s.head}><CreditCard size={15} /> Pay Enrollment Fees — {q.year_label}</div>
      <p style={s.sub}>Youth ready to pay are already checked — uncheck any you're not paying right now. A greyed-out youth needs a step finished first (usually signing their Terms &amp; Conditions) before they can be added. Sibling discounts adjust automatically, and it all rolls up into one payment.</p>

      {q.youth.map((y) => (
        <div key={y.member_id} style={s.youth}>
          <div style={s.youthName}>{y.name}{y.waitlisted && <span style={s.wl}>waitlisted</span>}</div>
          {y.enrollments.map((e) => (
            <div key={e.enrollment_id}>
            <div style={{ ...s.row, ...(e.ready ? {} : s.rowBlocked) }}>
              <input type="checkbox" disabled={!e.ready} checked={sel.has(e.enrollment_id)} onChange={() => toggle(e.enrollment_id)} style={{ cursor: e.ready ? "pointer" : "default" }} />
              <span style={s.rowLabel}>{e.label}</span>
              {!e.ready && !e.fully_signed && (
                <button style={s.fixBtn} onClick={() => navigate(`/enrollment/${e.enrollment_id}/sign-tc`)}>
                  <FileSignature size={12} /> Sign T&amp;C
                </button>
              )}
              {!e.ready && e.fully_signed && !e.shirt_ok && (
                <select style={s.shirtSelect} defaultValue="" onChange={(ev) => setShirt(y.member_id, ev.target.value)} title="Set shirt size">
                  <option value="" disabled>Shirt size…</option>
                  {SHIRT_SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
                </select>
              )}
              {!e.ready && e.fully_signed && e.shirt_ok && (
                <span style={s.blockTag}><AlertCircle size={12} /> waitlisted</span>
              )}
              <span style={s.rowPrice}>{sel.has(e.enrollment_id) ? `$${(prices.get(e.enrollment_id) ?? 0).toFixed(0)}` : e.ready ? `$${e.balance.toFixed(0)}` : "—"}</span>
            </div>
            {/* Spell out WHY a row can't be checked, so a greyed-out box isn't a mystery. */}
            {!e.ready && (
              <div style={s.reason}>
                {!e.fully_signed
                  ? "Can't be selected yet — sign this youth's Terms & Conditions (button above) to add them to the payment."
                  : !e.shirt_ok
                  ? "Can't be selected yet — choose a shirt size (above) to add them to the payment."
                  : "Can't be selected — this youth is on the waitlist, so there's no payment due yet."}
              </div>
            )}
            {e.scholarship_credit > 0 && (
              <div style={s.scholLine}>
                <span>Registration fee ${e.fee_gross.toFixed(0)}</span>
                <span style={s.scholCredit}>🎓 Scholarship{e.scholarship_fund ? ` (${e.scholarship_fund})` : ""} −${e.scholarship_credit.toFixed(0)}</span>
              </div>
            )}
            </div>
          ))}
        </div>
      ))}

      {anyBlocked && <div style={s.blockNote}>Sign the Terms &amp; Conditions and set a shirt size for each youth above to pay for them.</div>}

      <div style={s.donationRow}>
        <label style={s.donationLabel}>Add a donation (optional)</label>
        <div style={s.donationInputWrap}>
          <span style={s.dollar}>$</span>
          <input style={s.donationInput} inputMode="decimal" value={donation} onChange={(e) => setDonation(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
        </div>
      </div>

      <div style={s.totals}>
        <div style={s.totalLine}><span>Enrollments</span><span>${enrollTotal.toFixed(2)}</span></div>
        {donationNum > 0 && <div style={s.totalLine}><span>Donation</span><span>${donationNum.toFixed(2)}</span></div>}
        <div style={s.grand}><span>Total</span><span>${grandTotal.toFixed(2)}</span></div>
      </div>

      {q.enabled ? (
        <>
          <label style={s.cover}><input type="checkbox" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} /> Add the card processing fee so TRC receives the full amount</label>
          {q.providers.length > 1 && (
            <select style={s.provSelect} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {q.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          )}
          {err && <div style={s.err}>{err}</div>}
          <button style={s.payBtn} onClick={pay} disabled={busy || grandTotal <= 0}>
            {busy ? <><Loader2 size={15} className="spin" /> Starting…</> : `Pay $${grandTotal.toFixed(2)}`}
          </button>
        </>
      ) : (
        <div style={s.disabled}>Online payments aren't enabled yet. Please pay at the center or contact an administrator.</div>
      )}

      {/* Other ways to handle payment — same options as the individual enrollment screen. */}
      <div style={s.otherWrap}>
        <div style={s.otherHead}>Other options</div>
        <div style={s.optRow}>
          <button style={s.optBtn} onClick={() => navigate("/scholarship/apply")}>🎓 Apply for a Scholarship</button>
          <button style={s.optBtn} onClick={requestPlan} disabled={planBusy}>🗓️ {planBusy ? "Sending…" : "Request Payment Plan"}</button>
          <button style={s.optBtn} onClick={() => setCashOpen(true)}>💵 Pay with Cash/Check</button>
        </div>
        {planMsg && <div style={s.planNote}>{planMsg}</div>}
        {planErr && <div style={s.planErr}>{planErr}</div>}
      </div>

      {cashOpen && (
        <div style={s.cashOverlay} onClick={() => setCashOpen(false)} role="presentation">
          <div style={s.cashModal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="famCashTitle">
            <h2 id="famCashTitle" style={s.cashTitle}>Paying by cash or check</h2>
            <p style={s.cashBody}>
              To pay by Cash or Check, please make your payment in person at the Tulsa Robotics Center.
              Checks should be made out to &ldquo;Tulsa Robotics Center&rdquo; and payments should be made
              directly to the admin team.
            </p>
            <div style={s.cashActions}>
              <button style={s.cashOk} onClick={() => setCashOpen(false)} autoFocus>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  pane: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 6 },
  sub: { fontSize: 12.5, color: "#667", margin: "0 0 12px", lineHeight: 1.5 },
  youth: { marginBottom: 10 },
  youthName: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 },
  wl: { padding: "1px 6px", background: "#fff3e0", color: "#e65100", borderRadius: 6, fontSize: 10.5, fontWeight: 700 },
  row: { display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8, marginBottom: 5, cursor: "pointer" },
  rowBlocked: { opacity: 0.7, cursor: "default" },
  rowLabel: { flex: 1, fontSize: 13, color: "#2a3f55" },
  blockTag: { display: "inline-flex", alignItems: "center", gap: 3, color: "#c62828", fontSize: 11, fontWeight: 600 },
  fixBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", background: "#fff4e5", color: "#b45309", border: "1px solid #fed7aa", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 11.5 },
  shirtSelect: { padding: "4px 7px", border: "1px solid #fed7aa", background: "#fff4e5", color: "#b45309", borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: "pointer" },
  rowPrice: { fontWeight: 700, color: "#1a3a5c", fontSize: 13, minWidth: 44, textAlign: "right" },
  reason: { padding: "0 10px 6px 34px", marginTop: -2, marginBottom: 6, fontSize: 11.5, color: "#b45309", lineHeight: 1.4 },
  scholLine: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "0 10px 6px 34px", marginTop: -3, marginBottom: 5, fontSize: 12, color: "#64748b" },
  scholCredit: { color: "#2e7d32", fontWeight: 600 },
  blockNote: { fontSize: 12, color: "#8a5a00", background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 8, padding: "7px 10px", marginBottom: 10 },
  donationRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid #eef2f6", marginTop: 4 },
  donationLabel: { fontSize: 13, color: "#445", fontWeight: 600 },
  donationInputWrap: { display: "flex", alignItems: "center", border: "1px solid #cdd7e3", borderRadius: 7, overflow: "hidden" },
  dollar: { padding: "0 8px", color: "#889", fontSize: 13, background: "#f4f7fa" },
  donationInput: { width: 80, padding: "6px 8px", border: "none", fontSize: 13, textAlign: "right", outline: "none" },
  totals: { borderTop: "1px solid #eef2f6", paddingTop: 8, marginTop: 4 },
  totalLine: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#556", padding: "2px 0" },
  grand: { display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, color: "#1a3a5c", paddingTop: 5 },
  cover: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#556", margin: "10px 0", cursor: "pointer" },
  provSelect: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, marginBottom: 10, width: "100%" },
  err: { padding: "8px 11px", background: "#fdecea", color: "#c62828", borderRadius: 8, fontSize: 12.5, marginBottom: 8 },
  payBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", padding: "11px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 15 },
  disabled: { fontSize: 12.5, color: "#889", fontStyle: "italic", marginTop: 8 },
  otherWrap: { borderTop: "1px solid #eef2f6", marginTop: 14, paddingTop: 12 },
  otherHead: { fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  optRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  optBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  planNote: { background: "#f1f8f4", border: "1px solid #a5d6a7", borderRadius: 7, padding: "9px 13px", fontSize: 13, color: "#2e5b3e", marginTop: 10 },
  planErr: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 7, padding: "9px 13px", fontSize: 13, color: "#c62828", marginTop: 10 },
  cashOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 },
  cashModal: { background: "#fff", borderRadius: 12, padding: "20px 22px", maxWidth: 460, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" },
  cashTitle: { margin: "0 0 10px", fontSize: 17, color: "#1a3a5c" },
  cashBody: { margin: 0, fontSize: 14, lineHeight: 1.6, color: "#33475b" },
  cashActions: { display: "flex", justifyContent: "flex-end", marginTop: 18 },
  cashOk: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13.5, fontWeight: 600 },
};
