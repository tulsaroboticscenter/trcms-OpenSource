/**
 * TeamGoalsPanel — the Goals tab on a team-season page. Edit the team mission,
 * create/edit/delete goals, and log progress. Gated by goals.view (render) and
 * goals.manage (edit) — the backend enforces; `can_manage` drives the UI affordances.
 */
import { useEffect, useState, useCallback } from "react";
import { goalsApi, downloadFile, type SeasonGoal, type TeamGoalsResponse, type EvidenceItem } from "../api";
import GoalCard from "./GoalCard";
import GoalForm from "./GoalForm";
import { Plus, Target, Pencil, Trash2, TrendingUp, Save, Download, Paperclip, ExternalLink } from "lucide-react";

export default function TeamGoalsPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const [data, setData] = useState<TeamGoalsResponse | null>(null);
  const [roster, setRoster] = useState<{ member_id: number; name: string; member_type: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SeasonGoal | null | undefined>(undefined); // undefined = closed, null = new
  const [mission, setMission] = useState("");
  const [missionDirty, setMissionDirty] = useState(false);
  const [logFor, setLogFor] = useState<number | null>(null);
  const [logVal, setLogVal] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logEvid, setLogEvid] = useState("");
  const [trail, setTrail] = useState<Record<number, EvidenceItem[]>>({});

  const load = useCallback(() => {
    setLoading(true);
    goalsApi.listTeam(teamSeasonId)
      .then((d) => { setData(d); setMission(d.mission ?? ""); setMissionDirty(false); })
      .catch(() => setData(null)).finally(() => setLoading(false));
  }, [teamSeasonId]);
  useEffect(() => { load(); goalsApi.teamMembers(teamSeasonId).then(setRoster).catch(() => setRoster([])); }, [load, teamSeasonId]);

  const canManage = !!data?.can_manage;

  async function saveGoal(draft: Parameters<typeof goalsApi.create>[1]) {
    if (editing) await goalsApi.update(editing.id, draft);
    else await goalsApi.create(teamSeasonId, draft);
    load();
  }
  async function del(g: SeasonGoal) { if (window.confirm(`Delete goal "${g.title}"?`)) { await goalsApi.remove(g.id); load(); } }
  async function saveMission() { await goalsApi.setMission(teamSeasonId, mission); setMissionDirty(false); }
  async function submitLog(goalId: number) {
    const v = logVal.trim() === "" ? undefined : Number(logVal);
    const evidence = logEvid.trim() ? { external_url: logEvid.trim(), label: logEvid.trim() } : undefined;
    await goalsApi.logProgress(goalId, { value: v, note: logNote.trim() || undefined, evidence });
    setLogFor(null); setLogVal(""); setLogNote(""); setLogEvid("");
    setTrail((t) => { const n = { ...t }; delete n[goalId]; return n; }); load();
  }
  async function toggleTrail(goalId: number) {
    if (trail[goalId]) { setTrail((t) => { const n = { ...t }; delete n[goalId]; return n; }); return; }
    const items = await goalsApi.evidenceTrail(goalId);
    setTrail((t) => ({ ...t, [goalId]: items }));
  }

  if (loading) return <div style={{ color: "#889", padding: "1rem" }}>Loading goals…</div>;
  if (!data) return <div style={{ color: "#c62828", padding: "1rem" }}>Couldn't load goals.</div>;

  return (
    <div>
      {/* Mission */}
      <div style={s.mission}>
        <div style={s.missionLbl}><Target size={13} /> Team Mission</div>
        {canManage ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea style={s.missionInput} rows={2} value={mission} placeholder="One sentence: why does this team exist?"
              onChange={(e) => { setMission(e.target.value); setMissionDirty(true); }} />
            {missionDirty && <button style={s.missionSave} onClick={saveMission}><Save size={13} /> Save</button>}
          </div>
        ) : (
          <p style={s.missionText}>{data.mission || <span style={{ color: "#98a3b0" }}>No mission set yet.</span>}</p>
        )}
      </div>

      <div style={s.head}>
        <h3 style={s.h}>Season Goals <span style={s.count}>({data.goals.length})</span></h3>
        <div style={{ display: "flex", gap: 8 }}>
          {data.goals.length > 0 && <button style={s.exportBtn} onClick={() => downloadFile(goalsApi.csvUrl(teamSeasonId), "team-goals.csv")}><Download size={13} /> Export CSV</button>}
          {canManage && <button style={s.add} onClick={() => setEditing(null)}><Plus size={14} /> New Goal</button>}
        </div>
      </div>

      {data.goals.length === 0 && <p style={s.empty}>No goals yet.{canManage ? " Add your team's measurable season goals." : ""}</p>}

      {data.goals.map((g) => (
        <GoalCard key={g.id} goal={g}>
          {logFor === g.id ? (
            <div style={s.logBox}>
              {g.metric_type !== "milestone" && <input style={s.logInput} type="number" placeholder={`New ${g.unit || "value"}`} value={logVal} onChange={(e) => setLogVal(e.target.value)} />}
              <input style={s.logNote} placeholder="Note (optional)" value={logNote} onChange={(e) => setLogNote(e.target.value)} />
              <input style={s.logNote} placeholder="Evidence link (optional)" value={logEvid} onChange={(e) => setLogEvid(e.target.value)} />
              <button style={s.logSave} onClick={() => submitLog(g.id)}>Log</button>
              <button style={s.logCancel} onClick={() => { setLogFor(null); setLogVal(""); setLogNote(""); setLogEvid(""); }}>Cancel</button>
            </div>
          ) : (
            <>
              {canManage && <button style={s.actBtn} onClick={() => { setLogFor(g.id); setLogVal(g.metric_type !== "milestone" ? String(g.current_value) : ""); }}><TrendingUp size={13} /> Log progress</button>}
              {canManage && <button style={s.actBtn} onClick={() => setEditing(g)}><Pencil size={13} /> Edit</button>}
              {canManage && <button style={{ ...s.actBtn, color: "#c62828" }} onClick={() => del(g)}><Trash2 size={13} /> Delete</button>}
              <button style={s.actBtn} onClick={() => toggleTrail(g.id)}><Paperclip size={13} /> Evidence</button>
              {g.update_count > 0 && <span style={s.updates}>{g.update_count} update{g.update_count === 1 ? "" : "s"}</span>}
            </>
          )}
          {trail[g.id] && (
            <div style={s.trail}>
              {trail[g.id].length === 0 ? <span style={s.trailEmpty}>No evidence linked yet. Attach a link when you log progress.</span>
                : trail[g.id].map((e) => (
                  <div key={e.id} style={s.trailItem}>
                    <Paperclip size={11} style={{ color: "#00695c" }} />
                    {e.external_url ? <a href={e.external_url} target="_blank" rel="noopener noreferrer" style={s.trailLink}>{e.label} <ExternalLink size={10} /></a> : <span>{e.label}</span>}
                    {e.note && <span style={s.trailNote}>— {e.note}</span>}
                  </div>
                ))}
            </div>
          )}
        </GoalCard>
      ))}

      {editing !== undefined && (
        <GoalForm initial={editing} roster={roster} onSave={saveGoal} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  mission: { background: "#f5f8fc", border: "1px solid #dde7f0", borderRadius: 10, padding: "10px 14px", marginBottom: 16 },
  missionLbl: { fontSize: 11, fontWeight: 800, color: "#546e7a", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 },
  missionInput: { flex: 1, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box", resize: "vertical" },
  missionText: { margin: 0, fontSize: 14, color: "#1a3a5c", fontStyle: "italic", lineHeight: 1.5 },
  missionSave: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  h: { margin: 0, fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  count: { color: "#889", fontWeight: 400, fontSize: 14 },
  add: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  empty: { color: "#889", fontSize: 14, padding: "1rem 0" },
  actBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#455" },
  updates: { fontSize: 11.5, color: "#98a3b0", alignSelf: "center" },
  logBox: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" },
  logInput: { width: 120, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  logNote: { flex: 1, minWidth: 120, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  logSave: { padding: "6px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12.5 },
  logCancel: { padding: "6px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5 },
  exportBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#455" },
  trail: { width: "100%", marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0", display: "flex", flexDirection: "column", gap: 4 },
  trailEmpty: { fontSize: 11.5, color: "#98a3b0", fontStyle: "italic" },
  trailItem: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#445", flexWrap: "wrap" },
  trailLink: { display: "inline-flex", alignItems: "center", gap: 3, color: "#00695c", fontWeight: 600, textDecoration: "none" },
  trailNote: { color: "#889" },
};
