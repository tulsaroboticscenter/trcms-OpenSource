/**
 * Work assigned to an FDP youth, on their member profile.
 *
 * Stored on the same per-member task machinery as the joining checklist (category
 * 'fdp_work'), so due dates, completion and the youth's own view come for free — this
 * is just the FDP-flavoured presentation of it.
 *
 * The youth and their parent/guardian can see it and the youth can tick items done;
 * assigning is fdp.manage. Renders nothing when there's no work and the viewer
 * couldn't assign any.
 */
import { useCallback, useEffect, useState } from "react";
import { onboardingApi, type OnboardingChecklist } from "../../onboarding";
import { ClipboardList, CheckCircle2, Circle, Plus, X } from "lucide-react";

export default function FdpWorkPanel({ memberId }: { memberId: number }) {
  const [data, setData] = useState<OnboardingChecklist | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    onboardingApi.forMember(memberId).then(setData).catch(() => setData(null));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr("");
    try { await fn(); load(); }
    catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't work."); }
    finally { setBusy(false); }
  }

  const add = () => run(async () => {
    if (!title.trim()) return;
    await onboardingApi.assignWork(memberId, {
      title: title.trim(), description: desc.trim() || undefined, due_date: due || undefined,
    });
    setAdding(false); setTitle(""); setDesc(""); setDue("");
  });

  if (!data) return null;
  const work = data.work ?? [];
  if (work.length === 0 && !data.can_assign_work) return null;

  const today = new Date().toISOString().slice(0, 10);
  const open = work.filter((w) => !w.is_complete).length;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <ClipboardList size={15} />
        <strong>Development work</strong>
        {open > 0 && <span style={s.count}>{open} open</span>}
      </div>

      {work.length === 0 ? (
        <p style={s.muted}>No work assigned yet.</p>
      ) : work.map((w) => {
        const overdue = !w.is_complete && w.due_date !== null && w.due_date < today;
        return (
          <div key={w.id} style={s.row}>
            <button style={s.tick} disabled={busy}
              title={w.is_complete ? "Mark as not done" : "Mark done"}
              onClick={() => run(() => onboardingApi.complete(w.id, !w.is_complete))}>
              {w.is_complete ? <CheckCircle2 size={16} color="#16a34a" /> : <Circle size={16} color={overdue ? "#dc2626" : "#94a3b8"} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...s.title, ...(w.is_complete ? s.done : {}) }}>{w.label}</div>
              {w.description && <div style={s.desc}>{w.description}</div>}
              <div style={s.meta}>
                {w.is_complete && w.completed_date ? `Done ${w.completed_date}`
                  : w.due_date ? <span style={overdue ? s.overdue : undefined}>Due {w.due_date}</span>
                  : "No due date"}
              </div>
            </div>
            {data.can_assign_work && (
              <button style={s.x} title="Remove" disabled={busy}
                onClick={() => run(() => onboardingApi.unassign(w.id))}><X size={13} /></button>
            )}
          </div>
        );
      })}

      {err && <div style={s.err}>{err}</div>}

      {data.can_assign_work && (adding ? (
        <div style={s.addBox}>
          <input style={s.input} autoFocus value={title} placeholder="What's the work?"
            onChange={(e) => setTitle(e.target.value)} />
          <textarea style={s.input} rows={2} value={desc} placeholder="Detail (optional)"
            onChange={(e) => setDesc(e.target.value)} />
          <div style={s.addRow}>
            <input style={{ ...s.input, flex: 1 }} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            <button style={s.ghost} onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
            <button style={s.primary} disabled={busy || !title.trim()} onClick={add}>Assign</button>
          </div>
        </div>
      ) : (
        <button style={s.addBtn} onClick={() => setAdding(true)}><Plus size={13} /> Assign work</button>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #eef2f6" },
  head: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1a3a5c", marginBottom: 8 },
  count: { marginLeft: "auto", fontSize: 11, color: "#8a5a00", background: "#fff6e5", borderRadius: 10, padding: "1px 8px" },
  muted: { fontSize: 12.5, color: "#90a4ae", margin: "2px 0 6px" },
  row: { display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderTop: "1px solid #f3f6f9" },
  tick: { background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", marginTop: 1 },
  title: { fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  done: { textDecoration: "line-through", color: "#8b98a6", fontWeight: 500 },
  desc: { fontSize: 12, color: "#5b6b7c", marginTop: 2 },
  meta: { fontSize: 11, color: "#90a4ae", marginTop: 3 },
  overdue: { color: "#c62828", fontWeight: 600 },
  x: { background: "none", border: "none", cursor: "pointer", color: "#b0bcc9", display: "flex", padding: 2 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "6px 11px", background: "#fff", color: "#1565c0", border: "1px dashed #90caf9", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  addBox: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  addRow: { display: "flex", gap: 6, alignItems: "center" },
  input: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" },
  ghost: { padding: "6px 11px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, fontSize: 12.5, cursor: "pointer", color: "#4a5b6d", whiteSpace: "nowrap" },
  primary: { padding: "7px 13px", background: "#00695c", color: "#fff", border: "none", borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  err: { marginTop: 8, fontSize: 12, color: "#c62828" },
};
