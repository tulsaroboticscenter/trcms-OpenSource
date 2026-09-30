/**
 * NightPreferencePanel — shows a member's FLL meeting-night preference(s) on their
 * profile: the night(s) they prefer / can also do / can't, per program + season.
 * Data is loaded by the parent (MemberProfile) so the panel is only shown when the
 * member is FLL-relevant.
 */
import type { MemberNightPrefs } from "../../../core/nightPrefsApi";

function Row({ label, names, tone }: { label: string; names: string[]; tone: "pref" | "ok" | "no" }) {
  const c = tone === "pref" ? { bg: "#e6f4ea", fg: "#1b7a3d", bd: "#bfe3c9" }
    : tone === "ok" ? { bg: "#eef2f7", fg: "#4a5a6a", bd: "#d9e2ec" }
    : { bg: "#fdecea", fg: "#b5372a", bd: "#f3cdc7" };
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "3px 0" }}>
      <span style={{ fontSize: 12.5, color: "#778", minWidth: 90 }}>{label}</span>
      <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
        {names.length ? names.map((n) => (
          <span key={n} style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, padding: "1px 8px", borderRadius: 20, fontSize: 12, fontWeight: 700, textDecoration: tone === "no" ? "line-through" : "none" }}>{n}</span>
        )) : <span style={{ color: "#aab" }}>—</span>}
      </span>
    </div>
  );
}

export default function NightPreferencePanel({ data }: { data: MemberNightPrefs }) {
  if (!data.items.length) {
    return <p style={{ color: "#889", fontSize: 13.5, margin: 0 }}>No meeting-night preference on file yet. You can set one from the family availability form or the Season Planning board.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.items.map((it) => (
        <div key={`${it.program_id}-${it.season}`}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>{it.program_name} · {it.season}</div>
          <Row label="Prefers" names={it.preferred} tone="pref" />
          <Row label="Can also do" names={it.ok} tone="ok" />
          {it.no.length > 0 && <Row label="Can't do" names={it.no} tone="no" />}
          <div style={{ fontSize: 13, color: "#556", marginTop: 4 }}>
            Flexible: {it.flexible ? "Yes" : "No"}{it.siblings_together ? " · Keep siblings together" : ""}
          </div>
          {it.notes && <div style={{ fontSize: 12.5, color: "#667", marginTop: 2 }}>{it.notes}</div>}
        </div>
      ))}
    </div>
  );
}
