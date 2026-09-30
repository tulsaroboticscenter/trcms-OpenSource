import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { teamsApi } from "../api";
import { programsApi, type Program } from "../../enrollment/api";
import { useGoBack } from "../../../core/useGoBack";

export default function TeamAdd() {
  const navigate = useNavigate();
  const goBack = useGoBack("/teams");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [teamNumber, setTeamNumber] = useState("");
  const [programId, setProgramId] = useState("");
  const [rookieSeason, setRookieSeason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { programsApi.list().then(setPrograms); }, []);

  // Build season options: last 10 years
  const currentYear = new Date().getFullYear();
  const seasonOptions = Array.from({ length: 11 }, (_, i) => {
    const y = currentYear - 10 + i;
    return `${y}-${y + 1}`;
  }).reverse();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!teamNumber.trim()) { setError("Team number is required."); return; }
    if (!programId) { setError("Program is required."); return; }
    setError("");
    setSaving(true);
    try {
      const result = await teamsApi.create({
        team_number: teamNumber.trim(),
        program_id: parseInt(programId),
        rookie_season: rookieSeason || null,
      });
      // Navigate to the auto-created current season profile
      const seasonId = result.seasons?.[0]?.id;
      if (seasonId) navigate(`/teams/season/${seasonId}/edit`);
      else navigate("/teams");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to create team.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>← Back to Teams</button>
        <h1 style={styles.heading}>Add New Team</h1>
        <p style={styles.sub}>
          A current-season profile will be created automatically. You can fill in the full team details on the next screen.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <Field label="Team Number *">
          <input style={styles.input} value={teamNumber}
            onChange={(e) => setTeamNumber(e.target.value)}
            placeholder="e.g. 12345 or 12345A" />
        </Field>
        <Field label="Program *">
          <select style={styles.input} value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">Select a program…</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.full_name ? ` — ${p.full_name}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rookie Season (first season competing)">
          <select style={styles.input} value={rookieSeason} onChange={(e) => setRookieSeason(e.target.value)}>
            <option value="">Unknown / Not yet competed</option>
            {seasonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={goBack} style={styles.cancelBtn}>Cancel</button>
          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving ? "Creating…" : "Create Team & Set Up Season →"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 520, margin: "0 auto" },
  header: { marginBottom: 24 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 6 },
  heading: { margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: 0, fontSize: 13, color: "#888" },
  form: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: { width: "100%", padding: "9px 11px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
