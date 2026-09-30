import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { paymentsApi, type PaymentOption } from "./api";

/**
 * "Make a one-time donation" — a general gift to TRC via the same hosted
 * checkout as enrollment payments. Renders nothing until online payments are
 * enabled. The donor may optionally cover the processing fee so 100% of the
 * gift reaches TRC.
 */
const PRESETS = [25, 50, 100, 250];

export default function DonationBox() {
  const [providers, setProviders] = useState<PaymentOption[]>([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [coverFee, setCoverFee] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    paymentsApi.getOptions().then((o) => setProviders(o.enabled ? o.providers : [])).catch(() => setProviders([]));
  }, []);

  if (providers.length === 0) return null;

  const amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const valid = amt >= 1;
  // Gross-up to cover the card fee: total = (amount + fixed) / (1 - pct/100).
  const withFee = (p: PaymentOption) => {
    const pct = (p.fee_pct ?? 0) / 100, fixed = p.fee_fixed ?? 0;
    return pct < 1 ? Math.round(((amt + fixed) / (1 - pct)) * 100) / 100 : amt;
  };

  async function donate(provider: string) {
    if (!valid) { setErr("Enter a donation amount of at least $1."); return; }
    setBusy(provider); setErr("");
    try {
      const { redirect_url } = await paymentsApi.donate(provider, amt, coverFee, note.trim() || undefined);
      window.location.href = redirect_url;
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not start the donation.");
      setBusy("");
    }
  }

  const one = providers.length === 1;

  return (
    <div style={st.wrap}>
      <div style={st.title}><Heart size={15} color="#c2185b" /> Make a one-time donation</div>
      <div style={st.sub}>Support Tulsa Robotics Center with a tax-deductible gift.</div>

      <div style={st.presets}>
        {PRESETS.map((v) => (
          <button key={v} style={{ ...st.preset, ...(amt === v ? st.presetOn : {}) }} onClick={() => setAmount(String(v))}>${v}</button>
        ))}
        <div style={st.custom}>
          <span style={st.dollar}>$</span>
          <input style={st.amtIn} type="number" min={1} step="1" placeholder="Other" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>

      <input style={st.noteIn} placeholder="Add a note (optional) — e.g. in honor of…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />

      <label style={st.cover}>
        <input type="checkbox" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} />
        <span>Add the processing fee so <strong>100% of my gift supports TRC</strong></span>
      </label>

      <div style={st.row}>
        {providers.map((p) => {
          const total = coverFee ? withFee(p) : amt;
          return (
            <button key={p.key} style={{ ...st.btn, ...(valid ? {} : st.btnOff) }} disabled={!!busy || !valid} onClick={() => donate(p.key)}>
              <Heart size={14} />
              {busy === p.key ? "Redirecting…" : `Donate${one ? "" : ` · ${p.label}`}${valid ? ` — $${total.toFixed(2)}` : ""}`}
            </button>
          );
        })}
      </div>
      {err && <div style={st.err}>{err}</div>}
      <div style={st.note}>You'll finish on a secure checkout page. A receipt is emailed to you.</div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 14, padding: "12px 14px", background: "#fdf2f7", border: "1px solid #f3c6da", borderRadius: 10 },
  title: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, color: "#c2185b" },
  sub: { fontSize: 12.5, color: "#8a5064", margin: "3px 0 10px" },
  presets: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 },
  preset: { padding: "8px 14px", background: "#fff", color: "#c2185b", border: "1px solid #f0b6ce", borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  presetOn: { background: "#c2185b", color: "#fff", borderColor: "#c2185b" },
  custom: { display: "inline-flex", alignItems: "center", gap: 3, border: "1px solid #f0b6ce", borderRadius: 8, background: "#fff", padding: "0 8px" },
  dollar: { color: "#8a5064", fontSize: 13.5 },
  amtIn: { width: 80, padding: "8px 4px", border: "none", outline: "none", fontSize: 13.5, background: "transparent" },
  noteIn: { width: "100%", padding: "8px 10px", border: "1px solid #f0b6ce", borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 8, background: "#fff" },
  cover: { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, color: "#333", cursor: "pointer", marginBottom: 10, lineHeight: 1.45 },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#c2185b", color: "#fff", border: "none", borderRadius: 7, fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  btnOff: { background: "#e6a9c2", cursor: "not-allowed" },
  err: { marginTop: 8, color: "#c62828", fontSize: 12.5 },
  note: { marginTop: 8, color: "#9a7686", fontSize: 11.5 },
};
