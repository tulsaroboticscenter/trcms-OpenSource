import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { membersApi } from "../api";
import { useGoBack } from "../../../core/useGoBack";
import PhoneInput from "../../../core/components/PhoneInput";
import { SeasonParticipationPanel } from "../../seasons";
import { Save, CheckCircle, ArrowLeft } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";
import { GRADE_OPTIONS, gradeFromGradYear, gradYearFromGrade } from "../../../core/grade";

/**
 * Parent-facing edit page for one of their youth. Parents can update the same
 * profile fields they can on their own record (no account/admin fields). The
 * backend authorizes the edit only when the parent shares a family with the youth.
 */
const FIELDS = [
  "first_name", "middle_name", "last_name", "birthday", "graduation_year", "school", "shirt_size",
  "email", "alt_email1", "alt_email2", "phone", "address_line1", "address_line2", "city", "state", "zip_code",
  "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship",
  "emergency_contact2_name", "emergency_contact2_phone", "emergency_contact2_relationship",
  "guardian1_name", "guardian1_phone", "guardian1_email", "guardian2_name", "guardian2_phone", "guardian2_email",
  "sex", "race", "special_notes",
] as const;
type Field = typeof FIELDS[number];

const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL"];
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export default function ParentYouthEdit() {
  const { id } = useParams<{ id: string }>();
  const youthId = parseInt(id!);
  const { user } = useAuth();
  const seasonYear = user?.enrollment_status?.enrollment_year ?? new Date().getFullYear();
  const goBack = useGoBack("/");
  const [form, setForm] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [alt1On, setAlt1On] = useState(false);
  const [alt2On, setAlt2On] = useState(false);

  useEffect(() => {
    membersApi.get(youthId).then((m: Record<string, unknown>) => {
      const f: Record<string, string> = {};
      for (const k of FIELDS) f[k] = m[k] != null ? String(m[k]) : "";
      setForm(f);
      setAlt1On(!!m.alt_email1_enabled);
      setAlt2On(!!m.alt_email2_enabled);
      setName(`${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
    }).catch(() => setError("Could not load this youth's record. You may not have access.")).finally(() => setLoading(false));
  }, [youthId]);

  function set(k: Field, v: string) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); }

  async function save() {
    setSaving(true); setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const k of FIELDS) payload[k] = form[k]?.trim() ? (k === "graduation_year" ? parseInt(form[k]) : form[k].trim()) : null;
      payload.alt_email1_enabled = alt1On;
      payload.alt_email2_enabled = alt2On;
      await membersApi.update(youthId, payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save changes.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back</button>
      <h1 style={st.heading}>Edit {name || "Youth"}</h1>
      <p style={st.sub}>Update your youth's information below. Changes save to their record.</p>

      {error && <div style={st.error}>{error}</div>}

      <Section title="Name">
        <Grid>
          <F label="First Name"><input style={st.input} value={form.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></F>
          <F label="Middle Name"><input style={st.input} value={form.middle_name ?? ""} onChange={(e) => set("middle_name", e.target.value)} /></F>
          <F label="Last Name"><input style={st.input} value={form.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></F>
        </Grid>
      </Section>

      <Section title="Personal">
        <Grid>
          <F label="Birthday"><input type="date" style={st.input} value={form.birthday ?? ""} onChange={(e) => set("birthday", e.target.value)} /></F>
          {/* Grade and graduation year are one value seen two ways — set either and
              the other follows. Only graduation_year is saved, so the grade moves up
              on its own each season. Asked here alongside shirt size because both are
              the things that go stale between seasons. */}
          <F label="Grade this season">
            <select
              style={st.input}
              value={form.graduation_year ? String(gradeFromGradYear(parseInt(form.graduation_year), seasonYear)) : ""}
              onChange={(e) => set("graduation_year", e.target.value === "" ? "" : String(gradYearFromGrade(parseInt(e.target.value), seasonYear)))}
            >
              <option value="">— please select —</option>
              {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </F>
          <F label="Graduation Year"><input type="number" style={st.input} value={form.graduation_year ?? ""} onChange={(e) => set("graduation_year", e.target.value)} /></F>
          <F label="School"><input style={st.input} value={form.school ?? ""} onChange={(e) => set("school", e.target.value)} /></F>
          <F label="Shirt Size">
            <select style={st.input} value={form.shirt_size ?? ""} onChange={(e) => set("shirt_size", e.target.value)}>
              <option value="">Select…</option>
              {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </F>
          <F label="Sex">
            <select style={st.input} value={form.sex ?? ""} onChange={(e) => set("sex", e.target.value)}>
              <option value="">Prefer not to say</option>
              {["Male", "Female", "Non-binary", "Other"].map((s) => <option key={s} value={s}>{s === "Other" ? "Other / Self-describe" : s}</option>)}
            </select>
          </F>
          <F label="Race / Ethnicity">
            <select style={st.input} value={form.race ?? ""} onChange={(e) => set("race", e.target.value)}>
              <option value="">Prefer not to say</option>
              {["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Native Hawaiian or Pacific Islander", "White", "Two or more races", "Other"].map((r) => <option key={r} value={r}>{r === "Other" ? "Other / Self-describe" : r}</option>)}
            </select>
          </F>
        </Grid>
        <p style={{ ...st.note, textTransform: "none", fontWeight: 400, marginTop: 8 }}>
          Demographic details are optional and used only for grant reporting. Choose “Prefer not to say” to leave them blank.
        </p>
      </Section>

      <Section title="Contact">
        <Grid>
          <F label="Email"><input type="email" style={st.input} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></F>
          <F label="Phone"><PhoneInput style={st.input} value={form.phone ?? ""} onChange={(v) => set("phone", v)} /></F>
        </Grid>
        <Grid>
          <F label="Alternate Email 1">
            <input type="email" style={st.input} value={form.alt_email1 ?? ""} onChange={(e) => set("alt_email1", e.target.value)} />
            <label style={st.altCheck}><input type="checkbox" checked={alt1On} onChange={(e) => { setAlt1On(e.target.checked); setSaved(false); }} /> Also send emails here</label>
          </F>
          <F label="Alternate Email 2">
            <input type="email" style={st.input} value={form.alt_email2 ?? ""} onChange={(e) => set("alt_email2", e.target.value)} />
            <label style={st.altCheck}><input type="checkbox" checked={alt2On} onChange={(e) => { setAlt2On(e.target.checked); setSaved(false); }} /> Also send emails here</label>
          </F>
          <span />
        </Grid>
        <Grid>
          <F label="Address Line 1"><input style={st.input} value={form.address_line1 ?? ""} onChange={(e) => set("address_line1", e.target.value)} /></F>
          <F label="Address Line 2"><input style={st.input} value={form.address_line2 ?? ""} onChange={(e) => set("address_line2", e.target.value)} /></F>
          <span />
          <F label="City"><input style={st.input} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></F>
          <F label="State">
            <select style={st.input} value={form.state ?? ""} onChange={(e) => set("state", e.target.value)}>
              <option value="">Select…</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </F>
          <F label="ZIP"><input style={st.input} value={form.zip_code ?? ""} onChange={(e) => set("zip_code", e.target.value)} /></F>
        </Grid>
      </Section>

      <Section title="Emergency Contact">
        <Grid>
          <F label="Name"><input style={st.input} value={form.emergency_contact_name ?? ""} onChange={(e) => set("emergency_contact_name", e.target.value)} /></F>
          <F label="Phone"><PhoneInput style={st.input} value={form.emergency_contact_phone ?? ""} onChange={(v) => set("emergency_contact_phone", v)} /></F>
          <F label="Relationship"><input style={st.input} value={form.emergency_contact_relationship ?? ""} onChange={(e) => set("emergency_contact_relationship", e.target.value)} /></F>
          <F label="2nd Contact Name"><input style={st.input} value={form.emergency_contact2_name ?? ""} onChange={(e) => set("emergency_contact2_name", e.target.value)} /></F>
          <F label="2nd Contact Phone"><PhoneInput style={st.input} value={form.emergency_contact2_phone ?? ""} onChange={(v) => set("emergency_contact2_phone", v)} /></F>
          <F label="2nd Contact Relationship"><input style={st.input} value={form.emergency_contact2_relationship ?? ""} onChange={(e) => set("emergency_contact2_relationship", e.target.value)} /></F>
        </Grid>
      </Section>

      <Section title="Parent / Guardian">
        <p style={st.note}>Guardian 1</p>
        <Grid>
          <F label="Name"><input style={st.input} value={form.guardian1_name ?? ""} onChange={(e) => set("guardian1_name", e.target.value)} /></F>
          <F label="Phone"><PhoneInput style={st.input} value={form.guardian1_phone ?? ""} onChange={(v) => set("guardian1_phone", v)} /></F>
          <F label="Email"><input type="email" style={st.input} value={form.guardian1_email ?? ""} onChange={(e) => set("guardian1_email", e.target.value)} /></F>
        </Grid>
        <p style={st.note}>Guardian 2 (optional)</p>
        <Grid>
          <F label="Name"><input style={st.input} value={form.guardian2_name ?? ""} onChange={(e) => set("guardian2_name", e.target.value)} /></F>
          <F label="Phone"><PhoneInput style={st.input} value={form.guardian2_phone ?? ""} onChange={(v) => set("guardian2_phone", v)} /></F>
          <F label="Email"><input type="email" style={st.input} value={form.guardian2_email ?? ""} onChange={(e) => set("guardian2_email", e.target.value)} /></F>
        </Grid>
      </Section>

      <Section title="FIRST Robotics Participation">
        <p style={st.note}>Check off the games your youth participated in each season — including seasons before joining TRC.</p>
        <SeasonParticipationPanel memberId={youthId} canEdit />
      </Section>

      <Section title="Notes">
        <textarea style={st.textarea} value={form.special_notes ?? ""} onChange={(e) => set("special_notes", e.target.value)} />
      </Section>

      <div style={st.actions}>
        <button style={st.saveBtn} disabled={saving} onClick={save}>
          {saved ? <><CheckCircle size={15} /> Saved</> : <><Save size={15} /> {saving ? "Saving…" : "Save Changes"}</>}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={st.section}><h3 style={st.sectionTitle}>{title}</h3>{children}</div>;
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px", marginBottom: 8 }}>{children}</div>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.label}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: "0 0 4px", fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { color: "#666", fontSize: 14, margin: "0 0 18px" },
  error: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 14 },
  section: { background: "#fff", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 16, border: "1px solid #e2e8f0" },
  sectionTitle: { margin: "0 0 1rem", fontSize: 14, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "2px solid #e2e8f0", paddingBottom: 8 },
  note: { margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical", boxSizing: "border-box" },
  actions: { display: "flex", justifyContent: "flex-end", marginTop: 8, paddingBottom: 32 },
  saveBtn: { display: "flex", alignItems: "center", gap: 7, padding: "11px 28px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  muted: { color: "#aaa", fontSize: 14 },
  altCheck: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555", marginTop: 4, cursor: "pointer" },
};
