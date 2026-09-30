import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { invoicesApi, type FamilyInvoice as Data } from "../api";

/** Printable consolidated family invoice: youth, discounted fee, credits, balance. */
export default function FamilyInvoice() {
  const { familyId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    invoicesApi.family(Number(familyId))
      .then(setD)
      .catch(() => setErr("Could not load the invoice."));
  }, [familyId]);

  if (err) return <p style={{ color: "#c62828", padding: 20 }}>{err}</p>;
  if (!d) return <p style={{ padding: 20, color: "#889" }}>Loading…</p>;

  const yr = `${d.enrollment_year}–${d.enrollment_year + 1}`;
  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", maxWidth: 720, margin: "0 auto 12px" }}>
        <button onClick={() => navigate(-1)} style={s.back}><ArrowLeft size={15} /> Back</button>
        <button onClick={() => window.print()} style={s.print}><Printer size={15} /> Print / Save PDF</button>
      </div>

      <div style={s.sheet}>
        <div style={s.header}>
          <div>
            <div style={s.org}>Tulsa Robotics Center</div>
            <div style={s.sub}>Registration Invoice · {yr}</div>
          </div>
          <div style={s.billTo}><div style={s.billLabel}>Billed to</div><div style={s.billName}>{d.family_name}</div></div>
        </div>

        {d.lines.length === 0 ? <p style={{ color: "#889" }}>No enrollments for {yr}.</p> : (
          <table style={s.table}>
            <thead><tr>
              <th style={s.th}>Youth</th><th style={s.th}>Program</th>
              <th style={s.thR}>Fee</th><th style={s.thR}>Credits</th><th style={s.thR}>Balance</th>
            </tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.enrollment_id}>
                  <td style={s.td}>{l.youth}</td>
                  <td style={s.td}>
                    {l.program}
                    {l.credits.length > 0 && (
                      <div style={s.creditList}>{l.credits.map((c, i) => <div key={i}>− ${c.amount.toFixed(2)} {c.source}</div>)}</div>
                    )}
                  </td>
                  <td style={s.tdR}>${l.fee.toFixed(2)}</td>
                  <td style={s.tdR}>{l.credit_total > 0 ? `− $${l.credit_total.toFixed(2)}` : "—"}</td>
                  <td style={s.tdR}>${l.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={s.totals}>
          <Row l="Registration fees (multi-child rate applied)" v={`$${d.gross_total.toFixed(2)}`} />
          {d.credits_total > 0 && <Row l="Scholarships & school payments" v={`− $${d.credits_total.toFixed(2)}`} />}
          <Row l="Family balance" v={`$${d.balance_total.toFixed(2)}`} strong />
          {d.paid_total > 0 && <Row l="Paid" v={`− $${d.paid_total.toFixed(2)}`} />}
          {d.paid_total > 0 && <Row l="Remaining due" v={`$${d.remaining_total.toFixed(2)}`} strong />}
        </div>
        <p style={s.note}>Fees shown already reflect the multi-child discount. Questions? Contact Tulsa Robotics Center.</p>
      </div>

      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>
    </div>
  );
}

function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return <div style={{ ...s.totRow, ...(strong ? s.totStrong : {}) }}><span>{l}</span><span>{v}</span></div>;
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, padding: 0 },
  print: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  sheet: { maxWidth: 720, margin: "0 auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 30 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #1a3a5c", paddingBottom: 14, marginBottom: 18 },
  org: { fontSize: 20, fontWeight: 800, color: "#1a3a5c" },
  sub: { fontSize: 13, color: "#667", marginTop: 2 },
  billTo: { textAlign: "right" },
  billLabel: { fontSize: 11, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 },
  billName: { fontSize: 15, fontWeight: 700, color: "#243" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5, marginBottom: 16 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #cdd7e3" },
  thR: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #cdd7e3" },
  td: { padding: "9px 8px", borderBottom: "1px solid #f0f4f8", color: "#243", verticalAlign: "top" },
  tdR: { padding: "9px 8px", borderBottom: "1px solid #f0f4f8", color: "#243", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" },
  creditList: { fontSize: 11.5, color: "#2e7d32", marginTop: 3 },
  totals: { marginLeft: "auto", maxWidth: 360 },
  totRow: { display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "5px 0", color: "#334155" },
  totStrong: { fontWeight: 800, color: "#1a3a5c", borderTop: "1px solid #cdd7e3", paddingTop: 8 },
  note: { fontSize: 11.5, color: "#99a", marginTop: 18 },
};
