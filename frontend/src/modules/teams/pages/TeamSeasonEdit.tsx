import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { teamsApi, type TeamSeasonDetail } from "../api";
import { PlusCircle, Trash2 } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const STATUSES = ["active", "inactive", "development_only"];

export default function TeamSeasonEdit() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack(`/teams/season/${seasonId}`);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [season, setSeason] = useState<TeamSeasonDetail | null>(null);

  // Form fields
  const [teamName, setTeamName] = useState("");
  const [status, setStatus] = useState("active");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [youtube, setYoutube] = useState("");
  const [xAccount, setXAccount] = useState("");
  const [website, setWebsite] = useState("");
  const [robotName, setRobotName] = useState("");
  const [robotPhotoUrl, setRobotPhotoUrl] = useState("");
  const [teamLogoUrl, setTeamLogoUrl] = useState("");
  const [teamPhotoUrl, setTeamPhotoUrl] = useState("");
  const [discordLinks, setDiscordLinks] = useState<{ name: string; url: string }[]>([]);

  useEffect(() => {
    teamsApi.getSeason(parseInt(seasonId!)).then((s) => {
      setSeason(s);
      setTeamName(s.team_name ?? "");
      setStatus(s.status ?? "active");
      setInstagram(s.instagram ?? "");
      setTiktok(s.tiktok ?? "");
      setYoutube(s.youtube ?? "");
      setXAccount(s.x_account ?? "");
      setWebsite(s.website ?? "");
      setRobotName(s.robot_name ?? "");
      setRobotPhotoUrl(s.robot_photo_url ?? "");
      setTeamLogoUrl(s.team_logo_url ?? "");
      setTeamPhotoUrl(s.team_photo_url ?? "");
      try {
        if (s.discord_links) setDiscordLinks(JSON.parse(s.discord_links));
      } catch { /* ignore */ }
    }).finally(() => setLoading(false));
  }, [seasonId]);

  function addDiscordLink() {
    setDiscordLinks([...discordLinks, { name: "", url: "" }]);
  }

  function updateDiscordLink(i: number, field: "name" | "url", value: string) {
    const updated = [...discordLinks];
    updated[i] = { ...updated[i], [field]: value };
    setDiscordLinks(updated);
  }

  function removeDiscordLink(i: number) {
    setDiscordLinks(discordLinks.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) { setError("Team name is required."); return; }
    setError("");
    setSaving(true);
    try {
      await teamsApi.updateSeason(parseInt(seasonId!), {
        team_name: teamName.trim(),
        status,
        instagram: instagram || null,
        tiktok: tiktok || null,
        youtube: youtube || null,
        x_account: xAccount || null,
        website: website || null,
        robot_name: robotName || null,
        robot_photo_url: robotPhotoUrl || null,
        team_logo_url: teamLogoUrl || null,
        team_photo_url: teamPhotoUrl || null,
        discord_links: discordLinks.length ? JSON.stringify(discordLinks.filter(d => d.name || d.url)) : null,
      });
      navigate(`/teams/season/${seasonId}`);
    } catch {
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading…</div>;
  if (!season) return <div style={{ padding: "2rem", color: "#c62828" }}>Season not found.</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          ← Back to Team Profile
        </button>
        <h1 style={styles.heading}>
          Edit Team Profile — #{season.team_number} · {season.season}
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card title="Team Details">
          <Grid>
            <Field label="Team Name *">
              <input style={styles.input} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            </Field>
            <Field label="Status">
              <select style={styles.input} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
          </Grid>
        </Card>

        <Card title="Robot">
          <Grid>
            <Field label="Robot Name">
              <input style={styles.input} value={robotName} onChange={(e) => setRobotName(e.target.value)} placeholder="What did you name the robot?" />
            </Field>
            <Field label="Robot Photo URL">
              <input style={styles.input} value={robotPhotoUrl} onChange={(e) => setRobotPhotoUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Team Logo URL">
              <input style={styles.input} value={teamLogoUrl} onChange={(e) => setTeamLogoUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Team Banner Photo URL">
              <input style={styles.input} value={teamPhotoUrl} onChange={(e) => setTeamPhotoUrl(e.target.value)} placeholder="https://…" />
            </Field>
          </Grid>
          <p style={styles.hint}>💡 You can also upload the banner directly from the team page. Paste a direct image URL here for the logo or robot photo.</p>
        </Card>

        <Card title="Social Media">
          <Grid>
            <Field label="Instagram Handle">
              <input style={styles.input} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@teamhandle" />
            </Field>
            <Field label="TikTok Handle">
              <input style={styles.input} value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="@teamhandle" />
            </Field>
            <Field label="YouTube URL">
              <input style={styles.input} value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="https://youtube.com/…" />
            </Field>
            <Field label="X / Twitter Handle">
              <input style={styles.input} value={xAccount} onChange={(e) => setXAccount(e.target.value)} placeholder="@teamhandle" />
            </Field>
            <Field label="Team Website">
              <input style={styles.input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </Field>
          </Grid>
        </Card>

        <Card title="Discord Channels">
          <p style={styles.hint}>Add links to your team's Discord channels so members can find them quickly.</p>
          {discordLinks.map((d, i) => (
            <div key={i} style={styles.discordRow}>
              <input style={{ ...styles.input, flex: 1 }} placeholder="Channel name"
                value={d.name} onChange={(e) => updateDiscordLink(i, "name", e.target.value)} />
              <input style={{ ...styles.input, flex: 2 }} placeholder="https://discord.com/channels/…"
                value={d.url} onChange={(e) => updateDiscordLink(i, "url", e.target.value)} />
              <button type="button" onClick={() => removeDiscordLink(i)} style={styles.removeBtn}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button type="button" onClick={addDiscordLink} style={styles.addLinkBtn}>
            <PlusCircle size={13} /> Add Discord Channel
          </button>
        </Card>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={() => navigate(`/teams/season/${seasonId}`)} style={styles.cancelBtn}>Cancel</button>
          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{title}</h3>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={styles.grid}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 800, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 1rem", fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  hint: { margin: "8px 0 0", fontSize: 12, color: "#888" },
  discordRow: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
  removeBtn: { padding: "7px", border: "1px solid #fcc", background: "#fff5f5", borderRadius: 5, cursor: "pointer", color: "#c62828", display: "flex" },
  addLinkBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#f0f4f8", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 13, marginTop: 4 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 32 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
