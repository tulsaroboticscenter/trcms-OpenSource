/**
 * ScholarshipBoardReport (Phase 5) — a printable season summary of the scholarship
 * fund for the TRCF Board: totals + outcome breakdown, per-fund figures, an itemized
 * award list, and multi-year history for grant writing. Confidential family aid —
 * gated the same as the rest of the module (scholarships.applications). The on-screen
 * chrome (back link, controls) is hidden when printing.
 */
import { useState, useEffect, useCallback } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { scholarshipsApi, money, type BoardReport } from "../api";
import { ArrowLeft, Printer, GraduationCap } from "lucide-react";

const OUTCOME: Record<string, { label: string; bg: string; fg: string }> = {
  enrolled: { label: "Enrolled", bg: "#e6f4ea", fg: "#1b7a3d" },
  pending: { label: "Pending", bg: "#fff4e0", fg: "#a86a00" },
  not_enrolled: { label: "Not enrolled", bg: "#fdecea", fg: "#b5372a" },
  none: { label: "—", bg: "#eef2f7", fg: "#889" },
};

export default function ScholarshipBoardReport() {
  const goBack = useGoBack("/admin/scholarship-funds");
  const [data, setData] = useState<BoardReport | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    scholarshipsApi.boardReport(year ?? undefined)
      .then((d) => { setData(d); if (year === null) setYear(d.year); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const yearOpts = year ? [year + 1, year, year - 1, year - 2] : [];
  const sm = data?.summary;

  return (
    <div style={s.page}>
      <style>{`@media print {
        .no-print { display: none !important; }
        body { background: #fff !important; }
        .board-report { max-width: none !important; margin: 0 !important; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
      }`}</style>

      <div className="no-print" style={s.toolbar}>
        <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Scholarship Funds</button>
        <div style={{ display: "flex", gap: 8 }}>
          {year !== null && (
            <select style={s.yearSel} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOpts.map((y) => <option key={y} value={y}>{y}–{y + 1}</option>)}
            </select>
          )}
          <button style={s.printBtn} onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : !data || !sm ? <p style={s.muted}>No report available.</p> : (
        <div className="board-report" style={s.report}>
          <header style={s.header}>
            <div style={s.brand}><GraduationCap size={20} /> Tulsa Robotics Center Foundation</div>
            <h1 style={s.h1}>Scholarship Fund Report</h1>
            <div style={s.season}>Season {data.year_label}</div>
            <div style={s.generated}>Generated {new Date(data.generated_at).toLocaleDateString()} · Confidential</div>
          </header>

          {/* Summary */}
          <div style={s.cards}>
            <Card label="Allocated" val={money(sm.total_allocated)} />
            <Card label="Awarded" val={money(sm.total_awarded)} />
            <Card label="Available" val={money(sm.total_available)} accent="#00695c" />
            <Card label="Youth helped" val={String(sm.youth_helped)} />
            <Card label="Awards" val={String(sm.award_count)} />
            <Card label="Avg award" val={money(sm.avg_award)} />
          </div>

          <p style={s.narr}>
            In {data.year_label}, {sm.funds_count} fund{sm.funds_count === 1 ? "" : "s"} allocated {money(sm.total_allocated)} from the General Fund
            and awarded {money(sm.total_awarded)} to {sm.youth_helped} youth across {sm.award_count} scholarship{sm.award_count === 1 ? "" : "s"},
            leaving {money(sm.total_available)} available.
            {sm.reclaimed_count > 0 && <> {money(sm.reclaimed_total)} from {sm.reclaimed_count} expired award{sm.reclaimed_count === 1 ? "" : "s"} was reclaimed and returned to the fund.</>}
            {sm.total_sponsor_support > 0 && <> Sponsor contributions of {money(sm.total_sponsor_support)} supported the program.</>}
          </p>

          {/* Outcome breakdown */}
          <div style={s.outRow}>
            <span style={s.outLbl}>Enrollment outcome of awards:</span>
            <span style={{ ...s.outPill, background: OUTCOME.enrolled.bg, color: OUTCOME.enrolled.fg }}>{sm.outcomes.enrolled} enrolled</span>
            <span style={{ ...s.outPill, background: OUTCOME.pending.bg, color: OUTCOME.pending.fg }}>{sm.outcomes.pending} pending</span>
            <span style={{ ...s.outPill, background: OUTCOME.not_enrolled.bg, color: OUTCOME.not_enrolled.fg }}>{sm.outcomes.not_enrolled} not enrolled</span>
          </div>

          {/* Per-fund */}
          <h2 style={s.h2}>By fund</h2>
          <table style={s.table}>
            <thead><tr><Th>Fund</Th><Th r>Allocated</Th><Th r>Awarded</Th><Th r>Available</Th><Th r>Awards</Th><Th r>Sponsor support</Th></tr></thead>
            <tbody>
              {data.funds.map((f) => (
                <tr key={f.id}>
                  <Td>{f.name}{!f.is_active && <span style={s.inactive}> (inactive)</span>}</Td>
                  <Td r>{money(f.allocated)}</Td><Td r>{money(f.awarded)}</Td><Td r>{money(f.available)}</Td>
                  <Td r>{f.award_count}</Td><Td r>{f.sponsor_support > 0 ? money(f.sponsor_support) : "—"}</Td>
                </tr>
              ))}
              <tr style={s.totalRow}>
                <Td><strong>Total</strong></Td>
                <Td r><strong>{money(sm.total_allocated)}</strong></Td><Td r><strong>{money(sm.total_awarded)}</strong></Td>
                <Td r><strong>{money(sm.total_available)}</strong></Td><Td r><strong>{sm.award_count}</strong></Td>
                <Td r><strong>{sm.total_sponsor_support > 0 ? money(sm.total_sponsor_support) : "—"}</strong></Td>
              </tr>
            </tbody>
          </table>

          {/* Itemized awards */}
          <h2 style={s.h2}>Awards ({data.awards.length})</h2>
          {data.awards.length === 0 ? <p style={s.muted}>No awards this season.</p> : (
            <table style={s.table}>
              <thead><tr><Th>Recipient</Th><Th>Program</Th><Th>Fund</Th><Th r>Amount</Th><Th>Date</Th><Th>Outcome</Th></tr></thead>
              <tbody>
                {data.awards.map((a) => {
                  const o = OUTCOME[a.outcome] ?? OUTCOME.none;
                  return (
                    <tr key={a.id}>
                      <Td>{a.recipient ?? "—"}</Td><Td>{a.program ?? "—"}</Td><Td>{a.fund_name ?? "—"}</Td>
                      <Td r>{money(a.amount)}</Td><Td>{a.date ?? "—"}</Td>
                      <Td><span style={{ ...s.outPill, background: o.bg, color: o.fg }}>{o.label}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* History */}
          {data.history.length > 1 && (
            <>
              <h2 style={s.h2}>History</h2>
              <table style={s.table}>
                <thead><tr><Th>Season</Th><Th r>Allocated</Th><Th r>Paid out</Th><Th r>Youth helped</Th></tr></thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.year}><Td>{h.year}–{h.year + 1}</Td><Td r>{money(h.allocated)}</Td><Td r>{money(h.paid_out)}</Td><Td r>{h.youth_helped}</Td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ label, val, accent }: { label: string; val: string; accent?: string }) {
  return <div style={s.card}><span style={s.cardLbl}>{label}</span><span style={{ ...s.cardVal, color: accent ?? "#1a3a5c" }}>{val}</span></div>;
}
function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th style={{ ...s.th, textAlign: r ? "right" : "left" }}>{children}</th>;
}
function Td({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <td style={{ ...s.td, textAlign: r ? "right" : "left" }}>{children}</td>;
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  yearSel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  printBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  report: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "28px 32px" },
  header: { textAlign: "center", borderBottom: "2px solid #1a3a5c", paddingBottom: 14, marginBottom: 20 },
  brand: { display: "inline-flex", alignItems: "center", gap: 7, color: "#1a3a5c", fontWeight: 700, fontSize: 14 },
  h1: { margin: "8px 0 2px", fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  season: { fontSize: 15, color: "#445", fontWeight: 600 },
  generated: { fontSize: 12, color: "#889", marginTop: 4 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 },
  card: { background: "#f7fbfa", border: "1px solid #cfe6df", borderRadius: 9, padding: "10px 14px", textAlign: "center" },
  cardLbl: { display: "block", fontSize: 11, fontWeight: 700, color: "#667", textTransform: "uppercase", letterSpacing: 0.3 },
  cardVal: { fontSize: 19, fontWeight: 800 },
  narr: { fontSize: 13.5, color: "#334", lineHeight: 1.6, margin: "0 0 14px" },
  outRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 18 },
  outLbl: { fontSize: 12.5, fontWeight: 700, color: "#556" },
  outPill: { padding: "2px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 },
  h2: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, margin: "20px 0 8px", paddingBottom: 4, borderBottom: "1px solid #e2e8f0" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "6px 8px", borderBottom: "2px solid #cdd7e3", color: "#556", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { padding: "6px 8px", borderBottom: "1px solid #eef2f7", color: "#223" },
  totalRow: { background: "#f7fbfa" },
  inactive: { color: "#99a", fontSize: 11, fontWeight: 400 },
  muted: { color: "#889", fontSize: 14 },
};
