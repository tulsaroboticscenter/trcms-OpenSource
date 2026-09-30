/**
 * MentorTcBanner — dashboard nudge for MENTORS to sign the current season's
 * annual TRC Terms & Conditions. The T&C is stored per season, so at the season
 * roll every mentor starts unsigned and must renew. Mentors don't enroll, so
 * this login-time prompt is how they get asked (parents/volunteers/sponsors are
 * excluded — this shows only for member_type 'mentor'). Renders nothing once the
 * current season is signed.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSignature } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";

interface TCStatus {
  current_year_label: string;
  signed_current_year: boolean;
  in_grace_period: boolean;
  grace_ends?: string;
  grace_days_remaining?: number;
  current_year: number;
}

export default function MentorTcBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<TCStatus | null>(null);

  const isMentor = user?.member_type === "mentor";

  useEffect(() => {
    if (!isMentor || !user) return;
    api.get(`/api/v1/enrollment/mentor-tc/${user.id}`).then((r) => setStatus(r.data)).catch(() => setStatus(null));
  }, [isMentor, user]);

  if (!isMentor || !user || !status || status.signed_current_year) return null;

  const grace = status.in_grace_period;
  return (
    <div style={{ ...s.box, background: grace ? "#fff8e1" : "#ffebee", borderColor: grace ? "#ffd54f" : "#ef9a9a" }}>
      <FileSignature size={18} color={grace ? "#f57c00" : "#c62828"} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <div style={{ ...s.title, color: grace ? "#8a5a00" : "#c62828" }}>
          Please renew your TRC Terms &amp; Conditions for {status.current_year_label}
        </div>
        <div style={s.sub}>
          {grace && status.grace_ends
            ? `You signed last season's T&C. Grace period ends ${new Date(status.grace_ends + "T00:00:00").toLocaleDateString()}${status.grace_days_remaining != null ? ` (${status.grace_days_remaining} day${status.grace_days_remaining !== 1 ? "s" : ""} left)` : ""} — please sign for the new season.`
            : "All mentors sign the annual T&C each season. It only takes a moment and is required to check in to events."}
        </div>
      </div>
      <button style={s.btn} onClick={() => navigate(`/enrollment/mentor-tc/${user.id}/sign`)}>
        Sign for {status.current_year_label}
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  box: { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", border: "1px solid", borderRadius: 10, marginBottom: 16 },
  title: { fontSize: 14, fontWeight: 700 },
  sub: { fontSize: 12.5, color: "#556", marginTop: 3, lineHeight: 1.5 },
  err: { fontSize: 12.5, color: "#c62828", marginTop: 6 },
  btn: { flexShrink: 0, alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
};
