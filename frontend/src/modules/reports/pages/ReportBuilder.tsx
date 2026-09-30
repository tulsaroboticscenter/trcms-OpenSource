import { useEffect, useMemo, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Play, Save, Trash2, Plus, X, FileText, Download, FolderOpen } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  reportEngineApi, type EngineDataset, type ReportResult, type SavedReport,
  type ReportDefinition, type DatasetField,
} from "../api";
import ReportSchedulePanel from "../components/ReportSchedulePanel";

const OPERATORS = [
  { id: "eq", label: "=" }, { id: "ne", label: "≠" },
  { id: "gt", label: ">" }, { id: "gte", label: "≥" }, { id: "lt", label: "<" }, { id: "lte", label: "≤" },
  { id: "contains", label: "contains" }, { id: "starts_with", label: "starts with" },
  { id: "in", label: "in (comma list)" }, { id: "between", label: "between (a,b)" },
  { id: "is_null", label: "is empty" }, { id: "not_null", label: "is not empty" },
];
const AGGS = ["", "count", "sum", "avg", "min", "max"];
const noValue = (op: string) => op === "is_null" || op === "not_null";

type Sel = { field: string; agg: string };
type Cond = { field: string; operator: string; value: string; param: string };
type Sort = { field: string; dir: string };
type Param = { key: string; label: string; type: string };
type Computed = { key: string; label: string; expr: string };

export default function ReportBuilder() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [datasets, setDatasets] = useState<EngineDataset[]>([]);
  const [datasetKey, setDatasetKey] = useState("");
  const [selected, setSelected] = useState<Sel[]>([]);
  const [conds, setConds] = useState<Cond[]>([]);
  const [sorts, setSorts] = useState<Sort[]>([]);
  const [params, setParams] = useState<Param[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [computed, setComputed] = useState<Computed[]>([]);
  const [limit, setLimit] = useState(500);

  const [result, setResult] = useState<ReportResult | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("private");

  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    reportEngineApi.datasets().then((ds) => {
      setDatasets(ds);
      const first = ds.find((d) => d.access.can_build) ?? ds[0];
      if (first && !datasetKey) setDatasetKey(first.meta.key);
    }).catch(() => setErr("Could not load datasets."));
    reloadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadSaved = () => reportEngineApi.list().then(setSaved).catch(() => {});

  const dataset = datasets.find((d) => d.meta.key === datasetKey);
  const baseFields = dataset?.meta.fields ?? [];
  // Computed fields are selectable/sortable like base fields (always aggregatable).
  const fields = useMemo<DatasetField[]>(() => [
    ...baseFields,
    ...computed.filter((c) => c.key).map((c) => ({ key: c.key, label: c.label || c.key, type: "decimal", tier: "internal", aggregatable: true })),
  ], [baseFields, computed]);
  const fieldByKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);

  // Reset the build when the dataset changes.
  function pickDataset(k: string) {
    setDatasetKey(k); setSelected([]); setConds([]); setSorts([]); setResult(null);
    setParams([]); setParamValues({}); setComputed([]);
    setCurrentId(null); setName(""); setDescription("");
  }

  function toggleField(f: DatasetField) {
    setSelected((prev) => prev.some((s) => s.field === f.key)
      ? prev.filter((s) => s.field !== f.key)
      : [...prev, { field: f.key, agg: f.aggregatable ? "count" : "" }]);
  }
  const isSelected = (k: string) => selected.some((s) => s.field === k);

  function buildDefinition(): ReportDefinition {
    return {
      fields: selected.map((s) => (s.agg ? { field: s.field, agg: s.agg } : { field: s.field })),
      filters: conds.length
        ? { op: "and", conditions: conds.filter((c) => c.field).map((c) => {
            if (noValue(c.operator)) return { field: c.field, operator: c.operator };
            if (c.param) return { field: c.field, operator: c.operator, param: c.param };
            if (c.operator === "in") return { field: c.field, operator: "in", value: c.value.split(",").map((v) => v.trim()) };
            if (c.operator === "between") { const [a, b] = c.value.split(",").map((v) => v.trim()); return { field: c.field, operator: "between", value: [a, b] }; }
            return { field: c.field, operator: c.operator, value: c.value };
          }) }
        : undefined,
      parameters: params.length ? params.filter((p) => p.key) : undefined,
      computed: computed.length ? computed.filter((c) => c.key && c.expr) : undefined,
      sort: sorts.filter((s) => s.field).map((s) => ({ field: s.field, dir: s.dir })),
      limit,
    };
  }

  async function runPreview() {
    if (!datasetKey || !selected.length) { setErr("Pick a dataset and at least one field."); return; }
    setRunning(true); setErr("");
    try {
      const r = await reportEngineApi.preview(datasetKey, buildDefinition(), paramValues);
      setResult(r);
    } catch (e) { setErr(errMsg(e)); setResult(null); }
    finally { setRunning(false); }
  }

  async function save() {
    if (!name.trim()) { setErr("Give the report a name to save it."); return; }
    setErr("");
    try {
      const payload = { name: name.trim(), description, dataset: datasetKey, visibility, definition: buildDefinition() };
      if (currentId) { await reportEngineApi.update(currentId, payload); }
      else { const { id } = await reportEngineApi.create(payload); setCurrentId(id); }
      reloadSaved();
    } catch (e) { setErr(errMsg(e)); }
  }

  async function load(rep: SavedReport) {
    try {
      const full = await reportEngineApi.get(rep.id);
      const def = full.definition!;
      setDatasetKey(full.dataset);
      setCurrentId(full.id); setName(full.name); setDescription(full.description ?? ""); setVisibility(full.visibility);
      setSelected((def.fields ?? []).map((f) => ({ field: f.field, agg: f.agg ?? "" })));
      setSorts((def.sort ?? []).map((s) => ({ field: s.field, dir: s.dir })));
      setLimit(def.limit ?? 500);
      setParams((def.parameters ?? []).map((p) => ({ key: p.key, label: p.label, type: p.type })));
      setComputed((def.computed ?? []).map((c) => ({ key: c.key, label: c.label, expr: c.expr })));
      setParamValues({});
      const cs = (def.filters?.conditions ?? []) as { field: string; operator: string; value?: unknown; param?: string }[];
      setConds(cs.map((c) => ({ field: c.field, operator: c.operator, param: c.param ?? "", value: Array.isArray(c.value) ? (c.value as unknown[]).join(",") : String(c.value ?? "") })));
      setResult(null);
    } catch (e) { setErr(errMsg(e)); }
  }

  function newReport() {
    setCurrentId(null); setSelected([]); setConds([]); setSorts([]); setResult(null); setName(""); setDescription("");
    setParams([]); setParamValues({}); setComputed([]);
  }

  async function del(rep: SavedReport) {
    if (!confirm(`Delete report "${rep.name}"?`)) return;
    try { await reportEngineApi.remove(rep.id); if (currentId === rep.id) newReport(); reloadSaved(); }
    catch (e) { setErr(errMsg(e)); }
  }

  function exportPDF() {
    if (!result) return;
    const doc = new jsPDF({ orientation: result.columns.length > 5 ? "landscape" : "portrait" });
    doc.setFontSize(16); doc.setTextColor(26, 58, 92);
    doc.text(name || "Custom Report", 14, 15);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`${result.row_count} row${result.row_count !== 1 ? "s" : ""} · ${dataset?.meta.label ?? ""} · generated ${new Date().toLocaleDateString()}`, 14, 21);
    autoTable(doc, {
      startY: 26,
      head: [result.columns.map((c) => c.label)],
      body: result.rows.map((r) => r.map((v) => (v === null ? "" : String(v)))),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [26, 58, 92], fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
    doc.save(`${(name || "report").replace(/\s+/g, "_").toLowerCase()}.pdf`);
  }

  function exportCSV() {
    if (!result) return;
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [result.columns.map((c) => esc(c.label)).join(",")];
    for (const row of result.rows) lines.push(row.map(esc).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${(name || "report").replace(/\s+/g, "_").toLowerCase()}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Reports</button>
      <h1 style={st.heading}><FileText size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Report Builder</h1>
      <p style={st.sub}>Design your own report: pick a dataset, choose fields, add filters, and preview. Save it to run again or share. You only see datasets and fields you're allowed to.</p>

      <div style={st.layout}>
        {/* Saved reports rail */}
        <aside style={st.rail}>
          <div style={st.railHead}><FolderOpen size={14} /> Saved reports <button style={st.newBtn} onClick={newReport}>+ New</button></div>
          {saved.length === 0 && <p style={st.railEmpty}>None yet.</p>}
          {saved.map((r) => (
            <div key={r.id} style={{ ...st.railItem, ...(currentId === r.id ? st.railItemOn : {}) }}>
              <button style={st.railName} onClick={() => load(r)} title={r.description ?? ""}>{r.name}</button>
              <button style={st.railDel} onClick={() => del(r)}><Trash2 size={13} /></button>
            </div>
          ))}
        </aside>

        {/* Builder */}
        <div style={st.main}>
          <div style={st.row}>
            <label style={st.field}><span style={st.lbl}>Dataset</span>
              <select style={st.select} value={datasetKey} onChange={(e) => pickDataset(e.target.value)}>
                {datasets.map((d) => <option key={d.meta.key} value={d.meta.key} disabled={!d.access.can_build}>{d.meta.label}{!d.access.can_build ? " (no access)" : ""}</option>)}
              </select>
            </label>
            {dataset && <span style={st.scopeTag}>rows: {dataset.access.row_scope} · fields up to {dataset.access.max_field_tier}</span>}
          </div>

          <div style={st.section}>Computed fields <span style={st.hint}>e.g. quantity * unit_cost, round(minutes/60, 1)</span>
            <button style={st.addBtn} onClick={() => setComputed((c) => [...c, { key: `calc${c.length + 1}`, label: "", expr: "" }])}><Plus size={12} /> Add</button>
          </div>
          {computed.map((c, i) => (
            <div key={i} style={st.condRow}>
              <input style={{ ...st.condSel, minWidth: 90 }} value={c.key} placeholder="key" onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") } : x))} />
              <input style={{ ...st.condSel, minWidth: 120 }} value={c.label} placeholder="Label" onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <input style={st.condVal} value={c.expr} placeholder="expression (field names + - * / and round/abs/coalesce)" onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, expr: e.target.value } : x))} />
              <button style={st.rmBtn} onClick={() => setComputed((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}

          <div style={st.section}>Fields</div>
          <div style={st.fieldGrid}>
            {fields.map((f) => (
              <div key={f.key} style={{ ...st.fieldChip, ...(isSelected(f.key) ? st.fieldChipOn : {}) }}>
                <label style={st.fieldLabel}>
                  <input type="checkbox" checked={isSelected(f.key)} onChange={() => toggleField(f)} />
                  {f.label}
                  {f.tier !== "public" && <span style={st.tierDot} title={f.tier}>{f.tier[0].toUpperCase()}</span>}
                </label>
                {isSelected(f.key) && f.aggregatable && (
                  <select style={st.aggSel} value={selected.find((s) => s.field === f.key)?.agg ?? ""}
                    onChange={(e) => setSelected((prev) => prev.map((s) => s.field === f.key ? { ...s, agg: e.target.value } : s))}>
                    {AGGS.map((a) => <option key={a} value={a}>{a || "(raw)"}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>

          <div style={st.section}>Filters <button style={st.addBtn} onClick={() => setConds((c) => [...c, { field: fields[0]?.key ?? "", operator: "eq", value: "", param: "" }])}><Plus size={12} /> Add</button></div>
          {conds.map((c, i) => (
            <div key={i} style={st.condRow}>
              <select style={st.condSel} value={c.field} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
                {fields.filter((f) => !f.aggregatable).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select style={st.condOp} value={c.operator} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, operator: e.target.value } : x))}>
                {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {!noValue(c.operator) && params.length > 0 && (
                <select style={st.condOp} value={c.param} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, param: e.target.value } : x))}>
                  <option value="">literal</option>
                  {params.filter((pp) => pp.key).map((pp) => <option key={pp.key} value={pp.key}>ask: {pp.label || pp.key}</option>)}
                </select>
              )}
              {!noValue(c.operator) && !c.param && <input style={st.condVal} value={c.value} placeholder="value" onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />}
              <button style={st.rmBtn} onClick={() => setConds((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}

          <div style={st.section}>Parameters <span style={st.hint}>ask the viewer for a value at run time</span>
            <button style={st.addBtn} onClick={() => setParams((p) => [...p, { key: `p${p.length + 1}`, label: "", type: "text" }])}><Plus size={12} /> Add</button>
          </div>
          {params.map((p, i) => (
            <div key={i} style={st.condRow}>
              <input style={{ ...st.condSel, minWidth: 90 }} value={p.key} placeholder="key" onChange={(e) => setParams((pp) => pp.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") } : x))} />
              <input style={st.condVal} value={p.label} placeholder="Prompt label" onChange={(e) => setParams((pp) => pp.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <select style={st.condOp} value={p.type} onChange={(e) => setParams((pp) => pp.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                <option value="text">text</option><option value="number">number</option><option value="date">date</option>
              </select>
              <button style={st.rmBtn} onClick={() => setParams((pp) => pp.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}

          <div style={st.section}>Sort <button style={st.addBtn} onClick={() => setSorts((s) => [...s, { field: selected[0]?.field ?? fields[0]?.key ?? "", dir: "asc" }])}><Plus size={12} /> Add</button></div>
          {sorts.map((s, i) => (
            <div key={i} style={st.condRow}>
              <select style={st.condSel} value={s.field} onChange={(e) => setSorts((p) => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
                {selected.map((sel) => <option key={sel.field} value={sel.field}>{fieldByKey[sel.field]?.label ?? sel.field}</option>)}
              </select>
              <select style={st.condOp} value={s.dir} onChange={(e) => setSorts((p) => p.map((x, j) => j === i ? { ...x, dir: e.target.value } : x))}>
                <option value="asc">ascending</option><option value="desc">descending</option>
              </select>
              <button style={st.rmBtn} onClick={() => setSorts((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}

          {params.filter((p) => p.key).length > 0 && (
            <div style={st.paramRun}>
              {params.filter((p) => p.key).map((p) => (
                <label key={p.key} style={st.field}>
                  <span style={st.lbl}>{p.label || p.key}</span>
                  <input type={p.type === "number" ? "number" : p.type === "date" ? "date" : "text"} style={st.input}
                    value={paramValues[p.key] ?? ""} placeholder="(any)"
                    onChange={(e) => setParamValues((pv) => ({ ...pv, [p.key]: e.target.value }))} />
                </label>
              ))}
            </div>
          )}

          <div style={st.actions}>
            <button style={st.runBtn} onClick={runPreview} disabled={running}><Play size={14} /> {running ? "Running…" : "Preview"}</button>
            <label style={st.limitField}>Limit <input type="number" style={st.limitInput} value={limit} min={1} max={5000} onChange={(e) => setLimit(Number(e.target.value))} /></label>
          </div>

          {err && <p style={st.err}>{err}</p>}

          {result && (
            <>
              <div style={st.resultHead}>
                <span style={st.resultCount}>{result.row_count} row{result.row_count !== 1 ? "s" : ""}</span>
                <div style={st.exportBtns}>
                  {canRead("reports.export") && (
                    <>
                      <button style={st.expBtn} onClick={exportPDF} disabled={!result.rows.length}><FileText size={13} /> PDF</button>
                      <button style={st.expBtn} onClick={exportCSV} disabled={!result.rows.length}><Download size={13} /> CSV</button>
                    </>
                  )}
                </div>
              </div>
              <div style={st.tableWrap}>
                <table style={st.table}>
                  <thead><tr>{result.columns.map((c) => <th key={c.key} style={{ ...st.th, textAlign: c.type === "int" || c.type === "decimal" ? "right" : "left" }}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri}>{row.map((v, ci) => <td key={ci} style={{ ...st.td, textAlign: result.columns[ci].type === "int" || result.columns[ci].type === "decimal" ? "right" : "left" }}>{v === null ? "—" : String(v)}</td>)}</tr>
                    ))}
                    {result.rows.length === 0 && <tr><td colSpan={result.columns.length} style={st.empty}>No rows match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Save bar */}
          <div style={st.saveBar}>
            <input style={st.nameInput} placeholder="Report name" value={name} onChange={(e) => setName(e.target.value)} />
            <select style={st.visSel} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="private">Only me</option>
              <option value="org">Everyone</option>
            </select>
            <button style={st.saveBtn} onClick={save}><Save size={14} /> {currentId ? "Update" : "Save"}</button>
          </div>

          {currentId ? <ReportSchedulePanel reportId={currentId} />
            : <p style={st.scheduleHint}>Save this report to set up automatic email delivery.</p>}
        </div>
      </div>
    </div>
  );
}

function errMsg(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong.";
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1040, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 16px", fontSize: 13, color: "#888", maxWidth: 720, lineHeight: 1.5 },
  layout: { display: "flex", gap: 16, alignItems: "flex-start" },
  rail: { width: 200, flexShrink: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 },
  railHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  newBtn: { marginLeft: "auto", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  railEmpty: { fontSize: 12, color: "#bbb" },
  railItem: { display: "flex", alignItems: "center", borderRadius: 6, marginBottom: 2 },
  railItemOn: { background: "#e8f0fe" },
  railName: { flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#1a3a5c", padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  railDel: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 4 },
  main: { flex: 1, minWidth: 0 },
  row: { display: "flex", gap: 14, alignItems: "flex-end", marginBottom: 8 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  select: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, background: "#fff", minWidth: 200 },
  scopeTag: { fontSize: 11, color: "#aaa", paddingBottom: 8 },
  section: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, margin: "18px 0 8px" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 3, background: "#f0f4f8", border: "none", borderRadius: 5, color: "#1565c0", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" },
  hint: { fontSize: 10, color: "#bbb", fontWeight: 400, textTransform: "none", letterSpacing: 0 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  paramRun: { display: "flex", gap: 12, flexWrap: "wrap", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", marginTop: 8 },
  fieldGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  fieldChip: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px", background: "#fff" },
  fieldChipOn: { borderColor: "#1565c0", background: "#f5f9ff" },
  fieldLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#333", cursor: "pointer" },
  tierDot: { fontSize: 9, fontWeight: 700, color: "#c62828", background: "#fdecea", borderRadius: 3, padding: "0 4px" },
  aggSel: { fontSize: 12, border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px" },
  condRow: { display: "flex", gap: 6, marginBottom: 6, alignItems: "center" },
  condSel: { padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, minWidth: 140 },
  condOp: { padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  condVal: { padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, flex: 1, minWidth: 100 },
  rmBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", padding: 4 },
  actions: { display: "flex", alignItems: "center", gap: 14, margin: "18px 0" },
  runBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  limitField: { fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 6 },
  limitInput: { width: 72, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  err: { color: "#c62828", fontSize: 14 },
  resultHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  resultCount: { fontSize: 13, color: "#888", fontWeight: 600 },
  exportBtns: { display: "flex", gap: 8 },
  expBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#444" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 18 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 400 },
  th: { padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc", whiteSpace: "nowrap" },
  td: { padding: "8px 14px", fontSize: 14, color: "#333", borderBottom: "1px solid #f2f5f8", whiteSpace: "nowrap" },
  empty: { padding: 18, textAlign: "center", color: "#aaa", fontSize: 14 },
  saveBar: { display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #eef2f6", paddingTop: 14 },
  nameInput: { flex: 1, padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  visSel: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  scheduleHint: { marginTop: 14, fontSize: 12, color: "#aaa" },
};
