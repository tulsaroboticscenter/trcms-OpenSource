import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { hofApi, initials, HOF_COLOR, type HofMember, type LinkItem } from "../api";
import { ArrowLeft, Trophy, Edit, Eye, EyeOff, Trash2, GraduationCap, Users, Award,
  Medal, Tent, School, Briefcase, ExternalLink, FileText, Images, Link as LinkIcon, Quote } from "lucide-react";

export default function HallOfFameDetail() {
  const navigate = useNavigate();
  const goBack = useGoBack("/hall-of-fame");
  const { id } = useParams();
  const { canWrite } = useAuth();
  const canManage = canWrite("hof.manage");
  const [m, setM] = useState<HofMember | null>(null);
  const [notFound, setNotFound] = useState(false);

  function load() {
    hofApi.get(parseInt(id!)).then(setM).catch(() => setNotFound(true));
  }
  useEffect(load, [id]);

  async function togglePublish() {
    if (!m) return;
    const updated = await hofApi.setPublished(m.id, !m.is_published);
    setM(updated);
  }
  async function remove() {
    if (!m || !window.confirm(`Remove ${m.first_name} ${m.last_name} from the Hall of Fame?`)) return;
    await hofApi.remove(m.id);
    navigate("/hall-of-fame");
  }

  if (notFound) return (
    <div style={st.center}><p style={st.muted}>This Hall of Fame page isn’t available.</p>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to Hall of Fame</button></div>
  );
  if (!m) return <p style={st.muted}>Loading…</p>;

  const honors: { icon: React.ReactNode; label: string }[] = [];
  if (m.deans_list_finalist) honors.push({ icon: <Medal size={16} />, label: "Dean’s List Finalist" });
  else if (m.deans_list_semifinalist) honors.push({ icon: <Medal size={16} />, label: "Dean’s List Semi-Finalist" });
  if (m.eagle_scout) honors.push({ icon: <Tent size={16} />, label: m.eagle_scout_troop ? `Eagle Scout — ${m.eagle_scout_troop}` : "Eagle Scout" });

  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (m.years_in_program) facts.push({ icon: <GraduationCap size={15} />, label: "Years in the program", value: m.years_in_program });
  if (m.high_school) facts.push({ icon: <School size={15} />, label: "High school", value: m.high_school });
  if (m.college) facts.push({ icon: <Briefcase size={15} />, label: "College / trade school", value: m.college });
  if (m.field_of_study) facts.push({ icon: <School size={15} />, label: "Field of study", value: m.field_of_study });
  if (m.college_grad_year) facts.push({ icon: <GraduationCap size={15} />, label: m.still_in_school ? "Expected graduation" : "College graduation", value: String(m.college_grad_year) });
  else if (m.still_in_school) facts.push({ icon: <GraduationCap size={15} />, label: "Status", value: "Currently in school" });
  if (m.degrees) facts.push({ icon: <Award size={15} />, label: "Degrees", value: m.degrees });

  return (
    <div style={st.wrap}>
      <div style={st.topRow}>
        <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Hall of Fame</button>
        {canManage && (
          <div style={st.manageBtns}>
            <button style={st.ghostBtn} onClick={() => navigate(`/hall-of-fame/${m.id}/edit`)}><Edit size={14} /> Edit</button>
            <button style={st.ghostBtn} onClick={togglePublish}>
              {m.is_published ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Publish</>}
            </button>
            <button style={st.delBtn} onClick={remove}><Trash2 size={14} /></button>
          </div>
        )}
      </div>

      {!m.is_published && <div style={st.draftBanner}><EyeOff size={14} /> Draft — hidden from members until published.</div>}

      <div style={st.header}>
        <div style={st.photoCol}>
          <div style={st.photoWrap}>
            {m.photo_url ? <img src={m.photo_url} alt="" style={st.photo} /> : <div style={st.avatar}>{initials(m.first_name, m.last_name)}</div>}
          </div>
        </div>
        <div style={st.headInfo}>
          <div style={st.class}><Trophy size={15} color={HOF_COLOR} /> {m.graduation_year ? `Class of ${m.graduation_year}` : "Hall of Fame"}</div>
          <h1 style={st.name}>{m.first_name} {m.last_name}</h1>
          {honors.length > 0 && (
            <div style={st.honorRow}>
              {honors.map((h, i) => <span key={i} style={st.honor}>{h.icon} {h.label}</span>)}
            </div>
          )}
          {m.where_now && <p style={st.whereNow}>{m.where_now}</p>}
        </div>
      </div>

      {facts.length > 0 && (
        <Section title="Overview">
          <div style={st.factGrid}>
            {facts.map((f, i) => (
              <div key={i} style={st.fact}>
                <span style={st.factIcon}>{f.icon}</span>
                <div><div style={st.factLabel}>{f.label}</div><div style={st.factValue}>{f.value}</div></div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {m.reflections.filter((r) => r.response?.trim()).length > 0 && (
        <Section title="In Their Words" icon={<Quote size={16} />}>
          <div style={st.reflectList}>
            {m.reflections.filter((r) => r.response?.trim()).map((r, i) => (
              <div key={i} style={st.reflect}>
                {r.prompt && <div style={st.reflectPrompt}>{r.prompt}</div>}
                <p style={st.reflectResponse}>{r.response}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {m.positions.length > 0 && (
        <Section title="Leadership Positions" icon={<Users size={16} />}>
          <ul style={st.list}>
            {m.positions.map((p, i) => (
              <li key={i} style={st.listItem}>
                <strong>{p.role}</strong>{p.team ? ` — ${p.team}` : ""}{p.terms ? <span style={st.terms}> · {p.terms}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {m.teams.length > 0 && (
        <Section title="Teams" icon={<Users size={16} />}>
          <div style={st.chips}>
            {m.teams.map((t, i) => <span key={i} style={st.chip}>{t.label}{t.season ? ` (${t.season})` : ""}</span>)}
          </div>
        </Section>
      )}

      {m.awards.length > 0 && (
        <Section title="Awards & Recognition" icon={<Award size={16} />}>
          <ul style={st.list}>
            {m.awards.map((a, i) => <li key={i} style={st.listItem}>{a.name}{a.year ? <span style={st.terms}> · {a.year}</span> : null}</li>)}
          </ul>
        </Section>
      )}

      <LinkSection title="Projects" icon={<LinkIcon size={16} />} links={m.project_links} />
      <LinkSection title="Articles" icon={<ExternalLink size={16} />} links={m.article_links} />
      <LinkSection title="Photo Albums" icon={<Images size={16} />} links={m.album_links} />
      <LinkSection title="Documents" icon={<FileText size={16} />} links={m.documents} />
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={st.section}>
      <h2 style={st.sectionTitle}>{icon}{title}</h2>
      {children}
    </section>
  );
}

function LinkSection({ title, icon, links }: { title: string; icon: React.ReactNode; links: LinkItem[] }) {
  if (!links || links.length === 0) return null;
  return (
    <Section title={title} icon={icon}>
      <div style={st.linkList}>
        {links.map((l, i) => (
          <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={st.linkRow}>
            <ExternalLink size={14} /> {l.label || l.url}
          </a>
        ))}
      </div>
    </Section>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem" },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 14, padding: 0 },
  manageBtns: { display: "flex", gap: 8 },
  ghostBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", background: "#fff", color: "#5b4a1e", border: "1px solid #e0d2a8", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  delBtn: { display: "flex", alignItems: "center", padding: "7px 11px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer" },
  draftBanner: { display: "flex", alignItems: "center", gap: 8, background: "#fff8e1", color: "#8a6d00", border: "1px solid #f0e0a8", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontSize: 13, fontWeight: 600 },
  header: { display: "flex", gap: 28, alignItems: "center", marginBottom: 28, flexWrap: "wrap" },
  photoCol: { flex: "1 1 360px", maxWidth: 460 },
  photoWrap: { width: "100%", aspectRatio: "4 / 5", borderRadius: 16, overflow: "hidden", border: `5px solid ${HOF_COLOR}`, boxShadow: "0 8px 30px rgba(0,0,0,0.22)" },
  photo: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  avatar: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#d9c27a,#b8860b)", color: "#fff", fontSize: 120, fontWeight: 700 },
  headInfo: { flex: "1 1 300px", minWidth: 260, alignSelf: "center" },
  class: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: HOF_COLOR, textTransform: "uppercase", letterSpacing: 0.5 },
  name: { margin: "4px 0 10px", fontSize: 40, fontWeight: 800, color: "#2a2418", lineHeight: 1.05 },
  honorRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  honor: { display: "flex", alignItems: "center", gap: 5, background: "#fbf3d8", color: "#7a5b00", border: "1px solid #ecd99b", borderRadius: 20, padding: "4px 12px", fontSize: 13, fontWeight: 600 },
  whereNow: { margin: 0, color: "#444", fontSize: 15, fontStyle: "italic" },
  section: { marginBottom: 22 },
  sectionTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, color: "#7a5b00", borderBottom: "2px solid #f0e6c8", paddingBottom: 6, marginBottom: 12 },
  factGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 },
  fact: { display: "flex", gap: 10, alignItems: "flex-start" },
  factIcon: { color: HOF_COLOR, marginTop: 2 },
  factLabel: { fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 },
  factValue: { fontSize: 15, color: "#2a2418", fontWeight: 600 },
  list: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 },
  listItem: { fontSize: 14, color: "#2a2418" },
  terms: { color: "#998", fontSize: 13 },
  chips: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: { background: "#f5efdc", color: "#5b4a1e", border: "1px solid #e6d9b0", borderRadius: 16, padding: "5px 13px", fontSize: 13, fontWeight: 600 },
  reflectList: { display: "flex", flexDirection: "column", gap: 16 },
  reflect: { borderLeft: `3px solid ${HOF_COLOR}`, paddingLeft: 14 },
  reflectPrompt: { fontSize: 14, fontWeight: 700, color: "#7a5b00", marginBottom: 4 },
  reflectResponse: { margin: 0, fontSize: 15, color: "#2a2418", lineHeight: 1.6, whiteSpace: "pre-wrap" },
  linkList: { display: "flex", flexDirection: "column", gap: 6 },
  linkRow: { display: "flex", alignItems: "center", gap: 7, color: "#1565c0", textDecoration: "none", fontSize: 14, fontWeight: 600 },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
};
