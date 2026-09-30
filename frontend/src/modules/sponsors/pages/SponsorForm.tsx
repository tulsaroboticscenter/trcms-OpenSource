/**
 * SponsorForm — create or edit a sponsor. Scope (program/team) drives the
 * owning-team picker; tier can be auto (from contributions) or locked manually.
 */
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sponsorsApi, type Scope, type Lifecycle } from "../api";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { ArrowLeft } from "lucide-react";
import { useSeasons, seasonOptions } from "../../../core/useSeasons";

export default function SponsorForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const seasons = useSeasons();
  const [f, setF] = useState({
    name: "", scope: "team" as Scope, lifecycle_state: "prospective" as Lifecycle,
    primary_contact_name: "", primary_contact_email: "", primary_contact_phone: "",
    website: "", logo_url: "", industry_category: "", season: "", source: "",
    youth_safety_flag: false, youth_safety_notes: "", tier: "", tier_locked: false, notes: "",
  });
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    teamsApi.list().then(setTeams);
    teamsApi.getCurrentSeason().then((sea: string) => setF((p) => (p.season ? p : { ...p, season: sea }))).catch(() => {});
    if (editing) {
      sponsorsApi.get(Number(id)).then((sp) => {
        setF({
          name: sp.name, scope: sp.scope, lifecycle_state: sp.lifecycle_state,
          primary_contact_name: sp.primary_contact_name ?? "", primary_contact_email: sp.primary_contact_email ?? "",
          primary_contact_phone: sp.primary_contact_phone ?? "", website: sp.website ?? "", logo_url: sp.logo_url ?? "",
          industry_category: sp.industry_category ?? "", season: sp.season, source: sp.source ?? "",
          youth_safety_flag: sp.youth_safety_flag, youth_safety_notes: sp.youth_safety_notes ?? "",
          tier: sp.tier_locked ? (sp.tier ?? "") : "", tier_locked: sp.tier_locked, notes: sp.notes ?? "",
        });
        setTeamIds(sp.owning_teams.map((t) => t.team_id));
      }).finally(() => setLoading(false));
    }
  }, [id, editing]);

  async function save() {
    if (!f.name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError("");
    const payload: Record<string, unknown> = { ...f, team_ids: f.scope === "team" ? teamIds : [] };
    try {
      const sp = editing ? await sponsorsApi.update(Number(id), payload) : await sponsorsApi.create(payload);
      navigate(`/sponsors/${sp.id}`);
    } catch { setError("Failed to save."); } finally { setSaving(false); }
  }

  if (loading) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={() => navigate(editing ? `/sponsors/${id}` : "/sponsors")}><ArrowLeft size={14} /> Back</button>
      <h1 style={st.h1}>{editing ? "Edit Sponsor" : "New Sponsor"}</h1>

      <div style={st.card}>
        <Field label="Sponsor name *"><input style={st.in} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div style={st.row2}>
          <Field label="Scope">
            <select style={st.in} value={f.scope} onChange={(e) => set("scope", e.target.value)}>
              <option value="team">Team sponsor</option>
              <option value="program">Program (TRC-wide)</option>
            </select>
          </Field>
          <Field label="Lifecycle state">
            <select style={st.in} value={f.lifecycle_state} onChange={(e) => set("lifecycle_state", e.target.value)}>
              {["prospective", "active", "lapsed", "declined"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
        </div>

        {f.scope === "team" && (
          <Field label="Owning team(s) — who may contact this sponsor">
            <div style={st.teamGrid}>
              {teams.map((t) => {
                const on = teamIds.includes(t.id);
                return (
                  <label key={t.id} style={{ ...st.teamChip, ...(on ? st.teamChipOn : {}) }}>
                    <input type="checkbox" checked={on} onChange={() =>
                      setTeamIds((p) => on ? p.filter((x) => x !== t.id) : [...p, t.id])} style={{ display: "none" }} />
                    #{t.team_number}{t.program_name ? ` · ${t.program_name}` : ""}
                  </label>
                );
              })}
              {teams.length === 0 && <span style={st.muted}>No teams found.</span>}
            </div>
          </Field>
        )}

        <div style={st.row2}>
          <Field label="Primary contact"><input style={st.in} value={f.primary_contact_name} onChange={(e) => set("primary_contact_name", e.target.value)} /></Field>
          <Field label="Contact email"><input style={st.in} value={f.primary_contact_email} onChange={(e) => set("primary_contact_email", e.target.value)} /></Field>
        </div>
        <div style={st.row2}>
          <Field label="Contact phone"><input style={st.in} value={f.primary_contact_phone} onChange={(e) => set("primary_contact_phone", e.target.value)} /></Field>
          <Field label="Website"><input style={st.in} value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" /></Field>
        </div>
        <div style={st.row2}>
          <Field label="Logo URL"><input style={st.in} value={f.logo_url} onChange={(e) => set("logo_url", e.target.value)} /></Field>
          <Field label="Industry / category"><input style={st.in} value={f.industry_category} onChange={(e) => set("industry_category", e.target.value)} /></Field>
        </div>
        <div style={st.row2}>
          <Field label="Season">
            <select style={st.in} value={f.season} onChange={(e) => set("season", e.target.value)}>
              <option value="">—</option>
              {seasonOptions(seasons, f.season).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select style={st.in} value={f.source} onChange={(e) => set("source", e.target.value)}>
              <option value="">—</option>
              {["referral", "self", "returning", "research", "event"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Tier">
          <label style={st.checkRow}>
            <input type="checkbox" checked={f.tier_locked} onChange={(e) => set("tier_locked", e.target.checked)} />
            <span>Set tier manually (otherwise auto-calculated from received contributions)</span>
          </label>
          {f.tier_locked && (
            <select style={st.in} value={f.tier} onChange={(e) => set("tier", e.target.value)}>
              <option value="">—</option>
              {["Gold", "Silver", "Bronze", "In-Kind Partner", "Community Supporter"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
        </Field>

        <Field label="Youth safety">
          <label style={st.checkRow}>
            <input type="checkbox" checked={f.youth_safety_flag} onChange={(e) => set("youth_safety_flag", e.target.checked)} />
            <span>Flag for review — blocks contributions/deliverables until cleared</span>
          </label>
          {f.youth_safety_flag && <textarea style={st.ta} value={f.youth_safety_notes} onChange={(e) => set("youth_safety_notes", e.target.value)} placeholder="Reason for flag (restricted)…" />}
        </Field>

        <Field label="Notes"><textarea style={st.ta} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>

        {error && <p style={st.error}>{error}</p>}
        <div style={st.actions}>
          <button style={st.cancel} onClick={() => navigate(editing ? `/sponsors/${id}` : "/sponsors")}>Cancel</button>
          <button style={st.save} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={st.field}><label style={st.label}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  h1: { margin: "0 0 14px", fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 },
  field: { marginBottom: 14 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#556", marginBottom: 5 },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box", background: "#fff" },
  ta: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box", minHeight: 60, resize: "vertical" },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  teamGrid: { display: "flex", flexWrap: "wrap", gap: 7 },
  teamChip: { border: "1px solid #cdd7e3", borderRadius: 16, padding: "4px 12px", fontSize: 12.5, cursor: "pointer", background: "#fff", color: "#556" },
  teamChipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  checkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 8 },
  error: { color: "#c0392b", fontSize: 13, margin: "6px 0" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  cancel: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 7, cursor: "pointer", fontSize: 14 },
  save: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  muted: { color: "#889", fontSize: 13 },
};
