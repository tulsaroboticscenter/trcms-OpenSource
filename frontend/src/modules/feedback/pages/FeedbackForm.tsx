import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { feedbackApi, TYPE_META } from "../api";
import { APP_VERSION } from "../../../core/version";
import { MessageSquarePlus, ArrowLeft, X } from "lucide-react";

type FeedbackType = "bug" | "feature" | "enhancement" | "other";
interface MemberHit { id: number; first_name: string; last_name: string; member_number?: string }

export default function FeedbackForm() {
  const navigate = useNavigate();
  const goBack = useGoBack("/feedback");
  const { id } = useParams();
  const isEdit = !!id;
  const { canWrite } = useAuth();
  const canManage = canWrite("feedback.manage");

  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [page, setPage] = useState("");
  const [targetRelease, setTargetRelease] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Manager-only: submit on behalf of another member.
  const [onBehalf, setOnBehalf] = useState<MemberHit | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberHits, setMemberHits] = useState<MemberHit[]>([]);

  async function searchMembers() {
    if (!memberQuery.trim()) { setMemberHits([]); return; }
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(memberQuery.trim())}&is_active=true&limit=10`);
    setMemberHits(data.members ?? []);
  }

  useEffect(() => {
    if (isEdit) {
      feedbackApi.get(parseInt(id!)).then((f) => {
        setType(f.type); setTitle(f.title); setDescription(f.description ?? "");
        setSteps(f.steps ?? ""); setPage(f.page ?? ""); setTargetRelease(f.target_release ?? "");
        if (f.member_id && f.submitter_name) {
          const parts = f.submitter_name.trim().split(" ");
          setOnBehalf({ id: f.member_id, first_name: parts[0] ?? f.submitter_name, last_name: parts.slice(1).join(" ") });
        }
      }).catch(() => setErr("Could not load this feedback."));
    } else {
      // Pre-fill the page context from wherever the user came from (same-origin only).
      try {
        const ref = document.referrer;
        if (ref && ref.startsWith(window.location.origin)) setPage(new URL(ref).pathname);
      } catch { /* ignore */ }
    }
  }, [id, isEdit]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) { setErr("Please give your feedback a short title."); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await feedbackApi.update(parseInt(id!), {
          type, title, description, steps, target_release: targetRelease,
          member_id: canManage && onBehalf ? onBehalf.id : undefined,
        });
        navigate("/feedback");
      } else {
        await feedbackApi.create({
          type, title, description, steps, page, app_version: APP_VERSION,
          target_release: targetRelease || undefined,
          member_id: canManage && onBehalf ? onBehalf.id : undefined,
        });
        navigate("/feedback");
      }
    } catch (e2) {
      const ax = e2 as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not submit your feedback.");
    } finally { setSaving(false); }
  }

  return (
    <div style={st.wrap}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to feedback</button>
      <h1 style={st.h1}><MessageSquarePlus size={20} style={{ verticalAlign: -3 }} /> {isEdit ? "Edit Feedback" : "Send Feedback"}</h1>
      <p style={st.intro}>Found a bug or have an idea? Tell us about it — the more detail, the faster we can act on it.</p>
      {err && <div style={st.err}>{err}</div>}

      <form onSubmit={submit} style={st.form}>
        <div style={st.typeRow}>
          {(Object.keys(TYPE_META) as FeedbackType[]).map((t) => (
            <label key={t} style={{ ...st.typeChip, ...(type === t ? { borderColor: TYPE_META[t].color, background: TYPE_META[t].color + "12", color: TYPE_META[t].color, fontWeight: 700 } : {}) }}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} style={{ marginRight: 6 }} />
              {TYPE_META[t].label}
            </label>
          ))}
        </div>

        <label style={st.label}>Title *
          <input style={st.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "feature" ? "e.g. Let me export the roster to CSV" : "e.g. Room occupants show as “Member #9”"} />
        </label>

        <label style={st.label}>{type === "feature" ? "What would you like, and why?" : "What happened?"}
          <textarea style={{ ...st.input, minHeight: 90, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {type === "bug" && (
          <label style={st.label}>Steps to reproduce (optional)
            <textarea style={{ ...st.input, minHeight: 70, resize: "vertical" }} value={steps} onChange={(e) => setSteps(e.target.value)}
              placeholder={"1. Go to…\n2. Click…\n3. See…"} />
          </label>
        )}

        <label style={st.label}>Where in the app? (optional)
          <input style={st.input} value={page} onChange={(e) => setPage(e.target.value)} placeholder="e.g. /events/55/logistics" />
        </label>

        <label style={st.label}>Target release (optional)
          <input style={st.input} value={targetRelease} onChange={(e) => setTargetRelease(e.target.value)} placeholder="e.g. Beta 0.13 — which release you'd like this in" />
        </label>

        {canManage && (
          <div style={st.onBehalf}>
            <span style={st.onBehalfLabel}>{isEdit ? "Submitted by (change the reporter):" : "Submitting on behalf of someone else? (optional)"}</span>
            {onBehalf ? (
              <div style={st.onBehalfPicked}>
                <span>Reporter: <strong>{onBehalf.first_name} {onBehalf.last_name}</strong></span>
                <button type="button" style={st.onBehalfClear} onClick={() => setOnBehalf(null)}><X size={13} /> clear</button>
              </div>
            ) : (
              <>
                <div style={st.onBehalfSearch}>
                  <input style={st.input} value={memberQuery} placeholder="Search member by name…"
                    onChange={(e) => setMemberQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchMembers(); } }} />
                  <button type="button" style={st.onBehalfSearchBtn} onClick={searchMembers}>Search</button>
                </div>
                {memberHits.length > 0 && (
                  <div style={st.onBehalfHits}>
                    {memberHits.map((m) => (
                      <button type="button" key={m.id} style={st.onBehalfHit} onClick={() => { setOnBehalf(m); setMemberHits([]); setMemberQuery(""); }}>
                        {m.last_name}, {m.first_name}{m.member_number ? ` · #${m.member_number}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div style={st.actions}>
          <button type="button" style={st.cancel} onClick={goBack}>Cancel</button>
          <button type="submit" disabled={saving} style={st.submit}>{saving ? "Sending…" : isEdit ? "Save Changes" : "Submit"}</button>
        </div>
      </form>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 600, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 10, padding: 0 },
  h1: { margin: "0 0 4px", fontSize: 23, fontWeight: 800, color: "#1a3a5c" },
  intro: { color: "#778", fontSize: 14, marginTop: 0, marginBottom: 18 },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 14 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  typeRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  typeChip: { display: "flex", alignItems: "center", padding: "8px 14px", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "#445" },
  input: { padding: "9px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, fontWeight: 400, fontFamily: "inherit" },
  onBehalf: { border: "1px dashed #cdd7e3", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  onBehalfLabel: { fontSize: 13, fontWeight: 600, color: "#445" },
  onBehalfSearch: { display: "flex", gap: 8 },
  onBehalfSearchBtn: { padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  onBehalfHits: { display: "flex", flexDirection: "column", gap: 4 },
  onBehalfHit: { textAlign: "left", padding: "8px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#1a3a5c" },
  onBehalfPicked: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 14, color: "#1a3a5c", background: "#eef4fb", borderRadius: 6, padding: "8px 12px" },
  onBehalfClear: { display: "flex", alignItems: "center", gap: 3, background: "none", border: "none", color: "#c62828", cursor: "pointer", fontSize: 12 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  cancel: { padding: "10px 18px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  submit: { padding: "10px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
};
