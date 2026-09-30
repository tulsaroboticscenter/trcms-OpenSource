import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { planningApi, type TeamIssue, type IssueStatus, type MemberBrief, type PlanActivity, ISSUE_STATUS_META } from "../api";
import { inventoryApi, type Bom } from "../../inventory/api";
import { Plus, MessageSquare, Trash2, Link2, ChevronDown, ChevronRight } from "lucide-react";

const STATUSES: IssueStatus[] = ["open", "in_progress", "on_hold", "closed"];

/** Team Issue Log (#126) — a pane on the team page. */
export default function TeamIssuesPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { canWrite, user } = useAuth();
  const canManage = canWrite("planning.manage");
  const [issues, setIssues] = useState<TeamIssue[]>([]);
  const [members, setMembers] = useState<MemberBrief[]>([]);
  const [activities, setActivities] = useState<PlanActivity[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [filter, setFilter] = useState<IssueStatus | "">("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    planningApi.issues(teamSeasonId, filter || undefined).then(setIssues).catch(() => setIssues([]));
  }, [teamSeasonId, filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    planningApi.teamMembers(teamSeasonId).then(setMembers).catch(() => {});
    planningApi.getPlan(teamSeasonId).then((cats) => setActivities(cats.flatMap((c) => c.activities))).catch(() => {});
    inventoryApi.listBoms({ team_season_id: teamSeasonId }).then(setBoms).catch(() => {});
  }, [teamSeasonId]);

  return (
    <div>
      <div style={st.head}>
        <div style={st.filters}>
          <button style={{ ...st.chip, ...(filter === "" ? st.chipOn : {}) }} onClick={() => setFilter("")}>All</button>
          {STATUSES.map((s) => (
            <button key={s} style={{ ...st.chip, ...(filter === s ? { ...st.chipOn, background: ISSUE_STATUS_META[s].color, borderColor: ISSUE_STATUS_META[s].color } : {}) }}
              onClick={() => setFilter(s)}>{ISSUE_STATUS_META[s].label}</button>
          ))}
        </div>
        <button style={st.addBtn} onClick={() => setAdding(true)}><Plus size={14} /> Report issue</button>
      </div>

      {adding && (
        <IssueForm members={members} activities={activities} boms={boms} defaultReporter={user?.id}
          onCancel={() => setAdding(false)}
          onSave={async (data) => { await planningApi.createIssue(teamSeasonId, data); setAdding(false); load(); }} />
      )}

      {issues.length === 0 && !adding && <p style={st.muted}>No issues logged{filter ? ` with status “${ISSUE_STATUS_META[filter].label}”` : " yet"}. Team members can report problems here as they come up.</p>}

      <div style={st.list}>
        {issues.map((i) => (
          <IssueRow key={i.id} issue={i} open={openId === i.id} canManage={canManage} members={members} activities={activities} boms={boms}
            onToggle={() => setOpenId(openId === i.id ? null : i.id)} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

function IssueRow({ issue, open, canManage, members, activities, boms, onToggle, onChanged }: {
  issue: TeamIssue; open: boolean; canManage: boolean; members: MemberBrief[]; activities: PlanActivity[]; boms: Bom[];
  onToggle: () => void; onChanged: () => void;
}) {
  const meta = ISSUE_STATUS_META[issue.status];
  const [full, setFull] = useState<TeamIssue | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (open) planningApi.getIssue(issue.id).then(setFull).catch(() => {}); }, [open, issue.id]);

  async function setStatus(s: IssueStatus) { await planningApi.updateIssue(issue.id, { status: s }); onChanged(); if (open) planningApi.getIssue(issue.id).then(setFull); }
  async function addComment() {
    if (!comment.trim()) return;
    const updated = await planningApi.addIssueComment(issue.id, comment.trim());
    setFull(updated); setComment(""); onChanged();
  }

  return (
    <div style={st.card}>
      <div style={st.cardHead} onClick={onToggle}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span style={{ ...st.statusBadge, background: meta.color }}>{meta.label}</span>
        <span style={st.title}>{issue.title}</span>
        <div style={{ flex: 1 }} />
        {issue.linked_activity_name && <span style={st.linkTag}><Link2 size={11} /> {issue.linked_activity_name}</span>}
        {issue.linked_bom_name && <span style={st.bomTag} title="Linked BOM"><Link2 size={11} /> {issue.linked_bom_name}</span>}
        {(issue.comment_count ?? 0) > 0 && <span style={st.cmtCount}><MessageSquare size={11} /> {issue.comment_count}</span>}
      </div>
      <div style={st.metaRow}>
        {issue.reporter && <span>Reported by {issue.reporter.name}</span>}
        {issue.stakeholders.length > 0 && <span>· Stakeholders: {issue.stakeholders.map((s) => s.name).join(", ")}</span>}
      </div>

      {open && (
        <div style={st.body}>
          {editing && full ? (
            <IssueForm members={members} activities={activities} boms={boms} existing={full}
              onCancel={() => setEditing(false)}
              onSave={async (data) => { const u = await planningApi.updateIssue(issue.id, data); setFull(u); setEditing(false); onChanged(); }} />
          ) : (
            <>
              {issue.description && <p style={st.desc}>{issue.description}</p>}
              {issue.resolution_notes && <div style={st.resolution}><strong>Resolution:</strong> {issue.resolution_notes}</div>}

              {canManage && (
                <div style={st.mgrRow}>
                  <span style={st.mgrLabel}>Status:</span>
                  <select style={st.sel} value={issue.status} onChange={(e) => setStatus(e.target.value as IssueStatus)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{ISSUE_STATUS_META[s].label}</option>)}
                  </select>
                  <button style={st.smallBtn} onClick={() => setEditing(true)}>Edit details</button>
                  <button style={st.delBtn} onClick={async () => { if (confirm("Delete this issue?")) { await planningApi.deleteIssue(issue.id); onChanged(); } }}><Trash2 size={12} /></button>
                </div>
              )}

              <div style={st.thread}>
                <div style={st.threadTitle}>Discussion</div>
                {(full?.comments ?? []).length === 0 && <p style={st.muted}>No comments yet.</p>}
                {(full?.comments ?? []).map((c) => (
                  <div key={c.id} style={st.comment}>
                    <div style={st.cmtAuthor}>{c.author?.name ?? "Someone"}{c.created_at ? ` · ${new Date(c.created_at).toLocaleDateString()}` : ""}</div>
                    <div style={st.cmtBody}>{c.body}</div>
                  </div>
                ))}
                <div style={st.addComment}>
                  <input style={st.cmtInput} placeholder="Add input on how to resolve…" value={comment}
                    onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addComment(); }} />
                  <button style={st.smallBtn} onClick={addComment}>Post</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IssueForm({ members, activities, boms, existing, defaultReporter, onSave, onCancel }: {
  members: MemberBrief[]; activities: PlanActivity[]; boms: Bom[]; existing?: TeamIssue; defaultReporter?: number;
  onSave: (data: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [reporterId, setReporterId] = useState<number | "">(existing?.reporter?.member_id ?? defaultReporter ?? "");
  const [linked, setLinked] = useState<number | "">(existing?.linked_activity_id ?? "");
  const [linkedBom, setLinkedBom] = useState<number | "">(existing?.linked_bom_id ?? "");
  const [resolution, setResolution] = useState(existing?.resolution_notes ?? "");
  const [stakeholders, setStakeholders] = useState<number[]>(existing?.stakeholders.map((s) => s.member_id) ?? []);
  const toggle = (id: number) => setStakeholders((l) => l.includes(id) ? l.filter((x) => x !== id) : [...l, id]);

  return (
    <div style={st.form}>
      <input style={st.input} placeholder="Issue title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <textarea style={st.textarea} placeholder="What's the problem?" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div style={st.formRow}>
        <label style={st.fl}>Reporter
          <select style={st.sel} value={reporterId} onChange={(e) => setReporterId(e.target.value ? parseInt(e.target.value) : "")}>
            <option value="">—</option>
            {members.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
          </select>
        </label>
        <label style={st.fl}>Related activity
          <select style={st.sel} value={linked} onChange={(e) => setLinked(e.target.value ? parseInt(e.target.value) : "")}>
            <option value="">— none —</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <label style={st.fl}>Related BOM (parts to order)
        <select style={st.sel} value={linkedBom} onChange={(e) => setLinkedBom(e.target.value ? parseInt(e.target.value) : "")}>
          <option value="">— none —</option>
          {boms.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status ? ` (${b.status})` : ""}</option>)}
        </select>
      </label>
      <div style={st.fl}>Stakeholders</div>
      <div style={st.chips}>
        {members.map((m) => (
          <button key={m.member_id} type="button" style={{ ...st.chip, ...(stakeholders.includes(m.member_id) ? st.chipOn : {}) }} onClick={() => toggle(m.member_id)}>{m.name}</button>
        ))}
      </div>
      {existing && (
        <>
          <div style={st.fl}>Resolution notes</div>
          <textarea style={st.textarea} value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </>
      )}
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onCancel}>Cancel</button>
        <button style={st.saveBtn} onClick={() => title.trim() && onSave({
          title: title.trim(), description: description.trim() || null,
          reporter_id: reporterId === "" ? null : reporterId,
          linked_activity_id: linked === "" ? null : linked,
          linked_bom_id: linkedBom === "" ? null : linkedBom,
          stakeholder_ids: stakeholders,
          ...(existing ? { resolution_notes: resolution.trim() || null } : {}),
        })}>{existing ? "Save" : "Report"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: "6px 0" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  filters: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: { padding: "5px 11px", border: "1px solid #cdd7e3", background: "#fff", color: "#556", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  chipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  card: { border: "1px solid #eef1f5", borderRadius: 9, background: "#fff", overflow: "hidden" },
  cardHead: { display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", cursor: "pointer" },
  statusBadge: { color: "#fff", fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: "1px 8px", textTransform: "uppercase" },
  title: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  linkTag: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 8, padding: "1px 7px" },
  bomTag: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: "#1565c0", background: "#e3f2fd", borderRadius: 8, padding: "1px 7px" },
  cmtCount: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: "#778" },
  metaRow: { display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11.5, color: "#889", padding: "0 11px 8px 34px" },
  body: { borderTop: "1px solid #f0f4f8", padding: "10px 12px", background: "#fbfdff" },
  desc: { fontSize: 13, color: "#334", lineHeight: 1.5, margin: "0 0 8px", whiteSpace: "pre-wrap" },
  resolution: { fontSize: 13, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "8px 10px", marginBottom: 8 },
  mgrRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  mgrLabel: { fontSize: 12, fontWeight: 600, color: "#556" },
  thread: { borderTop: "1px dashed #e2e8f0", paddingTop: 8 },
  threadTitle: { fontSize: 12, fontWeight: 700, color: "#556", marginBottom: 6 },
  comment: { background: "#fff", border: "1px solid #eef1f5", borderRadius: 7, padding: "7px 10px", marginBottom: 6 },
  cmtAuthor: { fontSize: 11, color: "#889", fontWeight: 600 },
  cmtBody: { fontSize: 13, color: "#334", marginTop: 2, whiteSpace: "pre-wrap" },
  addComment: { display: "flex", gap: 6, marginTop: 6 },
  cmtInput: { flex: 1, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  form: { border: "1px solid #d6e0ea", borderRadius: 10, padding: 12, marginBottom: 12, background: "#fff", display: "flex", flexDirection: "column", gap: 8 },
  input: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14 },
  textarea: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, minHeight: 56, resize: "vertical", fontFamily: "inherit" },
  formRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  fl: { fontSize: 12, fontWeight: 600, color: "#556", display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 150 },
  sel: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  saveBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  cancelBtn: { padding: "8px 14px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  smallBtn: { padding: "5px 10px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  delBtn: { padding: "5px 8px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 7, cursor: "pointer", display: "inline-flex" },
};
