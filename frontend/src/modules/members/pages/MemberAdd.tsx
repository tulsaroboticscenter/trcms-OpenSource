import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../../../core/api";
import { familiesApi } from "../../families/api";
import { visitorsApi } from "../../visitors/api";
import HelpTip from "../../../core/components/HelpTip";
import PhoneInput from "../../../core/components/PhoneInput";
import { useGoBack } from "../../../core/useGoBack";

interface FormData {
  // Account
  username: string;
  member_type: string;
  // Name
  first_name: string;
  middle_name: string;
  last_name: string;
  // Personal
  birthday: string;
  graduation_year: string;
  school: string;
  robotics_experience_years: string;
  // Contact
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  // Emergency contact
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  // Guardian 1
  guardian1_name: string;
  guardian1_phone: string;
  guardian1_email: string;
  // Guardian 2
  guardian2_name: string;
  guardian2_phone: string;
  guardian2_email: string;
  // Demographics (admin/grant reporting)
  sex: string;
  race: string;
  // Employer & matching gifts (adults)
  employer_name: string;
  employer_job_title: string;
  employer_matches_donations: string;   // yes | no | unsure | ""
  employer_volunteer_grants: string;
  employer_offers_grants: string;
  employer_program_info: string;
  employer_matching_help: string;       // "1" when checked
  employer_notes: string;
  // Notes
  special_notes: string;
}

const blank: FormData = {
  username: "", member_type: "youth",
  first_name: "", middle_name: "", last_name: "",
  birthday: "", graduation_year: "", school: "", robotics_experience_years: "0",
  sex: "", race: "",
  email: "", phone: "",
  address_line1: "", address_line2: "", city: "", state: "", zip_code: "",
  emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relationship: "",
  guardian1_name: "", guardian1_phone: "", guardian1_email: "",
  guardian2_name: "", guardian2_phone: "", guardian2_email: "",
  employer_name: "", employer_job_title: "", employer_matches_donations: "", employer_volunteer_grants: "",
  employer_offers_grants: "", employer_program_info: "", employer_matching_help: "", employer_notes: "",
  special_notes: "",
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

export default function MemberAdd() {
  const navigate = useNavigate();
  const goBack = useGoBack("/members");
  const location = useLocation();
  // Optional prefill passed via navigation state (e.g. "Create Parent Profile")
  const navState = location.state as { prefill?: Partial<FormData>; parentLink?: { childId: number; lastName: string } } | null;
  const prefill = navState?.prefill;
  const parentLink = navState?.parentLink;
  // When arriving from "Convert to Member", prefill from the visitor and, on save,
  // link the new member back to that visitor (which also carries night prefs + waitlist).
  const visitorId = new URLSearchParams(location.search).get("visitor_id");
  const [form, setForm] = useState<FormData>({ ...blank, ...(prefill ?? {}) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");
  const [prefilledFromVisitor, setPrefilledFromVisitor] = useState(false);
  const usernameTouched = useRef(false);

  // Suggest a unique username from the name until the operator edits it themselves.
  useEffect(() => {
    const first = form.first_name.trim(), last = form.last_name.trim();
    if (usernameTouched.current || (!first && !last)) return;
    const t = setTimeout(() => {
      api.get(`/api/v1/members/suggest-username?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}`)
        .then(({ data }) => { if (!usernameTouched.current) setForm((f) => ({ ...f, username: data.username })); })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [form.first_name, form.last_name]);

  useEffect(() => {
    if (!visitorId) return;
    visitorsApi.getPrefill(parseInt(visitorId)).then((v: Record<string, string | null>) => {
      setForm((f) => ({
        ...f,
        first_name: v.first_name || f.first_name,
        middle_name: v.middle_name || f.middle_name,
        last_name: v.last_name || f.last_name,
        birthday: (v.birthday || "").split("T")[0] || f.birthday,
        email: v.email || f.email,
        phone: v.phone || f.phone,
        address_line1: v.address_line1 || f.address_line1,
        address_line2: v.address_line2 || f.address_line2,
        city: v.city || f.city,
        state: v.state || f.state,
        zip_code: v.zip_code || f.zip_code,
        guardian1_name: v.guardian1_name || f.guardian1_name,
        guardian1_phone: v.guardian1_phone || f.guardian1_phone,
        guardian1_email: v.guardian1_email || f.guardian1_email,
        special_notes: v.additional_info || f.special_notes,
      }));
      setPrefilledFromVisitor(true);
    }).catch(() => { /* ignore — operator can still fill in manually */ });
  }, [visitorId]);

  function set(field: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = "Required";
    if (!form.last_name.trim()) e.last_name = "Required";
    if (!form.username.trim()) e.username = "Required";
    if (!form.member_type) e.member_type = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      username: form.username,
      member_type: form.member_type,
      first_name: form.first_name,
      last_name: form.last_name,
    };
    const optionals: (keyof FormData)[] = [
      "middle_name","birthday","school","email","phone",
      "address_line1","address_line2","city","state","zip_code",
      "emergency_contact_name","emergency_contact_phone","emergency_contact_relationship",
      "guardian1_name","guardian1_phone","guardian1_email",
      "guardian2_name","guardian2_phone","guardian2_email",
      "sex","race",
      "special_notes",
    ];
    for (const f of optionals) {
      if (form[f]?.trim()) payload[f] = form[f].trim();
    }
    if (form.graduation_year) payload.graduation_year = parseInt(form.graduation_year);
    if (form.robotics_experience_years) payload.robotics_experience_years = parseInt(form.robotics_experience_years);
    // Employer & matching-gift info — adults only.
    if (form.member_type !== "youth") {
      const emp: (keyof FormData)[] = ["employer_name", "employer_job_title", "employer_matches_donations",
        "employer_volunteer_grants", "employer_offers_grants", "employer_program_info", "employer_notes"];
      for (const f of emp) if (form[f]?.trim()) payload[f] = form[f].trim();
      if (form.employer_matching_help === "1") payload.employer_matching_help = true;
    }
    return payload;
  }

  async function submit(allowDuplicate: boolean) {
    setSaving(true);
    setServerError("");
    try {
      const url = allowDuplicate ? "/api/v1/members/?allow_duplicate=true" : "/api/v1/members/";
      const res = await api.post(url, buildPayload());
      const newId = (res.data as { id?: number })?.id;
      let note = "Member added successfully.";
      // When this parent was created from a youth's profile, link them into a family.
      if (parentLink && newId) {
        const linked = await linkParentFamily(newId, parentLink.childId, parentLink.lastName);
        if (linked) note = `Parent added and linked to the ${parentLink.lastName} Family.`;
      }
      // Converting a visitor: link the new member to the visitor record so their history,
      // night preference, and any waitlist entry follow them (backend convert endpoint).
      if (visitorId && newId) {
        try {
          await visitorsApi.markConverted(parseInt(visitorId), newId);
          note = "Member added and converted from the visitor record.";
        } catch { /* best-effort — the member was still created */ }
      }
      navigate("/members", { state: { success: note } });
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string; duplicate?: { id: number; first_name: string; last_name: string; member_number: string } } } };
      const msg = e?.response?.data?.detail;
      // 409 = potential duplicate person — let the admin confirm and override
      if (e?.response?.status === 409) {
        const dup = e.response?.data?.duplicate;
        // Converting a visitor who is ALREADY a member (e.g. an import duplicate): offer to
        // MERGE into that member instead of creating a second record. Links the visitor,
        // moves their night pref + waitlist, fills blank member fields, and hides the visitor.
        if (visitorId && dup?.id) {
          if (confirm(`${msg}\n\nMerge this visitor into the existing member ${dup.first_name} ${dup.last_name} (#${dup.member_number})?\n\nTheir visitor history, night preference and any waitlist entry move to that member, any blank member fields are filled in from the visitor, and the visitor is hidden from the list. No new member is created.`)) {
            try {
              await visitorsApi.markConverted(parseInt(visitorId), dup.id);
              navigate(`/members/${dup.id}`, { state: { success: `Merged ${form.first_name} ${form.last_name} into the existing member.` } });
            } catch { setServerError("Could not merge into the existing member. Please try again."); }
            return;
          }
          // declined the merge — fall through to the usual "create anyway" prompt.
        }
        if (confirm(`${msg ?? "A similar member already exists."}\n\nCreate this member anyway?`)) {
          await submit(true);
          return;
        }
        setServerError(msg ?? "A similar member already exists.");
      } else {
        setServerError(msg ?? "Failed to save member. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Put the new parent and the youth in a family ("<LastName> Family"), tagging
  // the parent as "Parent" and the youth as "Child". Reuses the youth's existing
  // family if they already have one. Best-effort: never blocks the member create.
  async function linkParentFamily(parentId: number, childId: number, lastName: string): Promise<boolean> {
    try {
      let family = await familiesApi.getMemberFamily(childId);
      if (!family) {
        family = await familiesApi.create({ family_name: `${lastName} Family`, member_ids: [childId] });
      }
      // Ensure the youth is tagged as a Child.
      await familiesApi.updateMember(family.id, childId, { relationship_label: "Child" }).catch(() => {});
      // Add the parent (tagged Parent). If already present, just (re)label them.
      const already = family.members.some((m) => m.member_id === parentId);
      if (already) {
        await familiesApi.updateMember(family.id, parentId, { relationship_label: "Parent" });
      } else {
        await familiesApi.addMember(family.id, { member_id: parentId, relationship_label: "Parent" });
      }
      return true;
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await submit(false);
  }

  const isYouth = form.member_type === "youth";
  const isMentor = form.member_type === "mentor";

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <button onClick={goBack} style={styles.backBtn}>← Back to Members</button>
        <h1 style={styles.heading}>Add New Member</h1>
      </div>

      {prefilledFromVisitor && (
        <div style={styles.prefillBanner}>
          Prefilled from the visitor record — review and adjust, then save to convert them to a member.
          Their night preference and any waitlist entry will follow automatically.
        </div>
      )}

      <form onSubmit={handleSubmit}>

        {/* Account Info */}
        <Section title="Account Information">
          <Grid cols={3}>
            <Field label="Member Type *" error={errors.member_type}>
              <select
                style={{ ...styles.input, ...(errors.member_type ? styles.inputError : {}) }}
                value={form.member_type}
                onChange={(e) => set("member_type", e.target.value)}
              >
                <option value="youth">Youth Member</option>
                <option value="mentor">Mentor</option>
                <option value="parent">Parent</option>
                <option value="volunteer">Volunteer</option>
              </select>
            </Field>
            <Field label="Username *" error={errors.username}>
              <input style={{ ...styles.input, ...(errors.username ? styles.inputError : {}) }}
                value={form.username}
                onChange={(e) => { usernameTouched.current = true; set("username", e.target.value); }}
                autoComplete="off" />
              <span style={styles.hint}>Auto-suggested from the name — edit if you like.</span>
            </Field>
            <span />
          </Grid>
          <p style={styles.sectionNote}>
            A temporary password is set automatically; the member is prompted to choose their own at first sign-in.
          </p>
        </Section>

        {/* Name */}
        <Section title="Name">
          <Grid cols={3}>
            <Field label="First Name *" error={errors.first_name}>
              <input style={{ ...styles.input, ...(errors.first_name ? styles.inputError : {}) }}
                value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
            </Field>
            <Field label="Middle Name">
              <input style={styles.input} value={form.middle_name} onChange={(e) => set("middle_name", e.target.value)} />
            </Field>
            <Field label="Last Name *" error={errors.last_name}>
              <input style={{ ...styles.input, ...(errors.last_name ? styles.inputError : {}) }}
                value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
            </Field>
          </Grid>
        </Section>

        {/* Personal */}
        <Section title="Personal Information">
          <Grid cols={3}>
            <Field label="Birthday">
              <input type="date" style={styles.input} value={form.birthday} onChange={(e) => set("birthday", e.target.value)} />
            </Field>
            {isYouth && (
              <Field label="Graduation Year">
                <input type="number" style={styles.input} placeholder="e.g. 2028"
                  value={form.graduation_year} onChange={(e) => set("graduation_year", e.target.value)} />
              </Field>
            )}
            {isYouth && (
              <Field label="School">
                <input style={styles.input} value={form.school} onChange={(e) => set("school", e.target.value)} />
              </Field>
            )}
            <Field label="Years of Robotics Experience">
              <input type="text" disabled style={{ ...styles.input, background: "#f5f5f5", color: "#888" }}
                value="Auto-calculated from FIRST participation" />
            </Field>
          </Grid>
        </Section>

        {/* Demographics — for grant reporting */}
        <Section title={<>Demographics <HelpTip text="Optional. Collected for FIRST Robotics grant reporting only. All responses are kept confidential and never shared individually." /></>}>
          <Grid cols={3}>
            <Field label="Sex">
              <select style={styles.input} value={form.sex} onChange={(e) => set("sex", e.target.value)}>
                <option value="">Prefer not to say</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-binary">Non-binary</option>
                <option value="Other">Other / Self-describe</option>
              </select>
            </Field>
            <Field label="Race / Ethnicity">
              <select style={styles.input} value={form.race} onChange={(e) => set("race", e.target.value)}>
                <option value="">Prefer not to say</option>
                <option value="American Indian or Alaska Native">American Indian or Alaska Native</option>
                <option value="Asian">Asian</option>
                <option value="Black or African American">Black or African American</option>
                <option value="Hispanic or Latino">Hispanic or Latino</option>
                <option value="Native Hawaiian or Pacific Islander">Native Hawaiian or Pacific Islander</option>
                <option value="White">White</option>
                <option value="Two or more races">Two or more races</option>
                <option value="Other">Other / Self-describe</option>
              </select>
            </Field>
          </Grid>
          <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0" }}>
            This information is collected voluntarily for FIRST grant reporting purposes and is kept confidential.
          </p>
        </Section>

        {/* Contact */}
        <Section title="Contact Information">
          <Grid cols={3}>
            <Field label="Email">
              <input type="email" style={styles.input} value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Phone">
              <PhoneInput style={styles.input} value={form.phone} onChange={(v) => set("phone", v)} />
            </Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Address Line 1">
              <input style={styles.input} value={form.address_line1} onChange={(e) => set("address_line1", e.target.value)} />
            </Field>
            <Field label="Address Line 2">
              <input style={styles.input} value={form.address_line2} onChange={(e) => set("address_line2", e.target.value)} />
            </Field>
            <span />
            <Field label="City">
              <input style={styles.input} value={form.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="State">
              <select style={styles.input} value={form.state} onChange={(e) => set("state", e.target.value)}>
                <option value="">Select…</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="ZIP Code">
              <input style={styles.input} value={form.zip_code} onChange={(e) => set("zip_code", e.target.value)} />
            </Field>
          </Grid>
        </Section>

        {/* Emergency Contact */}
        <Section title="Emergency Contact">
          <Grid cols={3}>
            <Field label="Name">
              <input style={styles.input} value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} />
            </Field>
            <Field label="Phone">
              <PhoneInput style={styles.input} value={form.emergency_contact_phone} onChange={(v) => set("emergency_contact_phone", v)} />
            </Field>
            <Field label="Relationship">
              <input style={styles.input} value={form.emergency_contact_relationship} onChange={(e) => set("emergency_contact_relationship", e.target.value)} />
            </Field>
          </Grid>
        </Section>

        {/* Guardians — only for youth (parents/mentors/volunteers don't have guardians) */}
        {isYouth && (
          <Section title="Parent / Guardian Information">
            <p style={styles.sectionNote}>Guardian 1</p>
            <Grid cols={3}>
              <Field label="Name">
                <input style={styles.input} value={form.guardian1_name} onChange={(e) => set("guardian1_name", e.target.value)} />
              </Field>
              <Field label="Phone">
                <PhoneInput style={styles.input} value={form.guardian1_phone} onChange={(v) => set("guardian1_phone", v)} />
              </Field>
              <Field label="Email">
                <input type="email" style={styles.input} value={form.guardian1_email} onChange={(e) => set("guardian1_email", e.target.value)} />
              </Field>
            </Grid>
            <p style={styles.sectionNote}>Guardian 2 (optional)</p>
            <Grid cols={3}>
              <Field label="Name">
                <input style={styles.input} value={form.guardian2_name} onChange={(e) => set("guardian2_name", e.target.value)} />
              </Field>
              <Field label="Phone">
                <PhoneInput style={styles.input} value={form.guardian2_phone} onChange={(v) => set("guardian2_phone", v)} />
              </Field>
              <Field label="Email">
                <input type="email" style={styles.input} value={form.guardian2_email} onChange={(e) => set("guardian2_email", e.target.value)} />
              </Field>
            </Grid>
          </Section>
        )}

        {/* Employer & matching gifts — adults only (parents / mentors / volunteers) */}
        {!isYouth && (
          <Section title="Employer & Matching Gifts">
            <p style={styles.sectionNote}>
              Optional — many employers match donations or give volunteer grants (“Dollars for Doers”). Sharing this can turn into funding for TRC. Kept confidential to fundraising staff.
            </p>
            <Grid cols={2}>
              <Field label="Employer">
                <input style={styles.input} value={form.employer_name} onChange={(e) => set("employer_name", e.target.value)} />
              </Field>
              <Field label="Job Title">
                <input style={styles.input} value={form.employer_job_title} onChange={(e) => set("employer_job_title", e.target.value)} />
              </Field>
            </Grid>
            <Grid cols={3}>
              {([
                ["employer_matches_donations", "Matches employee donations?"],
                ["employer_volunteer_grants", "Volunteer grants (Dollars for Doers)?"],
                ["employer_offers_grants", "Offers grants for nonprofits?"],
              ] as const).map(([field, label]) => (
                <Field key={field} label={label}>
                  <select style={styles.input} value={form[field]} onChange={(e) => set(field, e.target.value)}>
                    <option value="">— not sure —</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="unsure">Not sure</option>
                  </select>
                </Field>
              ))}
            </Grid>
            <Field label="Program details / matching portal link">
              <input style={styles.input} value={form.employer_program_info}
                onChange={(e) => set("employer_program_info", e.target.value)} placeholder="e.g. a Benevity/YourCause link, or the HR/community-giving contact" />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#334", margin: "8px 0" }}>
              <input type="checkbox" checked={form.employer_matching_help === "1"}
                onChange={(e) => set("employer_matching_help", e.target.checked ? "1" : "")} />
              I'm willing to help set up a match or grant
            </label>
            <Field label="Notes">
              <textarea style={styles.textarea} value={form.employer_notes} onChange={(e) => set("employer_notes", e.target.value)} />
            </Field>
          </Section>
        )}

        {/* Mentor-specific notes */}
        {isMentor && (
          <Section title="Mentor Notes">
            <Field label="Special Information / Notes">
              <textarea style={styles.textarea} value={form.special_notes}
                onChange={(e) => set("special_notes", e.target.value)} />
            </Field>
          </Section>
        )}

        {/* Youth notes */}
        {isYouth && (
          <Section title="Additional Information">
            <Field label="Special Information / Notes">
              <textarea style={styles.textarea} value={form.special_notes}
                onChange={(e) => set("special_notes", e.target.value)} />
            </Field>
          </Section>
        )}

        {serverError && <div style={styles.serverError}>{serverError}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={goBack} style={styles.cancelBtn}>Cancel</button>
          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving ? "Saving…" : "Add Member"}
          </button>
        </div>

      </form>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "12px 16px", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      {children}
      {error && <span style={styles.fieldError}>{error}</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  pageHeader: { marginBottom: "1.5rem" },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  section: { background: "#fff", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 16, border: "1px solid #e2e8f0" },
  sectionTitle: { margin: "0 0 1rem", fontSize: 14, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "2px solid #e2e8f0", paddingBottom: 8 },
  sectionNote: { margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  inputError: { borderColor: "#c62828" },
  fieldError: { display: "block", fontSize: 11, color: "#c62828", marginTop: 3 },
  hint: { display: "block", fontSize: 11, color: "#8a97a5", marginTop: 3 },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical" as const, boxSizing: "border-box" as const },
  serverError: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 14 },
  prefillBanner: { background: "#e7f1fb", border: "1px solid #90caf9", borderRadius: 8, padding: "10px 14px", color: "#0d47a1", marginBottom: 16, fontSize: 13.5 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8, paddingBottom: 32 },
  cancelBtn: { padding: "10px 24px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "10px 28px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};

