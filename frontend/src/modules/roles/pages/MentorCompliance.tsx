import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { rolesApi, type AdultRoleRecord, type YouthComplianceRecord } from "../api";
import { CheckCircle, XCircle, Shield, ChevronRight, RefreshCw, Users, GraduationCap } from "lucide-react";

type Mode = "mentor" | "youth";

export default function MentorCompliance() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("mentor");
  const [mentors, setMentors] = useState<AdultRoleRecord[]>([]);
  const [youth, setYouth] = useState<YouthComplianceRecord[]>([]);
  const [season, setSeason] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "compliant" | "non_compliant">("all");

  const load = useCallback(() => {
    setLoading(true);
    if (mode === "mentor") {
      rolesApi.listAdults().then(setMentors).finally(() => setLoading(false));
    } else {
      rolesApi.listYouthCompliance().then((r) => { setYouth(r.youth); setSeason(r.season); }).finally(() => setLoading(false));
    }
  }, [mode]);

  useEffect(() => { load(); }, [load]);
  // Re-pull when the user returns to this tab/window, so a T&C reset (or any
  // change made elsewhere) can't leave stale "completed" status on screen.
  useEffect(() => {
    const refetch = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => { window.removeEventListener("focus", refetch); document.removeEventListener("visibilitychange", refetch); };
  }, [load]);

  const records: { is_compliant: boolean }[] = mode === "mentor" ? mentors : youth;
  const compliantCount = records.filter((m) => m.is_compliant).length;
  const nonCompliantCount = records.length - compliantCount;
  const matchesFilter = (c: boolean) => filter === "all" || (filter === "compliant" ? c : !c);
  const filteredMentors = mentors.filter((m) => matchesFilter(m.is_compliant));
  const filteredYouth = youth.filter((y) => matchesFilter(y.is_compliant));

  return (
    <div>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.heading}>Compliance</h1>
          <p style={styles.sub}>
            {mode === "mentor"
              ? "YPT and background check tracking for all active mentors"
              : `Youth enrollment, TRC T&C, and FIRST status for ${season || "the current season"}`}
          </p>
        </div>
        <button style={styles.refreshBtn} onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Youth / Mentor toggle */}
      <div style={styles.toggle}>
        <button style={{ ...styles.toggleBtn, ...(mode === "mentor" ? styles.toggleActive : {}) }}
          onClick={() => { setMode("mentor"); setFilter("all"); }}>
          <Users size={14} /> Mentors
        </button>
        <button style={{ ...styles.toggleBtn, ...(mode === "youth" ? styles.toggleActive : {}) }}
          onClick={() => { setMode("youth"); setFilter("all"); }}>
          <GraduationCap size={14} /> Youth
        </button>
      </div>

      {/* Summary strip */}
      <div style={styles.strip}>
        <SummaryChip label={mode === "mentor" ? "All Mentors" : "All Youth"} count={records.length} color="#1a3a5c"
          active={filter === "all"} onClick={() => setFilter("all")} />
        <SummaryChip label="Compliant" count={compliantCount} color="#2e7d32"
          active={filter === "compliant"} onClick={() => setFilter("compliant")} />
        <SummaryChip label="Needs Action" count={nonCompliantCount} color="#c62828"
          active={filter === "non_compliant"} onClick={() => setFilter("non_compliant")} />
      </div>

      {loading ? (
        <p style={styles.muted}>Loading…</p>
      ) : mode === "mentor" ? (
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span style={{ flex: 1 }}>Mentor</span>
            <span style={styles.col}>YPT</span>
            <span style={styles.col}>Background Check</span>
            <span style={styles.col}>TRC T&amp;C</span>
            <span style={styles.col}>Role</span>
            <span style={styles.col}>Service</span>
            <span style={styles.col}>Status</span>
            <span style={{ width: 32 }} />
          </div>
          {filteredMentors.map((m) => (
            <MentorRow key={m.member_id} mentor={m} onClick={() => navigate(`/members/${m.member_id}`)} />
          ))}
          {filteredMentors.length === 0 && (
            <div style={styles.empty}>No mentors match this filter.</div>
          )}
        </div>
      ) : (
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span style={{ flex: 1 }}>Youth</span>
            <span style={styles.col}>Enrolled</span>
            <span style={styles.col}>TRC T&amp;C</span>
            <span style={styles.col}>FIRST Registered</span>
            <span style={styles.col}>FIRST T&amp;C</span>
            <span style={styles.col}>Status</span>
            <span style={{ width: 32 }} />
          </div>
          {filteredYouth.map((y) => (
            <YouthRow key={y.member_id} youth={y} onClick={() => navigate(`/members/${y.member_id}`)} />
          ))}
          {filteredYouth.length === 0 && (
            <div style={styles.empty}>No youth match this filter.</div>
          )}
        </div>
      )}

      <div style={styles.infoBox}>
        <Shield size={14} />
        <div>
          {mode === "mentor" ? (
            <>
              <strong>Compliance rules (FIRST YPP):</strong>
              <ul style={styles.infoList}>
                <li>All adult mentors must complete YPT (Youth Protection Training) annually through the FIRST website.</li>
                <li>All adult mentors must have a background check on file.</li>
                <li>Mentors missing either are automatically restricted to parent-level access.</li>
                <li>Update completion status from the mentor's Member Profile page.</li>
              </ul>
            </>
          ) : (
            <>
              <strong>Youth is fully compliant when all four are met for {season || "the current season"}:</strong>
              <ul style={styles.infoList}>
                <li><strong>Enrolled</strong> — active enrollment for the current season.</li>
                <li><strong>TRC T&amp;C</strong> — youth and parent have agreed to the TRC Terms &amp; Conditions.</li>
                <li><strong>FIRST Registered</strong> — registered with FIRST on a current-season team.</li>
                <li><strong>FIRST T&amp;C</strong> — FIRST Consent &amp; Release signed on a current-season team.</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function YouthRow({ youth: y, onClick }: { youth: YouthComplianceRecord; onClick: () => void }) {
  return (
    <div style={styles.row} onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
    >
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ ...styles.avatar, background: "#1565c0" }}>
          {y.photo_url
            ? <img src={y.photo_url} style={styles.avatarImg} alt="" />
            : <span style={styles.avatarInitials}>{y.first_name[0]}{y.last_name[0]}</span>
          }
        </div>
        <div>
          <div style={styles.mentorName}>{y.last_name}, {y.first_name}</div>
          {!y.on_team && <div style={styles.expertise}>Not on a team this season</div>}
        </div>
      </div>
      <div style={styles.col}><YesNo ok={y.enrolled} /></div>
      <div style={styles.col}><YesNo ok={y.trc_tc} /></div>
      <div style={styles.col}><YesNo ok={y.first_registered} /></div>
      <div style={styles.col}><YesNo ok={y.first_tc} /></div>
      <div style={styles.col}>
        {y.is_compliant
          ? <span style={styles.compliantTag}><CheckCircle size={12} /> OK</span>
          : <span style={styles.nonCompliantTag}><XCircle size={12} /> Action Needed</span>
        }
      </div>
      <ChevronRight size={14} color="#ccc" />
    </div>
  );
}

function YesNo({ ok }: { ok: boolean }) {
  return ok
    ? <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#2e7d32", fontWeight: 600 }}><CheckCircle size={13} /> Yes</span>
    : <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#c62828", fontWeight: 600 }}><XCircle size={13} /> No</span>;
}

function MentorRow({ mentor: m, onClick }: { mentor: AdultRoleRecord; onClick: () => void }) {
  return (
    <div style={styles.row} onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
    >
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={styles.avatar}>
          {m.photo_url
            ? <img src={m.photo_url} style={styles.avatarImg} alt="" />
            : <span style={styles.avatarInitials}>{m.first_name[0]}{m.last_name[0]}</span>
          }
        </div>
        <div>
          <div style={styles.mentorName}>{m.last_name}, {m.first_name}</div>
          {m.areas_of_expertise?.length > 0 && (
            <div style={styles.expertise}>{m.areas_of_expertise.slice(0, 3).join(" · ")}{m.areas_of_expertise.length > 3 ? " …" : ""}</div>
          )}
        </div>
      </div>
      <div style={styles.col}>
        <ComplianceCell done={m.ypt_complete} date={m.ypt_date} />
      </div>
      <div style={styles.col}>
        <ComplianceCell done={m.background_check_complete} date={m.background_check_date} />
      </div>
      <div style={styles.col}>
        <ComplianceCell done={m.trc_tc} date={m.trc_tc_date} label={["Signed", "Not signed"]} />
      </div>
      <div style={styles.col}>
        <span style={styles.roleTag}>{m.role ?? "—"}</span>
      </div>
      <div style={styles.col}>
        <span style={styles.yearsBadge}>{m.service_years}yr{m.on_hold ? " ⏸" : ""}</span>
      </div>
      <div style={styles.col}>
        {m.is_compliant
          ? <span style={styles.compliantTag}><CheckCircle size={12} /> OK</span>
          : <span style={styles.nonCompliantTag}><XCircle size={12} /> Action Needed</span>
        }
      </div>
      <ChevronRight size={14} color="#ccc" />
    </div>
  );
}

function ComplianceCell({ done, date, label }: { done: boolean; date?: string; label?: [string, string] }) {
  const [okText, noText] = label ?? ["Complete", "Missing"];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {done ? <CheckCircle size={13} color="#2e7d32" /> : <XCircle size={13} color="#ef5350" />}
        <span style={{ fontSize: 12, color: done ? "#2e7d32" : "#c62828", fontWeight: 600 }}>
          {done ? okText : noText}
        </span>
      </div>
      {done && date && (
        <span style={{ fontSize: 10, color: "#aaa" }}>
          {new Date(date).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function SummaryChip({ label, count, color, active, onClick }: {
  label: string; count: number; color: string; active: boolean; onClick: () => void;
}) {
  return (
    <button style={{ ...styles.chip, borderColor: active ? color : "#e2e8f0", background: active ? color : "#fff", color: active ? "#fff" : "#555" }} onClick={onClick}>
      <span style={styles.chipCount}>{count}</span>
      <span style={styles.chipLabel}>{label}</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  refreshBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  toggle: { display: "inline-flex", gap: 4, background: "#eef2f7", borderRadius: 8, padding: 4, marginBottom: 16 },
  toggleBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 18px", border: "none", background: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#555" },
  toggleActive: { background: "#1a3a5c", color: "#fff" },
  strip: { display: "flex", gap: 8, marginBottom: 16 },
  chip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 16px", border: "2px solid #e2e8f0", borderRadius: 8, cursor: "pointer", minWidth: 90 },
  chipCount: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  chipLabel: { fontSize: 11, marginTop: 2, fontWeight: 600 },
  warningBanner: { display: "flex", gap: 10, padding: "12px 16px", background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 9, marginBottom: 16, fontSize: 13, color: "#e65100", alignItems: "flex-start" },
  muted: { color: "#888", fontSize: 13 },
  table: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 16 },
  tableHeader: { display: "flex", alignItems: "center", padding: "10px 16px", background: "#f0f4f8", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", gap: 10 },
  col: { width: 130, flexShrink: 0 },
  row: { display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #f0f4f8", cursor: "pointer", gap: 10, background: "#fff", transition: "background 0.1s" },
  avatar: { width: 34, height: 34, borderRadius: "50%", background: "#2e7d32", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  avatarInitials: { color: "#fff", fontSize: 12, fontWeight: 700 },
  mentorName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  expertise: { fontSize: 11, color: "#aaa" },
  roleTag: { fontSize: 12, color: "#555" },
  yearsBadge: { fontSize: 12, color: "#555" },
  compliantTag: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#2e7d32", padding: "3px 8px", background: "#e8f5e9", borderRadius: 8 },
  nonCompliantTag: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#c62828", padding: "3px 8px", background: "#ffebee", borderRadius: 8 },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
  infoBox: { display: "flex", gap: 10, padding: "14px 16px", background: "#f3e5f5", border: "1px solid #ce93d8", borderRadius: 10, fontSize: 13, color: "#6a1b9a" },
  infoList: { margin: "6px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.8, color: "#6a1b9a" },
};
