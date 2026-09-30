/**
 * CollegePrepPanel — the self-contained scholarship tracker embedded on a youth's
 * "College/Vo-Tech Prep" profile tab. Shows the youth's applications (with a
 * requirements checklist and outcomes), their Watchlist (scholarships they've
 * starred to apply for later), and eligible/open scholarships to consider. Reads
 * and writes are scoped to the profile's youth, so it works whether the youth,
 * a guardian, or a mentor is viewing (the backend authorizes all three).
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Star, ExternalLink, Check, Plus, Trash2, Square, CheckSquare, ArrowRight } from "lucide-react";
import { scholarshipsApi, STATUS_LABEL, STATUS_COLOR, type CollegeTracker, type TrackerApplication, type Scholarship, type AppRequirement } from "../api";

const todayISO = () => new Date().toISOString().slice(0, 10);
/** Readable date like "Nov 12, 2026"; falls back to the raw string. */
function fmtDate(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s.length > 10 ? s.replace(" ", "T") : s + "T00:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CollegePrepPanel({ memberId }: { memberId: number }) {
  const [data, setData] = useState<CollegeTracker | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    scholarshipsApi.tracker(memberId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={st.muted}>Loading…</p>;
  if (!data) return <p style={st.muted}>Couldn't load scholarship tracking.</p>;

  const { summary, applications, watchlist, eligible_open } = data;

  return (
    <div style={st.wrap}>
      <div style={st.intro}>
        <GraduationCap size={18} color="#5e35b1" />
        <span>Track college &amp; vo-tech scholarships — build your Watchlist, apply, and keep tabs on what each one needs.</span>
      </div>

      <div style={st.stats}>
        <Stat label="Applied" value={summary.applied} color="#1565c0" />
        <Stat label="Won" value={summary.won} color="#2e7d32" />
        <Stat label="Awarded" value={`$${(summary.total_awarded || 0).toLocaleString()}`} color="#00695c" />
      </div>

      {/* My Applications */}
      <Section title={`My Applications${applications.length ? ` (${applications.length})` : ""}`}>
        {applications.length === 0
          ? <p style={st.empty}>No applications yet. Mark one "I applied" from your Watchlist or the board below.</p>
          : applications.map((a) => <ApplicationCard key={a.id} app={a} memberId={memberId} onChange={load} />)}
      </Section>

      {/* Watchlist */}
      <Section title={`Watchlist${watchlist.length ? ` (${watchlist.length})` : ""}`}
        hint="Scholarships you're saving to apply for later — even if you're not eligible yet.">
        {watchlist.length === 0
          ? <p style={st.empty}>Nothing on your Watchlist. Star scholarships below (or on the board) to save them here.</p>
          : <div style={st.grid}>{watchlist.map((s) => (
              <ScholarshipMini key={s.id} sc={s} memberId={memberId} onChange={load} watched />
            ))}</div>}
      </Section>

      {/* Eligible & open discovery */}
      {eligible_open.length > 0 && (
        <Section title="Eligible & open for you" hint="Open right now and matching your grade/eligibility.">
          <div style={st.grid}>{eligible_open.map((s) => (
            <ScholarshipMini key={s.id} sc={s} memberId={memberId} onChange={load} />
          ))}</div>
        </Section>
      )}

      <Link to="/scholarships" style={st.boardLink}>Browse the full scholarship board <ArrowRight size={14} /></Link>
    </div>
  );
}

function ApplicationCard({ app, memberId, onChange }: { app: TrackerApplication; memberId: number; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [newReq, setNewReq] = useState("");
  const reqs = app.requirements ?? [];
  const done = reqs.filter((r) => r.is_complete).length;
  const preDecision = app.status === "interested" || app.status === "applied";

  async function toggleReq(r: AppRequirement) {
    await scholarshipsApi.updateRequirement(r.id, { is_complete: !r.is_complete }); onChange();
  }
  async function addReq() {
    if (!newReq.trim()) return;
    await scholarshipsApi.addRequirement(app.id, { label: newReq.trim() });
    setNewReq(""); setAdding(false); onChange();
  }

  return (
    <div style={st.appCard}>
      <div style={st.appTop}>
        <div style={{ minWidth: 0 }}>
          <div style={st.appName}>{app.scholarship_name}</div>
          {app.provider && <div style={st.appProvider}>{app.provider}</div>}
        </div>
        <span style={{ ...st.statusBadge, background: STATUS_COLOR[app.status] }}>{STATUS_LABEL[app.status]}</span>
      </div>

      <div style={st.appMeta}>
        {app.amount_awarded != null && <span style={st.wonChip}>🎉 ${app.amount_awarded.toLocaleString()} awarded</span>}
        {app.target_college && <span>→ {app.target_college}</span>}
        {app.applied_date && <span>Applied {app.applied_date}</span>}
        {app.decision_date && <span>· Decision {app.decision_date}</span>}
      </div>

      {/* Requirements checklist */}
      <div style={st.reqBox}>
        <div style={st.reqHead}>Requirements{reqs.length ? ` · ${done}/${reqs.length}` : ""}</div>
        {reqs.map((r) => (
          <div key={r.id} style={st.reqRow}>
            <button style={st.reqCheck} onClick={() => toggleReq(r)} title={r.is_complete ? "Mark not done" : "Mark done"}>
              {r.is_complete ? <CheckSquare size={15} color="#2e7d32" /> : <Square size={15} color="#94a3b8" />}
            </button>
            <span style={{ ...st.reqLabel, ...(r.is_complete ? st.reqDone : {}) }}>{r.label}{r.due_date ? ` · due ${r.due_date}` : ""}</span>
            <button style={st.reqDel} onClick={async () => { await scholarshipsApi.deleteRequirement(r.id); onChange(); }} title="Remove"><Trash2 size={12} /></button>
          </div>
        ))}
        {adding ? (
          <div style={st.reqAddRow}>
            <input style={st.reqInput} value={newReq} autoFocus placeholder="e.g. Essay, 2 recommendations, transcript…"
              onChange={(e) => setNewReq(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addReq(); }} />
            <button style={st.reqAddBtn} onClick={addReq} disabled={!newReq.trim()}><Check size={14} /></button>
          </div>
        ) : (
          <button style={st.reqAdd} onClick={() => setAdding(true)}><Plus size={12} /> Add requirement</button>
        )}
      </div>

      <div style={st.appActions}>
        {app.info_url && <a style={st.linkBtn} href={app.info_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Scholarship page</a>}
        {preDecision && (
          <button style={st.withdrawBtn} onClick={async () => { await scholarshipsApi.memberWithdraw(memberId, app.scholarship_id); onChange(); }}>
            Withdraw
          </button>
        )}
      </div>
    </div>
  );
}

function ScholarshipMini({ sc, memberId, onChange, watched }: { sc: Scholarship; memberId: number; onChange: () => void; watched?: boolean }) {
  const amount = sc.amount_min != null || sc.amount_max != null
    ? `$${(sc.amount_min ?? sc.amount_max)!.toLocaleString()}${sc.amount_max != null && sc.amount_max !== sc.amount_min ? `–$${sc.amount_max.toLocaleString()}` : ""}`
    : null;
  return (
    <div style={st.mini}>
      <div style={st.miniTop}>
        <div style={st.miniName}>{sc.name}</div>
        <button style={{ ...st.star, ...(watched ? st.starOn : {}) }}
          title={watched ? "On your Watchlist — click to remove" : "Add to Watchlist"}
          onClick={async () => { watched ? await scholarshipsApi.memberUnfollow(memberId, sc.id) : await scholarshipsApi.memberFollow(memberId, sc.id); onChange(); }}>
          <Star size={13} fill={watched ? "#f9a825" : "none"} />
        </button>
      </div>
      {sc.provider && <div style={st.miniProvider}>{sc.provider}</div>}
      {sc.suggested_by && (
        <div style={st.suggestedBox}>
          💡 Suggested by {sc.suggested_by}{sc.suggested_note ? `: ${sc.suggested_note}` : ""}
        </div>
      )}
      <div style={st.miniBadges}>
        {sc.eligible && <span style={st.eligBadge}>✅ Eligible</span>}
        {sc.is_open
          ? <span style={st.openBadge}>Open</span>
          : (sc.open_date && sc.open_date > todayISO())
            ? <span style={st.upcomingBadge}>Opens {fmtDate(sc.open_date)}</span>
            : <span style={st.closedBadge}>Closed</span>}
        {amount && <span style={st.amtBadge}>{amount}</span>}
      </div>
      {sc.close_date && <div style={st.miniMeta}>📅 Deadline {fmtDate(sc.close_date)}</div>}
      <div style={st.miniActions}>
        {sc.info_url && <a style={st.linkBtn} href={sc.info_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Details</a>}
        <button style={st.appliedBtn} onClick={async () => { await scholarshipsApi.memberApply(memberId, sc.id, "applied"); onChange(); }}>I applied</button>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={st.section}>
      <div style={st.sectionHead}>{title}</div>
      {hint && <div style={st.sectionHint}>{hint}</div>}
      {children}
    </div>
  );
}
function Stat({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return <div style={st.statBox}><div style={{ ...st.statNum, color }}>{value}</div><div style={st.statLabel}>{label}</div></div>;
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  intro: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#556", background: "#f5f2fb", border: "1px solid #e3d9f5", borderRadius: 8, padding: "9px 12px", lineHeight: 1.4 },
  stats: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 },
  statBox: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", textAlign: "center" },
  statNum: { fontSize: 22, fontWeight: 800 },
  statLabel: { fontSize: 11.5, color: "#889", marginTop: 2 },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  sectionHead: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4 },
  sectionHint: { fontSize: 12, color: "#889", marginTop: -4, marginBottom: 2 },
  empty: { fontSize: 13, color: "#98a3b0", fontStyle: "italic", margin: "2px 0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 },
  appCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 13, display: "flex", flexDirection: "column", gap: 8 },
  appTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  appName: { fontSize: 15, fontWeight: 800, color: "#1a3a5c" },
  appProvider: { fontSize: 12, color: "#778", marginTop: 1 },
  statusBadge: { fontSize: 11, fontWeight: 700, color: "#fff", borderRadius: 10, padding: "2px 9px", whiteSpace: "nowrap", flexShrink: 0 },
  appMeta: { display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#667" },
  wonChip: { fontSize: 11.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "1px 8px" },
  reqBox: { background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 },
  reqHead: { fontSize: 11, fontWeight: 700, color: "#8a97a4", textTransform: "uppercase", letterSpacing: 0.3 },
  reqRow: { display: "flex", alignItems: "center", gap: 7 },
  reqCheck: { background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexShrink: 0 },
  reqLabel: { flex: 1, fontSize: 13, color: "#334" },
  reqDone: { textDecoration: "line-through", color: "#9aa7b4" },
  reqDel: { background: "none", border: "none", cursor: "pointer", color: "#c0392b", padding: 2, display: "flex" },
  reqAdd: { display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "2px 0" },
  reqAddRow: { display: "flex", gap: 6, alignItems: "center" },
  reqInput: { flex: 1, padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5 },
  reqAddBtn: { background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", display: "flex" },
  appActions: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  linkBtn: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#1565c0", textDecoration: "none", fontWeight: 600 },
  withdrawBtn: { padding: "5px 11px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" },
  mini: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 11, display: "flex", flexDirection: "column", gap: 6 },
  miniTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  miniName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", lineHeight: 1.3 },
  miniProvider: { fontSize: 11.5, color: "#778", marginTop: -2 },
  suggestedBox: { fontSize: 11.5, color: "#5e35b1", background: "#f5f2fb", border: "1px solid #e3d9f5", borderRadius: 6, padding: "5px 8px", lineHeight: 1.4 },
  star: { background: "#fff", border: "1px solid #e6d9a8", color: "#8a6d00", borderRadius: 14, padding: "3px 6px", cursor: "pointer", display: "flex", flexShrink: 0 },
  starOn: { background: "#fff8e1", borderColor: "#f9d976" },
  miniBadges: { display: "flex", flexWrap: "wrap", gap: 5 },
  eligBadge: { fontSize: 10.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 9, padding: "1px 7px" },
  openBadge: { fontSize: 10.5, fontWeight: 700, color: "#1565c0", background: "#e3f2fd", borderRadius: 9, padding: "1px 7px" },
  closedBadge: { fontSize: 10.5, fontWeight: 600, color: "#8a6d3b", background: "#fdf3e3", borderRadius: 9, padding: "1px 7px" },
  upcomingBadge: { fontSize: 10.5, fontWeight: 700, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 9, padding: "1px 7px" },
  amtBadge: { fontSize: 10.5, fontWeight: 700, color: "#00695c", background: "#e0f2f1", borderRadius: 9, padding: "1px 7px" },
  miniMeta: { fontSize: 11.5, color: "#667" },
  miniActions: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 },
  appliedBtn: { padding: "5px 11px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" },
  boardLink: { display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", color: "#5e35b1", fontWeight: 700, fontSize: 13, textDecoration: "none" },
  muted: { color: "#889", fontSize: 13.5 },
};
