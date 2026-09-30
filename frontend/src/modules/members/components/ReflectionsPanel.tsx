/**
 * ReflectionsPanel — "My Reflections" on a member's own profile. Private by design:
 * only the member sees and edits their own answers; Admin/System Administrator can
 * read (never edit) via members.view_reflections. Questions come from the server
 * catalog so the list can change without a frontend release.
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "../../../core/api";
import { Lock, Save, CheckCircle2 } from "lucide-react";

interface Question { key: string; group: string; label: string; answer: string | null }
interface Reflections {
  member_id: number; enrollment_year: number; year_label: string;
  is_self: boolean; can_edit: boolean;
  questions: Question[]; answered_count: number; question_count: number; last_updated: string | null;
}

export default function ReflectionsPanel({ memberId }: { memberId: number }) {
  const [data, setData] = useState<Reflections | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/v1/members/${memberId}/reflections`)
      .then(({ data: d }: { data: Reflections }) => {
        setData(d);
        setDraft(Object.fromEntries(d.questions.map((q) => [q.key, q.answer ?? ""])));
      })
      .catch(() => setError("Couldn't load your reflections."))
      .finally(() => setLoading(false));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  const dirty = !!data && data.questions.some((q) => (draft[q.key] ?? "") !== (q.answer ?? ""));

  async function save() {
    if (!data) return;
    setSaving(true); setError("");
    try {
      const { data: d } = await api.put(`/api/v1/members/${memberId}/reflections`, { year: data.enrollment_year, answers: draft });
      setData(d); setDraft(Object.fromEntries((d as Reflections).questions.map((q) => [q.key, q.answer ?? ""])));
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={{ color: "#889", padding: "1rem" }}>Loading…</div>;
  if (!data) return <div style={{ color: "#c62828", padding: "1rem" }}>{error || "Unavailable."}</div>;

  const groups = [...new Set(data.questions.map((q) => q.group))];

  return (
    <div>
      <div style={s.privacy}>
        <Lock size={13} />
        <span>{data.is_self
          ? "This is just for you. Nobody else on your team, and no mentors or parents, can see these answers — only you (and a TRC administrator)."
          : "Private reflection — read-only. These are the member's own words; you can't edit them."}</span>
      </div>

      <div style={s.head}>
        <span style={s.season}>{data.year_label}</span>
        <span style={s.progress}>{data.answered_count} of {data.question_count} answered</span>
        {data.last_updated && <span style={s.updated}>Last saved {new Date(data.last_updated).toLocaleDateString()}</span>}
      </div>

      {groups.map((g) => (
        <div key={g} style={s.group}>
          <div style={s.groupTitle}>{g}</div>
          {data.questions.filter((q) => q.group === g).map((q) => (
            <div key={q.key} style={s.qBlock}>
              <label style={s.q}>{q.label}</label>
              {data.can_edit ? (
                <textarea style={s.input} rows={3} value={draft[q.key] ?? ""} placeholder="Take your time — there's no wrong answer."
                  onChange={(e) => setDraft((d) => ({ ...d, [q.key]: e.target.value }))} />
              ) : (
                <div style={s.readOnly}>{q.answer?.trim() ? q.answer : <span style={{ color: "#98a3b0" }}>Not answered yet.</span>}</div>
              )}
            </div>
          ))}
        </div>
      ))}

      {error && <div style={s.err}>{error}</div>}
      {data.can_edit && (
        <div style={s.actions}>
          {saved && <span style={s.savedMsg}><CheckCircle2 size={14} /> Saved</span>}
          <button style={{ ...s.save, opacity: dirty && !saving ? 1 : 0.55 }} onClick={save} disabled={!dirty || saving}>
            <Save size={14} /> {saving ? "Saving…" : "Save my reflections"}
          </button>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  privacy: { display: "flex", alignItems: "flex-start", gap: 8, background: "#f0f7f5", border: "1px solid #cfe6df", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#2b5d52", marginBottom: 14, lineHeight: 1.5 },
  head: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  season: { fontSize: 12, fontWeight: 800, color: "#1a3a5c", background: "#eef2f7", borderRadius: 6, padding: "3px 9px" },
  progress: { fontSize: 12.5, color: "#556", fontWeight: 600 },
  updated: { fontSize: 11.5, color: "#98a3b0" },
  group: { marginBottom: 18 },
  groupTitle: { fontSize: 11.5, fontWeight: 800, color: "#00695c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, paddingBottom: 5, borderBottom: "1px solid #e4eeeb" },
  qBlock: { marginBottom: 14 },
  q: { display: "block", fontSize: 13.5, fontWeight: 600, color: "#1a3a5c", marginBottom: 6, lineHeight: 1.45 },
  input: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" },
  readOnly: { fontSize: 13.5, color: "#334", lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#fafbfc", border: "1px solid #eef2f7", borderRadius: 8, padding: "9px 11px" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "9px 12px", color: "#c62828", fontSize: 13, marginBottom: 10 },
  actions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, position: "sticky", bottom: 0, paddingTop: 10 },
  savedMsg: { display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#2e7d32", fontWeight: 600 },
  save: { display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "#00695c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 13.5 },
};
