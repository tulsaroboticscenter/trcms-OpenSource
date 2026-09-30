/**
 * OnboardingPanel — the joining-TRC checklist on a member's profile.
 *
 * The member sees their own open items with a link straight to the instructions and,
 * for YPT/background check, the VIRTUS registration link. Anyone holding
 * onboarding.manage can assign items and tick the manual ones.
 *
 * YPT / background check / first aid are marked `derived`: their state comes from the
 * compliance record, so they are shown read-only here with a pointer to where the date
 * is actually recorded. That keeps one source of truth per item.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { onboardingApi, type OnboardingChecklist, type CatalogItem } from "../api";
import { CheckCircle2, Circle, ExternalLink, AlertTriangle, Plus, X, ShieldCheck } from "lucide-react";

export default function OnboardingPanel({ memberId }: { memberId: number }) {
  const [data, setData] = useState<OnboardingChecklist | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    onboardingApi.forMember(memberId)
      .then(setData)
      .catch(() => setError("Couldn't load the onboarding checklist."))
      .finally(() => setLoading(false));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (assigning && catalog.length === 0) onboardingApi.catalog().then(setCatalog).catch(() => {});
  }, [assigning, catalog.length]);

  async function doAssign() {
    if (picks.length === 0) return;
    setBusy(true); setError("");
    try {
      setData(await onboardingApi.assign(memberId, picks, due));
      setAssigning(false); setPicks([]); setDue("");
    } catch { setError("Couldn't assign those items."); } finally { setBusy(false); }
  }

  async function toggle(taskId: number, complete: boolean) {
    setBusy(true); setError("");
    try { setData(await onboardingApi.complete(taskId, complete)); }
    catch { setError("Couldn't update that item."); } finally { setBusy(false); }
  }

  async function remove(taskId: number) {
    setBusy(true); setError("");
    try { await onboardingApi.unassign(taskId); load(); }
    catch { setError("Couldn't remove that item."); } finally { setBusy(false); }
  }

  if (loading) return <div style={st.muted}>Loading…</div>;
  if (!data) return <div style={st.muted}>{error || "Not available."}</div>;

  const unassigned = catalog.filter((c) => !data.items.some((i) => i.item_key === c.item_key));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={st.wrap}>
      {data.items.length === 0 && (
        <div style={st.muted}>
          Nothing assigned yet.{data.can_manage ? " Use “Assign items” to add the joining steps." : ""}
        </div>
      )}

      {data.items.map((i) => {
        const overdue = !i.is_complete && i.due_date !== null && i.due_date < today;
        return (
          <div key={i.id} style={{ ...st.row, ...(i.is_complete ? st.rowDone : {}) }}>
            <div style={st.icon}>
              {i.is_complete
                ? <CheckCircle2 size={16} color="#16a34a" />
                : <Circle size={16} color={overdue ? "#dc2626" : "#94a3b8"} />}
            </div>
            <div style={st.body}>
              <div style={st.title}>
                {i.label}
                {i.exempt && <span style={st.badgeGrey}>exempt</span>}
                {i.expired && <span style={st.badgeRed}>expired — needs redoing</span>}
                {i.expiring_soon && !i.expired && <span style={st.badgeAmber}>expires {i.expires_date}</span>}
                {overdue && <span style={st.badgeRed}>overdue</span>}
              </div>
              {i.description && <div style={st.desc}>{i.description}</div>}

              <div style={st.metaRow}>
                {i.is_complete && i.completed_date && <span style={st.meta}>Completed {i.completed_date}</span>}
                {!i.is_complete && i.due_date && <span style={st.meta}>Due {i.due_date}</span>}
                {i.help_slug && (
                  <Link to={`/help/${i.help_slug}`} style={st.link}>Instructions</Link>
                )}
                {!i.is_complete && i.action_url && (
                  <a href={i.action_url} target="_blank" rel="noopener noreferrer" style={st.action}>
                    {i.action_label ?? "Open"} <ExternalLink size={11} />
                  </a>
                )}
              </div>

              {i.derived && (
                <div style={st.derived}>
                  <ShieldCheck size={11} /> Tracked by the compliance record — recording the date there updates this.
                </div>
              )}
            </div>

            <div style={st.actions}>
              {!i.derived && (
                <button type="button" style={st.tick} disabled={busy}
                  onClick={() => toggle(i.id, !i.is_complete)}>
                  {i.is_complete ? "Reopen" : "Mark done"}
                </button>
              )}
              {data.can_manage && (
                <button type="button" style={st.x} title="Unassign" disabled={busy}
                  onClick={() => remove(i.id)}><X size={13} /></button>
              )}
            </div>
          </div>
        );
      })}

      {error && <div style={st.err}><AlertTriangle size={12} /> {error}</div>}

      {data.can_manage && !assigning && unassigned.length !== 0 && (
        <button type="button" style={st.assignBtn} onClick={() => setAssigning(true)}>
          <Plus size={13} /> Assign items
        </button>
      )}

      {data.can_manage && assigning && (
        <div style={st.assignBox}>
          {unassigned.length === 0 ? (
            <div style={st.muted}>Everything in the catalog is already assigned.</div>
          ) : unassigned.map((c) => (
            <label key={c.item_key} style={st.pick}>
              <input type="checkbox" checked={picks.includes(c.item_key)}
                onChange={(e) => setPicks((xs) => e.target.checked
                  ? [...xs, c.item_key]
                  : xs.filter((x) => x !== c.item_key))} />
              <span>{c.label}</span>
            </label>
          ))}
          <div style={st.assignRow}>
            <span style={st.fLabel}>Due</span>
            <input type="date" style={st.input} value={due} onChange={(e) => setDue(e.target.value)} />
            <button type="button" style={st.primary} disabled={busy || picks.length === 0} onClick={doAssign}>
              Assign {picks.length || ""}
            </button>
            <button type="button" style={st.cancel} onClick={() => { setAssigning(false); setPicks([]); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8 },
  muted: { fontSize: 12.5, color: "#90a4ae" },
  row: { display: "flex", gap: 8, padding: "8px 9px", border: "1px solid #eef2f7", borderRadius: 8, background: "#fff" },
  rowDone: { background: "#f8fafc", borderColor: "#e8f2ea" },
  icon: { paddingTop: 1 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  desc: { fontSize: 11.5, color: "#5b6b7c", marginTop: 2 },
  metaRow: { display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" },
  meta: { fontSize: 11, color: "#90a4ae" },
  link: { fontSize: 11, color: "#1a3a5c", textDecoration: "underline" },
  action: { fontSize: 11, color: "#fff", background: "#1a3a5c", borderRadius: 5, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" },
  derived: { fontSize: 10.5, color: "#90a4ae", display: "flex", alignItems: "center", gap: 4, marginTop: 4 },
  actions: { display: "flex", alignItems: "flex-start", gap: 4 },
  tick: { fontSize: 11, padding: "3px 8px", border: "1px solid #cbd5e1", borderRadius: 5, background: "#fff", cursor: "pointer", whiteSpace: "nowrap" },
  x: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", display: "flex", padding: 2 },
  badgeGrey: { fontSize: 10, fontWeight: 600, background: "#eef2f7", color: "#5b6b7c", borderRadius: 10, padding: "1px 7px" },
  badgeRed: { fontSize: 10, fontWeight: 600, background: "#fdecec", color: "#c0392b", borderRadius: 10, padding: "1px 7px" },
  badgeAmber: { fontSize: 10, fontWeight: 600, background: "#fff6e5", color: "#a86a00", borderRadius: 10, padding: "1px 7px" },
  err: { fontSize: 11.5, color: "#c0392b", display: "flex", alignItems: "center", gap: 4 },
  assignBtn: { alignSelf: "flex-start", fontSize: 12, padding: "5px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 },
  assignBox: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 9, display: "flex", flexDirection: "column", gap: 5, background: "#fafafa" },
  pick: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#445", cursor: "pointer" },
  assignRow: { display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" },
  fLabel: { fontSize: 11, color: "#778" },
  input: { padding: "5px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12.5 },
  primary: { fontSize: 12, padding: "5px 12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" },
  cancel: { fontSize: 12, padding: "5px 10px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" },
};
