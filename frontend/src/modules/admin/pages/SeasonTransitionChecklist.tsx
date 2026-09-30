/**
 * SeasonTransitionChecklist — Admin → Season Transition.
 * A tracked readiness checklist for rolling from one FIRST season to the next:
 * readiness items to verify first, transition steps to perform, and retained
 * items to confirm. Completion (who/when) is saved per (from → to) season pair.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { api } from "../../../core/api";
import { scholarshipsApi } from "../../scholarships/api";
import { ArrowLeft, CalendarClock, CheckCircle2, Circle, ExternalLink, ShieldCheck, ListChecks, Archive, CopyPlus } from "lucide-react";
import EnrollmentRolloverModal from "./EnrollmentRolloverModal";
import { useSeasons, seasonOptions } from "../../../core/useSeasons";

interface Item { key: string; phase: "readiness" | "transition" | "retained"; label: string; desc: string; link: string | null; action?: string | null }
interface ItemState { done?: boolean; done_at?: string; done_by_name?: string; notes?: string | null }
interface Checklist { from_season: string; to_season: string; items: Item[]; state: Record<string, ItemState> }

const PHASES: { key: Item["phase"]; title: string; blurb: string; icon: React.ReactNode; color: string }[] = [
  { key: "readiness",  title: "Readiness check", blurb: "Verify these BEFORE you transition.", icon: <ShieldCheck size={16} />, color: "#1565c0" },
  { key: "transition", title: "Transition steps", blurb: "Perform the rollover.", icon: <ListChecks size={16} />, color: "#e65100" },
  { key: "retained",   title: "Kept as-is", blurb: "Nothing to reset — just confirm.", icon: <Archive size={16} />, color: "#6a1b9a" },
];

const fmt = (d?: string) => d ? new Date(d.replace(" ", "T")).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function SeasonTransitionChecklist() {
  const navigate = useNavigate();
  const goBack = useGoBack("/admin");
  const [data, setData] = useState<Checklist | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Record<string, string>>({});
  const [actionErr, setActionErr] = useState<Record<string, boolean>>({});
  const [rolloverItem, setRolloverItem] = useState<Item | null>(null);
  const seasons = useSeasons();

  const errText = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;

  // In-step action runners — perform the step in place and check it off, so the
  // whole transition can be worked from this one page (no navigating away).
  async function runAction(item: Item) {
    if (!data) return;
    const from = data.from_season, to = data.to_season;
    const fromYear = parseInt((from || "").split("-")[0]);
    let confirmMsg = "", run: (() => Promise<string>) | null = null;

    // Reviewed bulk enrollment creation opens a roster modal rather than a confirm.
    if (item.action === "create_enrollments") { setRolloverItem(item); return; }

    switch (item.action) {
      case "create_team_seasons":
        confirmMsg = `Create a ${to} season for every active team? (Identity carries forward; budgets/robot/plan start blank. Teams that already have a ${to} season are skipped.)`;
        run = async () => { const { data: r } = await api.post("/api/v1/teams/seasons/create-all", { from_season: from, to_season: to }); return r.message ?? `Created ${r.created} team-season(s).`; };
        break;
      case "roll_scholarships":
        confirmMsg = `Clone active scholarships from ${from || "unseasoned"} into ${to}? (Dates are cleared on the copies.)`;
        run = async () => { const r = await scholarshipsApi.rollover(from, to); return `Cloned ${r.cloned} scholarship(s) into ${r.to_season}.`; };
        break;
      case "inventory_rollover":
        confirmMsg = `Archive ${from} BOMs & purchase orders and roll team resources into ${to}? Inventory/assets carry forward; new-season budgets start fresh. (Run after the ${to} team-seasons exist.)`;
        run = async () => {
          const { data: r } = await api.post(`/api/v1/inventory/season-rollover?season=${encodeURIComponent(from)}&to_season=${encodeURIComponent(to)}`);
          return `Archived ${r.boms_archived} BOM(s) and ${r.pos_archived} PO(s); rolled ${r.resources_copied_forward} resource(s) forward${r.resources_reset_blank ? `, ${r.resources_reset_blank} reset blank` : ""}.`;
        };
        break;
      case "repoint_grants":
        confirmMsg = `Move every grant marked for ${to} onto the ${to} team budgets? Grants marked for other seasons stay put. Amounts requested/awarded are preserved.`;
        run = async () => { const { data: r } = await api.post("/api/v1/grants/repoint-season", { from_season: from, to_season: to }); return r.message ?? `Moved ${r.links_moved} grant link(s).`; };
        break;
      case "repoint_fundraising":
        confirmMsg = `Point every fundraiser tagged "benefits ${to}" at the ${to} team budgets? Their team links move off ${from || "last season"} so earnings land on the right season. Earnings still only post when you finalize the event.`;
        run = async () => { const { data: r } = await api.post("/api/v1/events/fundraising/repoint-season", { to_season: to }); return r.message ?? `Moved ${r.team_links_moved} team link(s).`; };
        break;
      case "roll_rosters":
        confirmMsg = `Roll every team's roster forward from ${from || "last season"} into ${to}? Active members carry over (graduated/inactive are left off); FIRST reg & C&R reset for the new season. Members already on a ${to} roster are skipped.`;
        run = async () => { const { data: r } = await api.post("/api/v1/teams/seasons/roll-rosters", { from_season: from, to_season: to }); return r.message ?? `Rolled ${r.rolled} member(s) forward.`; };
        break;
      case "reset_team_first_reg":
        confirmMsg = `Reset FIRST registration & Consent/Release for all ${to} team-roster members so they re-collect for the new season? (Prior seasons stay on file.)`;
        run = async () => { const { data: r } = await api.post("/api/v1/teams/seasons/first-reg-reset", { season: to }); return r.message ?? `Reset ${r.reset} assignment(s).`; };
        break;
      case "reset_shirts":
        confirmMsg = `Clear the shirt size on every active member so it's re-collected for ${to}?`;
        run = async () => { const { data: r } = await api.post("/api/v1/enrollment/admin/reset-shirt-sizes"); return r.message ?? `Cleared shirt sizes for ${r.reset} member(s).`; };
        break;
      case "close_enrollment":
        confirmMsg = `Mark all active ${from} enrollments as expired? (Records stay on file.)`;
        run = async () => { const { data: r } = await api.post("/api/v1/enrollment/admin/close-season", { enrollment_year: fromYear }); return r.message ?? `Closed ${from}.`; };
        break;
      default: return;
    }

    if (!confirm(confirmMsg)) return;
    setBusy(item.key);
    try {
      const msg = await run();
      setActionMsg((p) => ({ ...p, [item.key]: msg }));
      setActionErr((p) => ({ ...p, [item.key]: false }));
      await toggle(item, true);   // check the step off
    } catch (e) {
      setActionMsg((p) => ({ ...p, [item.key]: errText(e, "Could not complete this step.") }));
      setActionErr((p) => ({ ...p, [item.key]: true }));
    } finally { setBusy(null); }
  }

  const load = useCallback((f?: string, t?: string) => {
    api.get("/api/v1/admin/season-transition", { params: { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) } })
      .then((r) => { setData(r.data); setFrom(r.data.from_season); setTo(r.data.to_season); })
      .catch(() => setData(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(item: Item, done: boolean) {
    if (!data) return;
    setBusy(item.key);
    try {
      const r = await api.post("/api/v1/admin/season-transition/item", { from: data.from_season, to: data.to_season, key: item.key, done });
      setData(r.data);
    } finally { setBusy(null); }
  }

  if (!data) return <div style={s.page}><p style={s.muted}>Loading…</p></div>;

  const readiness = data.items.filter((i) => i.phase === "readiness");
  const readyDone = readiness.filter((i) => data.state[i.key]?.done).length;
  const allReady = readyDone === readiness.length;
  const transition = data.items.filter((i) => i.phase === "transition");
  const transDone = transition.filter((i) => data.state[i.key]?.done).length;

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Admin</button>
      <div style={s.head}>
        <h1 style={s.h1}><CalendarClock size={22} /> Season Transition</h1>
        {/* Seasons come from Season Manager — this pair drives every "Run now" step
            below, so a typo'd season must not be possible. */}
        <div style={s.seasonPick}>
          <select style={s.seasonIn} value={from} onChange={(e) => setFrom(e.target.value)}>
            {seasonOptions(seasons, from).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <span style={s.arrow}>→</span>
          <select style={s.seasonIn} value={to} onChange={(e) => setTo(e.target.value)}>
            {seasonOptions(seasons, to).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <button style={s.loadBtn} onClick={() => load(from, to)}>Load</button>
        </div>
      </div>
      <p style={s.sub}>Track every step of moving the program from <strong>{data.from_season}</strong> to <strong>{data.to_season}</strong>. Most records are season-scoped, so last season stays on file while the new season starts fresh.</p>

      {/* Readiness gate */}
      <div style={{ ...s.gate, ...(allReady ? s.gateReady : {}) }}>
        {allReady ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        <strong>{allReady ? "Ready to transition" : "Not ready yet"}</strong>
        <span style={s.gateSub}>{readyDone}/{readiness.length} readiness items done · {transDone}/{transition.length} transition steps done</span>
      </div>

      {PHASES.map((ph) => {
        const items = data.items.filter((i) => i.phase === ph.key);
        return (
          <div key={ph.key} style={s.section}>
            <div style={{ ...s.sectionHead, color: ph.color }}>{ph.icon} {ph.title} <span style={s.blurb}>{ph.blurb}</span></div>
            <div style={s.list}>
              {items.map((it) => {
                const st = data.state[it.key] ?? {};
                return (
                  <div key={it.key} style={{ ...s.item, ...(it.action ? s.itemAction : {}), ...(st.done ? s.itemDone : {}) }}>
                    <button style={s.check} onClick={() => {
                      // Un-checking a step that already RAN is dangerous: re-running an
                      // action (roll scholarships, reset shirts/FIRST reg…) can duplicate
                      // or wipe data. Require an explicit confirmation.
                      if (st.done && it.action && !confirm(`“${it.label}” already ran${st.done_at ? ` on ${fmt(st.done_at)}` : ""}. Un-checking it re-enables the Run button so it can be run AGAIN — which may duplicate or wipe data. Only do this if you're sure you need to re-run it.\n\nUncheck anyway?`)) return;
                      toggle(it, !st.done);
                    }} disabled={busy === it.key} title={st.done ? "Mark not done" : "Mark done"}>
                      {st.done ? <CheckCircle2 size={20} color="#2e7d32" /> : <Circle size={20} color="#b0bcc9" />}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.itemLabel}>{it.label}</div>
                      <div style={s.itemDesc}>{it.desc}</div>
                      {it.action && actionMsg[it.key] && <div style={actionErr[it.key] ? s.actionErr : s.actionMsg}>{actionMsg[it.key]}</div>}
                      {st.done && st.done_by_name && <div style={s.itemBy}>✓ {st.done_by_name} · {fmt(st.done_at)}</div>}
                    </div>
                    {it.action
                      ? (st.done
                          ? <span style={s.ranTag} title="Already run — uncheck above to re-enable"><CheckCircle2 size={13} /> Ran</span>
                          : <button style={s.runBtn} onClick={() => runAction(it)} disabled={busy === it.key} title="Run this step now">
                              <CopyPlus size={13} /> {busy === it.key ? "Running…" : "Run now"}
                            </button>)
                      : it.link && <button style={s.openBtn} onClick={() => navigate(it.link!)} title="Open the tool for this step"><ExternalLink size={13} /> Open</button>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {rolloverItem && (
        <EnrollmentRolloverModal
          toSeason={data.to_season}
          onClose={() => setRolloverItem(null)}
          onCommitted={async (msg) => {
            setActionMsg((p) => ({ ...p, [rolloverItem.key]: msg }));
            await toggle(rolloverItem, true);
            setRolloverItem(null);
          }}
        />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  seasonPick: { display: "flex", alignItems: "center", gap: 6 },
  seasonIn: { width: 96, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, textAlign: "center" },
  arrow: { color: "#99a", fontWeight: 700 },
  loadBtn: { padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  sub: { color: "#667", fontSize: 14, margin: "6px 0 16px", lineHeight: 1.5 },
  muted: { color: "#888", fontSize: 14 },
  itemAction: { background: "#faf5fe", borderColor: "#e1bee7", borderLeft: "4px solid #8e24aa" },
  runBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", background: "#8e24aa", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" },
  ranTag: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 7, fontWeight: 700, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" },
  actionMsg: { fontSize: 12.5, color: "#2e7d32", fontWeight: 700, marginTop: 6 },
  actionErr: { fontSize: 12.5, color: "#c62828", fontWeight: 700, marginTop: 6 },
  gate: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderRadius: 10, marginBottom: 18, background: "#fff8e1", border: "1px solid #ffe0a3", color: "#8a5a00" },
  gateReady: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32" },
  gateSub: { marginLeft: "auto", fontSize: 12, fontWeight: 600, opacity: 0.85 },
  section: { marginBottom: 18 },
  sectionHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 800, marginBottom: 8 },
  blurb: { fontWeight: 400, color: "#99a", fontSize: 12 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  item: { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 },
  itemDone: { background: "#f6fbf7", borderColor: "#cfe9d3" },
  check: { background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexShrink: 0, marginTop: 1 },
  itemLabel: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  itemDesc: { fontSize: 13, color: "#556", marginTop: 3, lineHeight: 1.5 },
  itemBy: { fontSize: 11, color: "#2e7d32", fontWeight: 700, marginTop: 5 },
  openBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" },
};
