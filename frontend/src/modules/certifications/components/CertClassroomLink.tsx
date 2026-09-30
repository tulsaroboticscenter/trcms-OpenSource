/**
 * CertClassroomLink — the program settings banner at the top of the certification views.
 * Links to the TRC Google Classroom (managers can edit it), and — for admins — carries the
 * go-live switch for the Certification Quiz Engine (hidden until turned on). Renders nothing
 * for a non-manager with nothing to show.
 */
import { useState, useEffect } from "react";
import { certApi, type CertSettings } from "../api";
import { GraduationCap, ExternalLink, Pencil, Check, X, FileQuestion } from "lucide-react";

export default function CertClassroomLink() {
  const [s, setS] = useState<CertSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLms, setBusyLms] = useState(false);

  useEffect(() => { certApi.getSettings().then(setS).catch(() => setS(null)); }, []);
  if (!s) return null;
  const showLink = !!s.classroom_url || !!s.can_manage;
  const showLms = !!s.can_manage_lms;
  if (!showLink && !showLms) return null;

  async function saveLink() {
    setBusy(true); setErr("");
    try {
      const next = await certApi.updateSettings({ classroom_url: url.trim() });
      setS(next); setEditing(false);
    } catch (e) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setBusy(false); }
  }

  async function toggleLms(next: boolean) {
    setBusyLms(true);
    try {
      const r = await certApi.updateSettings({ lms_enabled: next });
      setS((cur) => (cur ? { ...cur, lms_enabled: r.lms_enabled } : cur));
    } finally { setBusyLms(false); }
  }

  return (
    <>
      {showLink && (
        editing ? (
          <div style={st.wrap}>
            <GraduationCap size={16} color="#1a73e8" style={{ flexShrink: 0 }} />
            <input style={st.input} value={url} autoFocus placeholder="https://classroom.google.com/…"
              onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveLink(); }} />
            <button style={st.iconBtn} onClick={saveLink} disabled={busy} title="Save"><Check size={16} color="#2e7d32" /></button>
            <button style={st.iconBtn} onClick={() => setEditing(false)} title="Cancel"><X size={16} color="#888" /></button>
            {err && <span style={st.err}>{err}</span>}
          </div>
        ) : (
          <div style={st.wrap}>
            <GraduationCap size={16} color="#1a73e8" style={{ flexShrink: 0 }} />
            {s.classroom_url ? (
              <a style={st.link} href={s.classroom_url} target="_blank" rel="noopener noreferrer">
                TRC Google Classroom for Certifications <ExternalLink size={12} style={{ verticalAlign: -1 }} />
              </a>
            ) : (
              <span style={st.muted}>No Google Classroom link set.</span>
            )}
            {s.can_manage && (
              <button style={st.editBtn} onClick={() => { setUrl(s.classroom_url ?? ""); setEditing(true); }}>
                <Pencil size={12} /> {s.classroom_url ? "Edit" : "Add link"}
              </button>
            )}
          </div>
        )
      )}

      {showLms && (
        <div style={st.lmsWrap}>
          <FileQuestion size={16} color="#6a1b9a" style={{ flexShrink: 0 }} />
          <div style={st.lmsBody}>
            <div style={st.lmsTitle}>
              In-app certification quizzes
              <span style={{ ...st.badge, ...(s.lms_enabled ? st.badgeOn : st.badgeOff) }}>
                {s.lms_enabled ? "Live for members" : "Hidden — admins only"}
              </span>
            </div>
            <div style={st.lmsHint}>
              {s.lms_enabled
                ? "Members with the “Take Certification Quizzes” permission can take published quizzes and earn certifications automatically."
                : "Only admins can see quizzes right now. Turn this on when you're ready, then grant the “Take Certification Quizzes” permission to the roles who should take them."}
            </div>
          </div>
          <button style={s.lms_enabled ? st.lmsOff : st.lmsOn} onClick={() => toggleLms(!s.lms_enabled)} disabled={busyLms}>
            {busyLms ? "Saving…" : s.lms_enabled ? "Turn off" : "Enable for members"}
          </button>
        </div>
      )}
    </>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", background: "#eef4fd", border: "1px solid #cfe0fb", borderRadius: 8, marginBottom: 12 },
  link: { color: "#1a56c4", fontWeight: 600, fontSize: 13, textDecoration: "none" },
  muted: { color: "#7d8896", fontSize: 13, fontStyle: "italic" },
  editBtn: { display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto", background: "#fff", color: "#1a56c4", border: "1px solid #cfe0fb", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "3px 9px" },
  input: { flex: 1, minWidth: 160, padding: "6px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", padding: 3, display: "flex" },
  err: { color: "#c62828", fontSize: 12, width: "100%" },

  lmsWrap: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px", background: "#f7f2fb", border: "1px solid #e2d5f0", borderRadius: 8, marginBottom: 12 },
  lmsBody: { flex: 1, minWidth: 0 },
  lmsTitle: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", fontSize: 13.5, fontWeight: 700, color: "#4a2a63" },
  lmsHint: { fontSize: 12, color: "#6a5a78", marginTop: 3, lineHeight: 1.45 },
  badge: { fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 9px", textTransform: "uppercase", letterSpacing: ".03em" },
  badgeOn: { color: "#2e7d32", background: "#e6f4ea" },
  badgeOff: { color: "#a5651a", background: "#f6ecda" },
  lmsOn: { background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  lmsOff: { background: "#fff", color: "#6a1b9a", border: "1px solid #d9c9ec", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
};
