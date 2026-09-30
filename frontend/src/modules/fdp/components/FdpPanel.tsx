/**
 * FDP status on a member's profile. Read-only for the youth and their parent;
 * managers get the graduate action here too, so they don't have to go to the roster
 * page to act on someone they're already looking at.
 */
import { useCallback, useEffect, useState } from "react";
import { fdpApi, type FdpHistory, type FdpInterview } from "../api";
import FdpWorkPanel from "./FdpWorkPanel";
import { GraduationCap, CheckCircle, Award, FileText, MessageSquare, ShieldCheck, CalendarClock } from "lucide-react";

export default function FdpPanel({ memberId }: { memberId: number }) {
  const [data, setData] = useState<FdpHistory | null>(null);
  // The youth's own interviews — the same list the team sees, from their side.
  const [interviews, setInterviews] = useState<FdpInterview[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fdpApi.forMember(memberId).then(setData).catch(() => setData(null));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fdpApi.interviews({ member_id: memberId }).then(setInterviews).catch(() => setInterviews([]));
  }, [memberId]);

  if (!data) return null;

  const current = data.history.find((h) => h.enrollment_year === data.current_year);
  const graduatedRow = data.history.find((h) => h.status === "graduated");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr("");
    try { await fn(); load(); }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't work."); }
    finally { setBusy(false); }
  }

  // Nothing to show, and nothing the viewer could do about it.
  if (data.history.length === 0 && !data.can_manage) return null;

  return (
    <div>
      {data.has_graduated && graduatedRow ? (
        <div style={s.gradBox}>
          <CheckCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Graduated from the FIRST Development Program</strong>
            <div style={s.meta}>
              {graduatedRow.graduated_date ?? ""}{graduatedRow.graduated_by ? ` · ${graduatedRow.graduated_by}` : ""}
            </div>
            {graduatedRow.graduated_note && <div style={s.note}>{graduatedRow.graduated_note}</div>}
          </div>
        </div>
      ) : current ? (
        <div style={s.activeBox}>
          <GraduationCap size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <strong>In the FIRST Development Program</strong>
            <div style={s.meta}>
              Since {current.joined_date ?? "—"} · {current.year_label}
              {current.joined_source === "auto" && " · added with their FTC/FRC enrolment"}
            </div>
          </div>
          {data.can_manage && (
            <button style={s.btn} disabled={busy}
              onClick={() => act(() => fdpApi.graduate(current.id, {}))}>
              Graduate
            </button>
          )}
        </div>
      ) : data.can_manage ? (
        <div style={s.emptyBox}>
          <span>Not in the FIRST Development Program this season.</span>
          <button style={s.btn} disabled={busy} onClick={() => act(() => fdpApi.assign(memberId))}>
            Add to the FDP
          </button>
        </div>
      ) : null}

      {/* Progress — what the youth has actually done. Visible to the youth, their
          parent/guardian and managers (the endpoint enforces that). Recording it is
          managers-only, done from the FDP roster page. */}
      {(data.history.length > 0 || data.progress?.eligible_for_interview) && (
        <div style={s.progress}>
          <div style={s.progressH}>Development progress</div>
          <div style={s.statRow}>
            <span style={s.stat}><Award size={13} /> {data.certifications_completed} certification{data.certifications_completed === 1 ? "" : "s"}</span>
            <span style={s.stat}><FileText size={13} /> {data.progress?.has_resume ? "Resume on file" : "No resume yet"}</span>
            <span style={s.stat}><MessageSquare size={13} /> {data.interviews} interview{data.interviews === 1 ? "" : "s"}</span>
          </div>

          {data.progress?.eligible_for_interview ? (
            <div style={s.eligible}>
              <ShieldCheck size={14} />
              <span>
                Passed the board of review{data.progress.board_review_date ? ` on ${data.progress.board_review_date}` : ""}
                {data.progress.board_review_by ? ` · ${data.progress.board_review_by}` : ""} — eligible to interview with a team.
              </span>
            </div>
          ) : data.progress?.board_review_outcome ? (
            <div style={s.pending}>
              Board of review recorded as <strong>{data.progress.board_review_outcome === "not_yet" ? "not yet" : data.progress.board_review_outcome}</strong>
              {data.progress.board_review_date ? ` on ${data.progress.board_review_date}` : ""}.
              {data.progress.board_review_notes ? ` ${data.progress.board_review_notes}` : ""}
            </div>
          ) : data.progress?.board_review_pending && data.progress.board_review_scheduled_at ? (
            <div style={s.scheduled}>
              <CalendarClock size={13} />
              <span>
                Board of review scheduled for{" "}
                <strong>{new Date(data.progress.board_review_scheduled_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
                {data.progress.board_review_location ? ` · ${data.progress.board_review_location}` : ""}.
              </span>
            </div>
          ) : (
            <div style={s.pending}>Board of review not held yet — it's what makes a youth eligible to interview with a team.</div>
          )}

          {data.progress?.board_review_scores && Object.keys(data.progress.board_review_scores).length > 0 && (
            <div style={s.scores}>
              {Object.entries(data.progress.board_review_scores).map(([crit, n]) => (
                <span key={crit} style={s.scoreItem}>{crit} <strong>{n}/4</strong></span>
              ))}
            </div>
          )}

          {interviews.length > 0 && (
            <div style={s.interviews}>
              <div style={s.intH}>Team interviews</div>
              {interviews.map((iv) => (
                <div key={iv.id} style={s.intRow}>
                  <span style={s.intTeam}>{iv.team}</span>
                  <span style={s.intStatus}>
                    {iv.status === "scheduled" && iv.scheduled_at
                      ? new Date(iv.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                      : iv.status}
                    {iv.location ? ` · ${iv.location}` : ""}
                  </span>
                  {iv.outcome === "offered" && <span style={s.offered}>offered a spot</span>}
                  {iv.direction === "youth" && <span style={s.intChip}>you asked</span>}
                </div>
              ))}
            </div>
          )}

          {data.progress?.resume_url ? (
            <a href={data.progress.resume_url} target="_blank" rel="noopener noreferrer" style={s.resumeLink}>
              View resume
            </a>
          ) : data.progress?.resume_builder_complete ? (
            <a href={`/resume/member/${memberId}`} style={s.resumeLink}>
              View resume
            </a>
          ) : null}
        </div>
      )}

      <FdpWorkPanel memberId={memberId} />

      {data.history.length > 1 && (
        <div style={s.history}>
          <div style={s.historyH}>Earlier seasons</div>
          {data.history.filter((h) => h.enrollment_year !== data.current_year).map((h) => (
            <div key={h.id} style={s.historyRow}>
              <span>{h.year_label}</span>
              <span style={s.historyStatus}>{h.status === "graduated" ? "Graduated" : "In the program"}</span>
            </div>
          ))}
        </div>
      )}
      {err && <div style={s.err}>{err}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  gradBox: { display: "flex", gap: 9, background: "#f1f8f4", border: "1px solid #a5d6a7", borderRadius: 8, padding: "12px 14px", fontSize: 13.5, color: "#2e5b3e", lineHeight: 1.5 },
  activeBox: { display: "flex", gap: 9, alignItems: "flex-start", background: "#f7fafc", border: "1px solid #cdd7e3", borderRadius: 8, padding: "12px 14px", fontSize: 13.5, color: "#1a3a5c", lineHeight: 1.5 },
  emptyBox: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: "#7a8899" },
  meta: { fontSize: 12, color: "#7a8899", marginTop: 2 },
  note: { fontSize: 12.5, color: "#4a5b6d", marginTop: 5, fontStyle: "italic" },
  btn: { padding: "6px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, fontSize: 12.5, fontWeight: 600, color: "#1a3a5c", cursor: "pointer", whiteSpace: "nowrap" },
  progress: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #eef2f6" },
  progressH: { fontSize: 11, fontWeight: 800, color: "#8b98a6", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7 },
  statRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  stat: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#33475b", background: "#f2f5f8", borderRadius: 12, padding: "3px 10px" },
  scheduled: { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, color: "#1565c0", background: "#eef4fc", border: "1px solid #c5d9f2", borderRadius: 8, padding: "8px 10px", lineHeight: 1.45 },
  eligible: { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 8, padding: "8px 10px", lineHeight: 1.45 },
  pending: { fontSize: 12.5, color: "#7a8899", lineHeight: 1.45 },
  scores: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 },
  scoreItem: { fontSize: 11.5, color: "#445", background: "#f0f4f8", borderRadius: 6, padding: "2px 8px" },
  interviews: { marginTop: 10 },
  intH: { fontSize: 11, fontWeight: 800, color: "#8b98a6", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  intRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: "#33475b", padding: "4px 0", borderTop: "1px solid #eef2f6" },
  intTeam: { fontWeight: 600 },
  intStatus: { color: "#7a8899" },
  offered: { fontSize: 10.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 10, padding: "1px 8px" },
  intChip: { fontSize: 11.5, color: "#33475b", background: "#eceff1", borderRadius: 10, padding: "2px 9px" },
  resumeLink: { display: "inline-block", marginTop: 8, fontSize: 12.5, color: "#1565c0" },
  history: { marginTop: 12 },
  historyH: { fontSize: 11, fontWeight: 800, color: "#8b98a6", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  historyRow: { display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#5a6b7d", padding: "4px 0", borderTop: "1px solid #eef2f6" },
  historyStatus: { fontWeight: 600 },
  err: { marginTop: 10, fontSize: 12.5, color: "#c62828" },
};
