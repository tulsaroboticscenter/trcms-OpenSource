/**
 * CommunicationPreferencesPanel
 * ==============================
 * Embedded in MemberProfile. Lets members choose which types of
 * communications they want to receive. Admins can also manage these.
 *
 * Preference types are configured by the admin in
 * Admin Console → Configurable Options → "Member Communication Preference Types".
 * Default = opted IN for all types. Unchecking opts out.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../../../core/AuthContext";
import { commsApi, type CommPreference } from "../api";
import { Bell, BellOff, Save, CheckCircle } from "lucide-react";

interface Props { memberId: number; }

export default function CommunicationPreferencesPanel({ memberId }: Props) {
  const { user } = useAuth();
  const isSelf = user?.id === memberId;

  const [preferences, setPreferences] = useState<CommPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { load(); }, [memberId]);

  async function load() {
    setLoading(true);
    commsApi.getMemberPreferences(memberId)
      .then(setPreferences)
      .finally(() => setLoading(false));
  }

  function toggle(type: string) {
    setPreferences(prev =>
      prev.map(p => p.preference_type === type ? { ...p, opted_in: !p.opted_in } : p)
    );
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await commsApi.updateMemberPreferences(memberId, preferences);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <p style={styles.muted}>Loading preferences…</p>;

  const optedIn = preferences.filter(p => p.opted_in).length;
  const total = preferences.length;

  return (
    <div>
      <div style={styles.summary}>
        <Bell size={14} color={optedIn > 0 ? "#2e7d32" : "#aaa"} />
        <span style={styles.summaryText}>
          Receiving <strong>{optedIn}</strong> of {total} communication type{total !== 1 ? "s" : ""}
        </span>
        {isSelf && <span style={styles.selfNote}>Your preferences</span>}
      </div>

      <div style={styles.prefList}>
        {preferences.map(p => (
          <label key={p.preference_type} style={{
            ...styles.prefRow,
            background: p.opted_in ? "#f0faf0" : "#fafafa",
            borderColor: p.opted_in ? "#a5d6a7" : "#e2e8f0",
          }}>
            <input
              type="checkbox"
              checked={p.opted_in}
              onChange={() => toggle(p.preference_type)}
              style={styles.checkbox}
            />
            <div style={styles.prefInfo}>
              <span style={{ ...styles.prefLabel, color: p.opted_in ? "#1a3a5c" : "#aaa" }}>
                {p.preference_type}
              </span>
            </div>
            {p.opted_in
              ? <Bell size={13} color="#2e7d32" />
              : <BellOff size={13} color="#ccc" />
            }
          </label>
        ))}
      </div>

      {dirty && (
        <div style={styles.saveRow}>
          <button style={styles.saveBtn} onClick={save} disabled={saving}>
            <Save size={13} /> {saving ? "Saving…" : "Save Preferences"}
          </button>
        </div>
      )}

      {saved && (
        <div style={styles.savedMsg}>
          <CheckCircle size={13} color="#2e7d32" /> Preferences saved.
        </div>
      )}

      <p style={styles.note}>
        {isSelf
          ? "Uncheck any type to stop receiving those emails. Emergency and urgent notices cannot be opted out of."
          : "These are the member's current communication preferences."
        }
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  summary: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 },
  summaryText: { flex: 1, color: "#555" },
  selfNote: { fontSize: 11, color: "#aaa", fontStyle: "italic" },
  prefList: { display: "flex", flexDirection: "column", gap: 6 },
  prefRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", userSelect: "none" as const, transition: "background 0.1s, border-color 0.1s" },
  checkbox: { flexShrink: 0, width: 16, height: 16, cursor: "pointer" },
  prefInfo: { flex: 1 },
  prefLabel: { fontSize: 13, fontWeight: 500 },
  saveRow: { display: "flex", justifyContent: "flex-end", marginTop: 10 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  savedMsg: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#2e7d32", marginTop: 8 },
  note: { fontSize: 11, color: "#aaa", marginTop: 10, lineHeight: 1.6 },
};
