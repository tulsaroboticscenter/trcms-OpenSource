import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { teamsApi } from "../api";
import { api } from "../../../core/api";
import { useGoBack } from "../../../core/useGoBack";

export default function RosterAddMember() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack(`/teams/season/${seasonId}`);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: number; first_name: string; last_name: string; member_number: string; member_type: string }[]>([]);
  const [selectedMember, setSelectedMember] = useState<{ id: number; first_name: string; last_name: string; member_type: string } | null>(null);
  const [primaryRole, setPrimaryRole] = useState("");
  const [secondaryRole, setSecondaryRole] = useState("");
  const [dateJoined, setDateJoined] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [youthRoles, setYouthRoles] = useState<string[]>([]);
  const [mentorRoles, setMentorRoles] = useState<string[]>([]);

  useEffect(() => {
    api.get("/api/v1/config/youth_team_roles").then(({ data }) => setYouthRoles(data.values)).catch(() => {});
    api.get("/api/v1/config/mentor_team_roles").then(({ data }) => setMentorRoles(data.values)).catch(() => {});
  }, []);

  async function doSearch() {
    if (!search.trim()) return;
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search)}&is_active=true&limit=20`);
    setSearchResults(data.members);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedMember) { setError("Please select a member."); return; }
    setError("");
    setSaving(true);
    try {
      await teamsApi.addMember({
        team_season_id: parseInt(seasonId!),
        member_id: selectedMember.id,
        primary_role: primaryRole || null,
        secondary_role: secondaryRole || null,
        date_joined: dateJoined || null,
      });
      navigate(`/teams/season/${seasonId}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to add member to team.");
    } finally {
      setSaving(false);
    }
  }

  const roleOptions = selectedMember?.member_type === "mentor" ? mentorRoles : youthRoles;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>← Back to Team</button>
        <h1 style={styles.heading}>Add Member to Roster</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Find Member</h3>

          {!selectedMember ? (
            <>
              <div style={styles.searchRow}>
                <input
                  style={styles.input}
                  placeholder="Search by name or member number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), doSearch())}
                />
                <button type="button" onClick={doSearch} style={styles.searchBtn}>Search</button>
              </div>
              {searchResults.length > 0 && (
                <div style={styles.resultsList}>
                  {searchResults.map((m) => (
                    <div
                      key={m.id}
                      style={styles.resultRow}
                      onClick={() => setSelectedMember(m)}
                    >
                      <div style={styles.resultAvatar}>{m.first_name[0]}{m.last_name[0]}</div>
                      <div>
                        <div style={styles.resultName}>{m.first_name} {m.last_name}</div>
                        <div style={styles.resultMeta}>#{m.member_number} · {m.member_type}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={styles.selectedMember}>
              <div style={styles.selectedAvatar}>{selectedMember.first_name[0]}{selectedMember.last_name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={styles.selectedName}>{selectedMember.first_name} {selectedMember.last_name}</div>
                <div style={styles.selectedType}>{selectedMember.member_type}</div>
              </div>
              <button type="button" onClick={() => { setSelectedMember(null); setSearchResults([]); }} style={styles.changeBtn}>
                Change
              </button>
            </div>
          )}
        </div>

        {selectedMember && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Role &amp; Details</h3>
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
                <label style={styles.label}>Date Joined Team</label>
                <input type="date" style={styles.input} value={dateJoined} onChange={(e) => setDateJoined(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={() => navigate(`/teams/season/${seasonId}`)} style={styles.cancelBtn}>Cancel</button>
          <button type="submit" style={styles.saveBtn} disabled={saving || !selectedMember}>
            {saving ? "Adding…" : "Add to Roster"}
          </button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 620, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 1rem", fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  searchRow: { display: "flex", gap: 8, marginBottom: 12 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  searchBtn: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" as const, fontSize: 14 },
  resultsList: { display: "flex", flexDirection: "column", gap: 4 },
  resultRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" },
  resultAvatar: { width: 34, height: 34, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  resultName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  resultMeta: { fontSize: 12, color: "#888" },
  selectedMember: { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8 },
  selectedAvatar: { width: 40, height: 40, borderRadius: "50%", background: "#2e7d32", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 },
  selectedName: { fontWeight: 700, fontSize: 15, color: "#1a3a5c" },
  selectedType: { fontSize: 12, color: "#555", textTransform: "capitalize" as const },
  changeBtn: { padding: "5px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 32 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 22px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
