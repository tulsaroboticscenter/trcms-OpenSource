import { useEffect, useState, useCallback } from "react";
import { GraduationCap, RefreshCw } from "lucide-react";
import { scholarshipsApi, type ScholarshipApplication, type ScholarshipFund, type ApplicationEnrollment } from "../scholarshipsApi";
import { useAuth } from "../../../core/AuthContext";

const STATUSES = ["pending", "under_review", "approved", "declined", "withdrawn"];
const STATUS_COLOR: Record<string, string> = {
  pending: "#1565c0", under_review: "#f57c00", approved: "#2e7d32", declined: "#c62828", withdrawn: "#888",
};

/** Admin review queue + decision + fund-drawing awards for scholarship applications. */
export default function ScholarshipReview() {
  const { canWrite } = useAuth();
  const canDelete = canWrite("scholarships.applications.delete");
  const [apps, setApps] = useState<ScholarshipApplication[]>([]);
  const [funds, setFunds] = useState<ScholarshipFund[]>([]);
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<ScholarshipApplication | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, f] = await Promise.all([
      scholarshipsApi.list(filter ? { status: filter } : undefined),
      scholarshipsApi.funds().catch(() => []),
    ]);
    setApps(a); setFunds(f); setLoading(false);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={s.head}>
        <h1 style={s.h1}><GraduationCap size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Scholarship Applications</h1>
        <button style={s.refresh} onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div style={s.filters}>
        <button style={{ ...s.chip, ...(filter === "" ? s.chipOn : {}) }} onClick={() => setFilter("")}>All</button>
        {STATUSES.map((st) => (
          <button key={st} style={{ ...s.chip, ...(filter === st ? s.chipOn : {}) }} onClick={() => setFilter(st)}>{st.replace("_", " ")}</button>
        ))}
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : apps.length === 0 ? <p style={s.muted}>No applications{filter ? ` with status "${filter}"` : ""} yet.</p> : (
        <div style={s.list}>
          {apps.map((a) => (
            <button key={a.id} style={s.row} onClick={() => setSel(a)}>
              <div>
                <div style={s.rowName}>{a.youth_name} <span style={s.rowProg}>· {a.program}</span></div>
                <div style={s.rowMeta}>{a.contact_name} · {a.contact_email} · requested ${(a.amount_requested ?? 0).toFixed(2)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {(a.awarded_total ?? 0) > 0 && <span style={s.awarded}>${a.awarded_total?.toFixed(2)} awarded</span>}
                <span style={{ ...s.badge, background: STATUS_COLOR[a.status] ?? "#888" }}>{a.status.replace("_", " ")}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {sel && <DetailModal appId={sel.id} funds={funds} canDelete={canDelete} onClose={() => setSel(null)} onChange={load} />}
    </div>
  );
}

function DetailModal({ appId, funds, canDelete, onClose, onChange }: { appId: number; funds: ScholarshipFund[]; canDelete: boolean; onClose: () => void; onChange: () => void }) {
  const [a, setA] = useState<ScholarshipApplication | null>(null);
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  // award form
  const [fundId, setFundId] = useState("");
  const [note, setNote] = useState("");
  // Enrollment picker: candidate enrollments (applicant + family siblings), the reviewer's
  // selection as enrollment_id -> amount, the applicant's member id, and a fund-only fallback.
  const [cands, setCands] = useState<ApplicationEnrollment[] | null>(null);
  const [applicantMid, setApplicantMid] = useState<number | null>(null);
  const [sel, setSel] = useState<Record<number, string>>({});
  const [plainAmount, setPlainAmount] = useState("");

  const reload = useCallback(async () => {
    const app = await scholarshipsApi.get(appId);
    setA(app); setNotes(app.review_notes ?? ""); setDecision(app.decision_amount != null ? String(app.decision_amount) : "");
  }, [appId]);
  const loadCands = useCallback(async () => {
    try {
      const r = await scholarshipsApi.applicationEnrollments(appId);
      setCands(r.enrollments); setApplicantMid(r.applicant_member_id || null);
    } catch { setCands([]); }
  }, [appId]);
  useEffect(() => { reload(); loadCands(); }, [reload, loadCands]);

  if (!a) return null;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  async function saveReview(status?: string) {
    setBusy("review");
    try {
      await scholarshipsApi.review(appId, { status, review_notes: notes, decision_amount: decision === "" ? null : parseFloat(decision) });
      await reload(); onChange(); flash("Saved.");
    } finally { setBusy(""); }
  }
  const picks = (cands ?? [])
    .filter((c) => c.enrollment_id in sel)
    .map((c) => ({ c, amt: parseFloat(sel[c.enrollment_id] || "0") }))
    .filter((x) => x.amt > 0);
  const pickTotal = picks.reduce((t, x) => t + x.amt, 0);

  function toggleEnrollment(c: ApplicationEnrollment) {
    setSel((prev) => {
      const next = { ...prev };
      if (c.enrollment_id in next) delete next[c.enrollment_id];
      else next[c.enrollment_id] = (c.balance > 0 ? c.balance : "").toString(); // default to the amount owed
      return next;
    });
  }
  const errMsg = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Award failed.";

  async function applyAward() {
    if (!fundId) { flash("Choose a fund to draw from."); return; }
    const fund = parseInt(fundId);
    if (picks.length === 0 && !(parseFloat(plainAmount) > 0)) {
      flash("Select at least one enrollment (or enter an amount for a fund-only award).");
      return;
    }
    setBusy("award");
    try {
      if (picks.length > 0) {
        // One award per selected enrollment — reuses the single-award primitive (which caps to
        // the enrollment's balance and the fund's available). Partial failures are surfaced.
        let ok = 0; let firstErr = "";
        for (const { c, amt } of picks) {
          try {
            await scholarshipsApi.award(appId, { fund_id: fund, amount: amt, member_id: c.member_id, enrollment_id: c.enrollment_id, note });
            ok++;
          } catch (e) { if (!firstErr) firstErr = errMsg(e); }
        }
        flash(firstErr ? `Applied ${ok} of ${picks.length}. ${firstErr}` : `Applied ${ok} award${ok === 1 ? "" : "s"}.`);
      } else {
        await scholarshipsApi.award(appId, { fund_id: fund, amount: parseFloat(plainAmount), member_id: a!.member_id ?? undefined, note });
        flash("Award applied.");
      }
      setSel({}); setPlainAmount(""); setNote("");
      await reload(); await loadCands(); onChange();
    } catch (e: unknown) { flash(errMsg(e)); }
    finally { setBusy(""); }
  }
  async function reverse(id: number) {
    if (!confirm("Reverse this award? It restores the fund balance and the youth's amount due.")) return;
    await scholarshipsApi.reverseAward(id); await reload(); onChange();
  }
  async function resend() {
    if (!confirm(`Email the scholarship team and send a "we received it" confirmation to ${a!.contact_email}?`)) return;
    setBusy("notify");
    try {
      const r = await scholarshipsApi.resendNotifications(appId);
      flash(`Sent — team: ${r.staff || "info box"}; applicant: ${r.applicant || "—"}.`);
    } catch (e: unknown) { flash((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not send."); }
    finally { setBusy(""); }
  }
  async function remove() {
    if (!confirm(`Delete ${a!.youth_name}'s application? This permanently removes it (use for a duplicate submission). This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await scholarshipsApi.remove(appId);
      onChange();
      onClose();
    } catch (e: unknown) { flash(errMsg(e)); }
    finally { setBusy(""); }
  }

  const Row = ({ l, v }: { l: string; v: React.ReactNode }) => (v ? <div style={s.dRow}><span style={s.dL}>{l}</span><span style={s.dV}>{v}</span></div> : null);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalH}>{a.youth_name} <span style={{ ...s.badge, background: STATUS_COLOR[a.status] }}>{a.status.replace("_", " ")}</span></h2>
          <button style={s.x} onClick={onClose}>×</button>
        </div>
        {msg && <div style={s.flash}>{msg}</div>}

        <div style={s.dSection}>
          <Row l="Category" v={a.choose_one} />
          <Row l="Program" v={a.program === "Other" ? a.program_other : a.program} />
          <Row l="Grade / school" v={a.youth_grade_school} />
          <Row l="Completed by" v={`${a.contact_name} · ${a.contact_email} · ${a.contact_phone}`} />
          <Row l="Household size" v={a.household_size ?? null} />
          <Row l="Youth enrolling" v={a.youth_count ?? null} />
          <Row l="Free/reduced lunch" v={a.frl_eligible ? a.frl_eligible : null} />
          <Row l="Can contribute" v={a.contribution_amount != null ? `$${a.contribution_amount.toFixed(2)} of $${(a.registration_cost ?? 240).toFixed(2)}` : null} />
          <Row l="Requested" v={a.amount_requested != null ? `$${a.amount_requested.toFixed(2)}` : null} />
          <Row l="Prior scholarship?" v={a.received_before == null ? null : a.received_before ? "Yes" : "No"} />
          <Row l="Explanation of need" v={a.need_explanation} />
          <Row l="What it means / goals" v={a.narrative} />
          <Row l="Referral" v={a.referral} />
          <Row l="Additional info" v={a.optional_info} />
        </div>

        <div style={s.block}>
          <h4 style={s.blockH}>Review</h4>
          <textarea style={s.area} rows={3} placeholder="Reviewer notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={s.reviewRow}>
            <label style={s.miniL}>Decision amount $<input style={s.mini} type="number" step="0.01" value={decision} onChange={(e) => setDecision(e.target.value)} /></label>
            <button style={s.saveBtn} disabled={busy === "review"} onClick={() => saveReview()}>Save notes</button>
            <button style={{ ...s.saveBtn, background: "#f57c00" }} disabled={busy === "review"} onClick={() => saveReview("under_review")}>Mark reviewing</button>
            <button style={{ ...s.saveBtn, background: "#2e7d32" }} disabled={busy === "review"} onClick={() => saveReview("approved")}>Approve</button>
            <button style={{ ...s.saveBtn, background: "#c62828" }} disabled={busy === "review"} onClick={() => saveReview("declined")}>Decline</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...s.saveBtn, background: "#5b6675" }} disabled={busy === "notify"} onClick={resend}>
              {busy === "notify" ? "Sending…" : "Resend notifications"}
            </button>
            <span style={{ fontSize: 12, color: "#778" }}>Emails the team and a “we received it” note to {a.contact_email}.</span>
            {canDelete && (
              <button style={{ ...s.saveBtn, background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", marginLeft: "auto" }}
                disabled={busy === "delete"} onClick={remove}
                title="Permanently delete this application (e.g. a duplicate). Reverse any award first.">
                {busy === "delete" ? "Deleting…" : "Delete application"}
              </button>
            )}
          </div>
        </div>

        <div style={s.block}>
          <h4 style={s.blockH}>Apply an award</h4>
          {(a.amount_requested != null || a.decision_amount != null) && (
            <div style={s.awardRef}>
              {a.amount_requested != null && <span>Requested <strong>${a.amount_requested.toFixed(2)}</strong></span>}
              {a.decision_amount != null && <span style={s.awardRefApproved}>Approved <strong>${a.decision_amount.toFixed(2)}</strong></span>}
              {a.decision_amount != null && picks.length > 0 && (
                <span style={{ color: Math.abs(pickTotal - a.decision_amount) < 0.005 ? "#2e7d32" : "#b45309", fontWeight: 700 }}>
                  {Math.abs(pickTotal - a.decision_amount) < 0.005 ? "✓ selection matches approved" : `selected $${pickTotal.toFixed(2)} of $${a.decision_amount.toFixed(2)}`}
                </span>
              )}
            </div>
          )}
          <div style={s.awardGrid}>
            <select style={s.in} value={fundId} onChange={(e) => setFundId(e.target.value)}>
              <option value="">Draw from fund…</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name} — ${f.available.toFixed(2)} available</option>)}
            </select>
            <input style={{ ...s.in, flex: 1 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* Pick the enrollment(s) to apply the award against — by youth + program, not a raw id. */}
          {cands === null ? (
            <p style={s.hint}>Loading enrollments…</p>
          ) : cands.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <p style={s.hint}>No active enrollment found for this applicant's family this season. You can still record a fund-only award:</p>
              <input style={{ ...s.in, width: 160 }} type="number" step="0.01" placeholder="Amount" value={plainAmount} onChange={(e) => setPlainAmount(e.target.value)} />
            </div>
          ) : (
            <div style={s.enrList}>
              <div style={s.enrHead}>Apply to enrollment{cands.length === 1 ? "" : "s"} <span style={s.enrHeadHint}>— check each youth to fund; the amount defaults to what they still owe</span></div>
              {cands.map((c) => {
                const on = c.enrollment_id in sel;
                const covered = c.balance <= 0; // nothing left to fund — no checkbox
                return (
                  <div key={c.enrollment_id} style={{ ...s.enrRow, ...(on ? s.enrRowOn : {}), ...(covered ? { opacity: 0.7 } : {}) }}>
                    <label style={{ ...s.enrLabel, ...(covered ? { cursor: "default" } : {}) }}>
                      {covered
                        ? <span style={{ color: "#2e7d32", fontWeight: 700, width: 16, textAlign: "center" }}>✓</span>
                        : <input type="checkbox" checked={on} onChange={() => toggleEnrollment(c)} />}
                      <span>
                        <strong>{c.youth_name}</strong>{c.member_id === applicantMid && <span style={s.applicantTag}>applicant</span>}
                        <span style={s.enrMeta}> · {c.program} · {covered ? "covered — no balance" : `$${c.balance.toFixed(2)} still due`}{c.status === "pending" ? " · pending" : ""}</span>
                      </span>
                    </label>
                    {on && !covered && (
                      <span style={s.enrAmtWrap}>$<input style={s.enrAmt} type="number" step="0.01" value={sel[c.enrollment_id]} onChange={(e) => setSel((p) => ({ ...p, [c.enrollment_id]: e.target.value }))} /></span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={s.awardActions}>
            {picks.length > 0 && <span style={s.awardTotal}>{picks.length} youth · ${pickTotal.toFixed(2)} total</span>}
            <button style={s.applyBtn} disabled={busy === "award"} onClick={applyAward}>{busy === "award" ? "Applying…" : "Apply award" + (picks.length > 1 ? "s" : "")}</button>
          </div>
          <p style={s.hint}>Each award draws from the selected fund and reduces that youth's amount due (capped to their balance and the fund's available).</p>

          {(a.awards ?? []).length > 0 && (
            <div style={s.awards}>
              {a.awards!.map((w) => (
                <div key={w.id} style={s.awardRow}>
                  <span>${w.amount.toFixed(2)} from <strong>{w.fund_name}</strong>{w.enrollment_id ? ` → enrollment #${w.enrollment_id}` : ""} {w.status === "reversed" && <em style={{ color: "#c62828" }}>(reversed)</em>}</span>
                  {w.status === "applied" && <button style={s.reverseBtn} onClick={() => reverse(w.id)}>Reverse</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  refresh: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, color: "#555" },
  filters: { display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 },
  chip: { border: "1px solid #cdd7e3", background: "#fff", color: "#556", borderRadius: 16, padding: "5px 13px", fontSize: 12.5, cursor: "pointer", textTransform: "capitalize" },
  chipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  muted: { color: "#889", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "12px 15px", cursor: "pointer", textAlign: "left", width: "100%" },
  rowName: { fontSize: 14.5, fontWeight: 700, color: "#1a3a5c" },
  rowProg: { fontWeight: 400, color: "#889" },
  rowMeta: { fontSize: 12.5, color: "#667", marginTop: 3 },
  awarded: { fontSize: 12, color: "#2e7d32", fontWeight: 600 },
  badge: { padding: "3px 10px", borderRadius: 11, color: "#fff", fontSize: 11, fontWeight: 700, textTransform: "capitalize", whiteSpace: "nowrap" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 24, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: 22, width: 620, maxWidth: "95vw", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalH: { fontSize: 18, fontWeight: 800, color: "#1a3a5c", margin: 0, display: "flex", alignItems: "center", gap: 10 },
  x: { background: "none", border: "none", fontSize: 26, color: "#889", cursor: "pointer", lineHeight: 1 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 6, padding: "7px 12px", fontSize: 13, marginBottom: 10 },
  dSection: { borderTop: "1px solid #eef2f6", paddingTop: 12, marginBottom: 12 },
  dRow: { display: "flex", gap: 12, padding: "5px 0", borderBottom: "1px solid #f4f6fa", fontSize: 13 },
  dL: { minWidth: 150, color: "#889", fontWeight: 600 },
  dV: { color: "#243", flex: 1, whiteSpace: "pre-wrap" },
  block: { background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 9, padding: 14, marginTop: 12 },
  blockH: { margin: "0 0 10px", fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  area: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box", resize: "vertical" },
  reviewRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 },
  miniL: { fontSize: 12.5, color: "#556", display: "flex", alignItems: "center", gap: 4 },
  mini: { width: 90, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 13 },
  saveBtn: { padding: "7px 12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  awardRef: { display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "#556", background: "#f6f9fc", border: "1px solid #e6edf4", borderRadius: 7, padding: "6px 12px", marginBottom: 10 },
  awardRefApproved: { color: "#2e7d32" },
  awardGrid: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, flex: "1 1 140px", minWidth: 120, boxSizing: "border-box" },
  applyBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  hint: { fontSize: 11.5, color: "#99a", margin: "8px 0 0" },
  enrList: { marginTop: 10, border: "1px solid #e6edf4", borderRadius: 8, overflow: "hidden" },
  enrHead: { fontSize: 11.5, fontWeight: 700, color: "#556", background: "#f6f9fc", padding: "6px 10px", borderBottom: "1px solid #e6edf4" },
  enrHeadHint: { fontWeight: 400, color: "#99a" },
  enrRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", borderTop: "1px solid #f1f5f9" },
  enrRowOn: { background: "#f2faf4" },
  enrLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#243", cursor: "pointer", flex: 1 },
  enrMeta: { color: "#778" },
  applicantTag: { fontSize: 10, fontWeight: 700, color: "#1565c0", background: "#e7f0fb", borderRadius: 5, padding: "1px 6px", marginLeft: 6, textTransform: "uppercase" },
  enrAmtWrap: { fontSize: 13, color: "#556", whiteSpace: "nowrap" },
  enrAmt: { width: 84, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, marginLeft: 3 },
  awardActions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 10 },
  awardTotal: { fontSize: 12.5, fontWeight: 700, color: "#2e7d32" },
  awards: { marginTop: 10, display: "flex", flexDirection: "column", gap: 6 },
  awardRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#243", padding: "6px 0", borderTop: "1px solid #eef2f6" },
  reverseBtn: { padding: "3px 10px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 10, fontSize: 11.5, cursor: "pointer" },
};
