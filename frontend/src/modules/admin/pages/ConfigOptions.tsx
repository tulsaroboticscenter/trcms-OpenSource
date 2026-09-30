import { useState, useEffect } from "react";
import { api } from "../../../core/api";
import { ArrowLeft, PlusCircle, X, Save } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface ConfigCategory {
  category: string;
  label: string;
  values: string[];
  updated_at: string;
}

export default function ConfigOptions() {
  const goBack = useGoBack("/admin");
  const [configs, setConfigs] = useState<ConfigCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<string[]>([]);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedCategory, setSavedCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setError(null);
    api.get("/api/v1/config/")
      .then((r) => {
        // Defensive: the list endpoint returns an array. If anything else comes
        // back (an error object, a single category, etc.), don't let it crash
        // the page — show an empty state instead of white-screening.
        const rows: ConfigCategory[] = Array.isArray(r.data) ? r.data : [];
        // Only flat lists of STRINGS are editable here. Some categories store
        // structured data with their own editors — objects (profile_layout,
        // team_pane_tabs) or arrays of objects (shipping_addresses, which is
        // {name,address}). Skip anything that isn't a plain string list, so the
        // page never tries to render an object as text (React error #31).
        setConfigs(rows.filter((c) => Array.isArray(c?.values) && c.values.every((v) => typeof v === "string")));
        if (!Array.isArray(r.data)) setError("The configuration list came back in an unexpected format.");
      })
      .catch(() => setError("Could not load configurable options. Please refresh and try again."))
      .finally(() => setLoading(false));
  }

  function startEdit(cat: ConfigCategory) {
    setEditingCategory(cat.category);
    setEditValues([...cat.values]);
    setNewValue("");
  }

  function addValue() {
    const v = newValue.trim();
    if (!v || editValues.includes(v)) return;
    setEditValues((prev) => [...prev, v]);
    setNewValue("");
  }

  function removeValue(i: number) {
    setEditValues((prev) => prev.filter((_, idx) => idx !== i));
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const arr = [...editValues];
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    setEditValues(arr);
  }

  function moveDown(i: number) {
    if (i === editValues.length - 1) return;
    const arr = [...editValues];
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    setEditValues(arr);
  }

  async function save() {
    if (!editingCategory) return;
    // Flush any text still sitting in the "Add new option…" box so a value that
    // was typed but not explicitly "Add"-ed isn't silently dropped on save.
    const pending = newValue.trim();
    const finalValues = pending && !editValues.includes(pending) ? [...editValues, pending] : editValues;
    setEditValues(finalValues);
    setNewValue("");
    setSaving(true);
    try {
      await api.put(`/api/v1/config/${editingCategory}`, { values: finalValues });
      setSavedCategory(editingCategory);
      setTimeout(() => setSavedCategory(null), 2000);
      setEditingCategory(null);
      load();
    } catch {
      alert("Failed to save. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={styles.heading}>Configurable Options</h1>
        <p style={styles.sub}>
          Manage the dropdown lists used throughout the system. Changes take effect immediately.
        </p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {loading ? <p style={styles.muted}>Loading…</p> : configs.length === 0 ? (
        !error && <p style={styles.muted}>No configurable options are defined yet.</p>
      ) : (
        <div style={styles.grid}>
          {configs.map((cat) => (
            <div key={cat.category} style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <div style={styles.cardTitle}>{cat.label}</div>
                  <div style={styles.cardCategory}>{cat.category}</div>
                </div>
                {editingCategory !== cat.category && (
                  <button style={styles.editBtn} onClick={() => startEdit(cat)}>Edit</button>
                )}
              </div>

              {savedCategory === cat.category && (
                <div style={styles.savedMsg}>✓ Saved</div>
              )}

              {editingCategory === cat.category ? (
                <div>
                  <div style={styles.valueList}>
                    {editValues.map((v, i) => (
                      <div key={i} style={styles.valueRow}>
                        <span style={styles.valueText}>{v}</span>
                        <div style={styles.valueBtns}>
                          <button style={styles.orderBtn} onClick={() => moveUp(i)} disabled={i === 0}>↑</button>
                          <button style={styles.orderBtn} onClick={() => moveDown(i)} disabled={i === editValues.length - 1}>↓</button>
                          <button style={styles.removeValueBtn} onClick={() => removeValue(i)}>
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={styles.addRow}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addValue())}
                      placeholder="Add new option…"
                    />
                    <button style={styles.addValueBtn} onClick={addValue}>
                      <PlusCircle size={13} /> Add
                    </button>
                  </div>
                  <div style={styles.cardActions}>
                    <button style={styles.cancelBtn} onClick={() => setEditingCategory(null)}>Cancel</button>
                    <button style={styles.saveBtn} onClick={save} disabled={saving}>
                      <Save size={13} /> {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={styles.tagList}>
                  {cat.values.map((v) => (
                    <span key={v} style={styles.tag}>{v}</span>
                  ))}
                  {cat.values.length === 0 && <span style={styles.empty}>No values defined.</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 20 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  muted: { color: "#888", fontSize: 13 },
  errorBox: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 8, padding: "12px 16px", fontSize: 13, marginBottom: 16 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  cardCategory: { fontSize: 11, color: "#aaa", fontFamily: "monospace" },
  editBtn: { padding: "4px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  savedMsg: { fontSize: 12, color: "#2e7d32", fontWeight: 600, marginBottom: 8 },
  tagList: { display: "flex", flexWrap: "wrap", gap: 5 },
  tag: { padding: "3px 9px", background: "#f0f4f8", color: "#555", borderRadius: 6, fontSize: 12 },
  empty: { fontSize: 12, color: "#aaa", fontStyle: "italic" },
  valueList: { display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 },
  valueRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "#f8fafc", borderRadius: 5, border: "1px solid #e2e8f0" },
  valueText: { flex: 1, fontSize: 13, color: "#333" },
  valueBtns: { display: "flex", gap: 3 },
  orderBtn: { background: "none", border: "1px solid #ddd", borderRadius: 3, cursor: "pointer", fontSize: 11, padding: "1px 5px", color: "#888" },
  removeValueBtn: { background: "none", border: "none", cursor: "pointer", color: "#ccc", display: "flex", padding: 2 },
  addRow: { display: "flex", gap: 6, marginBottom: 10 },
  input: { padding: "7px 9px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" as const },
  addValueBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#f0f4f8", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" as const },
  cardActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 },
};
