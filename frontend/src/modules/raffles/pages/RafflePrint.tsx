/**
 * RafflePrint — a print-optimized sheet of numbered ticket stubs. Staff prints these,
 * cuts them apart, and drops them in a bowl for the physical drawing. Each stub carries
 * the ticket number and buyer so a pulled number maps back to a person.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { rafflesApi, type RaffleTicket } from "../api";
import { Loader2, Printer } from "lucide-react";

export default function RafflePrint() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ raffle: { name: string; prize_description: string | null; draw_date: string | null }; tickets: RaffleTicket[] } | null>(null);

  useEffect(() => { rafflesApi.tickets(parseInt(id!)).then(setData); }, [id]);

  if (!data) return <div style={{ padding: 24 }}><Loader2 /></div>;

  return (
    <div style={s.wrap}>
      <div style={s.toolbar} className="no-print">
        <div><strong>{data.tickets.length}</strong> paid ticket{data.tickets.length === 1 ? "" : "s"} — cut apart and drop in the bowl.</div>
        <button style={s.printBtn} onClick={() => window.print()}><Printer size={14} /> Print</button>
      </div>
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 0.4in; } }`}</style>

      {data.tickets.length === 0 ? <p style={{ padding: 24 }}>No paid tickets yet.</p> : (
        <div style={s.sheet}>
          {data.tickets.map((t) => (
            <div key={t.ticket_number} style={s.stub}>
              <div style={s.stubTop}>
                <span style={s.num}>#{t.ticket_number}</span>
                {t.is_winner && <span style={s.win}>WINNER</span>}
              </div>
              <div style={s.raffleName}>{data.raffle.name}</div>
              {data.raffle.prize_description && <div style={s.prize}>{data.raffle.prize_description}</div>}
              <div style={s.buyer}>{t.buyer_name}</div>
              {(t.buyer_email || t.buyer_phone) && <div style={s.contact}>{t.buyer_email || t.buyer_phone}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { padding: "12px 16px", maxWidth: 900, margin: "0 auto" },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontSize: 13, color: "#445" },
  printBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  sheet: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 },
  stub: { border: "1px dashed #999", borderRadius: 6, padding: "10px 12px", pageBreakInside: "avoid", background: "#fff" },
  stubTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  num: { fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  win: { fontSize: 10, fontWeight: 800, color: "#fff", background: "#f9a825", borderRadius: 4, padding: "1px 6px" },
  raffleName: { fontSize: 12, fontWeight: 700, color: "#334", marginTop: 4 },
  prize: { fontSize: 11, color: "#2e7d32", fontWeight: 600 },
  buyer: { fontSize: 13, color: "#111", marginTop: 6, fontWeight: 600 },
  contact: { fontSize: 11, color: "#667" },
};
