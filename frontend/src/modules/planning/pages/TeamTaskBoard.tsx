import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { planningApi, type TeamTask, type PlanningTeam, type MemberBrief, type Recurrence } from "../api";
import MemberPickerModal from "../components/MemberPickerModal";
import { ClipboardList, Plus, Check, Hand, RotateCcw, Trash2, ArrowLeft, Link2, Building2, Clock, Users, Repeat, CalendarClock, ChevronRight, ChevronDown, Pencil, X, Save, Lock, User } from "lucide-react";

const RECUR_LABEL: Record<Recurrence, string> = {
  none: "One-time", daily: "Daily", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly",
};
import { LogTimeModal } from "../../activity";

type Scope = { kind: "team"; teamSeasonId: number } | { kind: "trc" };

/** Group tasks by category, ordered by the configured list, uncategorized last. */
function groupTasks(tasks: TeamTask[], categories: string[]): { category: string | null; items: TeamTask[] }[] {
  const order = [...categories, null];
  const groups: { category: string | null; items: TeamTask[] }[] = [];
  for (const cat of order) {
    const items = tasks.filter((t) => (t.category || null) === cat);
    if (items.length) groups.push({ category: cat, items });
  }
  const known = new Set(categories);
  const orphanCats = Array.from(new Set(tasks.filter((t) => t.category && !known.has(t.category)).map((t) => t.category as string)));
  for (const cat of orphanCats) groups.push({ category: cat, items: tasks.filter((t) => t.category === cat) });
  return groups;
}

export default function TeamTaskBoard() {
  const { teamSeasonId } = useParams<{ teamSeasonId: string }>();
  const navigate = useNavigate();

  if (teamSeasonId === "trc") return <Board scope={{ kind: "trc" }} onChangeTeam={() => navigate("/team-tasks")} />;
  if (teamSeasonId) return <Board scope={{ kind: "team", teamSeasonId: parseInt(teamSeasonId) }} onChangeTeam={() => navigate("/team-tasks")} />;
  return <TeamChooser onPick={(path) => navigate(path)} />;
}

function TeamChooser({ onPick }: { onPick: (path: string) => void }) {
  const [teams, setTeams] = useState<PlanningTeam[] | null>(null);
  useEffect(() => { planningApi.teams().then(setTeams).catch(() => setTeams([])); }, []);

  // Group teams by program, preserving the backend's program-ordered sequence.
  const programs: { name: string; teams: PlanningTeam[] }[] = [];
  for (const t of teams ?? []) {
    const name = t.program || "Other";
    let g = programs.find((p) => p.name === name);
    if (!g) { g = { name, teams: [] }; programs.push(g); }
    g.teams.push(t);
  }

  return (
    <div style={st.page}>
      <h1 style={st.h1}><ClipboardList size={22} /> TRC/Team Tasks</h1>
      <p style={st.sub}>Choose the TRC general board or a team to view its task board.</p>

      {/* TRC group — top, no header */}
      <div style={st.teamGrid}>
        <button style={{ ...st.teamBtn, ...st.trcBtn }} onClick={() => onPick("/team-tasks/trc")}>
          <Building2 size={28} color="#00838f" />
          <div style={st.teamName}>TRC (General)</div>
        </button>
      </div>

      {teams === null ? <p style={st.muted}>Loading…</p> : programs.map((p) => (
        <div key={p.name}>
          <div style={st.programHead}><span style={st.programLabel}>{p.name}</span><span style={st.programRule} /></div>
          <div style={st.teamGrid}>
            {p.teams.map((t) => (
              <button key={t.team_season_id} style={st.teamBtn} onClick={() => onPick(`/team-tasks/${t.team_season_id}`)}>
                <div style={st.teamNum}>{t.team_number ?? "—"}</div>
                <div style={st.teamName}>{t.team_name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Board({ scope, onChangeTeam }: { scope: Scope; onChangeTeam: () => void }) {
  const { canWrite, isAdmin, user } = useAuth();
  const canManage = canWrite("planning.manage");
  const canLog = canWrite("activity.log");
  const [logTask, setLogTask] = useState<TeamTask | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // The task's author may always edit it; so may planning managers.
  const canEditTask = (t: TeamTask) => canManage || (t.created_by?.member_id != null && t.created_by.member_id === user?.id);
  // Progress can be posted by anyone doing the work: author, whoever claimed it,
  // or anyone with task-write / planning-manage.
  // Prefer the backend's per-viewer flag (it also accounts for assigned-team
  // membership); fall back to a local check for older responses.
  const canPostProgress = (t: TeamTask) => t.can_post_progress ?? (canManage || canWrite("planning.tasks")
    || t.created_by?.member_id === user?.id || t.claimed_by?.member_id === user?.id);
  const isTrc = scope.kind === "trc";
  const tsid = scope.kind === "team" ? scope.teamSeasonId : null;
  // Who may direct a private task at a member (also the general task-write gate).
  const canAssign = canManage || canWrite("planning.tasks");

  const [tasks, setTasks] = useState<TeamTask[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCat, setNewCat] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [picker, setPicker] = useState<{ taskId: number; mode: "claim" | "complete" } | null>(null);
  // #112/#114 add-form options + team assignment
  const [teams, setTeams] = useState<PlanningTeam[]>([]);
  const [showOpts, setShowOpts] = useState(false);
  const [newAssign, setNewAssign] = useState<string>("");        // #112 single team
  const [newRecur, setNewRecur] = useState<Recurrence>("none");  // #114 frequency
  const [newDue, setNewDue] = useState("");
  const [newRotation, setNewRotation] = useState<number[]>([]);  // ordered rotation teams
  const [teamPicker, setTeamPicker] = useState<number | null>(null); // task id awaiting team assignment
  // Private, per-member task (TRC board only)
  const [newPrivate, setNewPrivate] = useState(false);
  const [newAssignMember, setNewAssignMember] = useState<string>("");
  const [members, setMembers] = useState<MemberBrief[]>([]);
  const [privTasks, setPrivTasks] = useState<TeamTask[]>([]);
  const [showPriv, setShowPriv] = useState(true);
  const [label, setLabel] = useState(isTrc ? "TRC (General)" : "");
  const [params] = useSearchParams();
  const targetTask = params.get("task");
  const scrolledRef = useRef(false);

  const loadPriv = useCallback(() => {
    if (!isTrc || !canAssign) { setPrivTasks([]); return; }
    planningApi.privateTasks(showDone).then(setPrivTasks).catch(() => setPrivTasks([]));
  }, [isTrc, canAssign, showDone]);

  const load = useCallback(() => {
    const p = isTrc ? planningApi.listTrcTasks(showDone) : planningApi.listTasks(tsid!, showDone);
    p.then(setTasks).catch(() => setTasks([]));
    loadPriv();
  }, [isTrc, tsid, showDone, loadPriv]);
  useEffect(() => { load(); }, [load]);

  // Members to pick from when assigning a private task (TRC board, assigners only).
  useEffect(() => {
    if (isTrc && canAssign) planningApi.trcMembers().then(setMembers).catch(() => setMembers([]));
  }, [isTrc, canAssign]);

  // Deep link: scroll to and highlight the task named in ?task=, revealing it
  // from the completed list if needed.
  useEffect(() => {
    if (!targetTask || tasks === null || scrolledRef.current) return;
    const t = tasks.find((x) => String(x.id) === targetTask);
    if (!t) return;
    if (t.status === "done" && !showDone) { setShowDone(true); return; }
    const el = document.getElementById(`task-${targetTask}`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); scrolledRef.current = true; }
  }, [targetTask, tasks, showDone]);

  useEffect(() => {
    planningApi.categories(isTrc ? "trc_task_categories" : "task_categories").then(setCategories).catch(() => setCategories([]));
    planningApi.teams().then((ts) => {
      setTeams(ts);
      if (!isTrc) { const t = ts.find((x) => x.team_season_id === tsid); if (t) setLabel(t.team_name); }
    }).catch(() => setTeams([]));
  }, [isTrc, tsid]);

  function resetAddForm() {
    setNewTitle(""); setNewCat(""); setAdding(false); setShowOpts(false);
    setNewAssign(""); setNewRecur("none"); setNewDue(""); setNewRotation([]);
    setNewPrivate(false); setNewAssignMember("");
  }

  async function addTask() {
    if (!newTitle.trim()) return;
    const payload: Parameters<typeof planningApi.createTrcTask>[0] = { title: newTitle.trim(), category: newCat || undefined };
    if (isTrc && newPrivate) {
      // A private task is directed at one member and stays off the shared board.
      if (!newAssignMember) return;
      payload.is_private = true;
      payload.assigned_member_id = Number(newAssignMember);
      if (newDue) payload.due_date = newDue;
    } else if (newRecur !== "none") {
      payload.recurrence = newRecur;
      payload.due_date = newDue || undefined;
      if (newRotation.length) payload.rotation_team_ids = newRotation;
    } else if (newAssign) {
      payload.assigned_team_season_id = Number(newAssign);
    }
    if (isTrc) await planningApi.createTrcTask(payload);
    else await planningApi.createTask(tsid!, payload);
    resetAddForm(); load();
  }

  function toggleRotation(id: number) {
    setNewRotation((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  async function assignTeam(taskId: number, teamSeasonId: number | null) {
    await planningApi.assignTeamTask(taskId, teamSeasonId);
    setTeamPicker(null); load();
  }

  async function delPrivate(id: number) {
    if (!confirm("Delete this private task? This can't be undone.")) return;
    await planningApi.deleteTask(id); loadPriv();
  }

  async function onPicked(member: MemberBrief) {
    if (!picker) return;
    if (picker.mode === "claim") await planningApi.claimTask(picker.taskId, member.member_id);
    else await planningApi.completeTask(picker.taskId, { memberId: member.member_id });
    setPicker(null); load();
  }

  async function onPickedTeam(team: PlanningTeam) {
    if (!picker) return;
    await planningApi.completeTask(picker.taskId, { teamSeasonId: team.team_season_id });
    setPicker(null); load();
  }

  const open = (tasks ?? []).filter((t) => t.status !== "done");
  const done = (tasks ?? []).filter((t) => t.status === "done");

  return (
    <div style={st.page}>
      <div style={st.header}>
        <div>
          <button style={st.backLink} onClick={onChangeTeam}><ArrowLeft size={13} /> Switch board</button>
          <h1 style={st.h1}>
            <ClipboardList size={22} /> TRC/Team Tasks
            {label && <span style={{ ...st.teamTag, background: isTrc ? "#00838f" : "#1565c0" }}>{label}</span>}
          </h1>
        </div>
        <button style={st.addBtn} onClick={() => setAdding((v) => !v)}><Plus size={15} /> Add Task</button>
      </div>

      {adding && (
        <div style={st.addWrap}>
          <div style={st.addRow}>
            <input style={st.addInput} autoFocus placeholder="What needs to be done? e.g. Take out the shop trash"
              value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); }} />
            {categories.length > 0 && (
              <select style={st.catSelect} value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button style={st.saveBtn} onClick={addTask}>Add</button>
            <button style={st.cancelBtn} onClick={resetAddForm}>Cancel</button>
          </div>

          {/* Private, per-member task (TRC board, assigners only) */}
          {isTrc && canAssign && (
            <label style={st.privateToggle}>
              <input type="checkbox" checked={newPrivate}
                onChange={(e) => setNewPrivate(e.target.checked)} />
              <Lock size={13} /> Private — assign to one member (only they see it, on their dashboard)
            </label>
          )}

          {isTrc && canAssign && newPrivate && (
            <div style={st.optsPanel}>
              <label style={st.optRow}>
                <span style={st.optLabel}><User size={14} /> Assign to</span>
                <select style={st.optSelect} value={newAssignMember} onChange={(e) => setNewAssignMember(e.target.value)}>
                  <option value="">Choose a member…</option>
                  {members.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
                </select>
              </label>
              <label style={st.optRow}>
                <span style={st.optLabel}><CalendarClock size={14} /> Due (optional)</span>
                <input type="date" style={st.optSelect} value={newDue} onChange={(e) => setNewDue(e.target.value)} />
              </label>
            </div>
          )}

          {!(isTrc && newPrivate) && (
          <button style={st.optsToggle} onClick={() => setShowOpts((v) => !v)}>
            {showOpts ? "▾" : "▸"} Assign a team or make it recurring
          </button>
          )}

          {!(isTrc && newPrivate) && showOpts && (
            <div style={st.optsPanel}>
              {/* #112 — hand the whole task to one team (only when one-time) */}
              {newRecur === "none" && (
                <label style={st.optRow}>
                  <span style={st.optLabel}><Users size={14} /> A team will do it</span>
                  <select style={st.optSelect} value={newAssign} onChange={(e) => setNewAssign(e.target.value)}>
                    <option value="">Anyone can pick it up</option>
                    {teams.map((t) => <option key={t.team_season_id} value={t.team_season_id}>{t.team_name}</option>)}
                  </select>
                </label>
              )}

              {/* #114 — recurring frequency */}
              <label style={st.optRow}>
                <span style={st.optLabel}><Repeat size={14} /> Repeats</span>
                <select style={st.optSelect} value={newRecur} onChange={(e) => setNewRecur(e.target.value as Recurrence)}>
                  {(Object.keys(RECUR_LABEL) as Recurrence[]).map((r) => <option key={r} value={r}>{RECUR_LABEL[r]}</option>)}
                </select>
              </label>

              {newRecur !== "none" && (
                <>
                  <label style={st.optRow}>
                    <span style={st.optLabel}><CalendarClock size={14} /> First due</span>
                    <input type="date" style={st.optSelect} value={newDue} onChange={(e) => setNewDue(e.target.value)} />
                  </label>
                  <div style={st.rotBlock}>
                    <div style={st.optLabel}>Rotate through teams (in order) — leave empty for no rotation</div>
                    <div style={st.rotChips}>
                      {teams.map((t) => {
                        const pos = newRotation.indexOf(t.team_season_id);
                        const on = pos >= 0;
                        return (
                          <button key={t.team_season_id} style={{ ...st.rotChip, ...(on ? st.rotChipOn : {}) }} onClick={() => toggleRotation(t.team_season_id)}>
                            {on && <span style={st.rotNum}>{pos + 1}</span>} {t.team_name}
                          </button>
                        );
                      })}
                    </div>
                    <div style={st.rotHint}>Each time it's completed it advances to the next team and its due date rolls forward.</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manager view: private tasks assigned to individuals (only they otherwise see them) */}
      {isTrc && canAssign && privTasks.length > 0 && (
        <div style={st.privSection}>
          <button style={st.privHead} onClick={() => setShowPriv((v) => !v)}>
            <Lock size={13} /> Private assignments <span style={st.privCount}>{privTasks.length}</span>
            <span style={st.privChev}>{showPriv ? "▾" : "▸"}</span>
          </button>
          {showPriv && (
            <div style={st.privList}>
              {privTasks.map((t) => (
                <div key={t.id} style={st.privRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={st.privTitle}>
                      {t.status === "done" && <Check size={12} color="#16a34a" style={{ verticalAlign: -1 }} />} {t.title}
                    </div>
                    <div style={st.privMeta}>
                      <User size={11} style={{ verticalAlign: -1 }} /> {t.assigned_member?.name ?? "—"}
                      {t.due_date && <> · due {t.due_date}</>}
                      {t.progress_pct != null && t.status !== "done" && <> · {t.progress_pct}%</>}
                      {" · "}
                      <span style={{ color: t.status === "done" ? "#16a34a" : "#a86a00", fontWeight: 600 }}>
                        {t.status === "done" ? "done" : "in progress"}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <button style={st.privDel} title="Delete private task" onClick={() => delPrivate(t.id)}><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tasks === null ? <p style={st.muted}>Loading…</p> : (
        <>
          {open.length === 0 && <p style={st.muted}>No open tasks. 🎉</p>}
          {groupTasks(open, categories).map(({ category, items }) => (
            <div key={category ?? "_none"} style={st.group}>
              {(categories.length > 0 || category) && (
                <div style={st.groupHead}>{category ?? "Uncategorized"}<span style={st.groupCount}>{items.length}</span></div>
              )}
              <div style={st.list}>
                {items.map((t) => (
                  <div key={t.id} id={`task-${t.id}`} style={{ ...st.card, ...(String(t.id) === targetTask ? st.cardHighlight : {}) }}>
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <div style={st.titleRow} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                        <button style={st.chevBtn} aria-label={expandedId === t.id ? "Collapse" : "Expand"}>
                          {expandedId === t.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <div style={st.taskTitle}>{t.title}</div>
                      </div>
                      {t.progress_pct != null && (
                        <div style={st.progWrap}>
                          <div style={st.progBar}><div style={{ ...st.progFill, width: `${t.progress_pct}%` }} /></div>
                          <span style={st.progPct}>{t.progress_pct}%</span>
                        </div>
                      )}
                      {t.description && expandedId !== t.id && <div style={st.taskDescClamp}>{t.description}</div>}
                      {expandedId === t.id && editingId !== t.id && (
                        <div style={st.expandBox}>
                          {t.description
                            ? <div style={st.taskDescFull}>{t.description}</div>
                            : <div style={st.noNotes}>No notes or details yet.</div>}
                          {t.created_by && <div style={st.addedBy}>Added by {t.created_by.name}</div>}
                          <TaskProgress task={t} canPost={canPostProgress(t)} canManage={canManage} userId={user?.id}
                            onChange={load} />
                          {canEditTask(t) && (
                            <button style={st.editLink} onClick={() => setEditingId(t.id)}><Pencil size={12} /> Edit task</button>
                          )}
                        </div>
                      )}
                      {expandedId === t.id && editingId === t.id && (
                        <TaskEditForm task={t} categorySuggestions={categories}
                          onCancel={() => setEditingId(null)}
                          onSaved={() => { setEditingId(null); load(); }} />
                      )}
                      <div style={st.meta}>
                        {t.category && <span style={st.catTag}>{t.category}</span>}
                        {t.linked_activity_name && <span style={st.linkTag}><Link2 size={11} /> {t.linked_activity_name}</span>}
                        {t.recurrence && t.recurrence !== "none" && (
                          <span style={st.recurTag}>
                            <Repeat size={11} /> {RECUR_LABEL[t.recurrence]}{t.due_date ? ` · due ${t.due_date}` : ""}
                            {(t.rotation?.length ?? 0) > 1 ? ` · rotates ${t.rotation!.length} teams` : ""}
                          </span>
                        )}
                        {t.claimed_by
                          ? <span style={st.claimed}>Claimed by {t.claimed_by.name}</span>
                          : t.assigned_team
                            ? <span style={st.teamAssigned}><Users size={11} /> {t.assigned_team.team_name}</span>
                            : <span style={st.openTag}>Unclaimed</span>}
                      </div>
                    </div>
                    <div style={st.actions}>
                      {t.status !== "done" && !t.claimed_by && (
                        <button style={st.claimBtn} onClick={() => setPicker({ taskId: t.id, mode: "claim" })}>
                          <Hand size={14} /> I'll take it
                        </button>
                      )}
                      {canManage && (!t.recurrence || t.recurrence === "none") && (
                        <button style={st.teamPickBtn} title="Assign to a team" onClick={() => setTeamPicker(t.id)}>
                          <Users size={14} /> Team
                        </button>
                      )}
                      <button style={st.doneBtn} onClick={() => setPicker({ taskId: t.id, mode: "complete" })}>
                        <Check size={14} /> Done
                      </button>
                      {canLog && (
                        <button style={st.iconBtn} title="Log time" onClick={() => setLogTask(t)}><Clock size={14} /></button>
                      )}
                      {canManage && (
                        <button style={st.iconBtn} title="Delete" onClick={async () => {
                          if (confirm("Delete this task?")) { await planningApi.deleteTask(t.id); load(); }
                        }}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <label style={st.showDone}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
          </label>
          {showDone && done.map((t) => (
            <div key={t.id} id={`task-${t.id}`} style={{ ...st.card, opacity: 0.65, ...(String(t.id) === targetTask ? st.cardHighlight : {}) }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...st.taskTitle, textDecoration: "line-through" }}>{t.title}</div>
                <div style={st.meta}>
                  <span style={st.doneTag}>✓ Completed{t.completed_by ? ` by ${t.completed_by.name}` : t.completed_by_team ? ` by ${t.completed_by_team.team_name}` : ""}</span>
                </div>
              </div>
              {(canManage || isAdmin) && (
                <button style={st.iconBtn} title="Reopen" onClick={async () => { await planningApi.reopenTask(t.id); load(); }}>
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {picker && (
        <MemberPickerModal
          teamSeasonId={tsid ?? undefined}
          fetchMembers={isTrc ? planningApi.trcMembers : undefined}
          title={picker.mode === "claim" ? "Who's taking this task?" : "Who completed this task?"}
          teams={picker.mode === "complete" ? teams : undefined}
          onPickTeam={picker.mode === "complete" ? onPickedTeam : undefined}
          onPick={onPicked}
          onClose={() => setPicker(null)}
        />
      )}

      {teamPicker !== null && (
        <div style={st.overlay} onClick={() => setTeamPicker(null)}>
          <div style={st.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={st.modalH}>Which team will do this?</h3>
            <div style={st.teamList}>
              <button style={st.teamOpt} onClick={() => assignTeam(teamPicker, null)}>Anyone (no team) — leave it open</button>
              {teams.map((t) => (
                <button key={t.team_season_id} style={st.teamOpt} onClick={() => assignTeam(teamPicker, t.team_season_id)}>
                  {t.team_name}{t.team_number != null ? ` · ${t.team_number}` : ""}
                </button>
              ))}
            </div>
            <button style={st.cancelBtn} onClick={() => setTeamPicker(null)}>Cancel</button>
          </div>
        </div>
      )}

      {logTask && user && (
        <LogTimeModal
          memberId={user.id}
          title={`Log time — ${logTask.title}`}
          context={{ item_type: "task", item_id: logTask.id, team_season_id: tsid }}
          onClose={() => setLogTask(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function fmtWhen(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s.length > 10 ? s : s + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TaskProgress({ task, canPost, canManage, userId, onChange }: {
  task: TeamTask; canPost: boolean; canManage: boolean; userId?: number; onChange: () => void;
}) {
  const updates = task.progress_updates ?? [];
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pct, setPct] = useState<string>(task.progress_pct != null ? String(task.progress_pct) : "");
  const [busy, setBusy] = useState(false);

  async function post() {
    if (!note.trim() && pct === "") return;
    setBusy(true);
    try {
      await planningApi.addProgress(task.id, {
        body: note.trim() || undefined,
        progress_pct: pct === "" ? undefined : Math.max(0, Math.min(100, parseInt(pct))),
      });
      setNote(""); setOpen(false); onChange();
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    setBusy(true);
    try { await planningApi.deleteProgress(id); onChange(); } finally { setBusy(false); }
  }

  return (
    <div style={pr.wrap}>
      <div style={pr.head}>Progress</div>
      {updates.length === 0 && !open && <div style={pr.empty}>No progress updates yet.</div>}
      {updates.map((u) => (
        <div key={u.id} style={pr.item}>
          {u.progress_pct != null && <span style={pr.pctChip}>{u.progress_pct}%</span>}
          <div style={pr.itemMain}>
            {u.body && <div style={pr.body}>{u.body}</div>}
            <div style={pr.meta}>{u.member?.name ?? "Someone"}{u.created_at ? ` · ${fmtWhen(u.created_at)}` : ""}</div>
          </div>
          {(canManage || (u.member_id != null && u.member_id === userId)) && (
            <button style={pr.del} title="Delete" disabled={busy} onClick={() => del(u.id)}><Trash2 size={12} /></button>
          )}
        </div>
      ))}
      {canPost && (open ? (
        <div style={pr.form}>
          <textarea style={pr.textarea} value={note} autoFocus placeholder="What did you get done? Blockers, next steps…"
            onChange={(e) => setNote(e.target.value)} />
          <div style={pr.formRow}>
            <label style={pr.pctLabel}>
              % complete
              <input style={pr.pctInput} type="number" min={0} max={100} value={pct} placeholder="—"
                onChange={(e) => setPct(e.target.value)} />
            </label>
            <div style={{ flex: 1 }} />
            <button style={pr.cancel} onClick={() => { setOpen(false); setNote(""); }} disabled={busy}>Cancel</button>
            <button style={pr.post} onClick={post} disabled={busy || (!note.trim() && pct === "")}>Post update</button>
          </div>
        </div>
      ) : (
        <button style={pr.addBtn} onClick={() => setOpen(true)}><Plus size={12} /> Update progress</button>
      ))}
    </div>
  );
}

const pr: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0", display: "flex", flexDirection: "column", gap: 6 },
  head: { fontSize: 11, fontWeight: 700, color: "#8a97a4", textTransform: "uppercase", letterSpacing: 0.4 },
  empty: { fontSize: 12.5, color: "#aaa", fontStyle: "italic" },
  item: { display: "flex", gap: 8, alignItems: "flex-start" },
  pctChip: { fontSize: 10.5, fontWeight: 800, color: "#1565c0", background: "#e7f0fb", borderRadius: 10, padding: "1px 7px", flexShrink: 0, marginTop: 1 },
  itemMain: { flex: 1, minWidth: 0 },
  body: { fontSize: 13, color: "#334", whiteSpace: "pre-wrap", lineHeight: 1.45 },
  meta: { fontSize: 11, color: "#9aa7b4", marginTop: 1 },
  del: { background: "none", border: "none", cursor: "pointer", color: "#c0392b", padding: 2, display: "flex", flexShrink: 0 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "2px 0" },
  form: { display: "flex", flexDirection: "column", gap: 6, background: "#f8fafc", border: "1px solid #dce4ec", borderRadius: 8, padding: 10 },
  textarea: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", minHeight: 54, resize: "vertical", fontFamily: "inherit" },
  formRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  pctLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#556" },
  pctInput: { width: 64, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  cancel: { padding: "6px 11px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  post: { padding: "6px 13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700 },
};

function TaskEditForm({ task, categorySuggestions, onCancel, onSaved }: {
  task: TeamTask; categorySuggestions: string[]; onCancel: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [category, setCategory] = useState(task.category ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await planningApi.editTask(task.id, { title: title.trim(), description: description.trim() || null, category: category.trim() || null });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={ef.wrap}>
      <input style={ef.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title *" autoFocus />
      <textarea style={ef.textarea} value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="Notes / details — steps, links, context…" />
      <input style={ef.input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" list="task-edit-cats" />
      <datalist id="task-edit-cats">{categorySuggestions.map((c) => <option key={c} value={c} />)}</datalist>
      <div style={ef.actions}>
        <button style={ef.cancel} onClick={onCancel} disabled={saving}><X size={13} /> Cancel</button>
        <button style={ef.save} onClick={save} disabled={saving || !title.trim()}><Save size={13} /> {saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

const ef: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8, margin: "6px 0 4px", padding: 12, background: "#f8fafc", border: "1px solid #dce4ec", borderRadius: 8 },
  input: { padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  textarea: { padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box", minHeight: 70, resize: "vertical", fontFamily: "inherit" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancel: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  save: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700 },
};

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 16 },
  backLink: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4, padding: 0, marginBottom: 4 },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  teamTag: { fontSize: 14, fontWeight: 600, color: "#fff", borderRadius: 14, padding: "2px 12px" },
  sub: { color: "#666", fontSize: 14, marginTop: 4 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  addWrap: { marginBottom: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 },
  addRow: { display: "flex", gap: 8 },
  addInput: { flex: 1, padding: "10px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14 },
  catSelect: { padding: "10px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, background: "#fff" },
  optsToggle: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "8px 2px 0", display: "block" },
  privateToggle: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12.5, color: "#4a3a6a", fontWeight: 600, cursor: "pointer" },
  privSection: { border: "1px solid #e6ddf5", background: "#faf8fe", borderRadius: 10, margin: "6px 0 14px", overflow: "hidden" },
  privHead: { width: "100%", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "10px 12px", fontSize: 13, fontWeight: 700, color: "#4a3a6a" },
  privCount: { fontSize: 11, fontWeight: 700, background: "#ede4fb", color: "#5b3e94", borderRadius: 10, padding: "1px 8px" },
  privChev: { marginLeft: "auto", color: "#8a7bb0" },
  privList: { display: "flex", flexDirection: "column", gap: 6, padding: "0 12px 12px" },
  privRow: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #eee6fb", borderRadius: 8, padding: "8px 10px" },
  privTitle: { fontSize: 13, fontWeight: 600, color: "#2c2340", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  privMeta: { fontSize: 11, color: "#7a6f92", marginTop: 2, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  privDel: { background: "none", border: "none", cursor: "pointer", color: "#b08", display: "flex", padding: 3, opacity: 0.6 },
  optsPanel: { marginTop: 8, display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid #e8edf3", paddingTop: 10 },
  optRow: { display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" },
  optLabel: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334", fontWeight: 600 },
  optSelect: { padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, background: "#fff", minWidth: 180 },
  rotBlock: { display: "flex", flexDirection: "column", gap: 6 },
  rotChips: { display: "flex", flexWrap: "wrap", gap: 6 },
  rotChip: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", border: "1px solid #cdd7e3", borderRadius: 14, background: "#fff", color: "#556", fontSize: 12.5, cursor: "pointer" },
  rotChipOn: { background: "#1565c0", color: "#fff", borderColor: "#1565c0" },
  rotNum: { background: "rgba(255,255,255,0.35)", borderRadius: 8, padding: "0 5px", fontSize: 11, fontWeight: 700 },
  rotHint: { fontSize: 11.5, color: "#889" },
  group: { marginBottom: 16 },
  groupHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#00838f", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  groupCount: { background: "#e0f2f1", color: "#00695c", borderRadius: 10, padding: "0 7px", fontSize: 11 },
  catTag: { fontSize: 11, color: "#00695c", background: "#e0f2f1", borderRadius: 10, padding: "1px 8px", fontWeight: 600 },
  saveBtn: { padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  cancelBtn: { padding: "9px 16px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
  muted: { color: "#888", fontSize: 14, padding: "8px 0" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: { display: "flex", alignItems: "center", gap: 12, rowGap: 8, flexWrap: "wrap", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" },
  cardHighlight: { borderColor: "#1565c0", boxShadow: "0 0 0 2px #1565c0" },
  taskTitle: { fontSize: 15, fontWeight: 600, color: "#1a3a5c", overflowWrap: "anywhere" },
  taskDesc: { fontSize: 13, color: "#666", marginTop: 2 },
  titleRow: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
  chevBtn: { background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", color: "#94a3b8", cursor: "pointer", flexShrink: 0 },
  taskDescClamp: { fontSize: 13, color: "#666", marginTop: 2, marginLeft: 21, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" },
  expandBox: { marginLeft: 21, marginTop: 4, display: "flex", flexDirection: "column", gap: 4 },
  taskDescFull: { fontSize: 13.5, color: "#445", whiteSpace: "pre-wrap", lineHeight: 1.5 },
  noNotes: { fontSize: 13, color: "#aaa", fontStyle: "italic" },
  addedBy: { fontSize: 11.5, color: "#94a3b8" },
  progWrap: { display: "flex", alignItems: "center", gap: 8, marginTop: 5, marginLeft: 21 },
  progBar: { flex: 1, height: 6, background: "#eef2f7", borderRadius: 4, overflow: "hidden", maxWidth: 220 },
  progFill: { height: "100%", background: "#2e7d32", borderRadius: 4 },
  progPct: { fontSize: 11.5, fontWeight: 700, color: "#2e7d32", flexShrink: 0 },
  editLink: { display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "2px 0", marginTop: 2 },
  meta: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 5, alignItems: "center" },
  linkTag: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 10, padding: "1px 8px" },
  claimed: { fontSize: 12, color: "#1565c0", fontWeight: 600 },
  teamAssigned: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#00695c", fontWeight: 600, background: "#e0f2f1", borderRadius: 10, padding: "1px 8px" },
  recurTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#5e35b1", background: "#ede7f6", borderRadius: 10, padding: "1px 8px", fontWeight: 600 },
  openTag: { fontSize: 12, color: "#e65100", fontWeight: 600 },
  doneTag: { fontSize: 12, color: "#2e7d32", fontWeight: 600 },
  actions: { display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" },
  claimBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  doneBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  teamPickBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", color: "#00695c", border: "1px solid #b2dfdb", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  iconBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, cursor: "pointer", color: "#888" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 24, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: 20, width: 420, maxWidth: "95vw", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" },
  modalH: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  teamList: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto", marginBottom: 12 },
  teamOpt: { textAlign: "left", padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13.5, color: "#243" },
  showDone: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666", margin: "16px 0 8px", cursor: "pointer" },
  teamGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginTop: 16 },
  programHead: { display: "flex", alignItems: "center", gap: 10, marginTop: 22 },
  programLabel: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" },
  programRule: { flex: 1, height: 1, background: "#e2e8f0" },
  teamBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "20px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, cursor: "pointer" },
  trcBtn: { border: "2px solid #b2dfdb", background: "#f1fbfa" },
  teamNum: { fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  teamName: { fontSize: 13, color: "#555", textAlign: "center" },
};
