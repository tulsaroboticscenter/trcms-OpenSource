import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { inventoryApi, type InvItem } from "../api";
import QrCode from "../components/QrCode";

/**
 * Asset label sheet — a print-optimized grid of QR labels for one or many assets.
 * Each label's QR opens that asset's TRCMS page. Pick a size to fit more per page.
 * While this page is mounted, print CSS (in index.css, body.print-labels) hides all
 * app chrome so only the label grid prints.
 */
const SIZES = {
  small:  { label: "Small",  cell: 1.35, qr: 74,  font: 9,  name: false },
  medium: { label: "Medium", cell: 1.9,  qr: 104, font: 11, name: true },
  large:  { label: "Large",  cell: 2.6,  qr: 150, font: 13, name: true },
} as const;
type SizeKey = keyof typeof SIZES;

export default function LabelSheet() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState<SizeKey>("small");
  const [copies, setCopies] = useState(1);

  useEffect(() => {
    document.body.classList.add("print-labels");
    return () => document.body.classList.remove("print-labels");
  }, []);

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    Promise.all(ids.map((id) => inventoryApi.getItem(id).catch(() => null)))
      .then((rows) => setItems(rows.filter((r): r is InvItem => !!r && !!r.asset_tag)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("ids")]);

  const s = SIZES[size];
  const labels = items.flatMap((it) => Array.from({ length: Math.max(1, copies) }, (_, k) => ({ it, k })));

  return (
    <div style={ui.page}>
      <div className="no-print" style={ui.toolbar}>
        <button style={ui.back} onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
        <div style={ui.controls}>
          <label style={ui.ctlLabel}>Label size
            <select style={ui.select} value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
              {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label style={ui.ctlLabel}>Copies each
            <input style={ui.num} type="number" min={1} max={20} value={copies} onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))} />
          </label>
          <span style={ui.count}>{items.length} asset{items.length !== 1 ? "s" : ""} · {labels.length} label{labels.length !== 1 ? "s" : ""}</span>
          <button style={ui.printBtn} disabled={labels.length === 0} onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </div>

      {loading ? <p className="no-print" style={ui.muted}>Loading…</p>
        : items.length === 0 ? <p className="no-print" style={ui.muted}>No printable assets (an asset needs a TRC Asset ID). Go back and select assets.</p>
        : (
        <div className="label-sheet" style={{ ...ui.sheet, gridTemplateColumns: `repeat(auto-fill, ${s.cell}in)` }}>
          {labels.map(({ it, k }) => (
            <div key={`${it.id}-${k}`} className="label" style={{ ...ui.label, width: `${s.cell}in` }}>
              <QrCode value={`${window.location.origin}/inventory/items/${it.id}`} size={s.qr} />
              <div style={{ ...ui.tag, fontSize: s.font }}>{it.asset_tag}</div>
              {s.name && <div style={{ ...ui.name, fontSize: s.font - 1 }}>{it.name}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ui: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  controls: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  ctlLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#556", fontWeight: 600 },
  select: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  num: { width: 60, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  count: { fontSize: 12.5, color: "#778" },
  printBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#889", fontSize: 14 },
  sheet: { display: "grid", gap: "0.12in", justifyContent: "start" },
  label: { border: "1px solid #ccc", borderRadius: 4, padding: "0.08in", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", boxSizing: "border-box", breakInside: "avoid" },
  tag: { fontFamily: "monospace", fontWeight: 700, color: "#000", marginTop: 3, lineHeight: 1.1, wordBreak: "break-all" },
  name: { color: "#333", marginTop: 1, lineHeight: 1.05, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
};
