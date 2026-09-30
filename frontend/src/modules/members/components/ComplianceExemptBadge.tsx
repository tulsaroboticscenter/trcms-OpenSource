/**
 * ComplianceExemptBadge
 * =====================
 * Shows an "Exempt" badge on member profiles and a toggle for System Admins.
 * Embedded near the top of the profile hero when a member is compliance-exempt.
 */
import { useState } from "react";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { ShieldOff, Shield } from "lucide-react";

interface ExemptionStatus {
  exempt: boolean;
  explicit_flag: boolean;
  role_based: boolean;
  reason?: string;
}

interface Props {
  memberId: number;
  exemptionStatus?: ExemptionStatus;
  isComplianceExempt?: boolean;
  onChanged?: (newExemptFlag: boolean, newStatus: ExemptionStatus) => void;
}

export default function ComplianceExemptBadge({
  memberId, exemptionStatus, isComplianceExempt, onChanged,
}: Props) {
  const { user } = useAuth();
  const isSysAdmin = user?.roles?.includes("System Administrator");
  const [toggling, setToggling] = useState(false);
  const [localExempt, setLocalExempt] = useState<boolean | undefined>(isComplianceExempt);
  const [localStatus, setLocalStatus] = useState<ExemptionStatus | undefined>(exemptionStatus);

  const currentExempt = localExempt ?? isComplianceExempt ?? false;
  const currentStatus = localStatus ?? exemptionStatus;

  // Only show if exempt, or if sysadmin (who can toggle it)
  if (!currentExempt && !isSysAdmin) return null;

  async function toggle() {
    if (!isSysAdmin) return;
    setToggling(true);
    try {
      const { data } = await api.patch(`/api/v1/members/${memberId}/compliance-exemption`);
      setLocalExempt(data.is_compliance_exempt);
      setLocalStatus(data);
      onChanged?.(data.is_compliance_exempt, data);
    } catch {
      alert("Failed to update exemption status.");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      {currentExempt ? (
        <div style={styles.exemptBadge}>
          <ShieldOff size={12} />
          <span>Compliance Exempt</span>
          {currentStatus?.reason && <span style={styles.reason}>({currentStatus.reason})</span>}
        </div>
      ) : (
        isSysAdmin && (
          <div style={styles.notExemptNote}>
            <Shield size={12} />
            <span style={{ opacity: 0.6 }}>Not exempt</span>
          </div>
        )
      )}

      {/* Toggle button — System Admins only; hidden when role-based (can't be overridden) */}
      {isSysAdmin && !currentStatus?.role_based && (
        <button style={styles.toggleBtn} onClick={toggle} disabled={toggling}>
          {toggling ? "…" : currentExempt ? "Remove Exemption" : "Grant Exemption"}
        </button>
      )}

      {/* Role-based exemption note — can't be manually removed */}
      {isSysAdmin && currentStatus?.role_based && (
        <span style={styles.roleNote}>Auto-exempt via role</span>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  exemptBadge: {
    display: "flex", alignItems: "center", gap: 5,
    padding: "3px 10px", borderRadius: 10,
    background: "#f3e5f5", color: "#6a1b9a",
    fontSize: 11, fontWeight: 700, border: "1px solid #ce93d8",
  },
  reason: { fontWeight: 400, opacity: 0.8 },
  notExemptNote: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#aaa" },
  toggleBtn: {
    padding: "2px 10px", fontSize: 11, cursor: "pointer",
    border: "1px solid #ccc", borderRadius: 6, background: "#fff",
    color: "#555",
  },
  roleNote: { fontSize: 11, color: "#aaa", fontStyle: "italic" },
};
