import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PhotoUpload from "../../../core/components/PhotoUpload";
import { api } from "../../../core/api";
import { hofApi, initials, HOF_COLOR, REFLECTION_PROMPTS, type HofMember, type LinkItem, type AwardItem, type PositionItem, type TeamItem, type ReflectionItem } from "../api";
import { ArrowLeft, Plus, X, Save, Upload } from "lucide-react";

type Draft = Partial<HofMember>;

const EMPTY: Draft = {
  first_name: "", last_name: "", graduation_year: null, photo_url: null,
  teams: [], awards: [], positions: [], project_links: [], article_links: [], album_links: [], documents: [],
};

export default function HallOfFameEdit() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [m, setM] = useState<Draft | null>(isNew ? { ...EMPTY } : null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    hofApi.get(parseInt(id!)).then(setM).catch(() => setErr("Could not load this entry."));
  }, [id, isNew]);

  function set<K extends keyof HofMember>(key: K, value: HofMember[K]) { setM((p) => ({ ...p!, [key]: value })); }

  async function save() {
    if (!m) return;
    if (!m.first_name?.trim() || !m.last_name?.trim()) { setErr("First and last name are required."); return; }
    setSaving(true); setErr(null);
    try {
      if (isNew) {
        const created = await hofApi.create(m as Record<string, unknown>);
        navigate(`/hall-of-fame/${created.id}`);
      } else {
        await hofApi.update(parseInt(id!), m as Record<string, unknown>);
        navigate(`/hall-of-fame/${id}`);
      }
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }

  if (err && !m) return <div style={st.wrap}><p style={st.muted}>{err}</p></div>;
  if (!m) return <p style={st.muted}>Loading…</p>;

  return (
    <div style={st.wrap}>
      <button style={st.back} onClick={() => navigate(`/hall-of-fame/${id}`)}><ArrowLeft size={15} /> Back</button>
      <h1 style={st.heading}>Edit Hall of Fame Page</h1>
      <p style={st.hint}>Empty fields are automatically hidden on the public page — fill in only what applies.</p>
      {err && <div style={st.err}>{err}</div>}

      <div style={st.photoRow}>
        <PhotoUpload currentUrl={m.photo_url} initials={initials(m.first_name ?? "", m.last_name ?? "")} size={110}
          onUploaded={(url) => set("photo_url", url)} />
        <div style={st.nameCol}>
          <Field label="First name"><input style={st.input} value={m.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></Field>
          <Field label="Last name"><input style={st.input} value={m.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></Field>
        </div>
      </div>

      <Group title="Overview">
        <Row>
          <Field label="Graduation year"><input type="number" style={st.input} value={m.graduation_year ?? ""} onChange={(e) => set("graduation_year", e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Years in the program"><input style={st.input} value={m.years_in_program ?? ""} onChange={(e) => set("years_in_program", e.target.value)} placeholder="e.g. 2019–2024 (5 years)" /></Field>
        </Row>
        <Field label="High school"><input style={st.input} value={m.high_school ?? ""} onChange={(e) => set("high_school", e.target.value)} /></Field>
        <Row>
          <Field label="College / trade school"><input style={st.input} value={m.college ?? ""} onChange={(e) => set("college", e.target.value)} /></Field>
          <Field label="Field of study"><input style={st.input} value={m.field_of_study ?? ""} onChange={(e) => set("field_of_study", e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label={m.still_in_school ? "Expected graduation year" : "College graduation year"}>
            <input type="number" style={st.input} value={m.college_grad_year ?? ""} onChange={(e) => set("college_grad_year", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Still in school?">
            <label style={{ ...st.check, paddingTop: 8 }}><input type="checkbox" checked={!!m.still_in_school} onChange={(e) => set("still_in_school", e.target.checked)} /> Currently enrolled</label>
          </Field>
        </Row>
        <Field label="Degrees earned"><input style={st.input} value={m.degrees ?? ""} onChange={(e) => set("degrees", e.target.value)} /></Field>
        <Field label="Where are they now?"><textarea style={{ ...st.input, minHeight: 64, resize: "vertical" }} value={m.where_now ?? ""} onChange={(e) => set("where_now", e.target.value)} /></Field>
      </Group>

      <Group title="Honors">
        <label style={st.check}><input type="checkbox" checked={!!m.deans_list_semifinalist} onChange={(e) => set("deans_list_semifinalist", e.target.checked)} /> Dean’s List Semi-Finalist</label>
        <label style={st.check}><input type="checkbox" checked={!!m.deans_list_finalist} onChange={(e) => set("deans_list_finalist", e.target.checked)} /> Dean’s List Finalist</label>
        <label style={st.check}><input type="checkbox" checked={!!m.eagle_scout} onChange={(e) => set("eagle_scout", e.target.checked)} /> Eagle Scout</label>
        {m.eagle_scout && <Field label="Eagle Scout troop"><input style={st.input} value={m.eagle_scout_troop ?? ""} onChange={(e) => set("eagle_scout_troop", e.target.value)} placeholder="Troop #" /></Field>}
      </Group>

      <Group title="Leadership Positions">
        <ListEditor<PositionItem>
          items={m.positions ?? []} onChange={(v) => set("positions", v)} blank={{ role: "", team: "", terms: "" }}
          render={(it, upd) => (
            <>
              <input style={st.cellWide} placeholder="Position (e.g. YLC President, Team Leader)" value={it.role} onChange={(e) => upd({ ...it, role: e.target.value })} />
              <input style={st.cell} placeholder="Team (if applicable)" value={it.team ?? ""} onChange={(e) => upd({ ...it, team: e.target.value })} />
              <input style={st.cell} placeholder="Term(s) e.g. 2022-2023" value={it.terms ?? ""} onChange={(e) => upd({ ...it, terms: e.target.value })} />
            </>
          )} addLabel="Add position" />
      </Group>

      <Group title="Teams">
        <ListEditor<TeamItem>
          items={m.teams ?? []} onChange={(v) => set("teams", v)} blank={{ label: "", season: "" }}
          render={(it, upd) => (
            <>
              <input style={st.cellWide} placeholder="Team (e.g. #1234 Robo Lions)" value={it.label} onChange={(e) => upd({ ...it, label: e.target.value })} />
              <input style={st.cell} placeholder="Season (e.g. 2023-2024)" value={it.season ?? ""} onChange={(e) => upd({ ...it, season: e.target.value })} />
            </>
          )} addLabel="Add team" />
      </Group>

      <Group title="Awards & Recognition">
        <ListEditor<AwardItem>
          items={m.awards ?? []} onChange={(v) => set("awards", v)} blank={{ name: "", year: null }}
          render={(it, upd) => (
            <>
              <input style={st.cellWide} placeholder="Award name" value={it.name} onChange={(e) => upd({ ...it, name: e.target.value })} />
              <input style={st.cell} type="number" placeholder="Year" value={it.year ?? ""} onChange={(e) => upd({ ...it, year: e.target.value === "" ? null : Number(e.target.value) })} />
            </>
          )} addLabel="Add award" />
      </Group>

      <LinkGroup title="Projects" value={m.project_links ?? []} onChange={(v) => set("project_links", v)} />
      <LinkGroup title="Articles" value={m.article_links ?? []} onChange={(v) => set("article_links", v)} />
      <LinkGroup title="Photo Albums" value={m.album_links ?? []} onChange={(v) => set("album_links", v)} />
      <LinkGroup title="Documents" value={m.documents ?? []} onChange={(v) => set("documents", v)} uploads />

      <Group title="In Their Words">
        <ReflectionsEditor value={m.reflections ?? []} onChange={(v) => set("reflections", v)} />
      </Group>

      <div style={st.actions}>
        <button style={st.cancel} onClick={() => navigate(`/hall-of-fame/${id}`)}>Cancel</button>
        <button style={st.save} disabled={saving} onClick={save}><Save size={15} /> {saving ? "Saving…" : "Save Changes"}</button>
      </div>
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={st.field}><span style={st.label}>{label}</span>{children}</label>;
}
function Row({ children }: { children: React.ReactNode }) { return <div style={st.gridRow}>{children}</div>; }
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={st.group}><h2 style={st.groupTitle}>{title}</h2><div style={st.groupBody}>{children}</div></section>;
}

/** Prompt + multi-line response reflections (e.g. "How the TRC has impacted me…"). */
function ReflectionsEditor({ value, onChange }: { value: ReflectionItem[]; onChange: (v: ReflectionItem[]) => void }) {
  const setItem = (i: number, patch: Partial<ReflectionItem>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={st.listEditor}>
      <datalist id="hof-reflection-prompts">
        {REFLECTION_PROMPTS.map((p) => <option key={p} value={p} />)}
      </datalist>
      {value.map((r, i) => (
        <div key={i} style={st.reflectRow}>
          <div style={st.reflectTop}>
            <input style={st.reflectPrompt} list="hof-reflection-prompts" placeholder="Prompt (e.g. My favorite experience at the TRC…)"
              value={r.prompt} onChange={(e) => setItem(i, { prompt: e.target.value })} />
            <button style={st.removeBtn} title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={15} /></button>
          </div>
          <textarea style={st.reflectResponse} placeholder="Their answer…" value={r.response}
            onChange={(e) => setItem(i, { response: e.target.value })} />
        </div>
      ))}
      <button style={st.addBtn} onClick={() => onChange([...value, { prompt: "", response: "" }])}><Plus size={14} /> Add a reflection</button>
    </div>
  );
}

function ListEditor<T>({ items, onChange, blank, render, addLabel }: {
  items: T[]; onChange: (v: T[]) => void; blank: T; addLabel: string;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div style={st.listEditor}>
      {items.map((it, i) => (
        <div key={i} style={st.editRow}>
          {render(it, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
          <button style={st.removeBtn} onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove"><X size={15} /></button>
        </div>
      ))}
      <button style={st.addBtn} onClick={() => onChange([...items, { ...blank }])}><Plus size={14} /> {addLabel}</button>
    </div>
  );
}

function LinkGroup({ title, value, onChange, uploads }: { title: string; value: LinkItem[]; onChange: (v: LinkItem[]) => void; uploads?: boolean }) {
  return (
    <Group title={title}>
      <ListEditor<LinkItem>
        items={value} onChange={onChange} blank={{ label: "", url: "" }} addLabel={uploads ? "Add document" : "Add link"}
        render={(it, upd) => (
          <>
            <input style={st.cell} placeholder="Label" value={it.label} onChange={(e) => upd({ ...it, label: e.target.value })} />
            <input style={st.cellWide} placeholder={uploads ? "Document URL (or upload below)" : "https://…"} value={it.url} onChange={(e) => upd({ ...it, url: e.target.value })} />
          </>
        )} />
      {uploads && <UploadDoc onUploaded={(url, name) => onChange([...value, { label: name, url }])} />}
    </Group>
  );
}

function UploadDoc({ onUploaded }: { onUploaded: (url: string, name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function upload(file: File) {
    if (file.size > 20 * 1024 * 1024) { setErr("File must be under 20 MB."); return; }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/api/v1/uploads/document", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onUploaded(r.data.url, r.data.name || file.name);
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Upload failed.");
    } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  }

  return (
    <div>
      <input ref={ref} type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,image/*"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <button type="button" style={st.uploadBtn} disabled={busy} onClick={() => ref.current?.click()}>
        <Upload size={14} /> {busy ? "Uploading…" : "Upload a document"}
      </button>
      {err && <span style={st.uploadErr}>{err}</span>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 14, padding: 0, marginBottom: 8 },
  heading: { margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: "#7a5b00" },
  hint: { color: "#998", fontSize: 13, marginTop: 0, marginBottom: 18 },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 14 },
  photoRow: { display: "flex", gap: 18, alignItems: "center", marginBottom: 18 },
  nameCol: { flex: 1, display: "flex", flexDirection: "column", gap: 10 },
  group: { marginBottom: 18, border: "1px solid #ece3c8", borderRadius: 10, overflow: "hidden" },
  groupTitle: { margin: 0, padding: "10px 14px", background: "#faf6e8", color: "#7a5b00", fontSize: 14, fontWeight: 700, borderBottom: "1px solid #ece3c8" },
  groupBody: { padding: 14, display: "flex", flexDirection: "column", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12, fontWeight: 700, color: "#776", textTransform: "uppercase", letterSpacing: 0.3 },
  gridRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  input: { padding: "9px 11px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, width: "100%", boxSizing: "border-box" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#445", fontWeight: 500 },
  listEditor: { display: "flex", flexDirection: "column", gap: 8 },
  editRow: { display: "flex", gap: 8, alignItems: "center" },
  cell: { flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  cellWide: { flex: 2, minWidth: 0, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  removeBtn: { display: "flex", alignItems: "center", padding: "7px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer", flexShrink: 0 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "7px 12px", background: "#fff", color: "#5b4a1e", border: "1px dashed #d8c890", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  reflectRow: { display: "flex", flexDirection: "column", gap: 6, padding: 10, border: "1px solid #ece3c8", borderRadius: 8, background: "#fffdf7" },
  reflectTop: { display: "flex", gap: 8, alignItems: "center" },
  reflectPrompt: { flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, fontWeight: 600 },
  reflectResponse: { width: "100%", minHeight: 70, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", resize: "vertical" },
  uploadBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#f5efdc", color: "#5b4a1e", border: "1px solid #e0d2a8", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  uploadErr: { color: "#c62828", fontSize: 12, marginLeft: 8 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, marginBottom: 40 },
  cancel: { padding: "10px 18px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  save: { display: "flex", alignItems: "center", gap: 6, padding: "10px 22px", background: HOF_COLOR, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
};
