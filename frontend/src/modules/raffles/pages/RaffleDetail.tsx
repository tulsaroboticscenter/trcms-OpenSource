/**
 * RaffleDetail — the staff console for one raffle: edit settings, watch live sales stats,
 * show/print the public QR code, record in-person booth sales, review orders, print the
 * physical ticket stubs for the drawing bowl, and draw the winner.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import QRCode from "qrcode";
import { rafflesApi, type Raffle, type RaffleOrder } from "../api";
import { Ticket, Loader2, QrCode as QrIcon, Trophy, Printer, Trash2, Save, ExternalLink } from "lucide-react";

const STATUSES = ["draft", "open", "closed", "drawn", "archived"] as const;

export default function RaffleDetail() {
  const { id } = useParams<{ id: string }>();
  const rid = parseInt(id!);
  const navigate = useNavigate();
  const [raffle, setRaffle] = useState<Raffle | null>(null);
  const [orders, setOrders] = useState<RaffleOrder[]>([]);
  const [qr, setQr] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"overview" | "orders">("overview");

  // Booth-sale form
  const [bName, setBName] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bPhone, setBPhone] = useState("");
  const [bQty, setBQty] = useState(1);
  const [bMethod, setBMethod] = useState("cash");
  const [bProgram, setBProgram] = useState(false);
  const [bVolunteer, setBVolunteer] = useState(false);
  const [bSponsor, setBSponsor] = useState(false);
  const [bStay, setBStay] = useState(true);
  const [boothMsg, setBoothMsg] = useState("");
  const [boothBusy, setBoothBusy] = useState(false);

  const publicUrl = raffle ? `${window.location.origin}/raffle/${raffle.public_slug}` : "";

  const load = useCallback(() => {
    rafflesApi.get(rid).then(setRaffle);
    rafflesApi.orders(rid).then(setOrders).catch(() => setOrders([]));
  }, [rid]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (publicUrl) QRCode.toDataURL(publicUrl, { width: 240, margin: 1 }).then(setQr).catch(() => {});
  }, [publicUrl]);

  async function patch(data: Partial<Raffle>) {
    setSaving(true);
    try { const r = await rafflesApi.update(rid, data); setRaffle(r); } finally { setSaving(false); }
  }

  async function recordBooth() {
    if (!bName.trim() || bQty < 1) { setBoothMsg("Enter a name and quantity."); return; }
    setBoothBusy(true); setBoothMsg("");
    try {
      const r = await rafflesApi.boothSale(rid, {
        buyer_name: bName.trim(), quantity: bQty, payment_method: bMethod,
        buyer_email: bEmail.trim() || undefined, buyer_phone: bPhone.trim() || undefined,
        interested_program: bProgram, interested_volunteer: bVolunteer, interested_sponsor: bSponsor, stay_in_touch: bStay,
      });
      setBoothMsg(`✓ Sold tickets #${r.ticket_numbers[0]}–${r.ticket_numbers[r.ticket_numbers.length - 1]} ($${r.amount.toFixed(2)})`);
      setBName(""); setBEmail(""); setBPhone(""); setBQty(1); setBProgram(false); setBVolunteer(false); setBSponsor(false); setBStay(true);
      load();
    } catch (e: unknown) {
      setBoothMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Sale failed.");
    } finally { setBoothBusy(false); }
  }

  async function draw() {
    const redraw = raffle?.status === "drawn";
    if (redraw && !window.confirm("A winner was already drawn. Draw a different winner?")) return;
    const w = await rafflesApi.draw(rid, redraw);
    alert(`🎉 Winner: ticket #${w.ticket_number} — ${w.buyer_name}${w.buyer_email ? ` (${w.buyer_email})` : ""}`);
    load();
  }

  async function del() {
    if (!window.confirm("Delete this raffle and all its tickets? This cannot be undone.")) return;
    await rafflesApi.remove(rid);
    navigate("/raffles");
  }

  if (!raffle) return <div style={{ padding: 24 }}><Loader2 /></div>;
  const st = raffle.stats;

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "16px 18px" }}>
      <Link to="/raffles" style={s.back}>← All raffles</Link>
      <div style={s.head}>
        <h1 style={s.h1}><Ticket size={22} style={{ verticalAlign: -4 }} /> {raffle.name}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={raffle.status} onChange={(e) => patch({ status: e.target.value as Raffle["status"] })} style={s.statusSel}>
            {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          {saving && <Loader2 size={15} />}
        </div>
      </div>

      {/* Stats */}
      <div style={s.stats}>
        <Stat label="Tickets sold" value={st?.tickets_sold ?? 0} />
        <Stat label="Buyers" value={st?.buyers ?? 0} />
        <Stat label="Pending" value={st?.tickets_pending ?? 0} />
        <Stat label="Revenue" value={`$${(st?.revenue ?? 0).toFixed(2)}`} accent="#2e7d32" />
      </div>

      <div style={s.tabs}>
        <button style={tab === "overview" ? s.tabOn : s.tab} onClick={() => setTab("overview")}>Overview</button>
        <button style={tab === "orders" ? s.tabOn : s.tab} onClick={() => setTab("orders")}>Orders ({orders.length})</button>
      </div>

      {tab === "overview" ? (
        <div style={s.grid}>
          {/* Settings */}
          <div style={s.card}>
            <h3 style={s.cardH}>Settings</h3>
            <Field label="Prize"><input style={s.in} defaultValue={raffle.prize_description ?? ""} onBlur={(e) => e.target.value !== (raffle.prize_description ?? "") && patch({ prize_description: e.target.value })} /></Field>
            <Field label="Price per ticket"><input style={s.in} type="number" defaultValue={raffle.ticket_price ?? 5} onBlur={(e) => patch({ ticket_price: parseFloat(e.target.value) || 0 })} /></Field>
            <Field label="Draw date"><input style={s.in} type="date" defaultValue={raffle.draw_date?.slice(0, 10) ?? ""} onBlur={(e) => patch({ draw_date: e.target.value || null })} /></Field>
            <Field label="Fine print (shown on public page)"><textarea style={{ ...s.in, minHeight: 54 }} defaultValue={raffle.fine_print ?? ""} onBlur={(e) => e.target.value !== (raffle.fine_print ?? "") && patch({ fine_print: e.target.value })} /></Field>
            <p style={s.helpNote}>Set status to <strong>open</strong> to allow online sales. <Save size={11} style={{ verticalAlign: -1 }} /> saves when you click out of a field.</p>
            <button style={s.delBtn} onClick={del}><Trash2 size={13} /> Delete raffle</button>
          </div>

          {/* QR / public link */}
          <div style={s.card}>
            <h3 style={s.cardH}><QrIcon size={15} style={{ verticalAlign: -3 }} /> Public signup</h3>
            {qr && <img src={qr} alt="Raffle QR code" style={{ width: 200, height: 200, display: "block", margin: "4px auto 10px" }} />}
            <a href={publicUrl} target="_blank" rel="noreferrer" style={s.pubLink}>{publicUrl} <ExternalLink size={12} /></a>
            <button style={s.printBtn} onClick={() => window.open(`/raffle/${raffle.public_slug}`, "_blank")}>Preview public page</button>
            <p style={s.helpNote}>Print this QR for your booth. Guests scan it to buy tickets and pay by card. {raffle.status !== "open" && <em>Sales are closed until status is “open.”</em>}</p>
          </div>

          {/* Booth sale */}
          <div style={s.card}>
            <h3 style={s.cardH}>Record a booth sale</h3>
            <p style={s.helpNote}>For cash/card sales you take in person. Tickets are issued immediately.</p>
            <Field label="Buyer name"><input style={s.in} value={bName} onChange={(e) => setBName(e.target.value)} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Field label="Email (optional)"><input style={s.in} value={bEmail} onChange={(e) => setBEmail(e.target.value)} /></Field>
              <Field label="Phone (optional)"><input style={s.in} value={bPhone} onChange={(e) => setBPhone(e.target.value)} /></Field>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Field label="Qty"><input style={{ ...s.in, width: 70 }} type="number" min={1} value={bQty} onChange={(e) => setBQty(Math.max(1, parseInt(e.target.value) || 1))} /></Field>
              <Field label="Method"><select style={s.in} value={bMethod} onChange={(e) => setBMethod(e.target.value)}><option value="cash">Cash</option><option value="cc">Card</option><option value="check">Check</option><option value="comp">Comp</option></select></Field>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a5c", paddingBottom: 9 }}>= ${((raffle.ticket_price ?? 0) * bQty).toFixed(2)}</div>
            </div>
            <div style={s.boothQuiz}>
              <label style={s.ck}><input type="checkbox" checked={bProgram} onChange={(e) => setBProgram(e.target.checked)} /> Interested in programs</label>
              <label style={s.ck}><input type="checkbox" checked={bVolunteer} onChange={(e) => setBVolunteer(e.target.checked)} /> Volunteering</label>
              <label style={s.ck}><input type="checkbox" checked={bSponsor} onChange={(e) => setBSponsor(e.target.checked)} /> Sponsor/supporter</label>
              <label style={s.ck}><input type="checkbox" checked={bStay} onChange={(e) => setBStay(e.target.checked)} /> Stay in touch</label>
            </div>
            <button style={s.boothBtn} onClick={recordBooth} disabled={boothBusy}>{boothBusy ? <Loader2 size={14} /> : <Ticket size={14} />} Record sale</button>
            {boothMsg && <div style={s.boothMsg}>{boothMsg}</div>}
          </div>

          {/* Drawing */}
          <div style={s.card}>
            <h3 style={s.cardH}><Trophy size={15} style={{ verticalAlign: -3 }} /> Drawing</h3>
            {raffle.winner_ticket_id ? (
              <div style={s.winnerBox}>🏆 Winner drawn {raffle.winner_drawn_at ? new Date(raffle.winner_drawn_at).toLocaleString() : ""}. See Orders/print for details.</div>
            ) : <p style={s.helpNote}>Draw a random winner from all paid tickets. You can also print the physical stubs and pull one from a bowl.</p>}
            <button style={s.drawBtn} onClick={draw} disabled={(st?.tickets_sold ?? 0) === 0}><Trophy size={14} /> {raffle.status === "drawn" ? "Draw again" : "Draw winner"}</button>
            <Link to={`/raffles/${rid}/print`} target="_blank" style={s.printStubs}><Printer size={13} /> Print ticket stubs for the bowl</Link>
          </div>
        </div>
      ) : (
        <div style={s.card}>
          <h3 style={s.cardH}>Orders</h3>
          {orders.length === 0 ? <p style={s.helpNote}>No orders yet.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead><tr><th style={s.th}>Buyer</th><th style={s.th}>Contact</th><th style={s.th}>Qty</th><th style={s.th}>Amount</th><th style={s.th}>Channel</th><th style={s.th}>Status</th><th style={s.th}>When</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td style={s.td}>{o.buyer_name}</td>
                      <td style={s.td}>{o.buyer_email || o.buyer_phone || "—"}</td>
                      <td style={s.td}>{o.quantity}</td>
                      <td style={s.td}>${(o.amount ?? 0).toFixed(2)}</td>
                      <td style={s.td}>{o.sale_channel}</td>
                      <td style={s.td}><span style={{ color: o.payment_status === "paid" ? "#2e7d32" : o.payment_status === "pending" ? "#a86a00" : "#c62828", fontWeight: 600 }}>{o.payment_status}</span></td>
                      <td style={s.td}>{new Date(o.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return <div style={s.stat}><div style={{ ...s.statVal, color: accent ?? "#1a3a5c" }}>{value}</div><div style={s.statLbl}>{label}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ flex: 1, marginBottom: 10 }}><label style={s.fLbl}>{label}</label>{children}</div>;
}

const s: Record<string, React.CSSProperties> = {
  back: { fontSize: 13, color: "#1565c0", textDecoration: "none" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 14px", flexWrap: "wrap", gap: 10 },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  statusSel: { padding: "7px 10px", borderRadius: 7, border: "1px solid #cdd7e3", fontSize: 13, textTransform: "capitalize" },
  stats: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 },
  stat: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  statVal: { fontSize: 24, fontWeight: 800 },
  statLbl: { fontSize: 11.5, color: "#778", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  tabs: { display: "flex", gap: 6, marginBottom: 12 },
  tab: { padding: "7px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 13, cursor: "pointer", color: "#556" },
  tabOn: { padding: "7px 14px", background: "#1a3a5c", border: "1px solid #1a3a5c", borderRadius: 7, fontSize: 13, cursor: "pointer", color: "#fff", fontWeight: 600 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 },
  cardH: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", margin: "0 0 10px" },
  fLbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", marginBottom: 4 },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  helpNote: { fontSize: 12, color: "#778", lineHeight: 1.5, margin: "6px 0" },
  delBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#c62828", fontSize: 12.5, cursor: "pointer", padding: 0, marginTop: 8 },
  pubLink: { display: "flex", alignItems: "center", gap: 5, justifyContent: "center", fontSize: 12, color: "#1565c0", wordBreak: "break-all", textDecoration: "none", marginBottom: 8 },
  printBtn: { width: "100%", padding: "8px", background: "#eef3f8", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, cursor: "pointer", fontWeight: 600 },
  boothQuiz: { display: "flex", flexWrap: "wrap", gap: "4px 14px", margin: "6px 0 10px" },
  ck: { fontSize: 12, color: "#445", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" },
  boothBtn: { display: "flex", alignItems: "center", gap: 6, justifyContent: "center", width: "100%", padding: "10px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  boothMsg: { marginTop: 8, fontSize: 13, color: "#2e7d32", fontWeight: 600 },
  winnerBox: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#2e7d32", marginBottom: 10 },
  drawBtn: { display: "flex", alignItems: "center", gap: 6, justifyContent: "center", width: "100%", padding: "11px", background: "#f9a825", color: "#3a2a00", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 800, cursor: "pointer" },
  printStubs: { display: "flex", alignItems: "center", gap: 6, justifyContent: "center", marginTop: 8, fontSize: 13, color: "#1565c0", textDecoration: "none" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e2e8f0", color: "#556", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { padding: "8px 10px", borderBottom: "1px solid #eef2f6", color: "#334" },
};
