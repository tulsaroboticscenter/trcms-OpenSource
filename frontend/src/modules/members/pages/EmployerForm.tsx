/**
 * EmployerForm — the no-login "tell us where you work" form a parent or mentor reaches
 * from the personalized link in a TRC email ({{employer_form_url}}). The token in the URL
 * identifies them (no password); they answer on one screen and it saves to the same
 * members.employer_* fields the profile uses. Backend: EmployerFormController.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../core/api";
import { Building2, Loader2, CheckCircle } from "lucide-react";

interface Prefill {
  first_name: string; org_name: string;
  employer_name: string; employer_job_title: string;
  employer_matches_donations: string; employer_volunteer_grants: string; employer_offers_grants: string;
  employer_program_info: string; employer_matching_help: boolean; employer_notes: string;
  already_submitted: boolean;
}

const TRI = [
  ["employer_matches_donations", "Does your employer match employee donations?"],
  ["employer_volunteer_grants", "Volunteer grants — donates based on your volunteer hours (“Dollars for Doers”)?"],
  ["employer_offers_grants", "Does your employer offer grants nonprofits can apply for?"],
] as const;

export default function EmployerForm() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Prefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [f, setF] = useState<Record<string, string | boolean>>({});

  useEffect(() => {
    api.get(`/api/v1/public/employer/${token}`)
      .then(({ data }) => {
        setData(data);
        setF({
          employer_name: data.employer_name, employer_job_title: data.employer_job_title,
          employer_matches_donations: data.employer_matches_donations, employer_volunteer_grants: data.employer_volunteer_grants,
          employer_offers_grants: data.employer_offers_grants, employer_program_info: data.employer_program_info,
          employer_matching_help: data.employer_matching_help, employer_notes: data.employer_notes,
        });
      })
      .catch(() => setError("This link is invalid or has expired. Please ask TRC for a new one."))
      .finally(() => setLoading(false));
  }, [token]);

  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setSaving(true); setError("");
    try {
      await api.post(`/api/v1/public/employer/${token}`, f);
      setDone(true);
    } catch {
      setError("Sorry — couldn't save that. Please try again.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={s.page}><Loader2 /></div>;
  if (error && !data) return <div style={s.page}><div style={s.card}>{error}</div></div>;
  if (done) return (
    <div style={s.page}><div style={{ ...s.card, textAlign: "center" }}>
      <CheckCircle size={52} color="#2e7d32" style={{ margin: "0 auto 12px" }} />
      <h1 style={s.h1}>Thank you{data?.first_name ? `, ${data.first_name}` : ""}!</h1>
      <p style={s.lead}>Your employer info is saved. This directly helps TRC pursue grants and sponsorships for our teams. You can close this page.</p>
    </div></div>
  );

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.brand}>Tulsa Robotics Center</div>
        <h1 style={s.h1}><Building2 size={20} style={{ verticalAlign: -3 }} /> Where do you work?</h1>
        <p style={s.lead}>
          Hi {data?.first_name || "there"} — TRC is pursuing community grants and corporate sponsorships. Many employers match donations or give grants based on where their employees volunteer. Telling us where you work helps us connect our members directly to those businesses. Takes about two minutes, and it's kept confidential to our fundraising team.
          {data?.already_submitted && <em> You've shared this before — feel free to update it below.</em>}
        </p>

        <label style={s.label}>Employer</label>
        <input style={s.in} value={(f.employer_name as string) ?? ""} onChange={(e) => set("employer_name", e.target.value)} placeholder="Company / organization name" />
        <label style={s.label}>Your job title <span style={s.hint}>(optional)</span></label>
        <input style={s.in} value={(f.employer_job_title as string) ?? ""} onChange={(e) => set("employer_job_title", e.target.value)} />

        {TRI.map(([field, q]) => (
          <div key={field}>
            <label style={s.label}>{q}</label>
            <select style={s.in} value={(f[field] as string) ?? ""} onChange={(e) => set(field, e.target.value)}>
              <option value="">— not sure —</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unsure">Not sure</option>
            </select>
          </div>
        ))}

        <label style={s.label}>Program details / matching portal link <span style={s.hint}>(optional)</span></label>
        <input style={s.in} value={(f.employer_program_info as string) ?? ""} onChange={(e) => set("employer_program_info", e.target.value)} placeholder="e.g. a Benevity/YourCause link, or an HR contact" />

        <label style={s.check}>
          <input type="checkbox" checked={!!f.employer_matching_help} onChange={(e) => set("employer_matching_help", e.target.checked)} />
          I'm willing to help set up a match or grant with my employer
        </label>

        <label style={s.label}>Anything else? <span style={s.hint}>(optional)</span></label>
        <textarea style={{ ...s.in, minHeight: 64 }} value={(f.employer_notes as string) ?? ""} onChange={(e) => set("employer_notes", e.target.value)} />

        {error && <div style={s.err}>{error}</div>}
        <button style={s.submit} onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={16} /> : <CheckCircle size={16} />} Submit
        </button>
        <p style={s.fine}>Confidential — visible only to TRC fundraising staff. You can update it anytime from this link.</p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f0f4f8", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 14px" },
  card: { background: "#fff", borderRadius: 14, padding: "24px 22px", maxWidth: 480, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.08)" },
  brand: { fontSize: 12, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.6 },
  h1: { fontSize: 21, color: "#1a3a5c", margin: "6px 0 10px" },
  lead: { fontSize: 14, color: "#445", lineHeight: 1.6, margin: "0 0 8px" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#334", margin: "14px 0 5px" },
  hint: { fontWeight: 400, color: "#8a97a5" },
  in: { width: "100%", padding: "10px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 15, boxSizing: "border-box" },
  check: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, color: "#334", margin: "14px 0 2px", cursor: "pointer", lineHeight: 1.4 },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "9px 12px", color: "#c62828", fontSize: 13, marginTop: 12 },
  submit: { width: "100%", marginTop: 16, padding: "13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 9, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  fine: { fontSize: 11.5, color: "#8a97a5", marginTop: 10, lineHeight: 1.5 },
};
