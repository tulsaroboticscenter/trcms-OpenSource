import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { CreditCard, FileSignature, Users } from "lucide-react";
import { paymentsApi, type MemberPayQuote, type PaymentOptions } from "./api";
import InlineHelp from "../help/InlineHelp";

/** Gross up so TRC nets the full base after the card fee (mirrors the server). */
const grossUp = (base: number, pct: number, fixed: number) => pct < 100 ? Math.round(((base + fixed) / (1 - pct / 100)) * 100) / 100 : base;

const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL"];

/**
 * Combined "Check out with CC" for one youth — pays ALL of their T&C-signed,
 * unpaid enrollments (e.g. FTC + FRC) in a single transaction. Enrollments whose
 * Terms & Conditions signatures aren't complete can't be paid; they're listed
 * with a prompt to finish signing first. Renders nothing until online payments
 * are enabled and there's something to show.
 */
export default function PayYouthEnrollments({ memberId }: { memberId: number }) {
  const navigate = useNavigate();
  const [q, setQ] = useState<MemberPayQuote | null>(null);
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [provider, setProvider] = useState("");
  const [coverFee, setCoverFee] = useState(false);
  const [donation, setDonation] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [shirtMsg, setShirtMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // How many youth in this family have something payable — drives the "pay for all
  // together" shortcut so a parent isn't stuck paying each child one at a time.
  const [familyYouth, setFamilyYouth] = useState(0);

  useEffect(() => {
    paymentsApi.getMemberPayQuote(memberId)
      .then((quote) => { setQ(quote); setShirtSize(quote.shirt_size || ""); })
      .catch(() => setQ(null));
    paymentsApi.getOptions().then((o) => { setOptions(o); setProvider(o.providers[0]?.key ?? ""); }).catch(() => {});
    // Family context: only a parent gets youth back here (a youth viewing their own
    // page gets an empty list), so this naturally shows the shortcut to parents only.
    paymentsApi.getFamilyPayQuote().then((fq) => setFamilyYouth(fq.youth.length)).catch(() => setFamilyYouth(0));
  }, [memberId]);

  if (!q || !q.enabled) return null;
  const waitlisted = q.waitlisted;
  const hasPayable = q.base > 0 && q.enrollments.length > 0;
  const unsigned = q.unsigned_enrollments ?? [];
  if (!waitlisted && !hasPayable && unsigned.length === 0) return null;

  const donationNum = Math.max(0, parseFloat(donation) || 0);
  const grandBase = Math.round((q.base + donationNum) * 100) / 100;
  const opt = options?.providers.find((p) => p.key === provider);
  const grandTotal = coverFee && opt ? grossUp(grandBase, opt.fee_pct ?? 0, opt.fee_fixed ?? 0) : grandBase;

  async function pay() {
    if (!provider) { setErr("No payment method available."); return; }
    if (!shirtSize) { setErr("Please confirm the youth's shirt size."); return; }
    setBusy(provider); setErr("");
    try {
      const { redirect_url } = await paymentsApi.payMemberEnrollments(memberId, provider, coverFee, shirtSize, donationNum);
      window.location.href = redirect_url;
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not start payment.");
      setBusy("");
    }
  }

  async function saveShirt() {
    if (!shirtSize) { setShirtMsg(""); setErr("Please choose a shirt size."); return; }
    setErr("");
    try {
      await paymentsApi.saveMemberShirt(memberId, shirtSize);
      setShirtMsg("Shirt size saved.");
      setTimeout(() => setShirtMsg(""), 2500);
    } catch {
      setErr("Could not save the shirt size.");
    }
  }

  const blocked = !shirtSize;

  return (
    <div style={st.wrap}>
      <div style={st.titleRow}>
        <div style={st.title}>{waitlisted ? "Registration" : "Pay enrollment fees"}</div>
        <InlineHelp helpKey="pay-enrollments" />
      </div>

      {/* Shortcut to the combined checkout when the family has more than one youth to pay for. */}
      {familyYouth > 1 && (
        <Link to="/pay/family" style={st.familyBanner}>
          <Users size={15} />
          <span>Have more than one youth? <strong>Pay for all of them in one checkout →</strong></span>
        </Link>
      )}

      {/* Enrollments still needing T&C signatures — one signature covers the season. */}
      {unsigned.length > 0 && (
        <div style={st.tcBox}>
          <div style={st.tcHeadRow}>
            <div style={st.tcHead}><FileSignature size={14} /> Terms &amp; Conditions required before payment</div>
            <button style={st.signBtn} onClick={() => navigate(`/enrollment/${unsigned[0].enrollment_id}/sign-tc`)}>Sign T&amp;C</button>
          </div>
          {unsigned.map((e) => (
            <div key={e.enrollment_id} style={st.tcRow}>
              <span>{e.label} — <strong>${e.balance.toFixed(2)}</strong></span>
            </div>
          ))}
          <div style={st.tcNote}>Signing once covers all of this youth's enrollments for the season; they'll become payable afterward.</div>
        </div>
      )}

      {waitlisted ? (
        <div style={st.wlBox}>
          <div style={st.wlHead}>On the waitlist</div>
          <div style={st.wlText}>
            No registration payment is needed yet — you'll be able to pay once a spot opens up. You can still
            {unsigned.length > 0 ? " sign the Terms & Conditions above and" : ""} confirm the shirt size below.
          </div>
          <div style={st.shirtRow}>
            <span style={st.shirtLbl}>Shirt size</span>
            <select style={st.shirtSel} value={shirtSize} onChange={(e) => setShirtSize(e.target.value)}>
              <option value="">Select…</option>
              {SHIRT_SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
              {shirtSize && !SHIRT_SIZES.includes(shirtSize) && <option value={shirtSize}>{shirtSize}</option>}
            </select>
            <button style={st.saveShirtBtn} onClick={saveShirt}>Save</button>
            {shirtMsg && <span style={st.saved}>{shirtMsg}</span>}
          </div>
          {err && <div style={st.err}>{err}</div>}
        </div>
      ) : hasPayable ? (
        <>
          <div style={st.lines}>
            {q.enrollments.map((e) => (
              <div key={e.enrollment_id} style={st.line}>
                <span style={st.lineLabel}>{e.label}</span>
                <span style={st.lineAmt}>${e.balance.toFixed(2)}</span>
              </div>
            ))}
            <div style={st.donateLine}>
              <span>Add a donation (optional)</span>
              <span style={st.donateWrap}>$<input style={st.donateIn} inputMode="decimal" value={donation} placeholder="0"
                onChange={(e) => setDonation(e.target.value.replace(/[^0-9.]/g, ""))} /></span>
            </div>
            <div style={{ ...st.line, ...st.totalLine }}>
              <span>Total</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>

          <div style={st.shirtRow}>
            <span style={st.shirtLbl}>Confirm shirt size <span style={{ color: "#c62828" }}>*</span></span>
            <select style={st.shirtSel} value={shirtSize} onChange={(e) => setShirtSize(e.target.value)}>
              <option value="">Select…</option>
              {SHIRT_SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
              {shirtSize && !SHIRT_SIZES.includes(shirtSize) && <option value={shirtSize}>{shirtSize}</option>}
            </select>
            <span style={st.shirtHint}>Please verify before paying — this updates the youth's shirt size.</span>
          </div>

          <label style={st.cover}>
            <input type="checkbox" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} />
            <span>Add the processing fee so <strong>100% of my payment supports TRC</strong></span>
          </label>

          <div style={st.row}>
            {q.providers.length > 1 && (
              <select style={st.provSel} value={provider} onChange={(e) => setProvider(e.target.value)}>
                {q.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            )}
            <button style={{ ...st.btn, ...(blocked ? st.btnOff : {}) }} disabled={!!busy || blocked} onClick={pay}>
              <CreditCard size={14} />
              {busy ? "Redirecting…" : `Check out with CC — $${grandTotal.toFixed(2)}`}
            </button>
          </div>
          {blocked && <div style={st.note}>Confirm the shirt size above to enable checkout.</div>}
          {coverFee && <div style={st.feeNote}>Includes the card processing fee so TRC receives the full ${grandBase.toFixed(2)}.</div>}
          {err && <div style={st.err}>{err}</div>}
          <div style={st.note}>You'll be taken to a secure checkout page to finish. A receipt is emailed to you.</div>
        </>
      ) : (
        <div style={st.note}>Sign the Terms &amp; Conditions above to enable payment.</div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 14, padding: "12px 14px", background: "#f5faf6", border: "1px solid #cbe6cf", borderRadius: 10 },
  titleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 14, fontWeight: 800, color: "#2e7d32" },
  familyBanner: { display: "flex", alignItems: "center", gap: 8, textDecoration: "none", background: "#eef4fb", border: "1px solid #bcd6f0", borderRadius: 8, padding: "9px 12px", marginBottom: 10, color: "#1565c0", fontSize: 12.5, lineHeight: 1.4 },
  tcBox: { background: "#fff7ec", border: "1px solid #f0d9b5", borderRadius: 8, padding: "10px 12px", marginBottom: 10 },
  tcHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" },
  tcHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#b26a00" },
  tcRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5, color: "#443", padding: "3px 0" },
  signBtn: { padding: "5px 11px", background: "#e8850c", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  tcNote: { fontSize: 11, color: "#9a7b4f", marginTop: 6 },
  lines: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 },
  line: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#333" },
  lineLabel: { color: "#445" },
  lineAmt: { fontWeight: 600 },
  totalLine: { borderTop: "1px solid #cbe6cf", marginTop: 4, paddingTop: 6, fontWeight: 800, color: "#1a3a5c" },
  donateLine: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", color: "#455a64" },
  donateWrap: { display: "inline-flex", alignItems: "center", gap: 2, border: "1px solid #cbe6cf", borderRadius: 6, padding: "2px 8px", background: "#fff" },
  donateIn: { width: 64, border: "none", outline: "none", fontSize: 13, textAlign: "right", background: "transparent" },
  provSel: { padding: "9px 10px", border: "1px solid #cbe6cf", borderRadius: 8, fontSize: 13, background: "#fff" },
  wlBox: { background: "#eef4fb", border: "1px solid #bcd6f0", borderRadius: 8, padding: "12px 14px" },
  wlHead: { fontSize: 13.5, fontWeight: 800, color: "#1565c0", marginBottom: 4 },
  wlText: { fontSize: 12.5, color: "#334", lineHeight: 1.5, marginBottom: 10 },
  saveShirtBtn: { padding: "6px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  saved: { fontSize: 12, color: "#2e7d32", fontWeight: 600 },
  shirtRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, background: "#fff", border: "1px solid #cbe6cf", borderRadius: 8, padding: "8px 10px" },
  shirtLbl: { fontSize: 12.5, fontWeight: 700, color: "#1a3a5c" },
  shirtSel: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  shirtHint: { fontSize: 11.5, color: "#889" },
  btnOff: { background: "#a9c8ad", cursor: "not-allowed" },
  cover: { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, color: "#333", cursor: "pointer", marginBottom: 10, lineHeight: 1.45 },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  feeNote: { marginTop: 8, color: "#2e7d32", fontSize: 11.5 },
  err: { marginTop: 8, color: "#c62828", fontSize: 12.5 },
  note: { marginTop: 8, color: "#889", fontSize: 11.5 },
};
