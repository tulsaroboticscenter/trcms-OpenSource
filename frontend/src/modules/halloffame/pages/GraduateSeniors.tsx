import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { hofApi, initials, HOF_COLOR, type EligibleYouth } from "../api";
import { ArrowLeft, GraduationCap, Search } from "lucide-react";

export default function GraduateSeniors() {
  const navigate = useNavigate();
  const goBack = useGoBack("/hall-of-fame");
  const [youth, setYouth] = useState<EligibleYouth[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const thisYear = new Date().getFullYear();

  function load() { hofApi.eligible().then(setYouth).catch(() => setYouth([])); }
  useEffect(load, []);

  async function graduate(m: EligibleYouth) {
    setBusy(m.id);
    try {
      const hof = await hofApi.createFromMember(m.id);
      navigate(`/hall-of-fame/${hof.id}/edit`);
    } finally { setBusy(null); }
  }

  const filtered = (youth ?? []).filter((m) => {
    const name = `${m.first_name} ${m.last_name}`.toLowerCase();
    return !q || name.includes(q.toLowerCase()) || String(m.graduation_year ?? "").includes(q);
  });

  return (
    <div style={st.wrap}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Hall of Fame</button>
      <h1 style={st.heading}><GraduationCap size={22} style={{ verticalAlign: -3 }} /> Graduate Seniors</h1>
      <p style={st.hint}>
        Pick a member to create their Hall of Fame page. We’ll pre-fill their teams, positions, awards, high school, and
        years in the program from their record — then you can polish it and publish when ready. This is the tool to run
        during the summer season migration.
      </p>

      <div style={st.searchRow}>
        <Search size={15} color="#999" />
        <input style={st.search} placeholder="Search by name or graduation year…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {youth === null ? <p style={st.muted}>Loading…</p> : filtered.length === 0 ? (
        <p style={st.muted}>{q ? "No matching members." : "No eligible members — everyone is already in the Hall of Fame."}</p>
      ) : (
        <div style={st.list}>
          {filtered.map((m) => (
            <div key={m.id} style={st.row}>
              <div style={st.photoWrap}>
                {m.photo_url ? <img src={m.photo_url} alt="" style={st.photo} /> : <div style={st.avatar}>{initials(m.first_name, m.last_name)}</div>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={st.name}>{m.first_name} {m.last_name}</div>
                <div style={st.meta}>
                  {m.graduation_year ? <span style={m.graduation_year <= thisYear ? st.gradNow : undefined}>Class of {m.graduation_year}</span> : "Grad year not set"}
                  {m.school ? ` · ${m.school}` : ""}
                </div>
              </div>
              <button style={st.gradBtn} disabled={busy === m.id} onClick={() => graduate(m)}>
                <GraduationCap size={15} /> {busy === m.id ? "Creating…" : "Add to Hall of Fame"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 14, padding: 0, marginBottom: 8 },
  heading: { margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: "#7a5b00" },
  hint: { color: "#8a7a52", fontSize: 14, marginTop: 0, marginBottom: 18, lineHeight: 1.5 },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #e0d2a8", borderRadius: 8, padding: "0 12px", marginBottom: 16, background: "#fff" },
  search: { flex: 1, padding: "10px 0", border: "none", outline: "none", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 14, padding: 12, background: "#fff", border: "1px solid #ece3c8", borderRadius: 10 },
  photoWrap: { width: 52, height: 52, borderRadius: 10, overflow: "hidden", border: `2px solid ${HOF_COLOR}`, flexShrink: 0 },
  photo: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  avatar: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#d9c27a,#b8860b)", color: "#fff", fontSize: 20, fontWeight: 700 },
  name: { fontWeight: 700, fontSize: 15, color: "#2a2418" },
  meta: { fontSize: 13, color: "#998", marginTop: 2 },
  gradNow: { color: "#2e7d32", fontWeight: 700 },
  gradBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: HOF_COLOR, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  muted: { color: "#998", textAlign: "center", padding: "2rem" },
};
