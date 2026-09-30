import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { api } from "../../../core/api";
import { repairsApi, KIND_META, PRIORITY_META, type AssetOption } from "../api";
import { Wrench, ArrowLeft } from "lucide-react";

interface LocationOpt { id: number; name: string; }

export default function RepairForm() {
  const navigate = useNavigate();
  const goBack = useGoBack("/repairs");
  const [params] = useSearchParams();
  const preItem = params.get("item");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("repair");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [assetMode, setAssetMode] = useState<"asset" | "freetext">(preItem ? "asset" : "freetext");
  const [invItemId, setInvItemId] = useState(preItem ?? "");
  const [equipmentName, setEquipmentName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [reportedDate, setReportedDate] = useState(new Date().toISOString().slice(0, 10));

  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    repairsApi.assets().then(setAssets).catch(() => {});
    api.get("/api/v1/inventory/locations").then((r) => setLocations(r.data)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Please give the problem a short title."); return; }
    setBusy(true); setErr("");
    try {
      const t = await repairsApi.create({
        title: title.trim(),
        kind, priority,
        description: description.trim() || null,
        inv_item_id: assetMode === "asset" && invItemId ? Number(invItemId) : null,
        equipment_name: assetMode === "freetext" ? equipmentName.trim() || null : null,
        location_id: locationId ? Number(locationId) : null,
        reported_date: reportedDate || null,
      });
      navigate(`/repairs/${t.id}`);
    } catch (e2: unknown) {
      const msg = (e2 as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErr(msg || "Could not save the ticket.");
      setBusy(false);
    }
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to tickets</button>
      <h1 style={st.h1}><Wrench size={20} /> New Repair / Maintenance Ticket</h1>

      <form onSubmit={submit} style={st.form}>
        <label style={st.label}>What's the problem? <span style={st.req}>*</span>
          <input style={st.input} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Bandsaw blade is dull / Laptop #4 won't charge" autoFocus />
        </label>

        <div style={st.grid2}>
          <label style={st.label}>Type
            <select style={st.input} value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label style={st.label}>Priority
            <select style={st.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
        </div>

        <label style={st.label}>Describe the issue
          <textarea style={{ ...st.input, minHeight: 90, resize: "vertical" }} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's wrong, when it started, anything you already tried…" />
        </label>

        <div style={st.label}>
          Which equipment?
          <div style={st.toggleRow}>
            <button type="button" style={{ ...st.toggle, ...(assetMode === "freetext" ? st.toggleOn : {}) }}
              onClick={() => setAssetMode("freetext")}>Type a name</button>
            <button type="button" style={{ ...st.toggle, ...(assetMode === "asset" ? st.toggleOn : {}) }}
              onClick={() => setAssetMode("asset")}>Pick a tracked asset</button>
          </div>
          {assetMode === "freetext" ? (
            <input style={st.input} value={equipmentName} onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="e.g. Wood lathe, 3D printer #2" />
          ) : (
            <select style={st.input} value={invItemId} onChange={(e) => setInvItemId(e.target.value)}>
              <option value="">— select a tracked asset —</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          )}
          {assetMode === "asset" && assets.length === 0 && (
            <span style={st.hint}>No tracked assets found in inventory. Switch to “Type a name”.</span>
          )}
        </div>

        <div style={st.grid2}>
          <label style={st.label}>Location
            <select style={st.input} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— optional —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label style={st.label}>Date reported
            <input type="date" style={st.input} value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} />
          </label>
        </div>

        {err && <p style={st.err}>{err}</p>}
        <div style={st.actions}>
          <button type="button" style={st.cancel} onClick={goBack}>Cancel</button>
          <button type="submit" style={st.submit} disabled={busy}>{busy ? "Saving…" : "Create Ticket"}</button>
        </div>
      </form>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 640, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 12 },
  h1: { margin: "0 0 18px", fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  form: { display: "flex", flexDirection: "column", gap: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 },
  label: { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 600, color: "#33475b" },
  req: { color: "#c62828" },
  input: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, fontWeight: 400, color: "#1a3a5c", background: "#fff" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  toggleRow: { display: "flex", gap: 6, marginBottom: 6 },
  toggle: { padding: "6px 12px", border: "1px solid #cdd7e3", borderRadius: 7, background: "#fff", color: "#667", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  toggleOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  hint: { fontSize: 12, color: "#9aa7b4", fontWeight: 400 },
  err: { color: "#c62828", fontSize: 13, margin: 0 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancel: { padding: "9px 16px", background: "#fff", color: "#667", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  submit: { padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
