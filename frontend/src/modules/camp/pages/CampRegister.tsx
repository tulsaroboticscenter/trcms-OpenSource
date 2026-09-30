import { useState, useEffect } from "react";
import { campApi, type PublicRegistration, type PublicSession } from "../api";

/**
 * Public, no-login camp registration form — designed to be embedded on the
 * WordPress site via an iframe (renders bare, no app chrome). Lists whatever
 * camps are currently open, collects the standard fields + waivers, and posts a
 * "pending" registration. Honors the season's master on/off toggle.
 */
export default function CampRegister() {
  const [data, setData] = useState<PublicRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [f, setF] = useState<Record<string, string>>({});
  const [agree, setAgree] = useState({ liability: false, media: false, firstaid: false });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { campApi.publicRegistration().then(setData).catch(() => setData({ open: false, message: "We couldn't load camp registration. Please try again later." })).finally(() => setLoading(false)); }, []);

  function set(k: string, v: string) { setF((p) => ({ ...p, [k]: v })); }
  function togglePick(id: number) { setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (picked.size === 0) { setError("Please choose at least one camp."); return; }
    if (!f.guardian_name?.trim() || !f.guardian_email?.trim()) { setError("Your name and email are required."); return; }
    if (!f.camper_first_name?.trim()) { setError("The camper's first name is required."); return; }
    if (!f.camper_last_name?.trim()) { setError("The camper's last name is required."); return; }
    if (!agree.liability || !agree.firstaid) { setError("Please agree to the liability waiver and first-aid consent."); return; }
    setSubmitting(true);
    try {
      const res = await campApi.publicRegister({
        ...f, website,
        session_ids: Array.from(picked),
        marketing_consent: consent,
        waiver_liability_agreed: agree.liability,
        waiver_media_agreed: agree.media,
        waiver_firstaid_agreed: agree.firstaid,
      });
      setDone(res.message ?? "Your registration has been received!");
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  if (loading) return <div style={st.wrap}><p style={st.muted}>Loading…</p></div>;
  if (!data?.open) return <div style={st.wrap}><div style={st.card}><h2 style={st.h2}>Summer Camp Registration</h2><p style={st.muted}>{data?.message ?? "Registration is not open right now."}</p></div></div>;
  if (done) return <div style={st.wrap}><div style={st.card}><h2 style={st.h2}>✓ All set!</h2><p style={st.lead}>{done}</p></div></div>;

  const season = data.season!;
  const sessions = data.sessions ?? [];

  return (
    <div style={st.wrap}>
      <form style={st.card} onSubmit={submit}>
        <h2 style={st.h2}>{season.name} — Registration</h2>
        {season.intro_text && <p style={st.lead}>{season.intro_text}</p>}

        {/* Camp selection */}
        <h3 style={st.h3}>1. Choose your camp(s)</h3>
        {sessions.length === 0 && <p style={st.muted}>No camps are open for registration right now.</p>}
        {sessions.map((s) => <CampOption key={s.id} s={s} checked={picked.has(s.id)} onToggle={() => togglePick(s.id)} />)}

        {/* Camper */}
        <h3 style={st.h3}>2. Camper information</h3>
        <div style={st.grid}>
          <F label="Camper first name *"><input style={st.in} value={f.camper_first_name ?? ""} onChange={(e) => set("camper_first_name", e.target.value)} /></F>
          <F label="Camper last name *"><input style={st.in} value={f.camper_last_name ?? ""} onChange={(e) => set("camper_last_name", e.target.value)} /></F>
          <F label="Grade (this fall)"><input style={st.in} value={f.camper_grade ?? ""} onChange={(e) => set("camper_grade", e.target.value)} /></F>
          <F label="School"><input style={st.in} value={f.camper_school ?? ""} onChange={(e) => set("camper_school", e.target.value)} /></F>
          <F label="T-shirt size"><input style={st.in} value={f.shirt_size ?? ""} onChange={(e) => set("shirt_size", e.target.value)} placeholder="e.g. Youth M, Adult L" /></F>
        </div>
        <F label="Accommodations or supports needed in a group/educational setting"><textarea style={st.ta} value={f.accommodations ?? ""} onChange={(e) => set("accommodations", e.target.value)} /></F>
        <F label="Medical conditions or special learning needs to be aware of"><textarea style={st.ta} value={f.medical_notes ?? ""} onChange={(e) => set("medical_notes", e.target.value)} /></F>
        <div style={st.grid}>
          <F label="Food allergies / sensitivities"><input style={st.in} value={f.food_allergies ?? ""} onChange={(e) => set("food_allergies", e.target.value)} /></F>
          <F label="Prior experience with the subject"><input style={st.in} value={f.prior_experience ?? ""} onChange={(e) => set("prior_experience", e.target.value)} /></F>
        </div>

        {/* Guardian */}
        <h3 style={st.h3}>3. Parent / guardian (completing this form)</h3>
        <div style={st.grid}>
          <F label="Your name *"><input style={st.in} value={f.guardian_name ?? ""} onChange={(e) => set("guardian_name", e.target.value)} /></F>
          <F label="Your email *"><input type="email" style={st.in} value={f.guardian_email ?? ""} onChange={(e) => set("guardian_email", e.target.value)} /></F>
          <F label="Your phone"><input style={st.in} value={f.guardian_phone ?? ""} onChange={(e) => set("guardian_phone", e.target.value)} /></F>
        </div>

        {/* Emergency contacts */}
        <h3 style={st.h3}>4. Emergency contacts</h3>
        <div style={st.grid}>
          <F label="Contact 1 name"><input style={st.in} value={f.emergency1_name ?? ""} onChange={(e) => set("emergency1_name", e.target.value)} /></F>
          <F label="Relation"><input style={st.in} value={f.emergency1_relation ?? ""} onChange={(e) => set("emergency1_relation", e.target.value)} /></F>
          <F label="Daytime phone"><input style={st.in} value={f.emergency1_phone ?? ""} onChange={(e) => set("emergency1_phone", e.target.value)} /></F>
          <F label="Contact 2 name"><input style={st.in} value={f.emergency2_name ?? ""} onChange={(e) => set("emergency2_name", e.target.value)} /></F>
          <F label="Relation"><input style={st.in} value={f.emergency2_relation ?? ""} onChange={(e) => set("emergency2_relation", e.target.value)} /></F>
          <F label="Daytime phone"><input style={st.in} value={f.emergency2_phone ?? ""} onChange={(e) => set("emergency2_phone", e.target.value)} /></F>
        </div>

        {/* Waivers */}
        <h3 style={st.h3}>5. Agreements</h3>
        {season.waiver_liability && <Waiver text={season.waiver_liability} checked={agree.liability} onChange={(v) => setAgree((a) => ({ ...a, liability: v }))} label="I agree to the Liability Waiver (required)" />}
        {season.waiver_firstaid && <Waiver text={season.waiver_firstaid} checked={agree.firstaid} onChange={(v) => setAgree((a) => ({ ...a, firstaid: v }))} label="I consent to first-aid / emergency care (required)" />}
        {season.waiver_media && <Waiver text={season.waiver_media} checked={agree.media} onChange={(v) => setAgree((a) => ({ ...a, media: v }))} label="I agree to the Media Release (optional)" />}

        {/* Payment + consent + notes */}
        <h3 style={st.h3}>6. Finish up</h3>
        <div style={st.grid}>
          <F label="How will you pay?">
            <select style={st.in} value={f.payment_method ?? ""} onChange={(e) => set("payment_method", e.target.value)}>
              <option value="">Select…</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="card">Card / online (we'll send details)</option>
              <option value="scholarship">Scholarship request</option>
            </select>
          </F>
        </div>
        <F label="Notes or questions for the organizers"><textarea style={st.ta} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></F>
        <label style={st.check}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> It's OK to email me about future TRC camps and programs.</label>

        {/* Honeypot — hidden from humans */}
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} aria-hidden="true" />

        {error && <div style={st.err}>{error}</div>}
        <button type="submit" style={{ ...st.submit, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit registration"}
        </button>
        <p style={st.fineprint}>Your information is used only to run the camp and is not sold or shared.</p>
      </form>
    </div>
  );
}

function CampOption({ s, checked, onToggle }: { s: PublicSession; checked: boolean; onToggle: () => void }) {
  const meta = [s.program_name, s.age_band,
    s.start_date && `${s.start_date}${s.end_date ? " – " + s.end_date : ""}`,
    s.start_time && `${s.start_time}${s.end_time ? "–" + s.end_time : ""}`,
    s.price != null && `$${s.price.toFixed(2)}`,
    s.spots_left != null && !s.is_full && `${s.spots_left} spots left`,
  ].filter(Boolean).join(" · ");
  return (
    <label style={{ ...st.camp, ...(checked ? st.campOn : {}), ...(s.is_full ? st.campFull : {}) }}>
      <input type="checkbox" checked={checked} disabled={s.is_full} onChange={onToggle} style={{ marginTop: 3 }} />
      <span style={{ flex: 1 }}>
        <span style={st.campTitle}>{s.title}{s.is_full && <span style={st.fullTag}>FULL</span>}</span>
        {meta && <span style={st.campMeta}>{meta}</span>}
        {s.public_blurb && <span style={st.campBlurb}>{s.public_blurb}</span>}
      </span>
    </label>
  );
}

function Waiver({ text, checked, onChange, label }: { text: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div style={st.waiver}>
      <div style={st.waiverText}>{text}</div>
      <label style={st.check}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.lbl}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a2733" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  h2: { margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  h3: { margin: "22px 0 8px", fontSize: 15, fontWeight: 700, color: "#1a3a5c", borderBottom: "2px solid #eef2f7", paddingBottom: 5 },
  lead: { fontSize: 14, color: "#445", lineHeight: 1.6, margin: "0 0 6px" },
  muted: { color: "#888", fontSize: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px 14px", marginBottom: 6 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  in: { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  ta: { width: "100%", minHeight: 56, padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, resize: "vertical", boxSizing: "border-box" },
  camp: { display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid #e2e8f0", borderRadius: 9, padding: "11px 13px", marginBottom: 8, cursor: "pointer" },
  campOn: { borderColor: "#1565c0", background: "#f3f8ff" },
  campFull: { opacity: 0.55, cursor: "not-allowed" },
  campTitle: { display: "block", fontWeight: 700, color: "#1a3a5c", fontSize: 15 },
  fullTag: { fontSize: 10, fontWeight: 800, color: "#c62828", background: "#fdecea", borderRadius: 8, padding: "1px 7px", marginLeft: 8 },
  campMeta: { display: "block", fontSize: 12.5, color: "#667", marginTop: 2 },
  campBlurb: { display: "block", fontSize: 13, color: "#445", marginTop: 5, lineHeight: 1.5 },
  waiver: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 10, background: "#fafbfc" },
  waiverText: { fontSize: 11.5, color: "#667", maxHeight: 120, overflowY: "auto", lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 8, padding: "4px 0" },
  check: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, color: "#334", margin: "8px 0", cursor: "pointer", lineHeight: 1.4 },
  err: { background: "#fdecea", border: "1px solid #f5c2c0", color: "#c62828", borderRadius: 8, padding: "10px 13px", fontSize: 13.5, margin: "14px 0" },
  submit: { width: "100%", padding: "13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 16, marginTop: 16 },
  fineprint: { fontSize: 11.5, color: "#99a", textAlign: "center", marginTop: 10 },
};
