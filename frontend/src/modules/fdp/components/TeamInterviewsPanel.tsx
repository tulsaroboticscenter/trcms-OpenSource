/**
 * FDP interviews for one team, on the team page.
 *
 * Team leaders (planning.manage, on this team) request an interview with a youth who
 * has passed their board of review, then schedule it and record the outcome. Youth may
 * also request an interview with the team — those arrive here as "they asked us".
 *
 * Everyone who can see the team's roster can read this; the actions only appear for
 * people the server would let act anyway, so the UI matches the API rather than
 * guessing at permissions.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { fdpApi, type FdpInterview, type InterviewStatus, type EligibleMember, type TeamCertNeeds } from "../api";
import { CalendarClock, UserPlus, UserCheck, Check, X, MapPin, Award, FileText } from "lucide-react";

const STATUS_LABEL: Record<InterviewStatus, string> = {
  requested: "Requested", scheduled: "Scheduled", completed: "Completed",
  declined: "Declined", cancelled: "Cancelled",
};
const STATUS_COLOR: Record<InterviewStatus, string> = {
  requested: "#e65100", scheduled: "#1565c0", completed: "#2e7d32",
  declined: "#757575", cancelled: "#757575",
};
const OUTCOME_LABEL: Record<string, string> = {
  offered: "Offered a spot", not_selected: "Not selected", undecided: "Undecided",
};

const fmt = (s: string | null) => s
  ? new Date(s.length > 10 ? s : s + "T00:00:00").toLocaleString("en-US",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  : null;

export default function TeamInterviewsPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { canWrite } = useAuth();
  const canAct = canWrite("planning.manage") || canWrite("fdp.manage");

  const [rows, setRows] = useState<FdpInterview[]>([]);
  const [eligible, setEligible] = useState<EligibleMember[]>([]);
  const [needs, setNeeds] = useState<TeamCertNeeds | null>(null);
  const [editCerts, setEditCerts] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [schedFor, setSchedFor] = useState<FdpInterview | null>(null);
  const [when, setWhen] = useState("");
  const [where, setWhere] = useState("");

  const load = useCallback(() => {
    fdpApi.interviews({ team_season_id: teamSeasonId }).then(setRows).catch(() => setRows([]));
  }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fdpApi.teamCertNeeds(teamSeasonId).then(setNeeds).catch(() => setNeeds(null)); }, [teamSeasonId]);
  useEffect(() => {
    if (adding) {
      fdpApi.eligible(undefined, teamSeasonId).then((e) => setEligible(e.members)).catch(() => setEligible([]));
    }
  }, [adding, teamSeasonId, needs]);

  async function saveCertNeeds(ids: number[]) {
    setBusy(true); setErr("");
    try { const r = await fdpApi.setTeamCertNeeds(teamSeasonId, ids); setNeeds((n) => n ? { ...n, selected: r.selected } : n); }
    catch { setErr("Could not save the certification list."); }
    finally { setBusy(false); }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr("");
    try { await fn(); load(); }
    catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't work."); }
    finally { setBusy(false); }
  }

  const request = () => run(async () => {
    if (!pick) return;
    await fdpApi.requestInterview({ member_id: Number(pick), team_season_id: teamSeasonId, notes: note || undefined });
    setAdding(false); setPick(""); setNote("");
  });

  const schedule = () => run(async () => {
    if (!schedFor) return;
    await fdpApi.updateInterview(schedFor.id, {
      status: "scheduled", scheduled_at: when || undefined, location: where || undefined,
    });
    setSchedFor(null); setWhen(""); setWhere("");
  });

  // Only hide youth who already have an open interview with THIS team — the server
  // refuses a duplicate for the same pairing. Interviewing with other teams is fine:
  // a youth may be considered by several teams at once. (Youth already placed on a
  // team are excluded server-side by /fdp/eligible.)
  const openWithThisTeam = new Set(
    rows.filter((r) => ["requested", "scheduled"].includes(r.status)).map((r) => r.member_id));
  const pickable = eligible.filter((e) => !openWithThisTeam.has(e.member_id));

  return (
    <div>
      <p style={s.intro}>
        Interviews with youth in the FIRST Development Program. Youth become available once
        they pass their board of review, and drop off once they join a team — being
        interviewed by another team doesn&apos;t take them out of the running.
      </p>

      {needs && (needs.selected.length > 0 || needs.can_edit) && (
        <div style={s.certNeeds}>
          <div style={s.certHead}>
            <Award size={13} /> <span style={{ fontWeight: 700 }}>Certifications we want</span>
            {needs.can_edit && <button style={s.certEditBtn} onClick={() => setEditCerts((v) => !v)}>{editCerts ? "Done" : needs.selected.length ? "Edit" : "Set"}</button>}
          </div>
          {editCerts ? (
            <div style={s.certGrid}>
              {needs.catalog.map((c) => {
                const on = needs.selected.includes(c.id);
                return (
                  <label key={c.id} style={s.certOpt}>
                    <input type="checkbox" checked={on} disabled={busy}
                      onChange={() => saveCertNeeds(on ? needs.selected.filter((x) => x !== c.id) : [...needs.selected, c.id])} />
                    {c.name}
                  </label>
                );
              })}
            </div>
          ) : needs.selected.length === 0 ? (
            <span style={s.muted}>None set — pick the certs you want, then the candidate list shows who has them.</span>
          ) : (
            <div style={s.certList}>
              {needs.catalog.filter((c) => needs.selected.includes(c.id)).map((c) => <span key={c.id} style={s.certChip}>{c.name}</span>)}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && !adding && <p style={s.muted}>No interviews yet.</p>}

      <div style={s.list}>
        {rows.map((r) => (
          <div key={r.id} style={s.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.name}>
                <Link to={`/members/${r.member_id}`} style={s.link}>{r.member_name ?? `Member #${r.member_id}`}</Link>
                <span style={{ ...s.status, color: STATUS_COLOR[r.status], background: STATUS_COLOR[r.status] + "1a" }}>
                  {STATUS_LABEL[r.status]}
                </span>
                {r.direction === "youth" && <span style={s.dirChip}>they asked us</span>}
              </div>
              <div style={s.meta}>
                {r.scheduled_at
                  ? <><CalendarClock size={11} /> {fmt(r.scheduled_at)}{r.location ? <> · <MapPin size={11} /> {r.location}</> : null}</>
                  : <>Requested{r.requested_by ? ` by ${r.requested_by}` : ""}</>}
                {r.outcome && <> · <strong>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</strong></>}
              </div>
              {r.notes && <div style={s.note}>{r.notes}</div>}
            </div>

            {canAct && !["completed", "declined", "cancelled"].includes(r.status) && (
              <div style={s.actions}>
                <button style={s.btn} disabled={busy}
                  onClick={() => { setSchedFor(r); setWhen(r.scheduled_at?.slice(0, 16) ?? ""); setWhere(r.location ?? ""); }}>
                  {r.status === "scheduled" ? "Reschedule" : "Schedule"}
                </button>
                {r.status === "scheduled" && (
                  <button style={{ ...s.btn, ...s.btnOk }} disabled={busy}
                    onClick={() => run(() => fdpApi.updateInterview(r.id, { status: "completed", outcome: "offered" }))}>
                    <Check size={12} /> Offered
                  </button>
                )}
                <button style={s.icon} title="Cancel this interview" disabled={busy}
                  onClick={() => run(() => fdpApi.updateInterview(r.id, { status: "cancelled" }))}>
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Close the loop: once a spot is offered, place the youth on this team. */}
            {r.placed
              ? <span style={s.placedChip} title="On this team's roster"><UserCheck size={12} /> On roster</span>
              : (canAct && r.outcome === "offered" && (
                  <button style={{ ...s.btn, ...s.btnPlace }} disabled={busy} title="Add this youth to the team roster"
                    onClick={() => run(() => fdpApi.placeInterview(r.id))}>
                    <UserPlus size={12} /> Place on team
                  </button>
                ))}
          </div>
        ))}
      </div>

      {err && <div style={s.err}>{err}</div>}

      {canAct && (adding ? (
        <div style={s.addBox}>
          <label style={s.label}>Youth eligible to interview</label>
          {pickable.length === 0 ? (
            <p style={s.muted}>
              No eligible youth available. A youth becomes eligible once they pass their board
              of review, recorded on the FDP page.
            </p>
          ) : (
            <select style={s.input} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Select a youth…</option>
              {pickable.map((e) => (
                <option key={e.member_id} value={e.member_id}>
                  {e.name}{e.grade_label ? ` · ${e.grade_label}` : ""} — {e.certifications_completed} certs{e.has_resume ? ", resume" : ""}{e.cert_match ? ` · ${e.cert_match} wanted certs` : ""}
                </option>
              ))}
            </select>
          )}
          {pick && (() => {
            const y = pickable.find((e) => String(e.member_id) === pick);
            if (!y || (y.matched_certs.length === 0 && y.missing_certs.length === 0)) return null;
            return (
              <div style={s.matchLine}>
                {y.matched_certs.map((c) => <span key={c} style={s.matchOk}>✓ {c}</span>)}
                {y.missing_certs.map((c) => <span key={c} style={s.matchNo}>{c}</span>)}
              </div>
            );
          })()}
          {/* Resume link for the selected candidate — the linked/uploaded URL, or their
              in-app resume when they built one in the system (auto, no manual entry). */}
          {pick && (() => {
            const y = pickable.find((e) => String(e.member_id) === pick);
            if (!y || !y.has_resume) return null;
            const external = !!y.resume_url;
            const href = y.resume_url || `/resume/member/${y.member_id}`;
            return (
              <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} style={s.resumeLink}>
                <FileText size={12} style={{ verticalAlign: -2, marginRight: 3 }} />
                View {external ? "resume" : "in-app resume"}
              </a>
            );
          })()}
          <label style={s.label}>Note (optional)</label>
          <input style={s.input} value={note} placeholder="What the interview is for" onChange={(e) => setNote(e.target.value)} />
          <div style={s.addActions}>
            <button style={s.ghost} onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
            <button style={s.primary} disabled={busy || !pick} onClick={request}>Request interview</button>
          </div>
        </div>
      ) : (
        <button style={s.addBtn} onClick={() => setAdding(true)}><UserPlus size={14} /> Request an interview</button>
      ))}

      {schedFor && (
        <div style={s.modalWrap} onClick={() => setSchedFor(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>Schedule with {schedFor.member_name}</h3>
            <label style={s.label}>When</label>
            <input style={s.input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <label style={s.label}>Where</label>
            <input style={s.input} value={where} placeholder="e.g. Shop bay 2" onChange={(e) => setWhere(e.target.value)} />
            <div style={s.addActions}>
              <button style={s.ghost} onClick={() => setSchedFor(null)}>Cancel</button>
              <button style={s.primary} disabled={busy} onClick={schedule}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  intro: { fontSize: 13, color: "#667", margin: "0 0 12px", lineHeight: 1.5 },
  muted: { fontSize: 13, color: "#aaa", margin: "4px 0" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid #eef1f5", borderRadius: 9, background: "#fff", padding: "10px 12px" },
  name: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  link: { color: "#1a3a5c", textDecoration: "none" },
  status: { fontSize: 10.5, fontWeight: 700, borderRadius: 10, padding: "1px 8px" },
  dirChip: { fontSize: 10.5, color: "#5a6b7d", background: "#eef2f6", borderRadius: 10, padding: "1px 8px" },
  meta: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 11.5, color: "#7a8899", marginTop: 3 },
  note: { fontSize: 12.5, color: "#4a5b6d", marginTop: 4, fontStyle: "italic" },
  actions: { display: "flex", gap: 5, alignItems: "center", flexShrink: 0 },
  btn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#1a3a5c", cursor: "pointer", whiteSpace: "nowrap" },
  btnOk: { color: "#2e7d32", borderColor: "#a5d6a7" },
  btnPlace: { color: "#fff", background: "#2e7d32", borderColor: "#2e7d32", marginTop: 6 },
  certNeeds: { background: "#f8fafc", border: "1px solid #e6edf4", borderRadius: 8, padding: "8px 11px", marginBottom: 10 },
  certHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#445" },
  certEditBtn: { marginLeft: "auto", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  certGrid: { display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6 },
  certOpt: { display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#334", width: "calc(50% - 7px)" },
  certList: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 },
  certChip: { fontSize: 11, fontWeight: 600, color: "#4a5568", background: "#e8eef5", borderRadius: 5, padding: "2px 7px" },
  matchLine: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 },
  matchOk: { fontSize: 11, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 5, padding: "2px 7px" },
  matchNo: { fontSize: 11, fontWeight: 600, color: "#a15", background: "#fdecef", borderRadius: 5, padding: "2px 7px", textDecoration: "line-through" },
  placedChip: { display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 11.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 6, padding: "3px 8px" },
  icon: { background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: 4, cursor: "pointer", color: "#94a3b8", display: "inline-flex" },
  addBtn: { display: "flex", alignItems: "center", gap: 5, marginTop: 12, padding: "8px 14px", background: "#fff", color: "#1565c0", border: "1px dashed #90caf9", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  addBox: { marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 9, padding: 12, background: "#fafbfc" },
  addActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#5a6b7d", margin: "8px 0 4px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  ghost: { padding: "7px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 7, fontSize: 13, cursor: "pointer", color: "#4a5b6d" },
  primary: { padding: "8px 14px", background: "#00695c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  err: { marginTop: 10, fontSize: 12.5, color: "#c62828" },
  modalWrap: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, padding: "18px 20px", maxWidth: 420, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" },
  modalH: { margin: "0 0 6px", fontSize: 16, color: "#1a3a5c" },
};
