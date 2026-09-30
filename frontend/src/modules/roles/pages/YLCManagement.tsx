import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { rolesApi, type YouthRoleRecord } from "../api";
import { Star, Users, ChevronRight, NotebookPen } from "lucide-react";

const ROLE_ORDER = ["President", "Vice President", "Treasurer", "Fundraising Lead", "Quartermaster", "Team Leader", "At Large"];

export default function YLCManagement() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<YouthRoleRecord[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [selectedTerm, setSelectedTerm] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rolesApi.listYLCTerms().then((t) => {
      setTerms(t);
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth();
      const activeYear = currentMonth >= 4 ? currentYear : currentYear - 1;
      const activeTerm = `${activeYear}-${activeYear + 1}`;
      const defaultTerm = t.includes(activeTerm) ? activeTerm : t[0] ?? "";
      setSelectedTerm(defaultTerm);
      return rolesApi.listYLC(defaultTerm || undefined);
    }).then(setMembers).finally(() => setLoading(false));
  }, []);

  async function loadTerm(term: string) {
    setSelectedTerm(term);
    setLoading(true);
    rolesApi.listYLC(term || undefined).then(setMembers).finally(() => setLoading(false));
  }

  // Group by role
  const byRole: Record<string, YouthRoleRecord[]> = {};
  for (const m of members) {
    const key = m.ylc_role ?? "At Large";
    if (!byRole[key]) byRole[key] = [];
    byRole[key].push(m);
  }

  const sortedRoles = [
    ...ROLE_ORDER.filter((r) => byRole[r]),
    ...Object.keys(byRole).filter((r) => !ROLE_ORDER.includes(r)),
  ];

  return (
    <div>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.heading}>Youth Leadership Council</h1>
          <p style={styles.sub}>YLC roles are assigned by the YLC President. The admin team assigns the President.</p>
        </div>
        <button style={styles.minutesBtn} onClick={() => navigate("/minutes?group=YLC")}>
          <NotebookPen size={15} /> Meeting Minutes
        </button>
      </div>

      {/* Term selector */}
      <div style={styles.termRow}>
        <label style={styles.termLabel}>Term:</label>
        <div style={styles.termButtons}>
          {terms.map((t) => (
            <button
              key={t}
              style={{ ...styles.termBtn, ...(selectedTerm === t ? styles.termBtnActive : {}) }}
              onClick={() => loadTerm(t)}
            >
              {t}
            </button>
          ))}
          <button
            style={{ ...styles.termBtn, ...(selectedTerm === "" ? styles.termBtnActive : {}) }}
            onClick={() => loadTerm("")}
          >
            All Time
          </button>
        </div>
      </div>

      {loading ? (
        <p style={styles.muted}>Loading…</p>
      ) : members.length === 0 ? (
        <div style={styles.empty}>
          <Star size={32} color="#ffd54f" style={{ margin: "0 auto 12px", display: "block" }} />
          <p>No YLC members found for this term.</p>
          <p style={{ fontSize: 13, color: "#888" }}>
            To add a member to the YLC, open their Member Profile and update their YLC Role.
          </p>
        </div>
      ) : (
        <div style={styles.rolesGrid}>
          {sortedRoles.map((roleName) => (
            <div key={roleName} style={styles.roleCard}>
              <div style={styles.roleCardTitle}>
                {roleName === "President" && <Star size={13} color="#f57c00" />}
                {roleName}
                <span style={styles.roleCount}>{byRole[roleName].length}</span>
              </div>
              {byRole[roleName].map((m) => (
                <div
                  key={m.member_id}
                  style={styles.memberRow}
                  onClick={() => navigate(`/members/${m.member_id}`)}
                >
                  <div style={styles.avatar}>
                    {m.photo_url
                      ? <img src={m.photo_url} style={styles.avatarImg} alt="" />
                      : <span style={styles.avatarInitials}>{m.first_name[0]}{m.last_name[0]}</span>
                    }
                  </div>
                  <span style={styles.memberName}>{m.first_name} {m.last_name}</span>
                  <ChevronRight size={13} color="#ccc" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={styles.infoBox}>
        <Users size={14} />
        <div>
          <strong>How YLC role assignment works:</strong>
          <ul style={styles.infoList}>
            <li>The admin team assigns the YLC President role from a member's profile page.</li>
            <li>The President can then assign roles to other YLC members.</li>
            <li>YLC membership is permanent — members keep their status as "At Large" even when not in an active role.</li>
            <li>Terms run May–May each year (e.g., 2026–2027).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  minutesBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 15px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  termRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  termLabel: { fontSize: 13, fontWeight: 600, color: "#555" },
  termButtons: { display: "flex", gap: 6, flexWrap: "wrap" },
  termBtn: { padding: "6px 14px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 },
  termBtnActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  muted: { color: "#888", fontSize: 13 },
  empty: { textAlign: "center", padding: "3rem", color: "#888" },
  rolesGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 20 },
  roleCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  roleCardTitle: { display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", background: "#f8fafc", fontSize: 13, fontWeight: 700, color: "#1a3a5c", borderBottom: "1px solid #e2e8f0" },
  roleCount: { marginLeft: "auto", background: "#e3f2fd", color: "#1565c0", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 },
  memberRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid #f8fafc" },
  avatar: { width: 28, height: 28, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  avatarInitials: { color: "#fff", fontSize: 10, fontWeight: 700 },
  memberName: { flex: 1, fontSize: 13, color: "#222" },
  infoBox: { display: "flex", gap: 10, padding: "14px 16px", background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 10, fontSize: 13, color: "#1565c0" },
  infoList: { margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#1565c0", lineHeight: 1.8 },
};
