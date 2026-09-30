/**
 * Compliance Settings (open-source Phase 4) — rename the compliance items your
 * organization tracks (e.g. "Youth Protection Training" → "Safeguarding Training",
 * "Background Check" → "DBS Check"), choose which ones apply, and which ones block
 * check-in. The data model is unchanged; this only controls labels and behavior.
 * Defaults preserve the original FIRST setup (YPT + background check gate check-in).
 */
import { useEffect, useState } from "react";
import { rolesApi, type ComplianceItem } from "../../roles/api";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, Save, ShieldCheck } from "lucide-react";

export default function ComplianceSettings() {
  const goBack = useGoBack("/admin");
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    rolesApi.complianceItems().then((r) => setItems(r.items)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const update = (key: string, patch: Partial<ComplianceItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    try {
      await rolesApi.saveComplianceItems(items);
      setMsg("Saved — these apply across compliance and the check-in gate.");
      load();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={s.wrap}><p style={s.muted}>Loading…</p></div>;

  return (
    <div style={s.wrap}>
      <button onClick={goBack} style={s.back}><ArrowLeft size={14} /> Admin</button>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}><ShieldCheck size={20} style={{ verticalAlign: "-3px", marginRight: 6 }} />Compliance Settings</h1>
          <p style={s.sub}>
            Name the trainings and checks your organization requires, choose which apply, and which
            must be current for someone to check in. Validity periods are set in Configurable Options.
          </p>
        </div>
        <button style={s.primary} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
      </div>

      {msg && <div style={s.ok}>{msg}</div>}
      {err && <div style={s.err}>{err}</div>}

      <div style={s.table}>
        <div style={{ ...s.row, ...s.headerRow }}>
          <div style={s.cLabel}>Name</div>
          <div style={s.cShort}>Short</div>
          <div style={s.cFlag}>Applies</div>
          <div style={s.cFlag}>Gates check-in</div>
        </div>
        {items.map((it) => (
          <div key={it.key} style={{ ...s.row, opacity: it.enabled ? 1 : 0.55 }}>
            <div style={s.cLabel}>
              <input style={s.input} value={it.label} onChange={(e) => update(it.key, { label: e.target.value })} />
            </div>
            <div style={s.cShort}>
              <input style={s.input} value={it.short} onChange={(e) => update(it.key, { short: e.target.value })} />
            </div>
            <div style={s.cFlag}>
              <input type="checkbox" checked={it.enabled} onChange={(e) => update(it.key, { enabled: e.target.checked })} />
            </div>
            <div style={s.cFlag}>
              <input type="checkbox" checked={it.gates_checkin} disabled={!it.enabled}
                onChange={(e) => update(it.key, { gates_checkin: e.target.checked })} />
            </div>
          </div>
        ))}
      </div>
      <p style={s.hint}>
        "Gates check-in" items must be complete and unexpired before a mentor (or any adult held to
        compliance) can check in — the safety gate. The others only drive renewal reminders.
      </p>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#5a6b7d", cursor: "pointer", fontSize: 13, padding: "8px 0" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a2634", margin: 0 },
  sub: { fontSize: 13, color: "#7a8899", margin: "4px 0 0", maxWidth: 520, lineHeight: 1.5 },
  table: { border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", background: "#fff" },
  row: { display: "grid", gridTemplateColumns: "1fr 120px 90px 120px", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid #f0f4f8" },
  headerRow: { background: "#fafcfe", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#7a8899" },
  cLabel: {}, cShort: {}, cFlag: { textAlign: "center" },
  input: { width: "100%", padding: "6px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ok: { fontSize: 13, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  err: { fontSize: 13, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6c2", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  hint: { fontSize: 12.5, color: "#8b98a6", margin: "12px 2px 0", lineHeight: 1.5 },
  muted: { fontSize: 13, color: "#8b98a6" },
};
