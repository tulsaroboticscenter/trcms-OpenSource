import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import {
  inventoryApi,
  type ReportsOverview, type SpendReport, type LowStockRow, type OpenPoRow, type BackorderRow, type RolloverResult,
} from "../api";
import {
  ArrowLeft, BarChart2, AlertTriangle, Truck, PackageCheck, RotateCcw,
} from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function ReportsPage() {
  const navigate = useNavigate();
  const goBack = useGoBack("/inventory");
  const { user } = useAuth();
  const isAdmin = !!user?.roles?.some((r) => r === "Admin" || r === "System Administrator");

  const [ov, setOv] = useState<ReportsOverview | null>(null);
  const [groupBy, setGroupBy] = useState("team");
  const [spend, setSpend] = useState<SpendReport | null>(null);
  const [low, setLow] = useState<LowStockRow[]>([]);
  const [openPos, setOpenPos] = useState<OpenPoRow[]>([]);
  const [backorders, setBackorders] = useState<BackorderRow[]>([]);

  useEffect(() => {
    inventoryApi.reportsOverview().then(setOv).catch(() => {});
    inventoryApi.reportsLowStock().then(setLow).catch(() => {});
    inventoryApi.reportsOpenPos().then(setOpenPos).catch(() => {});
    inventoryApi.reportsBackorders().then(setBackorders).catch(() => {});
  }, []);
  useEffect(() => { inventoryApi.reportsSpend(groupBy).then(setSpend).catch(() => {}); }, [groupBy]);

  const maxSpend = spend ? Math.max(1, ...spend.rows.map((r) => r.amount)) : 1;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <h1 style={st.heading}><BarChart2 size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Reports &amp; Analytics</h1>

      {/* Overview cards */}
      {ov && (
        <div style={st.cards}>
          <Card label="Inventory Value" value={`$${ov.estimated_valuation.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#2e7d32" />
          <Card label="Total Spend (received)" value={`$${ov.total_spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#1a3a5c" />
          <Card label="Total Items" value={String(ov.total_items)} color="#1565c0" />
          <Card label="Tagged Assets" value={String(ov.tagged_assets)} color="#3949ab" />
          <Card label="Low Stock" value={String(ov.low_stock)} color={ov.low_stock ? "#e65100" : "#999"} />
          <Card label="Open POs" value={String(ov.open_pos)} color="#6a1b9a" />
          <Card label="Items Out" value={String(ov.outstanding_checkouts)} color="#1565c0" />
          <Card label="Overdue" value={String(ov.overdue_checkouts)} color={ov.overdue_checkouts ? "#c62828" : "#999"} />
        </div>
      )}

      {/* Spend breakdown */}
      <Section title="Spend Breakdown" icon={<BarChart2 size={14} />}>
        <div style={st.toggle}>
          {[["team", "By Team"], ["vendor", "By Vendor"], ["category", "By Category"]].map(([v, l]) => (
            <button key={v} style={{ ...st.tBtn, ...(groupBy === v ? st.tBtnActive : {}) }} onClick={() => setGroupBy(v)}>{l}</button>
          ))}
        </div>
        {!spend || spend.rows.length === 0 ? <p style={st.muted}>No received spend recorded yet.</p> : (
          <div>
            {spend.rows.map((r) => (
              <div key={r.label} style={st.spendRow}>
                <span style={st.spendLabel}>{r.label}</span>
                <div style={st.spendBarWrap}><div style={{ ...st.spendBar, width: `${(r.amount / maxSpend) * 100}%` }} /></div>
                <span style={st.spendAmt}>${r.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
            <div style={st.spendTotal}>Total: <strong>${spend.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
          </div>
        )}
      </Section>

      <div style={st.twoCol}>
        {/* Low stock */}
        <Section title="Low Stock" icon={<AlertTriangle size={14} />}>
          {low.length === 0 ? <p style={st.muted}>Everything's above minimum.</p> : low.map((i) => (
            <div key={i.id} style={st.lineRow} onClick={() => navigate(`/inventory/items/${i.id}`)}>
              <span style={st.lineName}>{i.name}</span>
              <span style={st.lineRight}>{i.current_quantity} / {i.minimum_stock_level} {i.unit_of_measure ?? ""}</span>
            </div>
          ))}
        </Section>

        {/* Backorders */}
        <Section title="Backorders" icon={<Truck size={14} />}>
          {backorders.length === 0 ? <p style={st.muted}>No backorders.</p> : backorders.map((b) => (
            <div key={b.line_id} style={st.lineRow} onClick={() => navigate(`/inventory/boms/${b.bom_id}`)}>
              <span style={st.lineName}>{b.description ?? "—"}</span>
              <span style={st.lineRight}>{b.vendor_name ?? ""}</span>
            </div>
          ))}
        </Section>
      </div>

      {/* Open POs */}
      <Section title="Open Purchase Orders" icon={<PackageCheck size={14} />}>
        {openPos.length === 0 ? <p style={st.muted}>No open POs.</p> : openPos.map((p) => (
          <div key={p.id} style={st.lineRow} onClick={() => navigate(`/inventory/pos/${p.id}`)}>
            <span style={st.lineName}>{p.po_number} · {p.vendor_name ?? "Vendor TBD"}</span>
            <span style={st.lineRight}>{p.status.replace(/_/g, " ")} · {p.received_lines}/{p.line_count} received</span>
          </div>
        ))}
      </Section>

      {/* Season rollover — admin only */}
      {isAdmin && <SeasonRollover />}
    </div>
  );
}

function SeasonRollover() {
  const [season, setSeason] = useState("");
  const [preview, setPreview] = useState<RolloverResult | null>(null);
  const [result, setResult] = useState<RolloverResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function doPreview() {
    if (!season.trim()) return;
    setResult(null);
    setPreview(await inventoryApi.rolloverPreview(season.trim()));
  }
  async function run() {
    if (!preview || !season.trim()) return;
    if (!confirm(`Archive ${preview.boms} BOM(s) and ${preview.pos} PO(s) from season ${season}? Inventory and assets carry forward; this cannot be undone.`)) return;
    setBusy(true);
    try { setResult(await inventoryApi.runRollover(season.trim())); setPreview(null); }
    finally { setBusy(false); }
  }

  return (
    <Section title="Season Rollover (Admin)" icon={<RotateCcw size={14} />}>
      <p style={st.muted}>
        Archive a closed season's BOMs &amp; purchase orders. Inventory items and tagged assets carry forward
        automatically; new-season budgets start fresh.
      </p>
      <div style={st.rollRow}>
        <input style={st.rollInput} placeholder="Season to close, e.g. 2025-2026" value={season} onChange={(e) => setSeason(e.target.value)} />
        <button style={st.previewBtn} onClick={doPreview}>Preview</button>
      </div>
      {preview && (
        <div style={st.previewBox}>
          <span>{preview.boms} BOM(s), {preview.pos} PO(s){preview.total_spend ? `, $${preview.total_spend.toLocaleString()} received spend` : ""} would be archived.</span>
          {(preview.boms ?? 0) > 0 && <button style={st.runBtn} onClick={run} disabled={busy}>{busy ? "Archiving…" : "Run Rollover"}</button>}
        </div>
      )}
      {result && (
        <div style={st.resultBox}>
          ✓ Archived {result.boms_archived} BOM(s) and {result.pos_archived} PO(s) for {result.season}. {result.note}
        </div>
      )}
    </Section>
  );
}

function Card({ label, value, color }: { label: string; value: string; color: string }) {
  return <div style={st.card}><div style={{ ...st.cardVal, color }}>{value}</div><div style={st.cardLabel}>{label}</div></div>;
}
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={st.section}>
      <div style={st.sectionTitle}>{icon} {title}</div>
      {children}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: "0 0 16px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  cardVal: { fontSize: 20, fontWeight: 800 },
  cardLabel: { fontSize: 11, color: "#888", marginTop: 3 },
  section: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 14 },
  sectionTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  toggle: { display: "flex", gap: 6, marginBottom: 12 },
  tBtn: { padding: "5px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 16, cursor: "pointer", fontSize: 12, color: "#555" },
  tBtnActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  spendRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 7 },
  spendLabel: { width: 140, fontSize: 13, color: "#1a3a5c", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  spendBarWrap: { flex: 1, height: 14, background: "#eef2f7", borderRadius: 7, overflow: "hidden" },
  spendBar: { height: "100%", background: "#1565c0", borderRadius: 7 },
  spendAmt: { width: 90, textAlign: "right", fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  spendTotal: { textAlign: "right", marginTop: 10, paddingTop: 8, borderTop: "1px solid #f0f4f8", fontSize: 14, color: "#1a3a5c" },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  lineRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid #f4f6fa", cursor: "pointer", fontSize: 13 },
  lineName: { color: "#1a3a5c", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  lineRight: { color: "#888", flexShrink: 0 },
  muted: { color: "#aaa", fontSize: 13, margin: "4px 0" },
  rollRow: { display: "flex", gap: 8, marginTop: 8 },
  rollInput: { flex: 1, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  previewBtn: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  previewBox: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, padding: "10px 14px", marginTop: 10, fontSize: 13, color: "#795548" },
  runBtn: { padding: "7px 16px", background: "#e65100", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" },
  resultBox: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, padding: "10px 14px", marginTop: 10, fontSize: 13, color: "#2e7d32" },
};
