import { useEffect, useState } from "react";
import { incidentsApi, PHASE1_TYPES, type RoutingConfig, type RoutingRule } from "../api";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, Send } from "lucide-react";

/**
 * Incident report email routing. Lives inside Admin → Email Settings (embedded) so it sits with the
 * rest of the notification addresses; also reachable at /admin/incident-settings. Each destination
 * has its own Test button.
 */
export function IncidentRoutingSettings({ embedded = false }: { embedded?: boolean }) {
  const [cfg, setCfg] = useState<RoutingConfig | null>(null);
  const [msg, setMsg] = useState("");
  const [test, setTest] = useState<Record<string, string>>({});   // per-destination test result

  useEffect(() => { incidentsApi.settingsGet().then(setCfg).catch(() => {}); }, []);

  if (!cfg) return <div style={{ padding: embedded ? 0 : 24, color: "#888" }}>Loading routing…</div>;

  const update = (patch: Partial<RoutingConfig>) => setCfg({ ...cfg, ...patch });
  const setRule = (i: number, patch: Partial<RoutingRule>) => update({ rules: cfg.rules.map((r, j) => j === i ? { ...r, ...patch } : r) });
  const addRule = () => update({ rules: [...cfg.rules, { id: Math.max(0, ...cfg.rules.map((r) => r.id)) + 1, label: "New rule", types: ["*"], min_severity: "minor", to: [], cc: [], notify_roles: [], board_notify: false }] });

  async function save() { const saved = await incidentsApi.settingsSave(cfg!); setCfg(saved); setMsg("Saved."); setTimeout(() => setMsg(""), 2500); }

  // Send a test to every address in a destination field, and report the outcome under that field.
  async function testDest(key: string, addrs: string[]) {
    const list = addrs.map((a) => a.trim()).filter(Boolean);
    if (!list.length) { setTest((t) => ({ ...t, [key]: "No address to test." })); return; }
    setTest((t) => ({ ...t, [key]: "Sending…" }));
    const results = await Promise.all(list.map(async (a) => {
      try { const r = await incidentsApi.settingsTest(a); return r.ok ? null : `${a}: ${r.error ?? "failed"}`; }
      catch { return `${a}: failed`; }
    }));
    const fails = results.filter(Boolean);
    setTest((t) => ({ ...t, [key]: fails.length ? `⚠ ${fails.join("; ")}` : `✓ Sent to ${list.join(", ")}` }));
  }

  const TestBtn = ({ k, addrs }: { k: string; addrs: string[] }) => (
    <span style={st.testWrap}>
      <button type="button" style={st.testBtn} onClick={() => testDest(k, addrs)}><Send size={12} /> Test</button>
      {test[k] && <span style={{ ...st.testMsg, color: test[k].startsWith("⚠") ? "#c62828" : "#2e7d32" }}>{test[k]}</span>}
    </span>
  );

  return (
    <div>
      {!embedded && <p style={st.lead}>Rules are evaluated in order; every matching rule fires (recipients de-duplicated). Severity gates on the triage-confirmed value, falling back to the reporter's.</p>}

      <div style={st.block}>
        <div style={st.blockTitle}>Incident inbox</div>
        <label style={st.lbl}>Default recipients (comma-separated) <TestBtn k="inbox" addrs={cfg.default_to} /></label>
        <input style={st.in} value={cfg.default_to.join(", ")} onChange={(e) => update({ default_to: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="incidentreport@tulsaroboticscenter.org" />
        <label style={st.lbl}>Reply-to (optional)</label>
        <input style={st.in} value={cfg.reply_to} onChange={(e) => update({ reply_to: e.target.value })} />
      </div>

      {cfg.rules.map((r, i) => (
        <div key={i} style={st.block}>
          <div style={st.blockTitle}>Rule {r.id}</div>
          <label style={st.lbl}>Label</label>
          <input style={st.in} value={r.label} onChange={(e) => setRule(i, { label: e.target.value })} />
          <div style={st.grid2}>
            <div><label style={st.lbl}>Applies to types</label>
              <select style={st.in} value={r.types.includes("*") ? "*" : r.types[0] ?? "*"} onChange={(e) => setRule(i, { types: [e.target.value] })}>
                <option value="*">All types</option>{PHASE1_TYPES.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
              </select></div>
            <div><label style={st.lbl}>Minimum severity</label>
              <select style={st.in} value={r.min_severity} onChange={(e) => setRule(i, { min_severity: e.target.value })}>{["minor", "moderate", "serious", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <label style={st.lbl}>Send to (emails, comma-separated) <TestBtn k={`rule-${i}`} addrs={r.to} /></label>
          <input style={st.in} value={r.to.join(", ")} onChange={(e) => setRule(i, { to: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          <label style={st.lbl}>Notify roles (comma-separated role names, e.g. Admin)</label>
          <input style={st.in} value={r.notify_roles.join(", ")} onChange={(e) => setRule(i, { notify_roles: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginTop: 8 }}><input type="checkbox" checked={r.board_notify} onChange={(e) => setRule(i, { board_notify: e.target.checked })} /> Flag as board-reportable</label>
        </div>
      ))}
      <button style={st.lightBtn} onClick={addRule}>+ Add rule</button>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <button style={st.primary} onClick={save}>Save routing</button>
        {msg && <span style={{ color: "#2e7d32", fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}

export default function IncidentSettings() {
  const goBack = useGoBack("/admin");
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "8px 14px 40px" }}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Admin Console</button>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: "6px 0 4px" }}>Incident Routing Settings</h1>
      <IncidentRoutingSettings />
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  lead: { color: "#888", fontSize: 13, marginTop: 0 },
  block: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginTop: 10 },
  blockTitle: { fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "#888", marginBottom: 8 },
  lbl: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 12, fontWeight: 600, color: "#556", margin: "8px 0 3px" },
  in: { width: "100%", boxSizing: "border-box", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  primary: { padding: "10px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  lightBtn: { padding: "9px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontWeight: 600, marginTop: 10 },
  testWrap: { display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 400 },
  testBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", background: "#0277bd", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 600 },
  testMsg: { fontSize: 11.5 },
};
