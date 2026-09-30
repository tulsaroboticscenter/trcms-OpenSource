import { useEffect, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { api } from "../../../core/api";
import { CreditCard, Plus, Trash2, Check, AlertCircle } from "lucide-react";
import InlineHelp from "../../help/InlineHelp";

interface ProviderRow { key: string; label: string; enabled: boolean; configured: boolean; fee_percent: number; fee_fixed: number; }
interface ManualMethod { key: string; label: string; enabled: boolean; }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

export default function PaymentSettings() {
  const goBack = useGoBack("/admin");
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [manual, setManual] = useState<ManualMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await api.get("/api/v1/admin/payment-settings");
    setProviders(r.data.providers ?? []);
    setManual(r.data.manual_methods ?? []);
    setLoading(false);
  }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  function setProvider(key: string, patch: Partial<ProviderRow>) {
    setProviders((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function setMethod(i: number, patch: Partial<ManualMethod>) {
    setManual((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function save() {
    setMsg("");
    const provObj: Record<string, unknown> = {};
    for (const p of providers) provObj[p.key] = { enabled: p.enabled, fee_percent: p.fee_percent, fee_fixed: p.fee_fixed };
    const methods = manual
      .map((m) => ({ key: m.key || slug(m.label), label: m.label.trim(), enabled: m.enabled }))
      .filter((m) => m.key && m.label);
    const r = await api.put("/api/v1/admin/payment-settings", { providers: provObj, manual_methods: methods });
    setProviders(r.data.providers ?? []);
    setManual(r.data.manual_methods ?? []);
    setMsg("Saved.");
    setTimeout(() => setMsg(""), 2500);
  }

  if (loading) return <p style={{ padding: 20, color: "#889" }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <button style={s.back} onClick={goBack}>← Admin</button>
      <h1 style={s.h1}><CreditCard size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Payment Settings <InlineHelp helpKey="payment-settings" /></h1>
      <p style={s.sub}>Control which online payment providers families can use and the fee rates for the "cover the processing fee" option. Provider credentials are configured on the server (.env); this page turns them on/off and sets fees.</p>

      {/* Online providers */}
      <div style={s.card}>
        <div style={s.cardH}>Online providers (credit card)</div>
        {providers.map((p) => (
          <div key={p.key} style={s.provRow}>
            <div style={s.provTop}>
              <label style={s.toggle}>
                <input type="checkbox" checked={p.enabled} onChange={(e) => setProvider(p.key, { enabled: e.target.checked })} />
                <span style={s.provName}>{p.label}</span>
              </label>
              {p.configured
                ? <span style={s.okTag}><Check size={12} /> Credentials configured</span>
                : <span style={s.warnTag}><AlertCircle size={12} /> Not configured on server (.env)</span>}
            </div>
            <div style={s.feeRow}>
              <label style={s.feeLbl}>Fee %
                <input style={s.feeIn} type="number" min={0} max={100} step="0.01" value={p.fee_percent}
                  onChange={(e) => setProvider(p.key, { fee_percent: parseFloat(e.target.value) || 0 })} />
              </label>
              <label style={s.feeLbl}>Fixed fee $
                <input style={s.feeIn} type="number" min={0} step="0.01" value={p.fee_fixed}
                  onChange={(e) => setProvider(p.key, { fee_fixed: parseFloat(e.target.value) || 0 })} />
              </label>
              {!p.configured && p.enabled && <span style={s.hint}>Won't appear to families until credentials are added on the server.</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Manual (admin-recorded) methods */}
      <div style={s.card}>
        <div style={s.cardH}>Manual methods (recorded by admins only)</div>
        <p style={s.note}>These are how the admin team records payments taken outside the app (cash, check, scholarship, etc.). Parents never see these — they can't mark their own accounts paid.</p>
        {manual.map((m, i) => (
          <div key={i} style={s.methodRow}>
            <input type="checkbox" checked={m.enabled} onChange={(e) => setMethod(i, { enabled: e.target.checked })} />
            <input style={s.methodIn} value={m.label} placeholder="Method name (e.g. Venmo)" onChange={(e) => setMethod(i, { label: e.target.value })} />
            <button style={s.del} title="Remove" onClick={() => setManual((mm) => mm.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
        <button style={s.addBtn} onClick={() => setManual((m) => [...m, { key: "", label: "", enabled: true }])}><Plus size={14} /> Add method</button>
      </div>

      <div style={s.actions}>
        <button style={s.save} onClick={save}>Save settings</button>
        {msg && <span style={s.saved}>{msg}</span>}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: "0 0 4px" },
  sub: { color: "#667", fontSize: 13.5, margin: "0 0 16px", lineHeight: 1.5 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 14 },
  cardH: { fontSize: 15, fontWeight: 800, color: "#1a3a5c", marginBottom: 10 },
  note: { fontSize: 12.5, color: "#889", margin: "0 0 10px", lineHeight: 1.5 },
  provRow: { borderTop: "1px solid #eef2f6", padding: "12px 0" },
  provTop: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  toggle: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  provName: { fontSize: 14.5, fontWeight: 700, color: "#1a3a5c" },
  okTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#2e7d32", background: "#e8f5e9", borderRadius: 10, padding: "2px 9px", fontWeight: 600 },
  warnTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#e65100", background: "#fff3e0", borderRadius: 10, padding: "2px 9px", fontWeight: 600 },
  feeRow: { display: "flex", gap: 16, alignItems: "center", marginTop: 8, flexWrap: "wrap" },
  feeLbl: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#556", fontWeight: 600 },
  feeIn: { width: 80, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  hint: { fontSize: 11.5, color: "#b26a00" },
  methodRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" },
  methodIn: { flex: 1, padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5 },
  del: { background: "none", border: "1px solid #f0c5c5", color: "#c62828", borderRadius: 6, cursor: "pointer", padding: 6, display: "flex" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "7px 12px", background: "#fff", color: "#1a3a5c", border: "1px dashed #b8c4d4", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer" },
  actions: { display: "flex", alignItems: "center", gap: 12 },
  save: { padding: "10px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  saved: { color: "#2e7d32", fontSize: 13, fontWeight: 600 },
};
