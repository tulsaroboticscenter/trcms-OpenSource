import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { inventoryApi, type Vendor } from "../api";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { ArrowLeft } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function BomCreate() {
  const navigate = useNavigate();
  const goBack = useGoBack("/inventory/boms");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [teamSeasonId, setTeamSeasonId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    teamsApi.list().then(setTeams).catch(() => {});
    inventoryApi.listVendors().then(setVendors).catch(() => {});
  }, []);

  async function create() {
    if (!teamSeasonId) { setError("Please choose a team (or TRC — General)."); return; }
    if (!vendorId) { setError("Please select a vendor — each BOM is for a single vendor."); return; }
    setSaving(true); setError("");
    try {
      const bom = await inventoryApi.createBom({
        // "general" = a TRC-wide BOM not tied to a team.
        team_season_id: teamSeasonId === "general" ? null : parseInt(teamSeasonId),
        vendor_id: parseInt(vendorId),
        name: name.trim() || null,
      });
      navigate(`/inventory/boms/${bom.id}`);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create BOM.");
    } finally { setSaving(false); }
  }

  const teamsWithSeason = teams.filter((t) => t.current_season?.id);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> BOMs</button>
      <h1 style={st.heading}>New Bill of Materials</h1>
      <div style={st.card}>
        <label style={st.label}>Team *</label>
        <select style={st.input} value={teamSeasonId} onChange={(e) => setTeamSeasonId(e.target.value)}>
          <option value="">Select team…</option>
          <option value="general">TRC — General (no team)</option>
          {teamsWithSeason.map((t) => (
            <option key={t.current_season!.id} value={t.current_season!.id}>
              #{t.team_number}{t.current_season?.team_name ? ` — ${t.current_season.team_name}` : ""} ({t.current_season!.season})
            </option>
          ))}
        </select>

        <label style={st.label}>Vendor *</label>
        <select style={st.input} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Select vendor…</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <p style={st.hint}>Each BOM is for one vendor — put all items from the same vendor on a single BOM so it becomes one order.</p>

        <label style={st.label}>Name / Label (optional)</label>
        <input style={st.input} placeholder="Defaults to the vendor name" value={name} onChange={(e) => setName(e.target.value)} />

        {error && <p style={st.error}>{error}</p>}
        <div style={st.actions}>
          <button style={st.cancelBtn} onClick={() => navigate("/inventory/boms")}>Cancel</button>
          <button style={st.saveBtn} onClick={create} disabled={saving}>{saving ? "Creating…" : "Create & Add Items"}</button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 560, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: "0 0 16px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "12px 0 4px" },
  input: { width: "100%", padding: "9px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  hint: { fontSize: 11, color: "#888", margin: "4px 0 0", lineHeight: 1.5 },
  error: { color: "#c62828", fontSize: 13, margin: "12px 0 0" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
