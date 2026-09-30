import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { feedbackApi, TYPE_META, STATUS_META, PRIORITY_META, type Feedback } from "../api";
import { RELEASES } from "../../../core/version";
import { MessageSquarePlus, Bug, Lightbulb, MessageSquare, Download, CheckSquare } from "lucide-react";

const typeIcon = (t: string) => t === "bug" ? <Bug size={14} /> : t === "feature" ? <Lightbulb size={14} /> : <MessageSquare size={14} />;
const fmtDate = (d?: string | null) => d ? new Date((d.length > 10 ? d : d + "T00:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/** Trigger a browser download of `content` as `filename`. */
function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(items: Feedback[]): string {
  const cols: (keyof Feedback)[] = [
    "id", "type", "status", "priority", "title", "description", "steps", "page",
    "app_version", "submitter_name", "created_at", "updated_at",
    "resolution_release", "deployed_on", "resolution_notes", "admin_notes",
  ];
  const header = cols.join(",");
  const rows = items.map((f) => cols.map((c) => csvCell(f[c])).join(","));
  return [header, ...rows].join("\n");
}

export default function FeedbackList() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ can_manage: boolean; items: Feedback[] } | null>(null);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [showResolved, setShowResolved] = useState(false); // auto-hide Done/Declined in the list
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkRelease, setBulkRelease] = useState("");
  const [bulkDeployed, setBulkDeployed] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  function load() {
    setSelected(new Set());
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (type) params.type = type;
    if (mineOnly) params.mine = "true";
    feedbackApi.list(params).then(setData).catch(() => setData({ can_manage: false, items: [] }));
  }
  useEffect(load, [status, type, mineOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const canManage = data?.can_manage;
  const items = data?.items ?? [];
  // #25/#58: auto-hide Done/Declined for everyone unless a specific status filter
  // is set or "Show all" is on. Applies to standard users too — they just see open tickets.
  const visibleItems = (!showResolved && !status)
    ? items.filter((f) => f.status !== "done" && f.status !== "declined")
    : items;

  function toggleSel(id: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => (s.size === visibleItems.length ? new Set() : new Set(visibleItems.map((f) => f.id))));
  }
  async function applyBulk() {
    const fields: Record<string, unknown> = {};
    if (bulkStatus) fields.status = bulkStatus;
    if (bulkTarget) fields.target_release = bulkTarget;
    if (bulkRelease) fields.resolution_release = bulkRelease;
    if (bulkDeployed) fields.deployed_on = bulkDeployed;
    if (Object.keys(fields).length === 0 || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await feedbackApi.bulkUpdate([...selected], fields);
      setSelected(new Set()); setBulkStatus(""); setBulkTarget(""); setBulkRelease(""); setBulkDeployed("");
      load();
    } finally { setBulkBusy(false); }
  }

  // Export feedback for handoff/review. By default only the OPEN items (so
  // already-done/declined ones don't have to be re-parsed every time); tick
  // "include resolved" to export everything.
  async function exportAll(format: "json" | "csv") {
    const all = await feedbackApi.list({}); // managers get the full set
    const items = includeResolved
      ? all.items
      : all.items.filter((f) => f.status !== "done" && f.status !== "declined");
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      downloadFile(`trcms-feedback-${stamp}.json`, JSON.stringify(items, null, 2), "application/json");
    } else {
      downloadFile(`trcms-feedback-${stamp}.csv`, toCSV(items), "text/csv");
    }
  }

  return (
    <div style={st.page}>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}><MessageSquarePlus size={22} /> Feedback</h1>
          <p style={st.sub}>{canManage ? "Bug reports and feature requests from across the program." : "Your submitted bug reports and feature requests."}</p>
        </div>
        <div style={st.headBtns}>
          {canManage && data && data.items.length > 0 && (
            <>
              <button style={st.exportBtn} title="Download open feedback as JSON (for review/handoff)" onClick={() => exportAll("json")}><Download size={15} /> JSON</button>
              <button style={st.exportBtn} title="Download open feedback as CSV (spreadsheet)" onClick={() => exportAll("csv")}><Download size={15} /> CSV</button>
              <label style={st.inclResolved} title="By default the export skips done/declined items">
                <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} /> include resolved
              </label>
            </>
          )}
          <button style={st.addBtn} onClick={() => navigate("/feedback/new")}><MessageSquarePlus size={15} /> New Feedback</button>
        </div>
      </div>

      {canManage && (
        <div style={st.filters}>
          <select style={st.select} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select style={st.select} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <label style={st.inclResolved} title="Done/Declined items are hidden by default">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> show resolved
          </label>
          <label style={st.inclResolved} title="Only feedback I submitted or that was submitted on my behalf">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> my submissions
          </label>
        </div>
      )}

      {/* #58: standard users see open tickets by default, with a Show all toggle. */}
      {!canManage && (
        <div style={st.filters}>
          <label style={st.inclResolved} title="Closed (Done/Declined) tickets are hidden by default">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show all (including closed)
          </label>
        </div>
      )}

      {/* #26: bulk triage bar for the selected items */}
      {canManage && selected.size > 0 && (
        <div style={st.bulkBar}>
          <span style={st.bulkCount}><CheckSquare size={15} /> {selected.size} selected</span>
          <select style={st.bulkInput} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Status…</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input style={st.bulkInput} list="fb-bulk-releases" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)} placeholder="Target release" />
          <input style={st.bulkInput} list="fb-bulk-releases" value={bulkRelease} onChange={(e) => setBulkRelease(e.target.value)} placeholder="Delivered in" />
          <input style={st.bulkInput} type="date" value={bulkDeployed} onChange={(e) => setBulkDeployed(e.target.value)} title="Deployed date" />
          <datalist id="fb-bulk-releases">{RELEASES.map((r) => <option key={r.version} value={r.version} />)}</datalist>
          <button style={st.bulkApply} disabled={bulkBusy} onClick={applyBulk}>{bulkBusy ? "Applying…" : "Apply"}</button>
          <button style={st.bulkClear} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {data === null ? <p style={st.muted}>Loading…</p> : visibleItems.length === 0 ? (
        <div style={st.empty}>
          <MessageSquarePlus size={48} color="#cdd7e3" />
          <p style={st.muted}>{items.length === 0 ? "No feedback yet. Click “New Feedback” to report a bug or suggest a feature." : "No open feedback — tick “show resolved” to see completed items."}</p>
        </div>
      ) : (
        <div style={st.list}>
          {canManage && (
            <label style={st.selectAll}>
              <input type="checkbox" checked={selected.size === visibleItems.length && visibleItems.length > 0} onChange={toggleAll} /> Select all ({visibleItems.length})
            </label>
          )}
          {visibleItems.map((f) => {
            const tm = TYPE_META[f.type]; const sm = STATUS_META[f.status]; const pm = PRIORITY_META[f.priority];
            return (
              <div key={f.id} style={{ ...st.row, ...(selected.has(f.id) ? st.rowSel : {}) }} onClick={() => navigate(`/feedback/${f.id}`)}>
                {canManage && (
                  <input type="checkbox" checked={selected.has(f.id)} style={st.rowCheck}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(f.id)} />
                )}
                <span style={{ ...st.typeIcon, color: tm.color, background: tm.color + "18" }}>{typeIcon(f.type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={st.title}><span style={st.idTag}>#{f.id}</span> {f.title}</div>
                  <div style={st.metaRow}>
                    <span>{tm.label}</span>
                    {canManage && f.submitter_name && (
                      <span>· {f.submitter_name}
                        {f.entered_by_name && f.entered_by_id !== f.member_id && ` (entered by ${f.entered_by_name})`}
                      </span>
                    )}
                    <span>· {fmtDate(f.created_at)}</span>
                    {f.status === "done" && f.resolution_release && <span style={st.shipped}>· shipped {f.resolution_release}</span>}
                  </div>
                </div>
                {canManage && f.priority !== "normal" && <span style={{ ...st.badge, color: pm.color, background: pm.color + "1a" }}>{pm.label}</span>}
                <span style={{ ...st.badge, color: sm.color, background: sm.color + "1a" }}>{sm.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  sub: { color: "#666", fontSize: 14, marginTop: 4 },
  headBtns: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  exportBtn: { display: "flex", alignItems: "center", gap: 5, padding: "9px 13px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  inclResolved: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#778", cursor: "pointer" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  filters: { display: "flex", gap: 8, marginBottom: 14 },
  select: { padding: "8px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff" },
  bulkBar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#eef4fb", border: "1px solid #c9ddf3", borderRadius: 10, padding: "10px 14px", marginBottom: 12 },
  bulkCount: { display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  bulkInput: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff", maxWidth: 140 },
  bulkApply: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  bulkClear: { padding: "7px 12px", background: "#fff", color: "#667", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  selectAll: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#778", fontWeight: 600, padding: "0 4px" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, cursor: "pointer" },
  rowSel: { background: "#eef4fb", borderColor: "#c9ddf3" },
  rowCheck: { flexShrink: 0, width: 16, height: 16, cursor: "pointer" },
  typeIcon: { width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { fontSize: 15, fontWeight: 600, color: "#1a3a5c" },
  idTag: { fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#94a3b8", fontWeight: 700 },
  metaRow: { display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, color: "#888", marginTop: 2 },
  shipped: { color: "#2e7d32", fontWeight: 600 },
  badge: { padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700, flexShrink: 0 },
  empty: { textAlign: "center", padding: "3rem 1rem" },
  muted: { color: "#888", textAlign: "center", padding: "1rem", fontSize: 14 },
};
