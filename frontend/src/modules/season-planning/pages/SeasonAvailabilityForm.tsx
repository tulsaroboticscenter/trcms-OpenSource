/**
 * SeasonAvailabilityForm — the tokenized, no-login family availability form.
 * Reached from an emailed link (/season-availability/:token). Resolves to the
 * whole family, pre-filling any answers already entered (so a co-parent sees
 * what the other parent submitted). Collects, per parent: whether they'll
 * mentor; per parent AND youth: which nights work. Nothing else is editable.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, CalendarClock, Users } from "lucide-react";
import { seasonPlanningApi, type AvailForm, type AvailResponse } from "../api";

type Pref = "preferred" | "ok" | "no";
const MENTOR_OPTS: { v: "lead" | "assist" | "admin" | "no"; label: string }[] = [
  { v: "lead", label: "Yes — I can lead a team" },
  { v: "assist", label: "I can help, but not lead" },
  { v: "admin", label: "I'll help with admin/other tasks" },
  { v: "no", label: "Not this season" },
];

export default function SeasonAvailabilityForm() {
  const { token } = useParams<{ token: string }>();
  const [form, setForm] = useState<AvailForm | null>(null);
  const [resp, setResp] = useState<Record<number, AvailResponse>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    seasonPlanningApi.resolveInvite(token)
      .then((f) => {
        setForm(f);
        // Seed editable state from any existing answers.
        const seed: Record<number, AvailResponse> = {};
        for (const m of f.members) {
          seed[m.member_id] = m.availability
            ? { member_id: m.member_id, mentor_willing: m.availability.mentor_willing,
                flexible: m.availability.flexible, night_prefs: { ...m.availability.night_prefs },
                siblings_together: m.availability.siblings_together, notes: m.availability.notes ?? undefined }
            : { member_id: m.member_id, flexible: false, night_prefs: {} };
        }
        setResp(seed);
      })
      .catch((e) => setError(e?.response?.data?.detail ?? "This link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  function setMember(id: number, patch: Partial<AvailResponse>) {
    setResp((r) => ({ ...r, [id]: { ...r[id], member_id: id, ...patch } }));
  }
  function setNight(id: number, nightId: number, pref: Pref) {
    setResp((r) => {
      const prefs = { ...(r[id]?.night_prefs ?? {}) };
      prefs[nightId] = pref;
      return { ...r, [id]: { ...r[id], member_id: id, night_prefs: prefs } };
    });
  }

  async function submit() {
    if (!token) return;
    setSaving(true); setError("");
    try {
      await seasonPlanningApi.submitInvite(token, Object.values(resp));
      setDone(true);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save. Please try again.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={s.center}>Loading…</div>;
  if (error && !form) return <div style={s.page}><div style={s.card}><p style={s.err}>{error}</p></div></div>;
  if (!form) return null;

  if (done) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: "center" }}>
          <CheckCircle size={56} color="#2e7d32" style={{ margin: "0 auto 14px" }} />
          <h2 style={{ ...s.h2, color: "#2e7d32" }}>Thank you!</h2>
          <p style={s.intro}>Your family's availability has been recorded for the {form.season} season. You can reopen this link any time to update it.</p>
          <button style={s.primary} onClick={() => setDone(false)}>Review / edit again</button>
        </div>
      </div>
    );
  }

  const guardians = form.members.filter((m) => m.is_guardian);
  const youth = form.members.filter((m) => !m.is_guardian);

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div style={s.trcTitle}>Tulsa Robotics Center</div>
        <div style={s.trcSub}>{form.program_name ? `${form.program_name} — ` : ""}Season Availability · {form.season}</div>
      </div>

      <div style={s.card}>
        <p style={s.intro}>
          Hi {form.family_name}! Help us plan the season by telling us which evenings work for your family and whether any
          parents can mentor. Anyone in your family can fill this in — answers already entered are shown below, and you can
          add to or change them. No login needed.
        </p>

        {guardians.length > 0 && (
          <>
            <div style={s.sectionHead}><Users size={16} /> Parents / Guardians</div>
            {guardians.map((m) => (
              <div key={m.member_id} style={s.member}>
                <div style={s.memberName}>
                  {m.name}
                  {m.availability?.submitted_by_name && <span style={s.byline}>answered by {m.availability.submitted_by_name}</span>}
                </div>
                <label style={s.fieldLabel}>Are you willing to mentor?</label>
                <div style={s.radioCol}>
                  {MENTOR_OPTS.map((o) => (
                    <label key={o.v} style={{ ...s.radio, ...(resp[m.member_id]?.mentor_willing === o.v ? s.radioOn : {}) }}>
                      <input type="radio" name={`mw_${m.member_id}`} checked={resp[m.member_id]?.mentor_willing === o.v} onChange={() => setMember(m.member_id, { mentor_willing: o.v })} />
                      {o.label}
                    </label>
                  ))}
                </div>
                <NightGrid nights={form.nights} value={resp[m.member_id]} onNight={(nid, p) => setNight(m.member_id, nid, p)}
                  flexible={!!resp[m.member_id]?.flexible} onFlexible={(v) => setMember(m.member_id, { flexible: v })} who="you" />
              </div>
            ))}
          </>
        )}

        {youth.length > 0 && (
          <>
            <div style={s.sectionHead}><CalendarClock size={16} /> Youth</div>
            {youth.map((m) => (
              <div key={m.member_id} style={s.member}>
                <div style={s.memberName}>{m.name}</div>
                <NightGrid nights={form.nights} value={resp[m.member_id]} onNight={(nid, p) => setNight(m.member_id, nid, p)}
                  flexible={!!resp[m.member_id]?.flexible} onFlexible={(v) => setMember(m.member_id, { flexible: v })} who="this youth" />
              </div>
            ))}
          </>
        )}

        {form.nights.length === 0 && <p style={s.err}>The season's nights haven't been set up yet. Please check back soon.</p>}
        {error && <div style={s.err}>{error}</div>}
        <button style={s.primary} onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save our availability"}</button>
      </div>
    </div>
  );
}

function NightGrid({ nights, value, onNight, flexible, onFlexible, who }: {
  nights: { id: number; name: string }[];
  value?: AvailResponse;
  onNight: (nightId: number, pref: Pref) => void;
  flexible: boolean; onFlexible: (v: boolean) => void; who: string;
}) {
  const PREFS: { v: Pref; label: string; color: string }[] = [
    { v: "preferred", label: "Preferred", color: "#2e7d32" },
    { v: "ok", label: "Works", color: "#1565c0" },
    { v: "no", label: "Can't", color: "#c62828" },
  ];
  return (
    <div style={{ marginTop: 8 }}>
      <label style={s.fieldLabel}>Which evenings work for {who}?</label>
      <label style={s.flexRow}>
        <input type="checkbox" checked={flexible} onChange={(e) => onFlexible(e.target.checked)} /> Flexible — any night works
      </label>
      {!flexible && nights.map((n) => (
        <div key={n.id} style={s.nightRow}>
          <span style={s.nightName}>{n.name}</span>
          <div style={s.prefBtns}>
            {PREFS.map((p) => {
              const on = value?.night_prefs?.[n.id] === p.v;
              return (
                <button key={p.v} type="button" onClick={() => onNight(n.id, p.v)}
                  style={{ ...s.prefBtn, ...(on ? { background: p.color, color: "#fff", borderColor: p.color } : {}) }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 680, margin: "0 auto", padding: "3vh 16px" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  topBar: { textAlign: "center", marginBottom: 18 },
  trcTitle: { fontSize: 26, fontWeight: 900, color: "#1a3a5c" },
  trcSub: { fontSize: 13, color: "#666", marginTop: 2 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.6rem" },
  h2: { margin: "0 0 10px", fontSize: 20, fontWeight: 700, color: "#1a3a5c" },
  intro: { fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 16 },
  sectionHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, margin: "18px 0 8px" },
  member: { border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 12 },
  memberName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  byline: { fontSize: 11, fontWeight: 500, color: "#8894a5", background: "#f0f4f8", borderRadius: 8, padding: "1px 8px" },
  fieldLabel: { display: "block", fontSize: 12.5, fontWeight: 700, color: "#455", margin: "10px 0 6px" },
  radioCol: { display: "flex", flexDirection: "column", gap: 6 },
  radio: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5, cursor: "pointer", color: "#333" },
  radioOn: { borderColor: "#1565c0", background: "#eef4fb", fontWeight: 600 },
  flexRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#333", marginBottom: 8, cursor: "pointer" },
  nightRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 0" },
  nightName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  prefBtns: { display: "flex", gap: 6 },
  prefBtn: { padding: "6px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 16, fontSize: 12.5, fontWeight: 600, color: "#556", cursor: "pointer" },
  primary: { marginTop: 16, width: "100%", padding: "12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: "pointer" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "10px 14px", color: "#c62828", fontSize: 13.5, marginTop: 12 },
};
