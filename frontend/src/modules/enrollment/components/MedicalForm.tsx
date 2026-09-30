/**
 * MedicalForm — Medical Consent & Emergency Information form (per member per season).
 * Used as a step in registration: a youth's is completed by a parent/guardian; an
 * adult volunteer completes their own. Prefills from the member + last year's answers.
 * The treatment authorization at the bottom is the signature that puts it "on file".
 */
import { useEffect, useState } from "react";
import { CheckCircle } from "lucide-react";
import { enrollmentApi, type MedicalForm as MedForm } from "../api";

type Draft = Partial<MedForm> & { treatment_authorized?: boolean };

export default function MedicalForm({ memberId, year, yearLabel, onSaved, onSkip, embedded, readOnly }: {
  memberId: number; year: number; yearLabel?: string; onSaved?: () => void; onSkip?: () => void;
  embedded?: boolean;
  /** View-only: staff who may read the form but not complete it on someone's behalf. */
  readOnly?: boolean;
}) {
  const [form, setForm] = useState<MedForm | null>(null);
  const [d, setD] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    enrollmentApi.getMedical(memberId, year)
      .then((f) => { setForm(f); setD({ ...f, treatment_authorized: false }); })
      .catch(() => setError("Could not load the medical form."))
      .finally(() => setLoading(false));
  }, [memberId, year]);

  const set = (k: keyof Draft, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const isYouth = form?.is_youth ?? true;
  const dateFmt = (s?: string | null) => (s ? new Date(s + "T00:00:00").toLocaleDateString() : "");

  async function save(authorize: boolean) {
    if (authorize && !(d.signed_name ?? "").trim()) { setError(`Please type the ${isYouth ? "parent/guardian" : "your"} name to authorize treatment.`); return; }
    setError(""); setSaving(true);
    try {
      await enrollmentApi.saveMedical(memberId, { ...d, year, treatment_authorized: authorize });
      if (authorize) { setDone(true); onSaved?.(); } else { onSkip?.(); }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={{ padding: "1rem", color: "#888" }}>Loading medical form…</div>;
  if (!form) return <div style={{ padding: "1rem", color: "#c62828" }}>{error || "Unavailable."}</div>;

  if (done) return (
    <div style={{ textAlign: "center", padding: "2rem 0" }}>
      <CheckCircle size={48} color="#2e7d32" style={{ margin: "0 auto 12px" }} />
      <p style={{ fontSize: 15, color: "#2e7d32", fontWeight: 600 }}>Medical form saved and authorized.</p>
    </div>
  );

  const who = isYouth ? "youth" : "member";
  return (
    // A disabled fieldset makes every control inside read-only in one place, so a new
    // field added later can't accidentally stay editable for view-only staff.
    <fieldset disabled={readOnly} style={{ ...(embedded ? {} : s.wrap), border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {readOnly && (
        <p style={s.readOnlyNote}>
          You're viewing this medical form. Only the member (if an adult), their parent/guardian, or a
          member editor can change it.
        </p>
      )}
      <p style={s.intro}>
        Emergency and medical information for <b>{form.member_name}</b>{form.birthday ? ` (DOB ${dateFmt(form.birthday)})` : ""}.
        We prefilled what we have on file — please review, correct anything out of date, and complete the medical
        details. {form.on_file && <span style={s.onFile}><CheckCircle size={12} style={{ verticalAlign: -2 }} /> A signed form is already on file for this season; saving again replaces it.</span>}
      </p>

      <Section title="Contact information">
        <Row><Field label="Home address" v={d.contact_address} on={(v) => set("contact_address", v)} wide /></Row>
        <Row>
          <Field label="City & state" v={d.contact_city_state} on={(v) => set("contact_city_state", v)} />
          <Field label="ZIP" v={d.contact_zip} on={(v) => set("contact_zip", v)} narrow />
        </Row>
        <Row>
          <Field label={isYouth ? "Parent/Guardian 1" : "Emergency contact 1"} v={d.guardian1_name} on={(v) => set("guardian1_name", v)} />
          <Field label="Cell phone" v={d.guardian1_phone} on={(v) => set("guardian1_phone", v)} narrow />
        </Row>
        <Row>
          <Field label={isYouth ? "Parent/Guardian 2" : "Emergency contact 2"} v={d.guardian2_name} on={(v) => set("guardian2_name", v)} />
          <Field label="Cell phone" v={d.guardian2_phone} on={(v) => set("guardian2_phone", v)} narrow />
        </Row>
        <Row>
          <Field label="If the above can't be reached — name" v={d.alt_contact_name} on={(v) => set("alt_contact_name", v)} />
          <Field label="Relationship" v={d.alt_contact_relationship} on={(v) => set("alt_contact_relationship", v)} narrow />
          <Field label="Cell phone" v={d.alt_contact_phone} on={(v) => set("alt_contact_phone", v)} narrow />
        </Row>
      </Section>

      <Section title="Medical insurance">
        <Row>
          <Field label="Insurance company" v={d.ins_company} on={(v) => set("ins_company", v)} />
          <Field label="Member services phone" v={d.ins_member_phone} on={(v) => set("ins_member_phone", v)} narrow />
        </Row>
        <Row>
          <Field label="Policy #" v={d.ins_policy} on={(v) => set("ins_policy", v)} />
          <Field label="Group #" v={d.ins_group} on={(v) => set("ins_group", v)} />
        </Row>
      </Section>

      <Section title="Over-the-counter medications">
        <p style={s.help}>Permission for the adult first-aid supervisor to give OTC medication (Tylenol, ibuprofen, Benadryl, etc.) to the {who}.</p>
        <div style={s.radioRow}>
          <label style={s.radio}><input type="radio" checked={d.otc_permission === "give"} onChange={() => set("otc_permission", "give")} /> I <b>give</b> permission</label>
          <label style={s.radio}><input type="radio" checked={d.otc_permission === "decline"} onChange={() => set("otc_permission", "decline")} /> I do <b>not</b> give permission</label>
        </div>
      </Section>

      <Section title="Health details">
        <Area label="Health problems or physical limitations" v={d.health_problems} on={(v) => set("health_problems", v)} />
        <Area label="Food allergies / sensitivities" v={d.food_allergies} on={(v) => set("food_allergies", v)} />
        <Area label="Environmental allergies" v={d.environmental_allergies} on={(v) => set("environmental_allergies", v)} />
        <Area label="Medication allergies" v={d.medication_allergies} on={(v) => set("medication_allergies", v)} />
        <Area label="Medications currently taking (attach dosing if needed)" v={d.medications_current} on={(v) => set("medications_current", v)} />
        <Area label="Please list any accommodations or supports that are provided in an educational and/or group environment"
          v={d.accommodations} on={(v) => set("accommodations", v)} />
        <Area label="Notes or other considerations" v={d.notes} on={(v) => set("notes", v)} />
        <div style={s.radioRow}>
          <span style={s.qlabel}>May the {who} self-administer medication?</span>
          <label style={s.radio}><input type="radio" checked={d.self_administer === true} onChange={() => set("self_administer", true)} /> Yes</label>
          <label style={s.radio}><input type="radio" checked={d.self_administer === false} onChange={() => set("self_administer", false)} /> No</label>
        </div>
      </Section>

      <Section title="Medical treatment authorization">
        <p style={s.help}>
          In the event {isYouth ? "my youth" : "I am"} injured or in an accident while participating in Tulsa Robotics Center
          Foundation / STEAM Post 26 activities from <b>{dateFmt(d.coverage_start ?? form.coverage_start)}</b> to
          {" "}<b>{dateFmt(d.coverage_end ?? form.coverage_end)}</b>, I authorize the adult sponsors to seek medical attention for
          {" "}{isYouth ? `my child, ${form.member_name},` : "me"} by medical personnel of their choice, and authorize that personnel
          to provide treatment they deem necessary in their professional opinion.
        </p>
        <div style={s.sigBlock}>
          <label style={s.sigLabel}>{isYouth ? "Parent/Guardian" : "Member"}: type your full legal name to authorize:</label>
          <input style={s.sigInput} value={d.signed_name ?? ""} onChange={(e) => set("signed_name", e.target.value)} placeholder="Full name" />
          <p style={s.sigNote}>Date: {new Date().toLocaleDateString()}{yearLabel ? ` · ${yearLabel}` : ""}</p>
        </div>
      </Section>

      {error && <div style={s.err}>{error}</div>}
      {!readOnly && (
        <div style={s.actions}>
          {onSkip && <button style={s.ghost} onClick={() => save(false)} disabled={saving}>Save &amp; finish later</button>}
          <button style={s.primary} onClick={() => save(true)} disabled={saving}>{saving ? "Saving…" : "Authorize & Save Medical Form"}</button>
        </div>
      )}
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={s.section}><div style={s.secTitle}>{title}</div>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) { return <div style={s.row}>{children}</div>; }
function Field({ label, v, on, narrow, wide }: { label: string; v?: string | null; on: (v: string) => void; narrow?: boolean; wide?: boolean }) {
  return (
    <div style={{ flex: wide ? "1 1 100%" : narrow ? "0 1 140px" : "1 1 200px" }}>
      <label style={s.lbl}>{label}</label>
      <input style={s.inp} value={v ?? ""} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
function Area({ label, v, on }: { label: string; v?: string | null; on: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={s.lbl}>{label}</label>
      <textarea style={s.area} rows={2} value={v ?? ""} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  intro: { fontSize: 13.5, color: "#555", lineHeight: 1.6, marginBottom: 14 },
  onFile: { display: "block", marginTop: 6, color: "#2e7d32", fontWeight: 600, fontSize: 12.5 },
  section: { border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  secTitle: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 },
  row: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  lbl: { display: "block", fontSize: 11.5, fontWeight: 600, color: "#556", marginBottom: 3 },
  inp: { width: "100%", padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  area: { width: "100%", padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box", resize: "vertical" },
  help: { fontSize: 12.5, color: "#667", lineHeight: 1.5, marginBottom: 8 },
  radioRow: { display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", marginTop: 4 },
  radio: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#333", cursor: "pointer" },
  qlabel: { fontSize: 13, fontWeight: 600, color: "#445" },
  sigBlock: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", marginTop: 4 },
  sigLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#444", marginBottom: 6 },
  sigInput: { width: "100%", padding: "9px 11px", border: "2px solid #1a3a5c", borderRadius: 6, fontSize: 15, fontFamily: "cursive, serif", boxSizing: "border-box" },
  sigNote: { fontSize: 11, color: "#888", marginTop: 6, marginBottom: 0 },
  readOnlyNote: { background: "#eef3f8", border: "1px solid #cdd7e3", borderRadius: 6, padding: "9px 13px", color: "#4a5b6d", marginBottom: 12, fontSize: 12.5 },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 12, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  ghost: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  primary: { padding: "10px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
