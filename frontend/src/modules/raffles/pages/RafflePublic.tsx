/**
 * RafflePublic — the public, no-login raffle signup a guest reaches by scanning the booth
 * QR code. Shows the prize, lets them buy N tickets, collects contact info + a short
 * "get involved" questionnaire, then hands off to the hosted card checkout. Tickets are
 * emailed once the payment clears.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { rafflesApi, type PublicRaffle } from "../api";
import { Ticket, Loader2 } from "lucide-react";

export default function RafflePublic() {
  const { slug } = useParams<{ slug: string }>();
  const [raffle, setRaffle] = useState<PublicRaffle | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [program, setProgram] = useState(false);
  const [volunteer, setVolunteer] = useState(false);
  const [sponsor, setSponsor] = useState(false);
  const [stay, setStay] = useState(true); // opt-in, default on
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    rafflesApi.publicGet(slug).then(setRaffle).catch(() => setError("This raffle isn't available.")).finally(() => setLoading(false));
  }, [slug]);

  const price = raffle?.ticket_price ?? 0;
  const total = (price * qty).toFixed(2);

  async function buy() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!email.trim()) { setError("Please enter your email so we can send your tickets."); return; }
    setBusy(true); setError("");
    try {
      const r = await rafflesApi.publicPurchase(slug!, {
        buyer_name: name.trim(), buyer_email: email.trim(), buyer_phone: phone.trim() || undefined, quantity: qty,
        interested_program: program, interested_volunteer: volunteer, interested_sponsor: sponsor, stay_in_touch: stay,
      });
      window.location.href = r.redirect_url; // hosted checkout
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't start checkout. Please try again, or buy at the booth.");
      setBusy(false);
    }
  }

  if (loading) return <div style={s.page}><Loader2 /></div>;
  if (!raffle) return <div style={s.page}><div style={s.card}>{error || "Raffle not found."}</div></div>;

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.brand}>Tulsa Robotics Center</div>
        <h1 style={s.h1}><Ticket size={22} style={{ verticalAlign: -4 }} /> {raffle.name}</h1>
        {raffle.prize_description && <p style={s.prize}>{raffle.prize_description}</p>}
        <p style={s.price}>${price.toFixed(2)} per ticket{raffle.draw_date ? ` · Winner drawn ${new Date(raffle.draw_date).toLocaleDateString()}` : ""}</p>

        {!raffle.sale_open ? (
          <div style={s.closed}>Ticket sales for this raffle are currently closed. Thanks for your interest!</div>
        ) : (
          <>
            <label style={s.label}>How many tickets?</label>
            <div style={s.qtyRow}>
              <button style={s.qtyBtn} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <input style={s.qtyInput} type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} />
              <button style={s.qtyBtn} onClick={() => setQty((q) => Math.min(100, q + 1))}>+</button>
              <span style={s.total}>= ${total}</span>
            </div>

            <label style={s.label}>Your name</label>
            <input style={s.in} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            <label style={s.label}>Email <span style={s.hint}>(we'll email your ticket numbers)</span></label>
            <input style={s.in} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <label style={s.label}>Phone <span style={s.hint}>(optional)</span></label>
            <input style={s.in} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(optional)" />

            <div style={s.quiz}>
              <div style={s.quizHead}>While you're here — anything you'd like to hear about?</div>
              <label style={s.check}><input type="checkbox" checked={program} onChange={(e) => setProgram(e.target.checked)} /> I'm interested in TRC programs for my child</label>
              <label style={s.check}><input type="checkbox" checked={volunteer} onChange={(e) => setVolunteer(e.target.checked)} /> I'd like to learn about volunteering</label>
              <label style={s.check}><input type="checkbox" checked={sponsor} onChange={(e) => setSponsor(e.target.checked)} /> I'd like to become a TRC Supporter/sponsor</label>
              <label style={s.check}><input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} /> Keep me in the loop with TRC news</label>
            </div>

            {error && <div style={s.err}>{error}</div>}
            <button style={s.buy} onClick={buy} disabled={busy}>
              {busy ? <Loader2 size={16} /> : <Ticket size={16} />} Buy {qty} ticket{qty === 1 ? "" : "s"} — ${total}
            </button>
            <p style={s.secure}>Card payment is processed securely by our payment provider. {raffle.fine_print}</p>
          </>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f0f4f8", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 14px" },
  card: { background: "#fff", borderRadius: 14, padding: "24px 22px", maxWidth: 460, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.08)" },
  brand: { fontSize: 12, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.6 },
  h1: { fontSize: 22, color: "#1a3a5c", margin: "6px 0 8px" },
  prize: { fontSize: 15, color: "#2e7d32", fontWeight: 600, margin: "0 0 6px" },
  price: { fontSize: 13, color: "#667", margin: "0 0 16px" },
  closed: { background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 8, padding: "14px 16px", color: "#8a5a00", fontSize: 14 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#445", margin: "12px 0 5px" },
  hint: { fontWeight: 400, color: "#8a97a5" },
  in: { width: "100%", padding: "10px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 15, boxSizing: "border-box" },
  qtyRow: { display: "flex", alignItems: "center", gap: 8 },
  qtyBtn: { width: 38, height: 38, borderRadius: 8, border: "1px solid #cdd7e3", background: "#fff", fontSize: 20, cursor: "pointer", color: "#1a3a5c" },
  qtyInput: { width: 70, textAlign: "center", padding: "9px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 16 },
  total: { fontSize: 16, fontWeight: 700, color: "#1a3a5c", marginLeft: 6 },
  quiz: { marginTop: 16, background: "#f7fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  quizHead: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 8 },
  check: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, color: "#334", padding: "5px 0", cursor: "pointer", lineHeight: 1.4 },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "9px 12px", color: "#c62828", fontSize: 13, margin: "12px 0 0" },
  buy: { width: "100%", marginTop: 16, padding: "13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 9, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  secure: { fontSize: 11.5, color: "#8a97a5", marginTop: 10, lineHeight: 1.5 },
};
