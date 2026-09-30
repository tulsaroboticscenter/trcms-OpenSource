/**
 * JoinPage — the no-login "would you like to join?" page reached from the link in a
 * visitor follow-up email (/join/:token).
 *
 * Three steps: ask, verify, done. The family confirms the details we already hold,
 * picks the program for each youth, and optionally takes a parent account of their own.
 * Submitting converts them to members and sends the normal welcome email; youth
 * credentials go to the guardian, as everywhere else in TRCMS.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, UserPlus, Mail, AlertTriangle } from "lucide-react";
import { visitorSignupApi, type JoinForm, type JoinResult, type JoinVisitor } from "../signupApi";
import { GRADE_OPTIONS } from "../../../core/grade";

const SEX_OPTIONS = ["Male", "Female", "Non-binary", "Other"];
const RACE_OPTIONS = [
  "American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino",
  "Native Hawaiian or Pacific Islander", "White", "Two or more races", "Other",
];
const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL"];

type YouthDraft = {
  visitor_id: number; include: boolean;
  first_name: string; last_name: string; birthday: string;
  email: string; program_id: string;
  // Demographics — grade is "the grade they'll enter this coming fall".
  grade: string; sex: string; shirt_size: string; race: string;
  // Key medical (emergency contact + health), captured up front.
  alt_contact_name: string; alt_contact_relationship: string; alt_contact_phone: string;
  food_allergies: string; environmental_allergies: string; medication_allergies: string;
  medications_current: string; health_problems: string; otc_permission: "" | "give" | "decline";
};

const draftFrom = (v: JoinVisitor, include: boolean): YouthDraft => ({
  visitor_id: v.visitor_id, include,
  first_name: v.first_name ?? "", last_name: v.last_name ?? "",
  birthday: v.birthday ?? "", email: v.email ?? "",
  program_id: v.program_interest_id ? String(v.program_interest_id) : "",
  grade: "", sex: "", shirt_size: "", race: "",
  alt_contact_name: "", alt_contact_relationship: "", alt_contact_phone: "",
  food_allergies: "", environmental_allergies: "", medication_allergies: "",
  medications_current: "", health_problems: "", otc_permission: "",
});

/**
 * True when the visitor record is really the PARENT — same name AND email as the
 * guardian. In that case the child was never captured, so pre-filling the parent's
 * name as the youth (which they'd have to notice and overwrite) is what led to
 * parent-only signups. We blank it and prompt for the child instead.
 */
const visitorIsParent = (v: JoinVisitor, g: { name: string | null; email: string | null }) => {
  const vName = `${v.first_name ?? ""} ${v.last_name ?? ""}`.trim().toLowerCase();
  const vEmail = (v.email ?? "").trim().toLowerCase();
  const gEmail = (g.email ?? "").trim().toLowerCase();
  return vName !== "" && vEmail !== "" && vEmail === gEmail && vName === (g.name ?? "").trim().toLowerCase();
};

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [form, setForm] = useState<JoinForm | null>(null);
  const [step, setStep] = useState<"ask" | "verify">("ask");
  const [youth, setYouth] = useState<YouthDraft[]>([]);
  const [gName, setGName] = useState("");
  const [gEmail, setGEmail] = useState("");
  const [gPhone, setGPhone] = useState("");
  const [gAccount, setGAccount] = useState(true);
  const [result, setResult] = useState<JoinResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [childPromptId, setChildPromptId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    visitorSignupApi.resolve(token)
      .then((f) => {
        setForm(f);
        const primary = draftFrom(f.visitor, true);
        if (visitorIsParent(f.visitor, f.guardian)) {
          // Record is the parent — clear the youth fields so they enter the actual child.
          primary.first_name = ""; primary.last_name = ""; primary.birthday = ""; primary.email = "";
          setChildPromptId(f.visitor.visitor_id);
        }
        setYouth([primary, ...f.siblings.map((s) => draftFrom(s, false))]);
        setGName(f.guardian.name ?? ""); setGEmail(f.guardian.email ?? ""); setGPhone(f.guardian.phone ?? "");
      })
      .catch((e) => setError(e?.response?.data?.detail ?? "This link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  function patch(id: number, p: Partial<YouthDraft>) {
    setYouth((ys) => ys.map((y) => (y.visitor_id === id ? { ...y, ...p } : y)));
  }

  async function submit() {
    if (!token) return;
    const chosen = youth.filter((y) => y.include);
    if (chosen.length === 0) { setError("Please choose at least one person to sign up."); return; }
    if (!gEmail.trim()) { setError("We need a parent/guardian email address to send the login details to."); return; }
    const incomplete = chosen.find((y) => !y.birthday || y.grade === "");
    if (incomplete) { setError(`Please add a date of birth and grade for ${incomplete.first_name.trim() || "each youth"}.`); return; }
    setSaving(true); setError("");
    try {
      setResult(await visitorSignupApi.submit(token, {
        create_guardian_account: gAccount,
        guardian: { name: gName.trim(), email: gEmail.trim(), phone: gPhone.trim() },
        youth: chosen.map((y) => ({
          visitor_id: y.visitor_id,
          first_name: y.first_name.trim(), last_name: y.last_name.trim(),
          birthday: y.birthday || null, email: y.email.trim() || null,
          program_id: y.program_id ? Number(y.program_id) : null,
          grade: y.grade === "" ? null : Number(y.grade),
          sex: y.sex, shirt_size: y.shirt_size, race: y.race,
          medical: {
            alt_contact_name: y.alt_contact_name.trim(), alt_contact_relationship: y.alt_contact_relationship.trim(),
            alt_contact_phone: y.alt_contact_phone.trim(), food_allergies: y.food_allergies.trim(),
            environmental_allergies: y.environmental_allergies.trim(), medication_allergies: y.medication_allergies.trim(),
            medications_current: y.medications_current.trim(), health_problems: y.health_problems.trim(),
            otc_permission: y.otc_permission,
          },
        })),
      }));
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail ?? "Something went wrong. Please contact us and we'll finish signing you up.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={s.page}><div style={s.card}>Loading…</div></div>;

  if (!form) {
    return (
      <div style={s.page}><div style={s.card}>
        <h1 style={s.h1}>We couldn't open this link</h1>
        <p style={s.p}>{error}</p>
        <p style={s.p}>Please get in touch and we'll send you a fresh one.</p>
      </div></div>
    );
  }

  // ── Done ──
  if (result) {
    const problems = result.email_problems ?? [];
    const existing = result.existing ?? [];
    return (
      <div style={s.page}><div style={s.card}>
        <div style={s.okIcon}><CheckCircle size={40} color="#16a34a" /></div>
        <h1 style={s.h1}>You're in — welcome to {form.org_name}!</h1>
        {result.created.length > 0 && (<>
          <p style={s.p}>We've created {result.created.length === 1 ? "an account" : "accounts"} for:</p>
          <ul style={s.list}>
            {result.created.map((c) => (
              <li key={c.member_id}>{c.name} <span style={s.dim}>({c.type === "parent" ? "parent/guardian" : "youth"})</span></li>
            ))}
          </ul>
        </>)}
        {existing.length > 0 && (
          <div style={s.info}>
            <div style={s.nextTitle}>Already with us</div>
            <p style={{ ...s.p, margin: "6px 0 0" }}>
              {existing.map((e) => e.name).join(", ")} already {existing.length === 1 ? "has an account" : "have accounts"} with us,
              so we've linked things up rather than creating {existing.length === 1 ? "a duplicate" : "duplicates"}.
              Sign in with the existing login — use <strong>Forgot password</strong> if you need it.
            </p>
          </div>
        )}

        <div style={s.next}>
          <div style={s.nextTitle}><Mail size={15} /> What happens next</div>
          <ol style={s.ol}>
            <li>Check your email — each account gets a welcome message with its <strong>username and a temporary password</strong>. Youth logins are sent to the parent/guardian address.</li>
            <li>Sign in at <a href={result.login_url} style={s.link}>{result.login_url}</a>. You'll be asked to choose your own password straight away.</li>
            <li>Finish the registration in your account — the terms &amp; conditions, and the rest of the enrolment details.</li>
            <li>Adults 18 and over: look for the <strong>Getting Started</strong> checklist on your profile, which walks you through youth protection training and the background check.</li>
          </ol>
          <p style={s.small}>Nothing in your inbox after a few minutes? Check the spam folder, then contact us and we'll sort it out.</p>
        </div>

        {problems.length > 0 && (
          <div style={s.warn}>
            <AlertTriangle size={14} />
            <span>We couldn't email {problems.join(", ")} just now — the {problems.length === 1 ? "account is" : "accounts are"} created, and we'll send the login details shortly.</span>
          </div>
        )}
      </div></div>
    );
  }

  // ── Step 1: ask ──
  if (step === "ask") {
    return (
      <div style={s.page}><div style={s.card}>
        <div style={s.okIcon}><UserPlus size={36} color="#1a3a5c" /></div>
        <h1 style={s.h1}>Would you like to join {form.org_name}?</h1>
        <p style={s.p}>
          Thanks for visiting us! If you'd like to take the next step, we'll set up your
          {form.siblings.length > 0 ? " family's accounts" : " account"} so you can register
          for a program. It takes about a minute — just check that we've got your details right.
        </p>
        <div style={s.row}>
          <button style={s.primary} onClick={() => setStep("verify")}>Yes, I'd like to join</button>
        </div>
        <p style={s.small}>
          Not ready yet? You can simply close this page — nothing happens until you confirm.
          {form.expires_at ? ` This link is good until ${form.expires_at.slice(0, 10)}.` : ""}
        </p>
      </div></div>
    );
  }

  // ── Step 2: verify ──
  return (
    <div style={s.page}><div style={s.card}>
      <h1 style={s.h1}>Check your details</h1>
      <p style={s.p}>Correct anything that's out of date, choose the program, and we'll do the rest.</p>

      <div style={s.section}>
        <div style={s.sTitle}>Parent / guardian</div>
        <label style={s.lbl}>Name
          <input style={s.input} value={gName} onChange={(e) => setGName(e.target.value)} />
        </label>
        <label style={s.lbl}>Email
          <input style={s.input} type="email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} />
        </label>
        <label style={s.lbl}>Phone
          <input style={s.input} value={gPhone} onChange={(e) => setGPhone(e.target.value)} />
        </label>
        <label style={s.check}>
          <input type="checkbox" checked={gAccount} onChange={(e) => setGAccount(e.target.checked)} />
          <span>Give me a parent account too, so I can manage registration and see what's going on.</span>
        </label>
      </div>

      <div style={s.section}>
        <div style={s.sTitle}>{youth.length > 1 ? "Who's joining?" : "Joining"}</div>
        {youth.map((y) => (
          <div key={y.visitor_id} style={{ ...s.youthBox, ...(y.include ? {} : s.youthOff) }}>
            <label style={s.check}>
              <input type="checkbox" checked={y.include}
                onChange={(e) => patch(y.visitor_id, { include: e.target.checked })} />
              <strong>{y.first_name || y.last_name ? `${y.first_name} ${y.last_name}` : "Your child"}</strong>
            </label>
            {y.visitor_id === childPromptId && y.include && (
              <div style={s.childHint}>
                The information we had on file was the <strong>parent's</strong>. Please enter <strong>your child's</strong> name and details below — this is the person joining the program. Add a second child from your account later if you have more than one.
              </div>
            )}
            {y.include && (
              <div style={s.grid}>
                <label style={s.lbl}>First name
                  <input style={s.input} value={y.first_name} onChange={(e) => patch(y.visitor_id, { first_name: e.target.value })} />
                </label>
                <label style={s.lbl}>Last name
                  <input style={s.input} value={y.last_name} onChange={(e) => patch(y.visitor_id, { last_name: e.target.value })} />
                </label>
                <label style={s.lbl}>Date of birth <span style={s.req}>*</span>
                  <input style={s.input} type="date" value={y.birthday} onChange={(e) => patch(y.visitor_id, { birthday: e.target.value })} />
                </label>
                <label style={s.lbl}>Their email <span style={s.dim}>(optional)</span>
                  <input style={s.input} type="email" value={y.email} onChange={(e) => patch(y.visitor_id, { email: e.target.value })} />
                </label>
                <label style={{ ...s.lbl, gridColumn: "1 / -1" }}>Program
                  <select style={s.input} value={y.program_id} onChange={(e) => patch(y.visitor_id, { program_id: e.target.value })}>
                    <option value="">Not sure yet — help me choose</option>
                    {form.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>

                <label style={s.lbl}>Grade this coming fall <span style={s.req}>*</span>
                  <select style={s.input} value={y.grade} onChange={(e) => patch(y.visitor_id, { grade: e.target.value })}>
                    <option value="">Select…</option>
                    {GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </label>
                <label style={s.lbl}>Sex <span style={s.dim}>(optional)</span>
                  <select style={s.input} value={y.sex} onChange={(e) => patch(y.visitor_id, { sex: e.target.value })}>
                    <option value="">Prefer not to say</option>
                    {SEX_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
                <label style={s.lbl}>T-shirt size <span style={s.dim}>(optional)</span>
                  <select style={s.input} value={y.shirt_size} onChange={(e) => patch(y.visitor_id, { shirt_size: e.target.value })}>
                    <option value="">Select…</option>
                    {SHIRT_SIZES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
                <label style={s.lbl}>Race / ethnicity <span style={s.dim}>(optional)</span>
                  <select style={s.input} value={y.race} onChange={(e) => patch(y.visitor_id, { race: e.target.value })}>
                    <option value="">Prefer not to say</option>
                    {RACE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>

                <div style={{ ...s.medHead, gridColumn: "1 / -1" }}>Health &amp; emergency info <span style={s.dim}>(so we're prepared — all optional)</span></div>
                <label style={s.lbl}>Emergency contact <span style={s.dim}>(other than you)</span>
                  <input style={s.input} value={y.alt_contact_name} onChange={(e) => patch(y.visitor_id, { alt_contact_name: e.target.value })} />
                </label>
                <label style={s.lbl}>Their relationship &amp; phone
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={s.input} placeholder="e.g. Aunt" value={y.alt_contact_relationship} onChange={(e) => patch(y.visitor_id, { alt_contact_relationship: e.target.value })} />
                    <input style={s.input} placeholder="Phone" value={y.alt_contact_phone} onChange={(e) => patch(y.visitor_id, { alt_contact_phone: e.target.value })} />
                  </div>
                </label>
                <label style={s.lbl}>Food allergies
                  <input style={s.input} placeholder="None" value={y.food_allergies} onChange={(e) => patch(y.visitor_id, { food_allergies: e.target.value })} />
                </label>
                <label style={s.lbl}>Environmental allergies
                  <input style={s.input} placeholder="None" value={y.environmental_allergies} onChange={(e) => patch(y.visitor_id, { environmental_allergies: e.target.value })} />
                </label>
                <label style={s.lbl}>Medication allergies
                  <input style={s.input} placeholder="None" value={y.medication_allergies} onChange={(e) => patch(y.visitor_id, { medication_allergies: e.target.value })} />
                </label>
                <label style={s.lbl}>Current medications
                  <input style={s.input} placeholder="None" value={y.medications_current} onChange={(e) => patch(y.visitor_id, { medications_current: e.target.value })} />
                </label>
                <label style={{ ...s.lbl, gridColumn: "1 / -1" }}>Health conditions we should know about
                  <textarea style={{ ...s.input, minHeight: 52, resize: "vertical" }} placeholder="None" value={y.health_problems} onChange={(e) => patch(y.visitor_id, { health_problems: e.target.value })} />
                </label>
                <div style={{ ...s.lbl, gridColumn: "1 / -1", gap: 6 }}>
                  <span>Over-the-counter medicine (e.g. ibuprofen) — may we give it if needed?</span>
                  <div style={{ display: "flex", gap: 16 }}>
                    <label style={s.radio}><input type="radio" checked={y.otc_permission === "give"} onChange={() => patch(y.visitor_id, { otc_permission: "give" })} /> Yes</label>
                    <label style={s.radio}><input type="radio" checked={y.otc_permission === "decline"} onChange={() => patch(y.visitor_id, { otc_permission: "decline" })} /> No</label>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div style={s.warn}><AlertTriangle size={14} /> {error}</div>}

      <div style={s.row}>
        <button style={s.primary} disabled={saving} onClick={submit}>
          {saving ? "Signing you up…" : "Sign us up"}
        </button>
        <button style={s.ghost} disabled={saving} onClick={() => setStep("ask")}>Back</button>
      </div>
      <p style={s.small}>
        We'll email a username and temporary password for each account. Youth login details go to the
        parent/guardian address above.
      </p>
    </div></div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f4f7fa", padding: "28px 16px", display: "flex", justifyContent: "center" },
  card: { width: "100%", maxWidth: 620, background: "#fff", border: "1px solid #e6ecf2", borderRadius: 12, padding: "26px 26px 30px", boxShadow: "0 1px 3px rgba(16,32,48,.06)" },
  okIcon: { display: "flex", justifyContent: "center", marginBottom: 8 },
  h1: { fontSize: 22, color: "#1a3a5c", margin: "0 0 10px", textAlign: "center" },
  p: { fontSize: 14.5, lineHeight: 1.6, color: "#41525f", margin: "0 0 14px" },
  small: { fontSize: 12, color: "#90a4ae", marginTop: 14, lineHeight: 1.5 },
  dim: { color: "#90a4ae", fontWeight: 400 },
  req: { color: "#c0392b", fontWeight: 700 },
  childHint: { fontSize: 12.5, lineHeight: 1.5, color: "#1a3a5c", background: "#eaf3fb", border: "1px solid #cfe0f0", borderRadius: 8, padding: "9px 11px", margin: "2px 0 4px" },
  medHead: { fontSize: 11.5, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6, paddingTop: 10, borderTop: "1px dashed #e6ecf2" },
  radio: { display: "flex", alignItems: "center", gap: 5, fontSize: 13.5, color: "#41525f", cursor: "pointer" },
  row: { display: "flex", gap: 8, justifyContent: "center", marginTop: 8, flexWrap: "wrap" },
  primary: { fontSize: 15, fontWeight: 600, padding: "11px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  ghost: { fontSize: 14, padding: "11px 16px", background: "#fff", color: "#41525f", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer" },
  section: { marginTop: 18, paddingTop: 14, borderTop: "1px solid #eef2f7", display: "flex", flexDirection: "column", gap: 8 },
  sTitle: { fontSize: 11.5, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4 },
  lbl: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#5b6b7c" },
  input: { padding: "9px 10px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, boxSizing: "border-box", width: "100%" },
  check: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "#41525f", cursor: "pointer", lineHeight: 1.45 },
  youthBox: { border: "1px solid #e6ecf2", borderRadius: 9, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  youthOff: { background: "#fafbfc", color: "#90a4ae" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  list: { margin: "0 0 14px", paddingLeft: 20, fontSize: 14.5, lineHeight: 1.8, color: "#41525f" },
  ol: { margin: "6px 0 0", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: "#41525f" },
  info: { marginTop: 4, marginBottom: 14, padding: 12, background: "#f4f7fa", border: "1px solid #e0e8ef", borderRadius: 9 },
  next: { marginTop: 16, padding: 14, background: "#f7fbff", border: "1px solid #dfeaf5", borderRadius: 9 },
  nextTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  link: { color: "#1a3a5c" },
  warn: { display: "flex", gap: 7, alignItems: "flex-start", marginTop: 14, padding: 11, background: "#fff8e6", border: "1px solid #f0dfb0", borderRadius: 8, fontSize: 13, color: "#7a5c00", lineHeight: 1.5 },
};
