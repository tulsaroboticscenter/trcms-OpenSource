import { useState, useEffect, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { grantsApi, SCOPES, RECURRENCES, STATUSES, type GrantLink } from "../api";
import { useGoBack } from "../../../core/useGoBack";
import { currentSeasonLabel } from "../../../core/dateUtils";
import { Plus, Trash2 } from "lucide-react";

interface MemberOpt { id: number; first_name: string; last_name: string; }

export default function GrantForm() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const goBack = useGoBack(isEdit ? `/grants/${id}` : "/grants");
  const [f, setF] = useState<Record<string, string>>({ scope: "multi_team", recurrence: "one_time", status: "researching", season: currentSeasonLabel() });
  const [restricted, setRestricted] = useState(false);
  const [links, setLinks] = useState<GrantLink[]>([]);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  // Seasons come from Season Manager so everyone picks the same string — free text
  // would drift ("2026-27" vs "2026-2027") and silently split a season's budgets.
  const [seasons, setSeasons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/v1/members/?limit=400&is_active=true").then((r) => setMembers(r.data.members)).catch(() => {});
    api.get("/api/v1/seasons/").then((r) => setSeasons((r.data as { season: string }[]).map((s) => s.season))).catch(() => {});
    if (isEdit) grantsApi.get(parseInt(id!)).then((g) => {
      setF({
        name: g.name, funder_name: g.funder_name ?? "", scope: g.scope, recurrence: g.recurrence, status: g.status, season: g.season ?? "",
        submitted_by_id: g.submitted_by_id ? String(g.submitted_by_id) : "", submitted_date: g.submitted_date ?? "",
        expected_response_date: g.expected_response_date ?? "", num_rounds: g.num_rounds ? String(g.num_rounds) : "",
        current_round: g.current_round ? String(g.current_round) : "", restriction_note: g.restriction_note ?? "",
        available_date: g.available_date ?? "", remind_date: g.remind_date ?? "", remind_note: g.remind_note ?? "",
        description: g.description ?? "",
      });
      setRestricted(g.restricted_funds);
      setLinks(g.links ?? []);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name?.trim()) { setError("Grant name is required."); return; }
    setSaving(true); setError("");
    const payload: Record<string, unknown> = {
      name: f.name.trim(), funder_name: f.funder_name || null, scope: f.scope, recurrence: f.recurrence, status: f.status, season: f.season || null,
      submitted_by_id: f.submitted_by_id || null, submitted_date: f.submitted_date || null,
      expected_response_date: f.expected_response_date || null, num_rounds: f.num_rounds || null, current_round: f.current_round || null,
      restricted_funds: restricted, restriction_note: f.restriction_note || null,
      available_date: f.available_date || null, remind_date: f.remind_date || null, remind_note: f.remind_note || null,
      links: links.filter((l) => l.url?.trim()), description: f.description || null,
    };
    try {
      const g = isEdit ? await grantsApi.update(parseInt(id!), payload) : await grantsApi.create(payload);
      navigate(`/grants/${g.id}`);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save grant.");
      setSaving(false);
    }
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}>← Back</button>
      <h1 style={st.heading}>{isEdit ? "Edit Grant" : "New Grant"}</h1>
      {error && <div style={st.error}>{error}</div>}
      <form onSubmit={submit}>
        <Section title="Grant">
          <Grid>
            <F label="Name *"><input style={st.input} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></F>
            <F label="Funder / Grant Giver"><input style={st.input} value={f.funder_name ?? ""} onChange={(e) => set("funder_name", e.target.value)} /></F>
            <F label="Scope"><select style={st.input} value={f.scope} onChange={(e) => set("scope", e.target.value)}>{SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></F>
            <F label="Recurrence"><select style={st.input} value={f.recurrence} onChange={(e) => set("recurrence", e.target.value)}>{RECURRENCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></F>
            <F label="Status"><select style={st.input} value={f.status} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></F>
            <F label="Season" hint="which season's team budgets this grant's money lands in">
              <select style={st.input} value={f.season ?? ""} onChange={(e) => set("season", e.target.value)}>
                <option value="">—</option>
                {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
                {/* A season already on this grant but not in Season Manager stays selectable. */}
                {f.season && !seasons.includes(f.season) && <option value={f.season}>{f.season}</option>}
              </select>
            </F>
            <F label="Submitted By"><select style={st.input} value={f.submitted_by_id ?? ""} onChange={(e) => set("submitted_by_id", e.target.value)}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}</select></F>
          </Grid>
        </Section>

        <Section title="Dates & Rounds">
          <Grid>
            <F label="Submitted Date"><input type="date" style={st.input} value={f.submitted_date ?? ""} onChange={(e) => set("submitted_date", e.target.value)} /></F>
            <F label="Expected Response"><input type="date" style={st.input} value={f.expected_response_date ?? ""} onChange={(e) => set("expected_response_date", e.target.value)} /></F>
            <span />
            <F label="# of Rounds"><input type="number" style={st.input} value={f.num_rounds ?? ""} onChange={(e) => set("num_rounds", e.target.value)} /></F>
            <F label="Current Round"><input type="number" style={st.input} value={f.current_round ?? ""} onChange={(e) => set("current_round", e.target.value)} /></F>
          </Grid>
        </Section>

        <Section title="Funds">
          <label style={st.check}><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restricted funds (limits how the money can be spent)</label>
          {restricted && <F label="Restriction Note"><input style={st.input} placeholder="e.g. Covers FIRST registration" value={f.restriction_note ?? ""} onChange={(e) => set("restriction_note", e.target.value)} /></F>}
        </Section>

        <Section title="Availability & Reminder">
          <Grid>
            <F label="Available / Opens"><input type="date" style={st.input} value={f.available_date ?? ""} onChange={(e) => set("available_date", e.target.value)} /></F>
            <F label="Remind Me On"><input type="date" style={st.input} value={f.remind_date ?? ""} onChange={(e) => set("remind_date", e.target.value)} /></F>
            <F label="Reminder Note"><input style={st.input} value={f.remind_note ?? ""} onChange={(e) => set("remind_note", e.target.value)} /></F>
          </Grid>
        </Section>

        <Section title="Links">
          {links.map((l, i) => (
            <div key={i} style={st.linkRow}>
              <input style={{ ...st.input, width: 160 }} placeholder="Label" value={l.label} onChange={(e) => setLinks((ls) => ls.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <input style={st.input} placeholder="https://…" value={l.url} onChange={(e) => setLinks((ls) => ls.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
              <button type="button" style={st.delBtn} onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" style={st.addLink} onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}><Plus size={13} /> Add link</button>
        </Section>

        <Section title="Description / Notes">
          <textarea style={st.textarea} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </Section>

        <div style={st.actions}>
          <button type="button" style={st.cancel} onClick={goBack}>Cancel</button>
          <button type="submit" style={st.save} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save Grant" : "Create Grant"}</button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={st.section}><h3 style={st.sectionTitle}>{title}</h3>{children}</div>;
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px" }}>{children}</div>;
}
function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={st.label}>{label}</label>
      {children}
      {hint && <div style={st.hint}>{hint}</div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 880, margin: "0 auto" },
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: "0 0 16px", fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  error: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 14 },
  section: { background: "#fff", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 16, border: "1px solid #e2e8f0" },
  sectionTitle: { margin: "0 0 1rem", fontSize: 14, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "2px solid #e2e8f0", paddingBottom: 8 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  hint: { fontSize: 11, color: "#8894a5", marginTop: 3, lineHeight: 1.4 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical", boxSizing: "border-box" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#333", marginBottom: 10 },
  linkRow: { display: "flex", gap: 8, marginBottom: 8, alignItems: "center" },
  delBtn: { background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: 4 },
  addLink: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8, paddingBottom: 32 },
  cancel: { padding: "10px 24px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 14 },
  save: { padding: "10px 28px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
