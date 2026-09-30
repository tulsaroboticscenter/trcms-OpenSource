import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, Mail, Trash2 } from "lucide-react";
import { invoicesApi, type SchoolInvoice as Data } from "../api";

/** School invoice: what a school (e.g. Epic Charter) is covering, printable + emailable. */
export default function SchoolInvoice() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<Data | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const data = await invoicesApi.school(Number(schoolId));
    setD(data);
    if (data.suggested_email && !to) setTo(data.suggested_email);
  }, [schoolId, to]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [schoolId]);

  if (!d) return <p style={{ padding: 20, color: "#889" }}>Loading…</p>;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  async function send() {
    if (!to) { flash("Enter a recipient email."); return; }
    if (!confirm(`Email this invoice for $${d!.total.toFixed(2)} to ${to}?`)) return;
    setBusy(true);
    try { const r = await invoicesApi.sendSchool(Number(schoolId), to, message); flash(`Invoice sent to ${r.sent_to}.`); await load(); }
    catch (e: unknown) { flash((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Send failed."); }
    finally { setBusy(false); }
  }
  async function reverse(id: number) {
    if (!confirm("Remove this item? It restores the youth's amount due.")) return;
    await invoicesApi.reverseSchoolPayment(id); await load();
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => navigate(-1)} style={s.back}><ArrowLeft size={15} /> Back</button>
        <button onClick={() => window.print()} style={s.print}><Printer size={15} /> Print / Save PDF</button>
      </div>
      {msg && <div className="no-print" style={s.flash}>{msg}</div>}

      <div style={s.sheet}>
        <div style={s.header}>
          <div><div style={s.org}>Tulsa Robotics Center</div><div style={s.sub}>Invoice</div></div>
          <div style={s.billTo}><div style={s.billLabel}>Billed to</div><div style={s.billName}>{d.school_name}</div></div>
        </div>
        {d.lines.length === 0 ? <p style={{ color: "#889" }}>No items recorded for this school yet.</p> : (
          <table style={s.table}>
            <thead><tr><th style={s.th}>Youth</th><th style={s.th}>Program</th><th style={s.thR}>Amount</th><th className="no-print" style={s.thR}></th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td style={s.td}>{l.youth}</td>
                  <td style={s.td}>{l.program}{l.year ? ` (${l.year}–${l.year + 1})` : ""} {l.status === "invoiced" && <span style={s.tag}>invoiced</span>}{l.status === "paid" && <span style={{ ...s.tag, background: "#e8f5e9", color: "#2e7d32" }}>paid</span>}</td>
                  <td style={s.tdR}>${l.amount.toFixed(2)}</td>
                  <td className="no-print" style={s.tdR}>{l.status !== "paid" && <button style={s.del} onClick={() => reverse(l.id)} title="Remove"><Trash2 size={13} /></button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2} style={s.totLabel}>Total due</td><td style={s.totVal}>${d.total.toFixed(2)}</td><td className="no-print"></td></tr></tfoot>
          </table>
        )}
      </div>

      {d.lines.length > 0 && (
        <div className="no-print" style={s.emailCard}>
          <h4 style={s.emailH}><Mail size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Email this invoice to the school</h4>
          <input style={s.in} type="email" placeholder="school billing email" value={to} onChange={(e) => setTo(e.target.value)} />
          <textarea style={s.area} rows={2} placeholder="Optional message to include…" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button style={s.sendBtn} disabled={busy} onClick={send}>{busy ? "Sending…" : "Send invoice"}</button>
        </div>
      )}
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, padding: 0 },
  print: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 10 },
  sheet: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 30 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #1a3a5c", paddingBottom: 14, marginBottom: 18 },
  org: { fontSize: 20, fontWeight: 800, color: "#1a3a5c" },
  sub: { fontSize: 13, color: "#667", marginTop: 2 },
  billTo: { textAlign: "right" },
  billLabel: { fontSize: 11, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 },
  billName: { fontSize: 15, fontWeight: 700, color: "#243" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #cdd7e3" },
  thR: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #cdd7e3" },
  td: { padding: "9px 8px", borderBottom: "1px solid #f0f4f8", color: "#243" },
  tdR: { padding: "9px 8px", borderBottom: "1px solid #f0f4f8", color: "#243", textAlign: "right", whiteSpace: "nowrap" },
  tag: { fontSize: 10.5, background: "#e3f2fd", color: "#1565c0", padding: "1px 7px", borderRadius: 9, marginLeft: 6 },
  del: { background: "none", border: "none", color: "#c62828", cursor: "pointer" },
  totLabel: { padding: "10px 8px", textAlign: "right", fontWeight: 800, color: "#1a3a5c" },
  totVal: { padding: "10px 8px", textAlign: "right", fontWeight: 800, color: "#1a3a5c" },
  emailCard: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginTop: 16 },
  emailH: { margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  in: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box", marginBottom: 8 },
  area: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box", resize: "vertical", marginBottom: 8 },
  sendBtn: { padding: "9px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
};
