import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { hofApi, initials, HOF_COLOR, type HofListResponse, type HofCard } from "../api";
import { Trophy, GraduationCap, Eye, EyeOff, UserPlus } from "lucide-react";

export default function HallOfFameGallery() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canManage = canWrite("hof.manage");
  const [data, setData] = useState<HofListResponse | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  function load() {
    hofApi.list(showDrafts && canManage).then(setData).catch(() => setData({ classes: [], can_manage: false }));
  }
  useEffect(load, [showDrafts, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = !data || data.classes.length === 0;

  return (
    <div>
      <div style={st.hero}>
        <Trophy size={34} color={HOF_COLOR} />
        <div>
          <h1 style={st.heading}>Hall of Fame</h1>
          <p style={st.tagline}>Honoring the graduates who built our legacy — and inspiring those who will build the next.</p>
        </div>
      </div>

      {canManage && (
        <div style={st.toolbar}>
          <button style={st.primaryBtn} onClick={() => navigate("/hall-of-fame/graduate")}>
            <GraduationCap size={15} /> Graduate Seniors
          </button>
          <button style={st.ghostBtn} onClick={() => navigate("/hall-of-fame/new")}>
            <UserPlus size={15} /> Add Manually
          </button>
          <button style={st.ghostBtn} onClick={() => setShowDrafts((v) => !v)}>
            {showDrafts ? <EyeOff size={15} /> : <Eye size={15} />} {showDrafts ? "Hiding drafts" : "Show drafts"}
          </button>
        </div>
      )}

      {empty ? (
        <div style={st.emptyWrap}>
          <Trophy size={56} color="#e0d5b8" />
          <p style={st.empty}>No Hall of Fame members yet.{canManage && " Use “Graduate Seniors” to add your first class."}</p>
        </div>
      ) : (
        data!.classes.map((cls) => (
          <section key={cls.year ?? "unknown"} style={st.classSection}>
            <div style={st.classHeader}>
              <span style={st.classTitle}>{cls.year ? `Class of ${cls.year}` : "Class year not set"}</span>
              <span style={st.classRule} />
            </div>
            <div style={st.grid}>
              {cls.members.map((m) => <MemberCard key={m.id} m={m} onClick={() => navigate(`/hall-of-fame/${m.id}`)} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function MemberCard({ m, onClick }: { m: HofCard; onClick: () => void }) {
  return (
    <button style={st.card} onClick={onClick}>
      <div style={st.photoWrap}>
        {m.photo_url
          ? <img src={m.photo_url} alt={`${m.first_name} ${m.last_name}`} style={st.photo} />
          : <div style={st.avatar}>{initials(m.first_name, m.last_name)}</div>}
        {!m.is_published && <span style={st.draftBadge}>Draft</span>}
      </div>
      <div style={st.cardName}>{m.first_name} {m.last_name}</div>
    </button>
  );
}

const st: Record<string, React.CSSProperties> = {
  hero: { display: "flex", alignItems: "center", gap: 16, marginBottom: 18, padding: "18px 22px", background: "linear-gradient(135deg,#fffdf5,#f7efd8)", border: "1px solid #ecdfb8", borderRadius: 12 },
  heading: { margin: 0, fontSize: 28, fontWeight: 800, color: "#7a5b00", letterSpacing: 0.3 },
  tagline: { margin: "4px 0 0", color: "#8a7a52", fontSize: 14 },
  toolbar: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  primaryBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: HOF_COLOR, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  ghostBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#5b4a1e", border: "1px solid #e0d2a8", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  emptyWrap: { textAlign: "center", padding: "4rem 1rem" },
  empty: { color: "#a89968", marginTop: 12, fontSize: 15 },
  classSection: { marginBottom: 34 },
  classHeader: { display: "flex", alignItems: "center", gap: 16, marginBottom: 16 },
  classTitle: { fontSize: 20, fontWeight: 800, color: "#7a5b00", whiteSpace: "nowrap" },
  classRule: { flex: 1, height: 2, background: "linear-gradient(90deg,#e6d49b,transparent)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 18 },
  card: { background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  photoWrap: { position: "relative", width: "100%", aspectRatio: "1", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.12)", border: `3px solid ${HOF_COLOR}` },
  photo: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  avatar: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#d9c27a,#b8860b)", color: "#fff", fontSize: 40, fontWeight: 700 },
  draftBadge: { position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.7)", color: "#ffd966", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  cardName: { fontSize: 15, fontWeight: 700, color: "#3a3120" },
};
