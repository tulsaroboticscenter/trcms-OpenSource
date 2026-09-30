/**
 * ScholarshipFunds — the scholarship fund LEDGER (Phase 3). Each fund is a per-season
 * General-Fund allocation set by the Program Committee (renewed annually, augmentable
 * mid-year, no carryover), DECOUPLED from sponsor money. Shows allocations (deposits:
 * who/when/amount), awards (recipient/amount/date + did they enroll), a live available
 * balance = allocations − applied awards, and annual paid-out history for grant writing.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { scholarshipsApi, money, type FundLedger, type ExpiringAwards, type AwardExpiry, type SeasonCloseout } from "../api";
import { ArrowLeft, Plus, GraduationCap, ChevronDown, ChevronRight, AlertTriangle, RotateCcw, CheckCircle2, ClipboardCheck } from "lucide-react";

const OUTCOME: Record<string, { label: string; bg: string; fg: string }> = {
  enrolled: { label: "Enrolled", bg: "#e6f4ea", fg: "#1b7a3d" },
  pending: { label: "Pending", bg: "#fff4e0", fg: "#a86a00" },
  not_enrolled: { label: "Not enrolled", bg: "#fdecea", fg: "#b5372a" },
  none: { label: "—", bg: "#eef2f7", fg: "#889" },
};

// P4: derived expiry state of an applied award. 'secured'/'closed' render nothing.
function expiryBadge(e: AwardExpiry): { label: string; bg: string; fg: string } | null {
  if (e.state === "expired") return { label: "Expired", bg: "#fdecea", fg: "#b5372a" };
  if (e.state === "expiring_soon") return { label: `${e.days_left}d left`, bg: "#fff4e0", fg: "#a86a00" };
  if (e.state === "active" && e.days_left != null) return { label: `${e.days_left}d left`, bg: "#eef4fb", fg: "#3a6ea5" };
  return null;
}

export default function ScholarshipFunds() {
  const navigate = useNavigate();
  const goBack = useGoBack("/admin");
  const { canWrite } = useAuth();
  const canFund = canWrite("sponsors.manage");
  const canDeposit = canWrite("scholarships.applications");
  const [data, setData] = useState<FundLedger | null>(null);
  const [attn, setAttn] = useState<ExpiringAwards | null>(null);
  const [closeout, setCloseout] = useState<SeasonCloseout | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", description: "" });
  const [depAmt, setDepAmt] = useState("");
  const [depNote, setDepNote] = useState("");
  const [err, setErr] = useState("");
  const [clawing, setClawing] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    scholarshipsApi.fundLedger({ year: year ?? undefined, fund_id: expanded ?? undefined })
      .then((d) => { setData(d); if (year === null) setYear(d.year); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    scholarshipsApi.expiringAwards({ year: year ?? undefined }).then(setAttn).catch(() => setAttn(null));
    scholarshipsApi.seasonCloseout(year ?? undefined).then(setCloseout).catch(() => setCloseout(null));
  }, [year, expanded]);
  useEffect(() => { load(); }, [load]);

  async function reclaim(awardId: number, recipient: string | null) {
    if (!window.confirm(`Reclaim this expired scholarship${recipient ? ` for ${recipient}` : ""}? The money returns to the fund and the family's balance is restored.`)) return;
    setClawing(awardId);
    try { await scholarshipsApi.clawBack(awardId); load(); }
    catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      window.alert(ax.response?.data?.detail ?? "Could not reclaim the award.");
    } finally { setClawing(null); }
  }

  async function addFund() {
    if (!f.name.trim()) return;
    await scholarshipsApi.createFund(f); setF({ name: "", description: "" }); setAdding(false); load();
  }
  async function toggleFund(id: number, isActive: boolean) { await scholarshipsApi.updateFund(id, { is_active: !isActive }); load(); }
  async function addDeposit(fundId: number) {
    const amt = parseFloat(depAmt);
    if (!amt) { setErr("Enter an amount."); return; }
    setErr("");
    try {
      await scholarshipsApi.addAllocation(fundId, { year: year ?? undefined, amount: amt, note: depNote || undefined });
      setDepAmt(""); setDepNote(""); load();
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not add the deposit.");
    }
  }

  const yearOpts = year ? [year + 1, year, year - 1, year - 2] : [];
  const detail = data?.detail;

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Admin</button>
      <div style={s.head}>
        <h1 style={s.h1}><GraduationCap size={22} /> Scholarship Funds</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {year !== null && (
            <select style={s.yearSel} value={year} onChange={(e) => { setYear(Number(e.target.value)); setExpanded(null); }}>
              {yearOpts.map((y) => <option key={y} value={y}>{y}–{y + 1}</option>)}
            </select>
          )}
          <button style={{ ...s.newBtn, background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3" }} onClick={() => navigate("/admin/scholarship-funds/board-report")}>Board report</button>
          <button style={{ ...s.newBtn, background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3" }} onClick={() => navigate("/admin/scholarship-applications")}>Review applications</button>
          {canFund && <button style={s.newBtn} onClick={() => setAdding(true)}><Plus size={16} /> New Fund</button>}
        </div>
      </div>
      <p style={s.sub}>Each fund is a per-season allocation from the General Fund (set by the Program Committee). <strong>Available = allocations − awards.</strong> Sponsor dollars are tracked separately and shown as context.</p>

      {data && (
        <div style={s.totalRow}>
          <Tot label="Allocated" val={data.totals.allocated} color="#1a3a5c" />
          <Tot label="Awarded" val={data.totals.awarded} color="#a86a00" />
          <Tot label="Available" val={data.totals.available} color="#00695c" />
        </div>
      )}

      {/* Season close-out (P6) — end-of-year readiness before the season rollover. */}
      {closeout && (
        <div style={{ ...s.closeout, borderColor: closeout.ready ? "#cfe6df" : "#f3d9a0", background: closeout.ready ? "#f7fbfa" : "#fffaf0" }}>
          <div style={s.closeoutHead}>
            {closeout.ready ? <CheckCircle2 size={15} color="#00695c" /> : <ClipboardCheck size={15} color="#a86a00" />}
            <span style={s.closeoutTitle}>Season close-out — {closeout.year_label}</span>
            <span style={s.closeoutState}>{closeout.ready ? "Ready to roll over" : "Needs attention before rollover"}</span>
          </div>
          <div style={s.closeoutRow}>
            <span><strong>{money(closeout.unspent)}</strong> unspent <span style={s.closeoutHint}>(forfeited — does not carry forward)</span></span>
            {closeout.reclaimable.count > 0
              ? <span style={s.closeoutWarn}>{closeout.reclaimable.count} award{closeout.reclaimable.count === 1 ? "" : "s"} to reclaim ({money(closeout.reclaimable.amount)})</span>
              : <span style={s.closeoutOk}>No awards left to reclaim</span>}
            {closeout.open_applications > 0
              ? <span style={s.closeoutWarn}>{closeout.open_applications} undecided application{closeout.open_applications === 1 ? "" : "s"}</span>
              : <span style={s.closeoutOk}>All applications decided</span>}
          </div>
        </div>
      )}

      {attn && (attn.counts.expired > 0 || attn.counts.expiring_soon > 0) && (
        <div style={s.attn}>
          <div style={s.attnHead}>
            <AlertTriangle size={16} color="#b5372a" />
            <span style={s.attnTitle}>Awards needing attention</span>
            <span style={s.attnMeta}>
              {attn.counts.expired > 0 && <>{attn.counts.expired} expired · {money(attn.reclaimable)} reclaimable</>}
              {attn.counts.expired > 0 && attn.counts.expiring_soon > 0 && " · "}
              {attn.counts.expiring_soon > 0 && <>{attn.counts.expiring_soon} expiring soon</>}
            </span>
          </div>
          {attn.awards.filter((a) => a.expiry.state === "expired").map((a) => (
            <div key={a.id} style={s.attnRow}>
              <span style={s.attnMain}>
                {a.recipient ?? "—"} <strong>{money(a.amount)}</strong>
                <span style={{ ...s.outcome, background: "#fdecea", color: "#b5372a", marginLeft: 8 }}>Expired {a.expiry.days_left != null ? `${Math.abs(a.expiry.days_left)}d ago` : ""}</span>
              </span>
              <span style={s.attnSub}>
                {a.fund_name ?? "—"} · granted {a.created_at?.slice(0, 10)}
                {canDeposit && (
                  <button style={s.reclaimBtn} disabled={clawing === a.id} onClick={() => reclaim(a.id, a.recipient)}>
                    <RotateCcw size={12} /> {clawing === a.id ? "Reclaiming…" : "Reclaim"}
                  </button>
                )}
              </span>
            </div>
          ))}
          {attn.counts.expiring_soon > 0 && attn.counts.expired === 0 && (
            <div style={s.attnNote}>No awards are past their 30-day deadline yet — check back as the dates approach.</div>
          )}
        </div>
      )}

      {adding && (
        <div style={s.addForm}>
          <input style={s.in} placeholder="Fund name (e.g. General Scholarship)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input style={s.in} placeholder="Description (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div style={s.formActions}>
            <button style={s.cancel} onClick={() => setAdding(false)}>Cancel</button>
            <button style={s.save} onClick={addFund}>Create fund</button>
          </div>
        </div>
      )}

      {loading ? <p style={s.muted}>Loading…</p> : !data || data.funds.length === 0 ? <p style={s.muted}>No scholarship funds yet.</p> : (
        data.funds.map((fund) => {
          const open = expanded === fund.id;
          return (
            <div key={fund.id} style={{ ...s.card, ...(fund.is_active ? {} : s.inactive) }}>
              <div style={s.cardHead} onClick={() => setExpanded(open ? null : fund.id)}>
                <span style={s.chev}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                <div style={{ flex: 1 }}>
                  <div style={s.fundName}>{fund.name}{!fund.is_active && <span style={s.inactiveTag}>inactive</span>}</div>
                  <div style={s.fundMeta}>
                    Allocated {money(fund.allocated)} · Awarded {money(fund.awarded)}
                    {fund.sponsor_support > 0 && <span style={s.sponsorNote}> · sponsor support {money(fund.sponsor_support)}</span>}
                  </div>
                </div>
                <div style={s.available}><span style={s.availLbl}>Available</span>{money(fund.available)}</div>
              </div>

              {open && (
                <div style={s.detail}>
                  {canFund && <button style={s.toggleBtn} onClick={() => toggleFund(fund.id, fund.is_active)}>{fund.is_active ? "Deactivate fund" : "Reactivate fund"}</button>}

                  {/* Deposits */}
                  <div style={s.secTitle}>Allocations / deposits ({year}–{(year ?? 0) + 1})</div>
                  {canDeposit && (
                    <div style={s.depForm}>
                      <input style={{ ...s.in, width: 120 }} type="number" step="0.01" placeholder="Amount" value={depAmt} onChange={(e) => setDepAmt(e.target.value)} />
                      <input style={{ ...s.in, flex: 1 }} placeholder="Note (e.g. Program Committee FY allocation)" value={depNote} onChange={(e) => setDepNote(e.target.value)} />
                      <button style={s.save} onClick={() => addDeposit(fund.id)}>Add deposit</button>
                    </div>
                  )}
                  {err && expanded === fund.id && <div style={s.err}>{err}</div>}
                  {detail && detail.fund_id === fund.id && (detail.allocations.length === 0
                    ? <div style={s.emptyRow}>No deposits this season.</div>
                    : detail.allocations.map((a) => (
                      <div key={a.id} style={s.row}>
                        <span style={s.rowMain}>{money(a.amount)}{a.source !== "general_fund" && <span style={s.tag}> {a.source}</span>}</span>
                        <span style={s.rowSub}>{a.note || ""}{a.by_name ? ` · ${a.by_name}` : ""}{a.allocated_at ? ` · ${a.allocated_at.slice(0, 10)}` : ""}</span>
                      </div>
                    )))}

                  {/* Awards */}
                  <div style={s.secTitle}>Awards</div>
                  {detail && detail.fund_id === fund.id && (detail.awards.length === 0
                    ? <div style={s.emptyRow}>No awards this season.</div>
                    : detail.awards.map((w) => {
                      const o = OUTCOME[w.outcome] ?? OUTCOME.none;
                      const xb = w.status === "applied" ? expiryBadge(w.expiry) : null;
                      return (
                        <div key={w.id} style={s.row}>
                          <span style={s.rowMain}>
                            {w.recipient ?? "—"} <strong>{money(w.amount)}</strong>
                            {w.status === "reversed" && <span style={s.reversed}> reversed</span>}
                            {w.status === "clawed_back" && <span style={s.reversed}> clawed back</span>}
                          </span>
                          <span style={s.rowSub}>
                            {w.created_at?.slice(0, 10)}
                            <span style={{ ...s.outcome, background: o.bg, color: o.fg }}>{o.label}</span>
                            {xb && <span style={{ ...s.outcome, background: xb.bg, color: xb.fg }}>{xb.label}</span>}
                          </span>
                        </div>
                      );
                    }))}

                  {/* History */}
                  {detail && detail.fund_id === fund.id && detail.history.length > 0 && (
                    <>
                      <div style={s.secTitle}>Annual history</div>
                      <div style={s.histWrap}>
                        <div style={{ ...s.histRow, fontWeight: 700, color: "#889" }}><span>Season</span><span>Allocated</span><span>Paid out</span></div>
                        {detail.history.map((h) => (
                          <div key={h.year} style={s.histRow}><span>{h.year}–{h.year + 1}</span><span>{money(h.allocated)}</span><span>{money(h.paid_out)}</span></div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function Tot({ label, val, color }: { label: string; val: number; color: string }) {
  return <div style={s.totCard}><span style={s.totLbl}>{label}</span><span style={{ ...s.totVal, color }}>{money(val)}</span></div>;
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  yearSel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  newBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 14px", lineHeight: 1.5 },
  totalRow: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  closeout: { border: "1px solid #cfe6df", borderRadius: 10, padding: "10px 14px", marginBottom: 16 },
  closeoutHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 },
  closeoutTitle: { fontWeight: 800, color: "#1a3a5c", fontSize: 13.5 },
  closeoutState: { fontSize: 12, fontWeight: 700, color: "#667", marginLeft: "auto" },
  closeoutRow: { display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#334", alignItems: "center" },
  closeoutHint: { color: "#99a", fontWeight: 400 },
  closeoutWarn: { color: "#a86a00", fontWeight: 700 },
  closeoutOk: { color: "#2e7d32", fontWeight: 600 },
  attn: { background: "#fff8f6", border: "1px solid #f3c9c0", borderRadius: 10, padding: "12px 16px", marginBottom: 16 },
  attnHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  attnTitle: { fontWeight: 800, color: "#8a2c20", fontSize: 14 },
  attnMeta: { fontSize: 12.5, color: "#a35", fontWeight: 600 },
  attnRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "7px 0", borderTop: "1px solid #f6ddd7", fontSize: 13.5, flexWrap: "wrap" },
  attnMain: { color: "#223", fontWeight: 600 },
  attnSub: { color: "#889", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 },
  reclaimBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#b5372a", color: "#fff", border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  attnNote: { fontSize: 12.5, color: "#a86a00", paddingTop: 8, borderTop: "1px solid #f6ddd7" },
  totCard: { flex: 1, minWidth: 140, background: "#f7fbfa", border: "1px solid #cfe6df", borderRadius: 10, padding: "12px 16px" },
  totLbl: { display: "block", fontSize: 12, fontWeight: 700, color: "#667", textTransform: "uppercase", letterSpacing: 0.4 },
  totVal: { fontSize: 22, fontWeight: 800 },
  addForm: { background: "#f8fafc", border: "1px dashed #cdd7e3", borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancel: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 8, overflow: "hidden" },
  inactive: { opacity: 0.65 },
  cardHead: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" },
  chev: { color: "#8aa" },
  fundName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  inactiveTag: { fontSize: 10.5, fontWeight: 700, color: "#889", background: "#f1f5f9", borderRadius: 5, padding: "1px 6px", textTransform: "uppercase" },
  fundMeta: { fontSize: 12.5, color: "#778", marginTop: 4 },
  sponsorNote: { color: "#99a" },
  available: { textAlign: "right", fontSize: 18, fontWeight: 800, color: "#00695c" },
  availLbl: { display: "block", fontSize: 10.5, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 },
  detail: { borderTop: "1px solid #eef2f7", background: "#fbfdfe", padding: "12px 16px" },
  toggleBtn: { background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, color: "#556", cursor: "pointer", marginBottom: 10 },
  secTitle: { fontSize: 11.5, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, margin: "12px 0 6px", paddingTop: 8, borderTop: "1px solid #eef2f7" },
  depForm: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  err: { color: "#b5372a", fontSize: 12.5, marginBottom: 6 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "6px 0", borderBottom: "1px solid #f2f6fa", fontSize: 13.5 },
  rowMain: { color: "#223", fontWeight: 600 },
  rowSub: { color: "#889", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, textAlign: "right" },
  tag: { fontSize: 11, color: "#889", fontWeight: 400 },
  reversed: { color: "#b5372a", fontSize: 11.5, fontWeight: 700 },
  outcome: { padding: "1px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700 },
  emptyRow: { color: "#99a", fontSize: 13, padding: "6px 0" },
  histWrap: { fontSize: 13 },
  histRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "4px 0", borderBottom: "1px solid #f2f6fa", color: "#334" },
  muted: { color: "#889", fontSize: 14 },
};
