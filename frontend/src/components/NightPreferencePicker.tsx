import type { NightOption } from "../core/nightPrefsApi";

export interface NightPrefValue {
  available: number[];
  preferred: number | null;
  siblings: boolean;
}

interface Props {
  nights: NightOption[];
  value: NightPrefValue;
  onChange: (v: NightPrefValue) => void;
  /** Shown when the program has no nights configured for the season. */
  emptyHint?: string;
  /** Hide the "keep siblings together" row (e.g. an only child / adult). */
  hideSiblings?: boolean;
  compact?: boolean;
}

/**
 * The one meeting-night preference control, shared by the visitor intake, the waitlist
 * add, and the enrollment form so a youth is asked the same way everywhere and the
 * answer lands in the canonical store. Model: pick the nights that work + one preferred.
 */
export default function NightPreferencePicker({ nights, value, onChange, emptyHint, hideSiblings, compact }: Props) {
  function toggle(id: number) {
    const on = value.available.includes(id);
    const available = on ? value.available.filter((x) => x !== id) : [...value.available, id];
    // If the preferred night is no longer among the workable nights, clear it.
    const preferred = value.preferred && !available.includes(value.preferred) ? null : value.preferred;
    onChange({ ...value, available, preferred });
  }

  if (nights.length === 0) {
    return <div style={s.muted}>{emptyHint ?? "No meeting nights are set up for this program yet."}</div>;
  }

  return (
    <div>
      <div style={s.label}>Which nights work?</div>
      <div style={compact ? s.chipsCompact : s.chips}>
        {nights.map((n) => {
          const on = value.available.includes(n.id);
          return (
            <label key={n.id} style={{ ...s.chip, ...(on ? s.chipOn : {}) }}>
              <input type="checkbox" checked={on} onChange={() => toggle(n.id)} style={{ margin: 0 }} />
              <span>{n.name}</span>
            </label>
          );
        })}
      </div>

      {value.available.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <div style={s.label}>Preferred night</div>
          <select
            style={s.sel}
            value={value.preferred ?? ""}
            onChange={(e) => onChange({ ...value, preferred: e.target.value ? parseInt(e.target.value) : null })}
          >
            <option value="">No preference</option>
            {nights.filter((n) => value.available.includes(n.id)).map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </div>
      )}

      {!hideSiblings && (
        <label style={s.check}>
          <input
            type="checkbox"
            checked={value.siblings}
            onChange={(e) => onChange({ ...value, siblings: e.target.checked })}
          />
          <span>Keep siblings on the same night</span>
        </label>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  label: { fontSize: 11.5, fontWeight: 700, color: "#556", margin: "0 0 5px" },
  chips: { display: "flex", flexWrap: "wrap", gap: 7 },
  chipsCompact: { display: "flex", flexWrap: "wrap", gap: 5 },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", border: "1px solid #cdd7e3", borderRadius: 20, fontSize: 13, cursor: "pointer", background: "#fff", color: "#334", userSelect: "none" },
  chipOn: { background: "#e7f0fb", borderColor: "#1565c0", color: "#0d3f7a", fontWeight: 600 },
  sel: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box", background: "#fff" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334", cursor: "pointer", margin: "10px 0 2px" },
  muted: { fontSize: 12.5, color: "#94a3b8", fontStyle: "italic" },
};
