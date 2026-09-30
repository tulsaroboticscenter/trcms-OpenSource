import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Star, ExternalLink, Check, Bell, Settings, BarChart3, Search } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";
import InlineHelp from "../../help/InlineHelp";
import { scholarshipsApi, type Scholarship } from "../api";
import TagYouthModal from "../components/TagYouthModal";
import { UserPlus } from "lucide-react";

const todayISO = () => new Date().toISOString().slice(0, 10);
/** Readable date like "Nov 12, 2026" from an ISO date; falls back to the raw string. */
function fmtDate(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s.length > 10 ? s.replace(" ", "T") : s + "T00:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Youth-facing scholarship board: browse, see eligibility, follow, and mark applied. */
export default function ScholarshipBoard() {
  const navigate = useNavigate();
  const { hasRole, isAdmin, canWrite } = useAuth();
  const canManage = isAdmin || canWrite("scholarships.manage") || hasRole("Admin", "System Administrator", "Mentor", "Executive Director");

  const [list, setList] = useState<Scholarship[]>([]);
  const [alerts, setAlerts] = useState<Scholarship[]>([]);
  const [stats, setStats] = useState<{ count: number; total_value: number; renewable_count: number } | null>(null);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState("");
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<"" | "eligible" | "following" | "open" | "dismissed">("");
  const [loading, setLoading] = useState(true);
  const [tagFor, setTagFor] = useState<Scholarship | null>(null);
  const [toast, setToast] = useState("");
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // Clicking an "open for you" chip clears filters (so the card is in the list),
  // then scrolls to it and flashes a bold green box for a few seconds.
  function goToScholarship(id: number) {
    setSearch(""); setSeason(""); setOnly("");
    setHighlightId(id);
  }
  useEffect(() => {
    if (highlightId == null) return;
    const el = document.getElementById(`sch-${highlightId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(null), 3500);
    return () => clearTimeout(t);
  }, [highlightId, list]);

  const load = useCallback(() => {
    setLoading(true);
    scholarshipsApi.board({ season: season || undefined, search: search || undefined, only: only || undefined })
      .then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, [season, search, only]);

  useEffect(() => {
    scholarshipsApi.seasons().then(setSeasons).catch(() => {});
    scholarshipsApi.alerts().then(setAlerts).catch(() => {});
    scholarshipsApi.stats().then(setStats).catch(() => {});
  }, []);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  async function toggleFollow(s: Scholarship) {
    s.following ? await scholarshipsApi.unfollow(s.id) : await scholarshipsApi.follow(s.id);
    load(); scholarshipsApi.alerts().then(setAlerts).catch(() => {});
  }
  async function markApplied(s: Scholarship) {
    await scholarshipsApi.apply(s.id, "applied"); load(); scholarshipsApi.alerts().then(setAlerts).catch(() => {});
  }
  async function dismiss(s: Scholarship, reason: "not_eligible" | "not_applying") {
    await scholarshipsApi.dismiss(s.id, reason);
    load(); scholarshipsApi.alerts().then(setAlerts).catch(() => {});
  }
  async function undismiss(s: Scholarship) {
    await scholarshipsApi.undismiss(s.id);
    load(); scholarshipsApi.alerts().then(setAlerts).catch(() => {});
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={s.head}>
        <h1 style={s.h1}><GraduationCap size={24} style={{ verticalAlign: -4, marginRight: 8 }} />College Scholarships <InlineHelp helpKey="college-scholarships" /></h1>
        {canManage && (
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.secBtn} onClick={() => navigate("/scholarships/reports")}><BarChart3 size={15} /> Reports</button>
            <button style={s.primBtn} onClick={() => navigate("/scholarships/manage")}><Settings size={15} /> Manage</button>
          </div>
        )}
      </div>
      <p style={s.sub}>Browse outside college scholarship opportunities to apply for. Follow the ones you're interested in to be reminded when they open, and mark the ones you've applied to. (This is separate from TRC's internal dues scholarship.)</p>

      {stats && (
        <div style={s.statBar}>
          <div style={s.statBox}><div style={s.statNum}>{stats.count.toLocaleString()}</div><div style={s.statLabel}>Scholarships</div></div>
          <div style={s.statBox}><div style={{ ...s.statNum, color: "#2e7d32" }}>${Math.round(stats.total_value).toLocaleString()}</div><div style={s.statLabel}>Total value</div></div>
          <div style={s.statBox}><div style={{ ...s.statNum, color: "#6a1b9a" }}>{stats.renewable_count.toLocaleString()}</div><div style={s.statLabel}>Renewable</div></div>
        </div>
      )}

      {alerts.length > 0 && (
        <div style={s.alertBox}>
          <div style={s.alertHead}><Bell size={16} /> {alerts.length} scholarship{alerts.length !== 1 ? "s" : ""} open for you right now</div>
          <div style={s.alertList}>
            {alerts.map((a) => (
              <button key={a.id} style={s.alertChip} onClick={() => goToScholarship(a.id)}
                title={a.eligible ? "You may be eligible — click to view" : "You're following this — click to view"}>
                {a.eligible ? "✅" : "⭐"} {a.name}{a.close_date ? ` · closes ${a.close_date}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={s.filters}>
        <div style={s.searchWrap}><Search size={15} color="#999" />
          <input style={s.search} placeholder="Search scholarships…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={s.sel} value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="">All seasons</option>
          {seasons.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <div style={s.chips}>
          {([["", "All"], ["open", "Open now"], ["eligible", "I'm eligible"], ["following", "Following"], ["dismissed", "Hidden"]] as const).map(([v, label]) => (
            <button key={v} style={{ ...s.chip, ...(only === v ? s.chipOn : {}) }} onClick={() => setOnly(v)}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : list.length === 0 ? (
        <div style={s.empty}>
          No scholarships found{only || season || search ? " for these filters" : " yet"}. {canManage && "Add some from Manage."}
          <div style={{ marginTop: 6 }}><InlineHelp helpKey="college-scholarships" label="Learn more" /></div>
        </div>
      ) : (
        <div style={s.grid}>
          {list.map((sc) => <ScholarshipCard key={sc.id} sc={sc} canManage={canManage} highlighted={highlightId === sc.id} onFollow={() => toggleFollow(sc)} onApplied={() => markApplied(sc)} onTag={() => setTagFor(sc)} onDismiss={(reason) => dismiss(sc, reason)} onRestore={() => undismiss(sc)} />)}
        </div>
      )}

      {tagFor && (
        <TagYouthModal scholarship={tagFor} onClose={() => setTagFor(null)}
          onDone={(msg) => { setTagFor(null); setToast(msg); setTimeout(() => setToast(""), 5000); }} />
      )}
      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function ScholarshipCard({ sc, canManage, highlighted, onFollow, onApplied, onTag, onDismiss, onRestore }: { sc: Scholarship; canManage?: boolean; highlighted?: boolean; onFollow: () => void; onApplied: () => void; onTag?: () => void; onDismiss?: (reason: "not_eligible" | "not_applying") => void; onRestore?: () => void }) {
  const amount = sc.amount_min != null || sc.amount_max != null
    ? `$${(sc.amount_min ?? sc.amount_max)!.toLocaleString()}${sc.amount_max != null && sc.amount_max !== sc.amount_min ? `–$${sc.amount_max.toLocaleString()}` : ""}`
    : null;
  const tags = (sc.elig_tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const applied = sc.my_status && sc.my_status !== "interested";
  return (
    <div id={`sch-${sc.id}`} style={{ ...s.card, ...(sc.eligible ? { borderColor: "#a5d6a7" } : {}), ...(highlighted ? s.cardHighlight : {}) }}>
      <div style={s.cardTop}>
        <div>
          <div style={s.cardName}>{sc.name}</div>
          {sc.provider && <div style={s.cardProvider}>{sc.provider}</div>}
        </div>
        <button style={{ ...s.followBtn, ...(sc.following ? s.followOn : {}) }} onClick={onFollow} title={sc.following ? "Following — click to unfollow" : "Follow to get reminders"}>
          <Star size={14} fill={sc.following ? "#f9a825" : "none"} /> {sc.following ? "Following" : "Follow"}
        </button>
      </div>

      <div style={s.badges}>
        {sc.eligible && <span style={s.eligBadge}>✅ You may be eligible</span>}
        {sc.is_open
          ? <span style={s.openBadge}>Open now</span>
          : (sc.open_date && sc.open_date > todayISO())
            ? <span style={s.upcomingBadge}>Opens {fmtDate(sc.open_date)}</span>
            : <span style={s.closedBadge}>Closed</span>}
        {amount && <span style={s.amtBadge}>{amount}</span>}
        {sc.renewable && <span style={s.renewBadge}>Renewable</span>}
      </div>

      {sc.description && <p style={s.cardDesc}>{sc.description}</p>}

      <div style={s.metaRow}>
        {sc.close_date && <span>📅 Deadline <strong>{fmtDate(sc.close_date)}</strong></span>}
        {sc.open_date && <span>Opens {fmtDate(sc.open_date)}</span>}
        {sc.season && <span>· {sc.season}</span>}
      </div>

      {(tags.length > 0 || sc.elig_notes) && (
        <div style={s.eligBox}>
          <span style={s.eligLabel}>Eligibility:</span>
          {tags.map((t) => <span key={t} style={s.tagChip}>{t}</span>)}
          {sc.elig_notes && <span style={s.eligNote}>{sc.elig_notes}</span>}
        </div>
      )}

      <div style={s.actions}>
        {sc.info_url && (
          <a style={s.linkBtn} href={sc.info_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} /> Learn more &amp; apply
          </a>
        )}
        {canManage && onTag && (
          <button style={s.tagBtn} onClick={onTag} title="Tag youth onto this scholarship (adds to their Watchlist)">
            <UserPlus size={13} /> Tag youth
          </button>
        )}
        {sc.dismissed ? (
          <span style={s.hiddenRow}>
            <span style={s.hiddenTag}>Hidden · {sc.dismiss_reason === "not_applying" ? "Not applying" : "Not eligible"}</span>
            {onRestore && <button style={s.undismissBtn} onClick={onRestore} title="Show this scholarship again">Restore</button>}
          </span>
        ) : (
          <>
            {onDismiss && <button style={s.dismissBtn} onClick={() => onDismiss("not_eligible")} title="I don't qualify for this one">Not eligible</button>}
            {onDismiss && <button style={s.dismissBtn} onClick={() => onDismiss("not_applying")} title="I qualify, but I'm not going to apply">Not applying</button>}
            {applied
              ? <span style={s.appliedTag}><Check size={13} /> Marked applied</span>
              : <button style={s.applyBtn} onClick={onApplied}>I applied</button>}
          </>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 },
  h1: { fontSize: 25, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 14px", lineHeight: 1.5 },
  secBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  primBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  statBar: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 },
  statBox: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", textAlign: "center" },
  statNum: { fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  statLabel: { fontSize: 11.5, color: "#889", marginTop: 2, textTransform: "uppercase" as const, letterSpacing: 0.4 },
  alertBox: { background: "#f3effa", border: "1px solid #d6c9ee", borderRadius: 10, padding: 12, marginBottom: 14 },
  alertHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "#5e35b1" },
  alertList: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  alertChip: { fontSize: 12.5, background: "#fff", border: "1px solid #e0d6f2", borderRadius: 14, padding: "3px 11px", color: "#4527a0", fontWeight: 500, cursor: "pointer" },
  filters: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 },
  searchWrap: { display: "flex", alignItems: "center", gap: 7, border: "1px solid #cdd7e3", borderRadius: 8, padding: "8px 11px", flex: 1, minWidth: 200 },
  search: { flex: 1, border: "none", outline: "none", fontSize: 13.5 },
  sel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5 },
  chips: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: { padding: "7px 12px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 16, fontSize: 12.5, fontWeight: 600, color: "#556", cursor: "pointer" },
  chipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 15, display: "flex", flexDirection: "column", gap: 9, transition: "box-shadow .2s, border-color .2s" },
  cardHighlight: { borderColor: "#2e7d32", boxShadow: "0 0 0 3px #2e7d32, 0 6px 18px rgba(46,125,50,0.25)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardName: { fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  cardProvider: { fontSize: 12.5, color: "#778", marginTop: 1 },
  followBtn: { display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fff", border: "1px solid #e6d9a8", color: "#8a6d00", borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  followOn: { background: "#fff8e1", borderColor: "#f9d976" },
  badges: { display: "flex", flexWrap: "wrap", gap: 6 },
  eligBadge: { fontSize: 11.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 10, padding: "2px 9px" },
  openBadge: { fontSize: 11.5, fontWeight: 700, color: "#1565c0", background: "#e3f2fd", borderRadius: 10, padding: "2px 9px" },
  closedBadge: { fontSize: 11.5, fontWeight: 600, color: "#8a6d3b", background: "#fdf3e3", borderRadius: 10, padding: "2px 9px" },
  upcomingBadge: { fontSize: 11.5, fontWeight: 700, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 10, padding: "2px 9px" },
  amtBadge: { fontSize: 11.5, fontWeight: 700, color: "#00695c", background: "#e0f2f1", borderRadius: 10, padding: "2px 9px" },
  renewBadge: { fontSize: 11.5, fontWeight: 600, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 10, padding: "2px 9px" },
  cardDesc: { fontSize: 13, color: "#445", lineHeight: 1.5, margin: 0 },
  metaRow: { display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#667" },
  eligBox: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", background: "#f8fafc", borderRadius: 8, padding: "7px 9px" },
  eligLabel: { fontSize: 11.5, fontWeight: 700, color: "#556" },
  tagChip: { fontSize: 11, color: "#37474f", background: "#eceff1", borderRadius: 8, padding: "1px 8px" },
  eligNote: { fontSize: 11.5, color: "#778", fontStyle: "italic" },
  actions: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4, flexWrap: "wrap" },
  linkBtn: { display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#1565c0", textDecoration: "none", fontWeight: 600 },
  applyBtn: { padding: "6px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  tagBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#f3effa", color: "#5e35b1", border: "1px solid #d6c9ee", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  dismissBtn: { padding: "6px 12px", background: "#fff", color: "#8a6d3b", border: "1px solid #e6d8bf", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  undismissBtn: { padding: "6px 12px", background: "#fff", color: "#1565c0", border: "1px solid #c5d9f0", borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  hiddenRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  hiddenTag: { fontSize: 12, fontWeight: 600, color: "#8a6d3b", background: "#fdf3e3", borderRadius: 8, padding: "3px 10px" },
  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1a3a5c", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.25)", zIndex: 1100 },
  appliedTag: { display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700, color: "#2e7d32" },
  muted: { color: "#889", fontSize: 13.5 },
  empty: { color: "#889", fontSize: 14, textAlign: "center", padding: "40px 0", background: "#fff", border: "1px dashed #d8e0ea", borderRadius: 12 },
};
