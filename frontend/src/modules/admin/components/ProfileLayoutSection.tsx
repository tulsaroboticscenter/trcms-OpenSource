import { useState, useEffect } from "react";
import { adminApi } from "../api";
import { LayoutPanelLeft, Save, Check } from "lucide-react";

/**
 * Profile Layout — global control of WHERE each profile pane appears.
 * Lives in Role Management because it sits next to per-role Profile Section
 * visibility. Visibility is per-role; placement is one global map.
 */
export default function ProfileLayoutSection() {
  const [panes, setPanes] = useState<{ key: string; label: string }[]>([]);
  const [zones, setZones] = useState<{ key: string; label: string }[]>([]);
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || panes.length) return;
    adminApi.getProfileLayout().then((d) => {
      setPanes(d.panes); setZones(d.zones); setPlacement(d.placement);
    }).finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function setZone(paneKey: string, zone: string) {
    setPlacement((p) => ({ ...p, [paneKey]: zone }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await adminApi.setProfileLayout(placement);
      setPlacement(res.placement);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={st.section}>
      <div style={st.head} onClick={() => setOpen((v) => !v)}>
        <span style={st.title}><LayoutPanelLeft size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Profile Layout</span>
        <span style={st.hint}>{open ? "Hide" : "Configure where profile panes appear"}</span>
      </div>

      {open && (
        <>
          <p style={st.desc}>
            Choose where each pane shows on a member's profile. <strong>Main Page</strong> is the daily view,
            <strong> Side Panel</strong> is a narrow column beside it, and <strong>Account Info Page</strong> is a
            separate tab for administrative items. This is one layout for everyone — what each role is <em>allowed</em>
            {" "}to see is still controlled by the per-role Profile Section permissions above.
          </p>

          {loading ? <p style={st.muted}>Loading…</p> : (
            <>
              <div style={st.grid}>
                <div style={{ ...st.cell, ...st.hdr }}>Pane</div>
                <div style={{ ...st.cell, ...st.hdr, textAlign: "center" }}>Placement</div>
                {panes.map((p) => (
                  <PaneRow key={p.key} label={p.label}
                    value={placement[p.key] ?? "main"} zones={zones}
                    onChange={(z) => setZone(p.key, z)} />
                ))}
              </div>
              <div style={st.actions}>
                <button style={st.saveBtn} onClick={save} disabled={saving}>
                  {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? "Saving…" : "Save Layout"}</>}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PaneRow({ label, value, zones, onChange }: {
  label: string; value: string; zones: { key: string; label: string }[]; onChange: (z: string) => void;
}) {
  return (
    <>
      <div style={st.cell}>{label}</div>
      <div style={{ ...st.cell, display: "flex", gap: 6, justifyContent: "center" }}>
        {zones.map((z) => {
          const active = value === z.key;
          return (
            <button key={z.key} onClick={() => onChange(z.key)}
              style={{ ...st.zoneBtn, ...(active ? st.zoneActive : {}) }}>
              {z.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

const st: Record<string, React.CSSProperties> = {
  section: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 18 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" },
  title: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  hint: { fontSize: 12, color: "#888" },
  desc: { fontSize: 12.5, color: "#666", lineHeight: 1.6, margin: "10px 0 14px" },
  muted: { color: "#888", fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "1fr auto", gap: "1px", background: "#eef2f6", border: "1px solid #eef2f6", borderRadius: 8, overflow: "hidden" },
  cell: { background: "#fff", padding: "9px 12px", fontSize: 13, color: "#333", display: "flex", alignItems: "center" },
  hdr: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, background: "#f8fafc" },
  zoneBtn: { padding: "5px 10px", border: "1px solid #cdd7e3", background: "#fff", color: "#555", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  zoneActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  actions: { display: "flex", justifyContent: "flex-end", marginTop: 14 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
