import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../../core/api";
import { teamsApi, type RosterMember } from "../api";
const STATUSES = ["active", "not_active", "graduated", "transferred"];

export default function RosterEditMember() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<RosterMember | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState("active");
  const [primaryRole, setPrimaryRole] = useState("");
  const [secondaryRole, setSecondaryRole] = useState("");
  const [dateLeft, setDateLeft] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [youthRoles, setYouthRoles] = useState<string[]>([]);
  const [mentorRoles, setMentorRoles] = useState<string[]>([]);

  useEffect(() => {
    api.get("/api/v1/config/youth_team_roles").then(({ data }) => setYouthRoles(data.values)).catch(() => {});
    api.get("/api/v1/config/mentor_team_roles").then(({ data }) => setMentorRoles(data.values)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!assignmentId) return;
    teamsApi.getAssignment(parseInt(assignmentId))
      .then((a) => {
        setAssignment(a);
        setStatus(a.status);
        setPrimaryRole(a.primary_role ?? "");
        setSecondaryRole(a.secondary_role ?? "");
        setDateLeft(a.date_left?.split("T")[0] ?? "");
      })
      .catch(() => { /* assignment stays null → error message shown */ })
      .finally(() => setLoading(false));
  }, [assignmentId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await teamsApi.updateMember(parseInt(assignmentId!), {
        status,
        primary_role: primaryRole || null,
        secondary_role: secondaryRole || null,
        date_left: dateLeft || null,
      });
      navigate(-1);
    } catch {
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Mark this member as inactive on the team? Their record will be kept for history.")) return;
    setRemoving(true);
    try {
      await teamsApi.removeMember(parseInt(assignmentId!));
      navigate(-1);
    } catch {
      setError("Failed to remove member.");
    } finally {
      setRemoving(false);
    }
  }

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading…</div>;
  if (!assignment) return (
    <div style={{ padding: "2rem" }}>
      <p style={{ color: "#c62828" }}>Member data not found. Please go back and try again.</p>
      <button onClick={() => navigate(-1)} style={{ color: "#1565c0", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>← Go back</button>
    </div>
  );

  const roleOptions = assignment.member_type === "mentor" ? mentorRoles : youthRoles;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back to Team</button>
        <h1 style={styles.heading}>
          Edit Team Member — {assignment.first_name} {assignment.last_name}
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Roles &amp; Status</h3>
          <div style={styles.grid}>
            <div>
              <label style={styles.label}>Primary Role</label>
              <select style={styles.input} value={primaryRole} onChange={(e) => setPrimaryRole(e.target.value)}>
                <option value="">No role assigned</option>
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Secondary Role</label>
              <select style={styles.input} value={secondaryRole} onChange={(e) => setSecondaryRole(e.target.value)}>
                <option value="">No secondary role</option>
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Status</label>
              <select style={styles.input} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            {status !== "active" && (
              <div>
                <label style={styles.label}>Date Left Team</label>
                <input type="date" style={styles.input} value={dateLeft} onChange={(e) => setDateLeft(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        {assignment && assignment.member_type !== "youth" && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>FIRST-YPP Compliance</h3>
            <p style={styles.hint}>
              FIRST registration, Consent &amp; Release, background check, YPT and Role-Specific
              Training are now tracked once on the mentor's profile and shown on every team they're
              on — no need to update them here.
            </p>
            <Link to={`/members/${assignment.member_id}`} style={{ fontSize: 13, color: "#1565c0", fontWeight: 600 }}>
              Open {assignment.first_name}'s profile → Compliance →
            </Link>
          </div>
        )}

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={handleRemove} style={styles.removeBtn} disabled={removing}>
            {removing ? "Removing…" : "Mark Inactive"}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => navigate(-1)} style={styles.cancelBtn}>Cancel</button>
            <button type="submit" style={styles.saveBtn} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 620, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: 0, fontSize: 20, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 1rem", fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  checkboxLabel: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 14, cursor: "pointer" },
  hint: { margin: "8px 0 0", fontSize: 12, color: "#888" },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 32 },
  removeBtn: { padding: "9px 16px", border: "1px solid #ef9a9a", background: "#fff", color: "#c62828", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
