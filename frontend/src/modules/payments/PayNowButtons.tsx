import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { paymentsApi, type QuoteProvider } from "./api";

/**
 * "Pay Now" buttons for an outstanding enrollment balance. Renders nothing
 * unless online payments are enabled AND there's a balance due — so it stays
 * invisible until a provider (Square/PayPal) is configured on the server.
 * The family picks the provider and may optionally cover the processing fee so
 * 100% of the enrollment fee reaches TRC.
 */
export default function PayNowButtons({ enrollmentId }: { enrollmentId: number }) {
  const [base, setBase] = useState(0);
  const [providers, setProviders] = useState<QuoteProvider[]>([]);
  const [coverFee, setCoverFee] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");

  useEffect(() => {
    paymentsApi.getEnrollmentQuote(enrollmentId)
      .then((q) => { setBase(q.base); setProviders(q.enabled ? q.providers : []); })
      .catch(() => setProviders([]));
  }, [enrollmentId]);

  if (base <= 0 || providers.length === 0) return null;

  async function pay(provider: string) {
    setBusy(provider); setErr("");
    try {
      const { redirect_url } = await paymentsApi.payEnrollment(enrollmentId, provider, coverFee);
      window.location.href = redirect_url; // hand off to the provider's hosted page
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not start payment.");
      setBusy("");
    }
  }

  return (
    <div style={st.wrap}>
      <div style={st.due}>Balance due: <strong>${base.toFixed(2)}</strong></div>

      <label style={st.cover}>
        <input type="checkbox" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} />
        <span>Add the processing fee so <strong>100% of my payment supports TRC</strong></span>
      </label>

      <div style={st.row}>
        {providers.map((p) => {
          const total = coverFee ? p.total_with_fee : base;
          return (
            <button key={p.key} style={st.btn} disabled={!!busy} onClick={() => pay(p.key)}>
              <CreditCard size={14} />
              {busy === p.key ? "Redirecting…" : `Pay with ${p.label} — $${total.toFixed(2)}`}
            </button>
          );
        })}
      </div>
      {coverFee && <div style={st.feeNote}>Includes the card processing fee so TRC receives the full ${base.toFixed(2)}.</div>}
      {err && <div style={st.err}>{err}</div>}
      <div style={st.note}>You'll be taken to a secure checkout page to finish. A receipt is emailed to you.</div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 10, padding: "10px 12px", background: "#f5faf6", border: "1px solid #cbe6cf", borderRadius: 8 },
  due: { fontSize: 13, color: "#2e7d32", marginBottom: 8 },
  cover: { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, color: "#333", cursor: "pointer", marginBottom: 10, lineHeight: 1.45 },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  feeNote: { marginTop: 8, color: "#2e7d32", fontSize: 11.5 },
  err: { marginTop: 8, color: "#c62828", fontSize: 12.5 },
  note: { marginTop: 8, color: "#889", fontSize: 11.5 },
};
