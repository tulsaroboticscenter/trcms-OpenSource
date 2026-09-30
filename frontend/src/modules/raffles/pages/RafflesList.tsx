/** RafflesList — admin overview of raffles with quick sales stats + create. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rafflesApi, type Raffle } from "../api";
import { Ticket, Plus, Loader2 } from "lucide-react";

const STATUS_COLOR: Record<string, string> = { draft: "#8a97a5", open: "#2e7d32", closed: "#a86a00", drawn: "#1565c0", archived: "#94a3b8" };

export default function RafflesList() {
  const navigate = useNavigate();
  const [raffles, setRaffles] = useState<Raffle[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prize, setPrize] = useState("");
  const [price, setPrice] = useState("5");
  const [busy, setBusy] = useState(false);

  const load = () => rafflesApi.list().then(setRaffles).catch(() => setRaffles([]));
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await rafflesApi.create({ name: name.trim(), prize_description: prize.trim() || null, ticket_price: parseFloat(price) || 5, status: "draft" });
      navigate(`/raffles/${r.id}`);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 18px" }}>
      <div style={s.head}>
        <h1 style={s.h1}><Ticket size={22} style={{ verticalAlign: -4 }} /> Raffles</h1>
        <button style={s.new} onClick={() => setCreating((v) => !v)}><Plus size={15} /> New raffle</button>
      </div>
      <p style={s.sub}>Run a prize drawing with online (QR) and in-person booth ticket sales. Each paid buyer can be routed into recruiting, volunteering, or the sponsor list.</p>

      {creating && (
        <div style={s.createCard}>
          <input style={s.in} placeholder="Raffle name (e.g. Maker Faire Raffle)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <input style={s.in} placeholder="Prize (e.g. $100 gift card — winner's choice)" value={prize} onChange={(e) => setPrize(e.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={s.priceLabel}>$ / ticket</span>
            <input style={{ ...s.in, width: 90 }} type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            <button style={s.save} onClick={create} disabled={busy}>{busy ? <Loader2 size={14} /> : "Create"}</button>
            <button style={s.cancel} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      {raffles === null ? <p style={s.muted}><Loader2 size={16} /> Loading…</p> : raffles.length === 0 ? <p style={s.muted}>No raffles yet — create one to get started.</p> : (
        <div style={s.list}>
          {raffles.map((r) => (
            <button key={r.id} style={s.row} onClick={() => navigate(`/raffles/${r.id}`)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.rowName}>{r.name} <span style={{ ...s.badge, color: STATUS_COLOR[r.status] ?? "#667", borderColor: STATUS_COLOR[r.status] ?? "#ccc" }}>{r.status}</span></div>
                <div style={s.rowMeta}>{r.prize_description || "—"} · ${(r.ticket_price ?? 0).toFixed(2)}/ticket</div>
              </div>
              <div style={s.rowStats}>
                <div><strong>{r.stats?.tickets_sold ?? 0}</strong> sold</div>
                <div style={{ color: "#2e7d32" }}><strong>${(r.stats?.revenue ?? 0).toFixed(0)}</strong></div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { fontSize: 13, color: "#778", margin: "6px 0 16px", maxWidth: 640, lineHeight: 1.5 },
  new: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  createCard: { display: "flex", flexDirection: "column", gap: 8, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 14 },
  in: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  priceLabel: { fontSize: 12.5, color: "#667" },
  save: { padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  cancel: { padding: "9px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, cursor: "pointer" },
  muted: { color: "#889", fontSize: 14, display: "flex", gap: 6, alignItems: "center" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 14, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "13px 16px", cursor: "pointer", textAlign: "left", width: "100%" },
  rowName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  badge: { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", border: "1px solid", borderRadius: 10, padding: "1px 8px" },
  rowMeta: { fontSize: 12.5, color: "#667", marginTop: 3 },
  rowStats: { display: "flex", gap: 16, fontSize: 13, color: "#445", textAlign: "right" },
};
