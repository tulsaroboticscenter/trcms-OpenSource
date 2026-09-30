import { useState, useEffect } from "react";
import { inventoryApi, type InvLocation, type LocationContentsRow } from "../api";
import { ArrowLeft, MapPin, Printer } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

/**
 * "Where is everything" — pick an area/room and list every stored item with its
 * Rack / Shelf / Bin, Part #, Name, and quantity on hand. Includes anything in
 * locations nested under the chosen one. Printable for posting on a wall.
 */
export default function WhereReport() {
  const goBack = useGoBack("/inventory");
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [locId, setLocId] = useState("");
  const [rows, setRows] = useState<LocationContentsRow[]>([]);
  const [locName, setLocName] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => { inventoryApi.listLocations().then(setLocations).catch(() => {}); }, []);

  function run(id: string) {
    setLocId(id);
    if (!id) { setRows([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    inventoryApi.locationContents(parseInt(id))
      .then((d) => { setRows(d.items); setLocName(d.location.name); })
      .finally(() => setLoading(false));
  }

  function printReport() {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const body = rows.map((r) => `<tr>
      <td>${esc(r.rack)}</td><td>${esc(r.shelf)}</td><td>${esc(r.bin)}</td>
      <td>${esc(r.part_number)}</td><td>${esc(r.name)}</td>
      <td>${r.location_name ?? ""}</td><td style="text-align:right">${r.quantity ?? ""} ${esc(r.unit_of_measure)}</td>
    </tr>`).join("");
    w.document.write(`<html><head><title>Where is everything — ${esc(locName)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#222}h2{margin:0 0 12px}
      table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f0f4f8}</style></head>
      <body><h2>Where is everything — ${esc(locName)}</h2>
      <table><thead><tr><th>Rack</th><th>Shelf</th><th>Bin</th><th>Part #</th><th>Item</th><th>Location</th><th>On Hand</th></tr></thead>
      <tbody>${body}</tbody></table></body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <h1 style={st.heading}><MapPin size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Where Is Everything</h1>
      <p style={st.sub}>Pick an area or room to list every item stored there with its rack, shelf, and bin.</p>

      <div style={st.toolbar}>
        <select style={st.select} value={locId} onChange={(e) => run(e.target.value)}>
          <option value="">Select an area / location…</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.path ?? l.name}</option>)}
        </select>
        {rows.length > 0 && <button style={st.printBtn} onClick={printReport}><Printer size={14} /> Print</button>}
      </div>

      {loading ? <p style={st.muted}>Loading…</p> : searched && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>{["Rack", "Shelf", "Bin", "Part #", "Item", "Location", "On Hand"].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.item_id}-${r.location_id}-${i}`} style={st.tr}>
                  <td style={st.td}>{r.rack || "—"}</td>
                  <td style={st.td}>{r.shelf || "—"}</td>
                  <td style={st.td}>{r.bin || "—"}</td>
                  <td style={st.td}>{r.part_number || "—"}</td>
                  <td style={{ ...st.td, fontWeight: 600 }}>{r.name}</td>
                  <td style={st.td}>{r.location_name}</td>
                  <td style={{ ...st.td, textAlign: "right" }}>{r.quantity ?? "—"} {r.unit_of_measure ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p style={st.empty}>Nothing is stored in this area yet.</p>}
        </div>
      )}
    </div>
  );
}

function esc(v?: string | null): string {
  return (v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 16px", fontSize: 13, color: "#888" },
  toolbar: { display: "flex", gap: 12, alignItems: "center", marginBottom: 16 },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, minWidth: 280 },
  printBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#888", fontSize: 14 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "10px 14px", background: "#f0f4f8", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "9px 14px", color: "#333" },
  empty: { textAlign: "center", color: "#aaa", padding: "2rem", fontSize: 14 },
};
