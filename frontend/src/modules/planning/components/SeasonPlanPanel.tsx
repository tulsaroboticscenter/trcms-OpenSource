import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import {
  planningApi, type PlanCategory, type PlanActivity, type MemberBrief,
  type ActivityStatus, type RescheduleChange, type SeasonDeadline, type TeamRole, STATUS_META,
} from "../api";
import { Plus, Pencil, Trash2, CalendarClock, X, AlertTriangle, Clock, List, GanttChartSquare, CalendarSync, Flag } from "lucide-react";
import { LogTimeModal } from "../../activity";
import { fmtMinutes } from "../../activity/api";
import { eventsApi, type TRCEvent } from "../../events/api";
import SeasonGantt from "./SeasonGantt";

const STATUSES: ActivityStatus[] = ["not_started", "in_progress", "blocked", "done"];

export default function SeasonPlanPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { canWrite, user } = useAuth();
  const canManage = canWrite("planning.manage");
  const canLog = canWrite("activity.log");
  const [plan, setPlan] = useState<PlanCategory[] | null>(null);
  const [members, setMembers] = useState<MemberBrief[]>([]);
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [editing, setEditing] = useState<{ activity?: PlanActivity; categoryId: number } | null>(null);
  const [logActivity, setLogActivity] = useState<PlanActivity | null>(null);
  const [view, setView] = useState<"board" | "timeline">("board");
  const [reschedule, setReschedule] = useState<{ changes: RescheduleChange[] } | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [deadlines, setDeadlines] = useState<SeasonDeadline[]>([]);
  const [addingDl, setAddingDl] = useState(false);
  const [dlForm, setDlForm] = useState<{ name: string; date: string; eventId: string; notes: string }>({ name: "", date: "", eventId: "", notes: "" });
  const [events, setEvents] = useState<TRCEvent[]>([]);

  const loadDeadlines = useCallback(() => { planningApi.deadlines(teamSeasonId).then(setDeadlines).catch(() => setDeadlines([])); }, [teamSeasonId]);
  useEffect(() => { loadDeadlines(); }, [loadDeadlines]);

  async function addDeadline() {
    if (!dlForm.eventId && (!dlForm.name.trim() || !dlForm.date)) return;
    const rows = await planningApi.createDeadline(teamSeasonId, {
      name: dlForm.name.trim() || undefined, deadline_date: dlForm.date || undefined,
      event_id: dlForm.eventId ? parseInt(dlForm.eventId) : null, notes: dlForm.notes.trim() || undefined,
    });
    setDeadlines(rows); setAddingDl(false); setDlForm({ name: "", date: "", eventId: "", notes: "" });
  }
  async function delDeadline(id: number) { await planningApi.deleteDeadline(id); loadDeadlines(); }
  function openAddDeadline() {
    setAddingDl(true);
    if (events.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const to = new Date(new Date().getFullYear() + 1, 11, 31).toISOString().slice(0, 10);
      eventsApi.list({ from_date: today, to_date: to }).then((r) => setEvents(r.events)).catch(() => {});
    }
  }

  async function previewReschedule() {
    setRescheduling(true);
    try { const r = await planningApi.reschedule(teamSeasonId, true); setReschedule({ changes: r.changes }); }
    finally { setRescheduling(false); }
  }
  async function applyReschedule() {
    setRescheduling(true);
    try { await planningApi.reschedule(teamSeasonId, false); setReschedule(null); load(); }
    finally { setRescheduling(false); }
  }

  const [params] = useSearchParams();
  const targetActivity = params.get("activity");
  const openedRef = useRef(false);

  const load = useCallback(() => {
    planningApi.getPlan(teamSeasonId).then(setPlan).catch(() => setPlan([]));
  }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { planningApi.teamMembers(teamSeasonId).then(setMembers).catch(() => {}); }, [teamSeasonId]);
  useEffect(() => { planningApi.teamRoles(teamSeasonId).then(setRoles).catch(() => {}); }, [teamSeasonId]);

  // Deep link: open the editor for the activity named in ?activity= once the plan loads.
  useEffect(() => {
    if (!targetActivity || plan === null || openedRef.current) return;
    for (const cat of plan) {
      const a = cat.activities.find((x) => String(x.id) === targetActivity);
      if (a) { setEditing({ activity: a, categoryId: cat.id }); openedRef.current = true; break; }
    }
  }, [targetActivity, plan]);

  // All activities flattened — for the dependency picker.
  const allActivities = (plan ?? []).flatMap((c) => c.activities);

  async function addCategory() {
    if (!newCat.trim()) return;
    await planningApi.createCategory(teamSeasonId, { name: newCat.trim() });
    setNewCat(""); setAddingCat(false); load();
  }

  if (plan === null) return <p style={st.muted}>Loading…</p>;

  return (
    <div>
      {plan.length === 0 && !canManage && <p style={st.muted}>No season plan yet.</p>}

      {plan.length > 0 && (
        <div style={st.toolbar}>
          <div style={st.viewToggle}>
            <button style={{ ...st.viewBtn, ...(view === "board" ? st.viewBtnOn : {}) }} onClick={() => setView("board")}><List size={13} /> Board</button>
            <button style={{ ...st.viewBtn, ...(view === "timeline" ? st.viewBtnOn : {}) }} onClick={() => setView("timeline")}><GanttChartSquare size={13} /> Timeline</button>
          </div>
          {canManage && (
            <button style={st.reschedBtn} disabled={rescheduling} onClick={previewReschedule}
              title="Push overdue activities and anything waiting on them forward, keeping durations">
              <CalendarSync size={13} /> Auto-reschedule
            </button>
          )}
        </div>
      )}

      {(deadlines.length > 0 || canManage) && (
        <div style={st.dlSection}>
          <div style={st.dlHead}>
            <span style={st.dlTitle}><Flag size={13} style={{ verticalAlign: -2 }} /> Team Deadlines</span>
            {canManage && !addingDl && <button style={st.dlAddBtn} onClick={openAddDeadline}><Plus size={12} /> Add</button>}
          </div>
          {deadlines.length === 0 && !addingDl && <span style={st.muted}>No deadlines yet. Add key dates (League Meet, scrimmage…) to plan around them.</span>}
          <div style={st.dlChips}>
            {deadlines.map((d) => (
              <span key={d.id} style={st.dlChip} title={d.notes ?? undefined}>
                <strong>{new Date(d.deadline_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>
                {" "}{d.name}{d.event_name && <span style={st.dlEvent}> · 📅 {d.event_name}</span>}
                {canManage && <button style={st.dlDel} onClick={() => delDeadline(d.id)}><X size={11} /></button>}
              </span>
            ))}
          </div>
          {addingDl && (
            <div style={st.dlForm}>
              <select style={st.dlInput} value={dlForm.eventId} onChange={(e) => {
                const ev = events.find((x) => String(x.id) === e.target.value);
                setDlForm((f) => ({ ...f, eventId: e.target.value, name: ev && !f.name ? ev.name : f.name, date: ev ? ev.event_date : f.date }));
              }}>
                <option value="">— link an event (optional) —</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.event_date} · {ev.name}</option>)}
              </select>
              <input style={st.dlInput} placeholder="Deadline name" value={dlForm.name} onChange={(e) => setDlForm((f) => ({ ...f, name: e.target.value }))} />
              <input style={st.dlInput} type="date" value={dlForm.date} onChange={(e) => setDlForm((f) => ({ ...f, date: e.target.value }))} />
              <button style={st.saveBtn} onClick={addDeadline}>Add</button>
              <button style={st.cancelBtn} onClick={() => { setAddingDl(false); setDlForm({ name: "", date: "", eventId: "", notes: "" }); }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {view === "timeline" ? (
        <SeasonGantt categories={plan} deadlines={deadlines} onOpen={canManage ? (a) => setEditing({ activity: a, categoryId: a.category_id }) : undefined} />
      ) : (<>
      <div style={st.cats}>
        {plan.map((cat) => (
          <div key={cat.id} style={st.cat}>
            <div style={st.catHead}>
              <span style={{ ...st.catName, borderColor: cat.color || "#cdd7e3" }}>{cat.name}</span>
              <span style={st.catCount}>{cat.activities.length}</span>
              {cat.activities.length > 0 && (
                <div style={st.catPctWrap} title={`${cat.percent_complete ?? 0}% complete`}>
                  <div style={st.catBarBg}><div style={{ ...st.catBarFill, width: `${cat.percent_complete ?? 0}%` }} /></div>
                  <span style={st.catPctNum}>{cat.percent_complete ?? 0}%</span>
                </div>
              )}
              {canManage && (
                <div style={st.catActions}>
                  <button style={st.addActBtn} onClick={() => setEditing({ categoryId: cat.id })}>
                    <Plus size={12} /> Activity
                  </button>
                  <button style={st.iconBtn} title="Delete category" onClick={async () => {
                    if (confirm(`Delete "${cat.name}" and all its activities?`)) { await planningApi.deleteCategory(cat.id); load(); }
                  }}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
            {cat.activities.length === 0 ? (
              <p style={st.emptyAct}>No activities yet.</p>
            ) : (
              <div style={st.actList}>
                {cat.activities.map((a) => (
                  <ActivityRow key={a.id} a={a} canManage={canManage} canLog={canLog}
                    onEdit={() => setEditing({ activity: a, categoryId: cat.id })}
                    onLog={() => setLogActivity(a)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && (addingCat ? (
        <div style={st.addCatRow}>
          <input style={st.input} autoFocus placeholder="Category name (e.g. Robot Build)"
            value={newCat} onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }} />
          <button style={st.saveBtn} onClick={addCategory}>Add</button>
          <button style={st.cancelBtn} onClick={() => { setAddingCat(false); setNewCat(""); }}>Cancel</button>
        </div>
      ) : (
        <button style={st.addCatBtn} onClick={() => setAddingCat(true)}><Plus size={14} /> Add Category</button>
      ))}
      </>
      )}

      {reschedule && (
        <div style={st.overlay} onClick={() => setReschedule(null)}>
          <div style={st.modal} onClick={(e) => e.stopPropagation()}>
            <div style={st.modalHead}>
              <span style={st.modalTitle}>Auto-reschedule</span>
              <button style={st.iconBtn} onClick={() => setReschedule(null)}><X size={18} /></button>
            </div>
            {reschedule.changes.length === 0 ? (
              <p style={st.muted}>Everything is on track — nothing needs to shift.</p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#556", margin: "0 0 10px" }}>
                  {reschedule.changes.length} activit{reschedule.changes.length === 1 ? "y" : "ies"} will move forward (overdue items, and anything waiting on them). Durations are kept.
                </p>
                <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {reschedule.changes.map((c) => (
                    <div key={c.id} style={st.change}>
                      <div style={{ fontWeight: 600, color: "#1a3a5c", fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "#667" }}>
                        {c.from_start ?? "—"} → <strong>{c.to_start ?? "—"}</strong> … {c.from_target ?? "—"} → <strong>{c.to_target ?? "—"}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={st.modalActions}>
                  <div style={{ flex: 1 }} />
                  <button style={st.cancelBtn} onClick={() => setReschedule(null)}>Cancel</button>
                  <button style={st.saveBtn} onClick={applyReschedule} disabled={rescheduling}>{rescheduling ? "Applying…" : "Apply changes"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {editing && (
        <ActivityEditor
          categoryId={editing.categoryId}
          activity={editing.activity}
          members={members}
          roles={roles}
          allActivities={allActivities}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {logActivity && user && (
        <LogTimeModal
          memberId={user.id}
          title={`Log time — ${logActivity.name}`}
          context={{ item_type: "activity", item_id: logActivity.id, team_season_id: teamSeasonId }}
          onClose={() => setLogActivity(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function ActivityRow({ a, canManage, canLog, onEdit, onLog }: {
  a: PlanActivity; canManage: boolean; canLog: boolean; onEdit: () => void; onLog: () => void;
}) {
  const meta = STATUS_META[a.status];
  const fmt = (d?: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const overdue = !!a.target_date && a.status !== "done" && new Date(a.target_date + "T00:00:00") < new Date(new Date().toDateString());
  return (
    <div style={st.actRow}>
      <span style={{ ...st.statusDot, background: meta.color }} title={meta.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={st.actName}>
          {a.name}
          {a.is_blocked && <span style={st.blockedTag}><AlertTriangle size={10} /> blocked</span>}
        </div>
        <div style={st.actMeta}>
          <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
          {a.lead && <span>Lead: {a.lead.name}</span>}
          {a.assigned_role_name && <span style={st.roleTag}>👥 {a.assigned_role_name}</span>}
          {a.assignees.length > 0 && <span>{a.assignees.length} owner{a.assignees.length !== 1 ? "s" : ""}</span>}
          {a.target_date && <span style={{ color: overdue ? "#c62828" : "#888", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <CalendarClock size={11} /> {a.start_date ? `${fmt(a.start_date)} – ` : "due "}{fmt(a.target_date)}</span>}
          {a.blocked_by.length > 0 && <span style={st.depHint}>after: {a.blocked_by.map((b) => b.name).join(", ")}</span>}
          {a.actual_minutes > 0 && <span style={st.loggedTag}><Clock size={10} /> {fmtMinutes(a.actual_minutes)} logged</span>}
        </div>
        {(a.percent_complete > 0 || a.status !== "not_started") && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <div style={st.actBarBg}><div style={{ ...st.actBarFill, width: `${a.percent_complete}%`, background: meta.color }} /></div>
            <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{a.percent_complete}%</span>
          </div>
        )}
      </div>
      {canLog && <button style={st.iconBtn} title="Log time" onClick={onLog}><Clock size={13} /></button>}
      {canManage && <button style={st.iconBtn} title="Edit" onClick={onEdit}><Pencil size={13} /></button>}
    </div>
  );
}

function ActivityEditor({ categoryId, activity, members, roles, allActivities, onClose, onSaved }: {
  categoryId: number;
  activity?: PlanActivity;
  members: MemberBrief[];
  roles: TeamRole[];
  allActivities: PlanActivity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!activity;
  const [name, setName] = useState(activity?.name ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [startDate, setStartDate] = useState(activity?.start_date ?? "");
  const [targetDate, setTargetDate] = useState(activity?.target_date ?? "");
  const [duration, setDuration] = useState<string>(activity?.duration_days != null ? String(activity.duration_days) : "");
  const [percent, setPercent] = useState<number>(activity?.percent_complete ?? 0);
  const [status, setStatus] = useState<ActivityStatus>(activity?.status ?? "not_started");
  const [leadId, setLeadId] = useState<number | "">(activity?.lead?.member_id ?? "");
  const [roleId, setRoleId] = useState<number | "">(activity?.assigned_role_id ?? "");
  const [assignees, setAssignees] = useState<number[]>(activity?.assignees.map((m) => m.member_id) ?? []);
  const [deps, setDeps] = useState<number[]>(activity?.blocked_by.map((b) => b.id) ?? []);
  const [saving, setSaving] = useState(false);

  function toggle(list: number[], setList: (v: number[]) => void, id: number) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  // Schedule trio: fill any two of (start, target, duration) and the third fills in.
  const addDays = (d: string, n: number) => { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
  const diffDays = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
  function onStart(v: string) {
    setStartDate(v);
    if (v && targetDate) setDuration(String(diffDays(v, targetDate)));
    else if (v && duration !== "") setTargetDate(addDays(v, parseInt(duration) || 0));
  }
  function onTarget(v: string) {
    setTargetDate(v);
    if (v && startDate) setDuration(String(diffDays(startDate, v)));
    else if (v && duration !== "") setStartDate(addDays(v, -(parseInt(duration) || 0)));
  }
  function onDuration(v: string) {
    setDuration(v);
    const n = parseInt(v);
    if (v !== "" && !isNaN(n)) {
      if (startDate) setTargetDate(addDays(startDate, n));
      else if (targetDate) setStartDate(addDays(targetDate, -n));
    }
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      start_date: startDate || null,
      target_date: targetDate || null,
      duration_days: duration === "" ? null : parseInt(duration),
      percent_complete: percent,
      status,
      lead_member_id: leadId === "" ? null : leadId,
      assigned_role_id: roleId === "" ? null : roleId,
      assignee_ids: assignees,
      depends_on_ids: deps,
    };
    try {
      if (editing) await planningApi.updateActivity(activity!.id, payload);
      else await planningApi.createActivity(categoryId, payload);
      onSaved();
    } finally { setSaving(false); }
  }

  // Can't depend on itself.
  const depChoices = allActivities.filter((a) => a.id !== activity?.id);

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}>
          <span style={st.modalTitle}>{editing ? "Edit Activity" : "New Activity"}</span>
          <button style={st.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <label style={st.l}>Name</label>
        <input style={st.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chassis" autoFocus />

        <label style={st.l}>Description</label>
        <textarea style={st.textarea} value={description} onChange={(e) => setDescription(e.target.value)} />

        <label style={st.l}>Schedule <span style={st.hint}>— fill any two; the third fills in automatically</span></label>
        <div style={st.grid3}>
          <div>
            <label style={st.lSub}>Start date</label>
            <input style={st.input} type="date" value={startDate ?? ""} onChange={(e) => onStart(e.target.value)} />
          </div>
          <div>
            <label style={st.lSub}>Target Due Date</label>
            <input style={st.input} type="date" value={targetDate ?? ""} onChange={(e) => onTarget(e.target.value)} />
          </div>
          <div>
            <label style={st.lSub}>Duration (days)</label>
            <input style={st.input} type="number" min={0} value={duration} onChange={(e) => onDuration(e.target.value)} />
          </div>
        </div>

        <div style={st.grid2}>
          <div>
            <label style={st.l}>Status</label>
            <select style={st.input} value={status} onChange={(e) => setStatus(e.target.value as ActivityStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          <div>
            <label style={st.l}>% Complete: <strong>{percent}%</strong></label>
            <input style={{ width: "100%" }} type="range" min={0} max={100} step={5} value={percent} onChange={(e) => setPercent(parseInt(e.target.value))} />
          </div>
        </div>

        <div style={st.grid2}>
          <div>
            <label style={st.l}>Lead</label>
            <select style={st.input} value={leadId} onChange={(e) => setLeadId(e.target.value ? parseInt(e.target.value) : "")}>
              <option value="">— none —</option>
              {members.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label style={st.l}>Assigned team role</label>
            <select style={st.input} value={roleId} onChange={(e) => setRoleId(e.target.value ? parseInt(e.target.value) : "")}>
              <option value="">— none —</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        <label style={st.l}>Owners</label>
        <div style={st.chips}>
          {members.length === 0 && <span style={st.muted}>No team members.</span>}
          {members.map((m) => (
            <button key={m.member_id} type="button"
              style={{ ...st.chip, ...(assignees.includes(m.member_id) ? st.chipOn : {}) }}
              onClick={() => toggle(assignees, setAssignees, m.member_id)}>{m.name}</button>
          ))}
        </div>

        {depChoices.length > 0 && (
          <>
            <label style={st.l}>Blocked by (depends on)</label>
            <div style={st.chips}>
              {depChoices.map((a) => (
                <button key={a.id} type="button"
                  style={{ ...st.chip, ...(deps.includes(a.id) ? st.chipOn : {}) }}
                  onClick={() => toggle(deps, setDeps, a.id)}>{a.name}</button>
              ))}
            </div>
          </>
        )}

        <div style={st.modalActions}>
          {editing && (
            <button style={st.deleteBtn} onClick={async () => {
              if (confirm(`Delete activity "${activity!.name}"?`)) { await planningApi.deleteActivity(activity!.id); onSaved(); }
            }}><Trash2 size={14} /> Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  reschedBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#5e35b1", border: "1px solid #d6c9ee", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  change: { border: "1px solid #eef1f5", borderRadius: 8, padding: "8px 10px", background: "#fbfdff" },
  dlSection: { background: "#fff7f2", border: "1px solid #ffe0cc", borderRadius: 10, padding: "10px 12px", marginBottom: 14 },
  dlHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  dlTitle: { fontSize: 12.5, fontWeight: 800, color: "#e65100", textTransform: "uppercase", letterSpacing: 0.3 },
  dlAddBtn: { display: "flex", alignItems: "center", gap: 3, fontSize: 12, padding: "3px 9px", background: "#fff", color: "#e65100", border: "1px solid #ffcc99", borderRadius: 12, cursor: "pointer", fontWeight: 600 },
  dlChips: { display: "flex", flexWrap: "wrap", gap: 7 },
  dlChip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, background: "#fff", border: "1px solid #ffd9bf", borderRadius: 14, padding: "3px 10px", color: "#5d4037" },
  dlEvent: { color: "#8a97a8", fontSize: 11.5 },
  dlDel: { background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: 0, marginLeft: 2, display: "inline-flex" },
  dlForm: { display: "flex", gap: 7, marginTop: 8, flexWrap: "wrap", alignItems: "center" },
  dlInput: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  viewToggle: { display: "inline-flex", gap: 0, border: "1px solid #cdd7e3", borderRadius: 8, overflow: "hidden" },
  viewBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#556", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  viewBtnOn: { background: "#1a3a5c", color: "#fff" },
  cats: { display: "flex", flexDirection: "column", gap: 14 },
  cat: {},
  catHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  catName: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.3, borderLeft: "3px solid", paddingLeft: 8 },
  catCount: { background: "#f0f4f8", color: "#555", borderRadius: 10, padding: "0 7px", fontSize: 11 },
  catActions: { marginLeft: "auto", display: "flex", gap: 6 },
  addActBtn: { display: "flex", alignItems: "center", gap: 3, fontSize: 12, padding: "4px 9px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 14, cursor: "pointer", fontWeight: 600 },
  emptyAct: { fontSize: 12, color: "#bbb", margin: "0 0 0 10px" },
  actList: { display: "flex", flexDirection: "column", gap: 6 },
  actRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8 },
  statusDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  actName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 6 },
  blockedTag: { display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#e65100", background: "#fff3e0", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" },
  actMeta: { display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#888", marginTop: 3 },
  depHint: { color: "#6a1b9a" },
  roleTag: { color: "#00695c", fontWeight: 600 },
  loggedTag: { display: "inline-flex", alignItems: "center", gap: 2, color: "#ff8f00", fontWeight: 600 },
  iconBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 7, padding: 6, cursor: "pointer", color: "#888" },
  addCatRow: { display: "flex", gap: 8, marginTop: 12 },
  addCatBtn: { display: "flex", alignItems: "center", gap: 5, marginTop: 12, padding: "8px 14px", background: "#fff", color: "#1565c0", border: "1px dashed #90caf9", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  input: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 60, padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, boxSizing: "border-box", resize: "vertical" },
  saveBtn: { padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  cancelBtn: { padding: "9px 16px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
  deleteBtn: { display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: "20px 22px", width: "100%", maxWidth: 540, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: 800, color: "#1a3a5c" },
  l: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "10px 0 4px" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  hint: { fontWeight: 400, color: "#99a", fontSize: 11 },
  lSub: { display: "block", fontSize: 11, fontWeight: 600, color: "#778", margin: "0 0 3px" },
  catPctWrap: { display: "flex", alignItems: "center", gap: 6 },
  catBarBg: { width: 90, height: 7, background: "#eceff1", borderRadius: 4, overflow: "hidden" },
  catBarFill: { height: "100%", background: "#2e7d32", borderRadius: 4 },
  catPctNum: { fontSize: 11.5, fontWeight: 700, color: "#2e7d32", minWidth: 30, textAlign: "right" },
  actBarBg: { flex: 1, height: 5, background: "#eef1f5", borderRadius: 3, overflow: "hidden", maxWidth: 120 },
  actBarFill: { height: "100%", borderRadius: 3 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { padding: "5px 11px", border: "1px solid #cdd7e3", background: "#fff", color: "#555", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  chipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  modalActions: { display: "flex", alignItems: "center", gap: 10, marginTop: 18 },
};
