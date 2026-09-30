import { useState, useEffect } from "react";
import { adminApi } from "../api";
import { LayoutGrid, Save, Check } from "lucide-react";

/**
 * Team Profile Tabs — global control of WHICH tab each team-profile pane
 * appears under (General / Season / Team Info). One layout for everyone;
 * each user can still drag-reorder panes within a tab.
 */
export default function TeamPaneTabsSection() {
  const [panes, setPanes] = useState<{ key: string; label: string }[]>([]);
  const [tabs, setTabs] = useState<{ key: string; label: string }[]>([]);
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || panes.length) return;
    adminApi.getTeamPaneLayout().then((d) => {
      setPanes(d.panes); setTabs(d.tabs); setPlacement(d.placement);
    }).finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function setTab(paneKey: string, tab: string) {
    setPlacement((p) => ({ ...p, [paneKey]: tab }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await adminApi.setTeamPaneLayout(placement);
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
        <span style={st.title}><LayoutGrid size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Team Profile Tabs</span>
        <span style={st.hint}>{open ? "Hide" : "Organize team panes into tabs"}</span>
      </div>

      {open && (
        <>
          <p style={st.desc}>
            Choose which tab each pane appears under on a team's profile. This is one layout for everyone;
            each user can still drag-reorder the panes within a tab. A tab with no panes is hidden automatically.
          </p>

          {loading ? <p style={st.muted}>Loading…</p> : (
            <>
              <div style={st.grid}>
                <div style={{ ...st.cell, ...st.hdr }}>Pane</div>
                <div style={{ ...st.cell, ...st.hdr, textAlign: "center" }}>Tab</div>
                {panes.map((p) => (
                  <PaneRow key={p.key} label={p.label}
                    value={placement[p.key] ?? tabs[0]?.key} tabs={tabs}
                    onChange={(t) => setTab(p.key, t)} />
                ))}
              </div>
              <div style={st.actions}>
                <button style={st.saveBtn} onClick={save} disabled={saving}>
                  {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? "Saving…" : "Save Tabs"}</>}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PaneRow({ label, value, tabs, onChange }: {
  label: string; value: string; tabs: { key: string; label: string }[]; onChange: (t: string) => void;
}) {
  return (
    <>
      <div style={st.cell}>{label}</div>
      <div style={{ ...st.cell, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const active = value === t.key;
          return (
            <button key={t.key} onClick={() => onChange(t.key)}
              style={{ ...st.tabBtn, ...(active ? st.tabActive : {}) }}>
              {t.label}
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
  tabBtn: { padding: "5px 10px", border: "1px solid #cdd7e3", background: "#fff", color: "#555", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  tabActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  actions: { display: "flex", justifyContent: "flex-end", marginTop: 14 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
