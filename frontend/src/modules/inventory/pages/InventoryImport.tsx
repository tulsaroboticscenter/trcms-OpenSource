import { useState, useRef } from "react";
import { inventoryApi } from "../api";
import { ArrowLeft, Upload, CheckCircle, AlertTriangle, FileText } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface ImportResult { ok: boolean; created: number; updated: number; errors: string[] }

export default function InventoryImport() {
  const goBack = useGoBack("/inventory");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState("");

  async function handleMergeClones() {
    setMerging(true);
    setMergeMsg("");
    try {
      const r = await inventoryApi.mergeTeamClones();
      const total = r.merged + r.converted;
      setMergeMsg(total > 0
        ? `Consolidated ${total} duplicate team cop${total === 1 ? "y" : "ies"} into their canonical items (team stock kept as holdings).`
        : "No duplicate team copies found — inventory is already consolidated.");
    } catch {
      setMergeMsg("Could not merge duplicates. Please try again.");
    } finally {
      setMerging(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillMsg("");
    try {
      const r = await inventoryApi.backfillCategoryLinks();
      setBackfillMsg(r.linked > 0
        ? `Linked ${r.linked} item${r.linked === 1 ? "" : "s"} to categories (of ${r.examined} unlinked).`
        : "Nothing to link — all items with a category are already in the category tree.");
    } catch {
      setBackfillMsg("Could not link categories. Please try again.");
    } finally {
      setBackfilling(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const res = await inventoryApi.importItems(file);
      setResult(res);
    } catch {
      setError("Import failed. Please check your file format and try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Inventory</button>
        <h1 style={styles.heading}>Import Inventory from CSV</h1>
        <p style={styles.sub}>
          Bulk-load parts, consumables, and assets from a CSV file — handy for loading a whole
          vendor's catalog at once. Items are matched by <strong>part number</strong>: a new part
          number creates an item, and an existing one is updated in place. Re-running the same file
          is safe.
        </p>
      </div>

      {/* Step 1 — Columns */}
      <div style={styles.step}>
        <div style={styles.stepNum}>1</div>
        <div style={styles.stepBody}>
          <div style={styles.stepTitle}>Prepare Your CSV</div>
          <p style={styles.stepDesc}>
            The first row must be the column headers below, in any order. Header names are
            matched loosely — <strong>case and spacing don't matter</strong>, so
            <code> Part Number</code>, <code>part_number</code>, and <code>PART NUMBER</code> are
            all the same column. Only <code>name</code> is required; include <code>part_number</code>{" "}
            to enable duplicate-matching.
          </p>
          <div style={styles.columns}>
            <div style={styles.colGroup}>
              <div style={styles.colGroupTitle}>Required</div>
              <code style={styles.col}>name</code>
            </div>
            <div style={styles.colGroup}>
              <div style={styles.colGroupTitle}>Recommended</div>
              <code style={styles.col}>part_number</code>
              <code style={styles.col}>vendor</code>
              <code style={styles.col}>category</code>
              <code style={styles.col}>cost</code>
            </div>
            <div style={styles.colGroup}>
              <div style={styles.colGroupTitle}>Optional</div>
              <code style={styles.col}>item_type</code>
              <code style={styles.col}>subcategory</code>
              <code style={styles.col}>url</code>
              <code style={styles.col}>package_quantity</code>
              <code style={styles.col}>unit_of_measure</code>
              <code style={styles.col}>current_quantity</code>
              <code style={styles.col}>minimum_stock_level</code>
              <code style={styles.col}>notes</code>
            </div>
          </div>
          <div style={styles.rulesList}>
            <div style={styles.rule}>✓ <strong>item_type</strong> defaults to <code>part</code> (also: <code>consumable</code>, <code>asset_tagged</code>, <code>battery</code>)</div>
            <div style={styles.rule}>✓ <strong>url</strong> accepts <code>product_url</code> as an alias; <strong>package_quantity</strong> accepts <code>pkg_quantity</code></div>
            <div style={styles.rule}>✓ <strong>vendor</strong> is matched to an existing vendor case-insensitively — an existing vendor (e.g. goBILDA) is reused, never duplicated. A genuinely new name is created automatically</div>
            <div style={styles.rule}>✓ Rows sharing a <strong>part_number</strong> (in the file or already in the system) update the same item — no duplicates</div>
            <div style={styles.rule}>✓ On an update, descriptive fields (name, vendor, cost, etc.) are refreshed but <strong>on-hand and minimum quantities are preserved</strong>; a blank optional cell won't wipe an existing value</div>
            <div style={styles.rule}>✓ Rows with no <strong>part_number</strong> are always added as new items</div>
          </div>
        </div>
      </div>

      {/* Step 2 — Upload */}
      <div style={styles.step}>
        <div style={styles.stepNum}>2</div>
        <div style={styles.stepBody}>
          <div style={styles.stepTitle}>Upload Your CSV File</div>
          <div
            style={styles.dropZone}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setResult(null); } }}
          >
            {file ? (
              <div style={styles.fileSelected}>
                <FileText size={20} color="#1565c0" />
                <span style={styles.fileName}>{file.name}</span>
                <span style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
                <button style={styles.clearFile} onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); }}>✕</button>
              </div>
            ) : (
              <>
                <Upload size={28} color="#aaa" />
                <p style={styles.dropText}>Click to choose a file or drag & drop</p>
                <p style={styles.dropHint}>CSV files only</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setResult(null); } }} />
        </div>
      </div>

      {/* Step 3 — Import */}
      <div style={styles.step}>
        <div style={styles.stepNum}>3</div>
        <div style={styles.stepBody}>
          <div style={styles.stepTitle}>Run Import</div>
          <button style={{ ...styles.importBtn, opacity: !file || importing ? 0.6 : 1 }}
            onClick={handleImport} disabled={!file || importing}>
            {importing ? "Importing…" : "Import Inventory"}
          </button>
        </div>
      </div>

      {/* Results */}
      {error && <div style={styles.errorBox}><AlertTriangle size={15} /> {error}</div>}

      {result && (
        <div style={styles.resultBox}>
          <div style={styles.resultHeader}>
            <CheckCircle size={18} color="#2e7d32" />
            <span style={styles.resultTitle}>Import Complete</span>
          </div>
          <div style={styles.resultStats}>
            <ResultStat label="Created" value={result.created} color="#2e7d32" />
            <ResultStat label="Updated" value={result.updated} color="#1565c0" />
          </div>
          {result.errors.length > 0 && (
            <div style={styles.errorList}>
              <div style={styles.errorListTitle}>Errors / Warnings ({result.errors.length})</div>
              {result.errors.map((e, i) => (
                <div key={i} style={styles.errorItem}><AlertTriangle size={12} /> {e}</div>
              ))}
            </div>
          )}
          <button style={styles.viewBtn} onClick={goBack}>View Inventory →</button>
        </div>
      )}

      {/* Category linking utility */}
      <div style={styles.backfillBox}>
        <div style={styles.backfillTitle}>Link imported items to categories</div>
        <p style={styles.backfillDesc}>
          Imported items carry their category and subcategory names, but browsing by
          category uses the category tree. Run this once after an import to slot any
          unlinked items into the tree (creating category/subcategory entries as needed).
          It's safe to run repeatedly — it only touches items that aren't linked yet.
        </p>
        <div style={styles.backfillRow}>
          <button style={{ ...styles.backfillBtn, opacity: backfilling ? 0.6 : 1 }}
            onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? "Linking…" : "Link Categories Now"}
          </button>
          {backfillMsg && <span style={styles.backfillMsg}>{backfillMsg}</span>}
        </div>
      </div>

      {/* Consolidate per-team duplicate items */}
      <div style={styles.backfillBox}>
        <div style={styles.backfillTitle}>Consolidate duplicate team copies</div>
        <p style={styles.backfillDesc}>
          Older receipts created a separate item row for each team. Inventory now keeps one row
          per part number and tracks team/location stock as holdings. Run this once to fold any
          leftover per-team duplicates back into their canonical item (their stock is preserved as
          a team holding, and history is repointed). Safe to re-run.
        </p>
        <div style={styles.backfillRow}>
          <button style={{ ...styles.backfillBtn, opacity: merging ? 0.6 : 1 }}
            onClick={handleMergeClones} disabled={merging}>
            {merging ? "Merging…" : "Merge Duplicate Team Copies"}
          </button>
          {mergeMsg && <span style={styles.backfillMsg}>{mergeMsg}</span>}
        </div>
      </div>
    </div>
  );
}

function ResultStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto" },
  header: { marginBottom: 24 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#666", lineHeight: 1.6 },
  step: { display: "flex", gap: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 12 },
  stepNum: { width: 28, height: 28, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 },
  stepBody: { flex: 1 },
  stepTitle: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", marginBottom: 6 },
  stepDesc: { fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 12 },
  columns: { display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" },
  colGroup: { display: "flex", flexDirection: "column", gap: 3 },
  colGroupTitle: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 },
  col: { fontSize: 12, background: "#f0f4f8", padding: "2px 6px", borderRadius: 4, color: "#1a3a5c", fontFamily: "monospace" },
  rulesList: { display: "flex", flexDirection: "column", gap: 5 },
  rule: { fontSize: 12, color: "#555", lineHeight: 1.5 },
  dropZone: { border: "2px dashed #ccc", borderRadius: 10, padding: "2rem", textAlign: "center", cursor: "pointer", marginTop: 8, background: "#fafafa" },
  dropText: { margin: "10px 0 4px", fontSize: 14, color: "#555" },
  dropHint: { margin: 0, fontSize: 12, color: "#aaa" },
  fileSelected: { display: "flex", alignItems: "center", gap: 10, justifyContent: "center" },
  fileName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  fileSize: { fontSize: 12, color: "#888" },
  clearFile: { background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16 },
  importBtn: { padding: "11px 28px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 15 },
  errorBox: { display: "flex", alignItems: "center", gap: 8, background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "12px 16px", color: "#c62828", fontSize: 13, marginBottom: 12 },
  resultBox: { background: "#fff", border: "1px solid #a5d6a7", borderRadius: 10, padding: "1.5rem", marginBottom: 12 },
  resultHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 16 },
  resultTitle: { fontSize: 16, fontWeight: 700, color: "#2e7d32" },
  resultStats: { display: "flex", gap: 40, justifyContent: "center", marginBottom: 16 },
  errorList: { background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, padding: "10px 14px", marginBottom: 14 },
  errorListTitle: { fontSize: 12, fontWeight: 700, color: "#795548", marginBottom: 8 },
  errorItem: { display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "#795548", marginBottom: 4 },
  viewBtn: { padding: "9px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  backfillBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginTop: 12 },
  backfillTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 6 },
  backfillDesc: { fontSize: 12, color: "#666", lineHeight: 1.6, margin: "0 0 12px" },
  backfillRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const },
  backfillBtn: { padding: "9px 18px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  backfillMsg: { fontSize: 13, color: "#2e7d32", fontWeight: 600 },
};
