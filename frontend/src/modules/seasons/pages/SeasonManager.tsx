import { useState, useEffect } from "react";
import { seasonsApi, type FIRSTSeason } from "../api";
import { ArrowLeft, PlusCircle, Edit2, Check, X, Trash2 } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const COLUMNS = [
  { key: "season",             label: "Season",         width: 90  },
  { key: "theme",              label: "Theme",          width: 150 },
  { key: "fll_explore_game",   label: "FLL Explore",    width: 160 },
  { key: "fll_challenge_game", label: "FLL Challenge",  width: 160 },
  { key: "ftc_game",           label: "FTC Game",       width: 150 },
  { key: "frc_game",           label: "FRC Game",       width: 160 },
  { key: "fdp_game",           label: "FDP (TRC)",      width: 130 },
  { key: "notes",              label: "Notes",          width: 120 },
];

type SeasonRow = FIRSTSeason & { _editing?: boolean };

const blankRow = (order: number): Partial<FIRSTSeason> => ({
  season: "", theme: "", fll_explore_game: "", fll_challenge_game: "",
  ftc_game: "", frc_game: "", fdp_game: "", notes: "", display_order: order,
});

export default function SeasonManager() {
  const goBack = useGoBack("/admin");
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [editValues, setEditValues] = useState<Partial<FIRSTSeason>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    seasonsApi.list().then(data => {
      // Sort newest first by season string ("2025-2026" > "2024-2025" etc.)
      setSeasons([...data].sort((a, b) => b.season.localeCompare(a.season)));
    }).finally(() => setLoading(false));
  }

  function startEdit(season: FIRSTSeason) {
    setEditingId(season.id);
    setEditValues({ ...season });
    setError("");
  }

  function startAdd() {
    // Auto-compute display_order from the season year so it stays consistent
    const maxYear = seasons.reduce((m, s) => {
      const y = parseInt(s.season.split("-")[0]) || 0;
      return Math.max(m, y);
    }, 2000);
    setEditingId("new");
    setEditValues(blankRow(maxYear + 1));
    setError("");
  }

  function setField(key: string, value: string) {
    setEditValues(prev => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!editValues.season?.trim()) { setError("Season is required (e.g. 2026-2027)"); return; }
    setSaving(true); setError("");
    try {
      // Auto-derive display_order from the start year of the season (e.g. "2026-2027" → 2026)
      const startYear = parseInt(editValues.season!.split("-")[0]) || editValues.display_order || 0;
      const payload = { ...editValues, display_order: startYear };
      if (editingId === "new") {
        await seasonsApi.create(payload);
      } else {
        await seasonsApi.update(editingId as number, payload);
      }
      setEditingId(null);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to save.");
    } finally { setSaving(false); }
  }

  async function deleteSeason(id: number, season: string) {
    if (!confirm(`Delete season ${season}? This will also delete all member participation records for this season.`)) return;
    await seasonsApi.delete(id);
    load();
  }

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <div style={styles.headingRow}>
          <div>
            <h1 style={styles.heading}>FIRST Season Manager</h1>
            <p style={styles.sub}>
              Manage season names and game titles. These appear as checkboxes on every member's profile.
              Member participation records (and years-of-experience counts) are based on this table.
            </p>
          </div>
          <button style={styles.addBtn} onClick={startAdd} disabled={editingId !== null}>
            <PlusCircle size={13} /> Add Season
          </button>
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {loading ? <p style={styles.muted}>Loading…</p> : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th key={col.key} style={{ ...styles.th, width: col.width }}>{col.label}</th>
                ))}
                <th style={{ ...styles.th, width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Add new row at top */}
              {editingId === "new" && (
                <EditRow
                  values={editValues}
                  onChange={setField}
                  onSave={save}
                  onCancel={() => setEditingId(null)}
                  saving={saving}
                  isNew
                />
              )}
              {seasons.map(s => (
                editingId === s.id ? (
                  <EditRow
                    key={s.id}
                    values={editValues}
                    onChange={setField}
                    onSave={save}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                ) : (
                  <tr key={s.id} style={styles.dataRow}>
                    <td style={{ ...styles.td, ...styles.seasonCell }}>{s.season}</td>
                    <td style={styles.td}>{s.theme || <span style={styles.blank}>—</span>}</td>
                    <td style={styles.td}>{s.fll_explore_game || <span style={styles.blank}>—</span>}</td>
                    <td style={styles.td}>{s.fll_challenge_game || <span style={styles.blank}>—</span>}</td>
                    <td style={styles.td}>{s.ftc_game || <span style={styles.blank}>—</span>}</td>
                    <td style={styles.td}>{s.frc_game || <span style={styles.blank}>—</span>}</td>
                    <td style={styles.td}>{s.fdp_game || <span style={styles.blank}>—</span>}</td>
                    <td style={styles.td}>
                      {s.notes && <span style={styles.notesTag}>{s.notes}</span>}
                    </td>
                    <td style={styles.td}>
                      <div style={styles.rowActions}>
                        <button style={styles.editRowBtn} onClick={() => startEdit(s)}
                          disabled={editingId !== null}>
                          <Edit2 size={12} />
                        </button>
                        <button style={styles.deleteRowBtn} onClick={() => deleteSeason(s.id, s.season)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={styles.hint}>
        💡 Leave a game name blank if TRC doesn't participate in that program for the season.
        Only games with names will show checkboxes on member profiles.
        FDP (Future Drone Pilots) is a TRC-specific program not part of the official FIRST season.
      </div>
    </div>
  );
}

function EditRow({ values, onChange, onSave, onCancel, saving, isNew = false }: {
  values: Partial<FIRSTSeason>;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew?: boolean;
}) {
  return (
    <tr style={{ background: isNew ? "#e3f2fd" : "#fff8e1" }}>
      {COLUMNS.map(col => (
        <td key={col.key} style={{ padding: "4px 6px" }}>
          <input
            style={styles.editInput}
            value={(values as Record<string, string>)[col.key] ?? ""}
            onChange={e => onChange(col.key, e.target.value)}
            placeholder={col.label}
            onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
            autoFocus={col.key === "season"}
          />
        </td>
      ))}
      <td style={{ padding: "4px 6px" }}>
        <div style={styles.rowActions}>
          <button style={styles.saveRowBtn} onClick={onSave} disabled={saving}>
            {saving ? "…" : <Check size={13} />}
          </button>
          <button style={styles.cancelRowBtn} onClick={onCancel}><X size={13} /></button>
        </div>
      </td>
    </tr>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  headingRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888", maxWidth: 600 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" as const },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 12, fontSize: 13 },
  muted: { color: "#888", fontSize: 13 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto", marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "10px 12px", background: "#f0f4f8", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" as const },
  dataRow: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "9px 12px", fontSize: 13, color: "#333" },
  seasonCell: { fontWeight: 700, color: "#1a3a5c", whiteSpace: "nowrap" as const },
  blank: { color: "#ccc" },
  notesTag: { fontSize: 11, color: "#888", fontStyle: "italic" },
  rowActions: { display: "flex", gap: 4 },
  editRowBtn: { padding: "4px 7px", border: "1px solid #ccc", background: "#fff", borderRadius: 4, cursor: "pointer", display: "flex", color: "#555" },
  deleteRowBtn: { padding: "4px 7px", border: "1px solid #fcc", background: "#fff5f5", borderRadius: 4, cursor: "pointer", display: "flex", color: "#c62828" },
  saveRowBtn: { padding: "4px 8px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", display: "flex" },
  cancelRowBtn: { padding: "4px 7px", background: "#f5f5f5", color: "#888", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", display: "flex" },
  editInput: { width: "100%", padding: "5px 7px", border: "1px solid #90caf9", borderRadius: 4, fontSize: 12, boxSizing: "border-box" as const },
  hint: { fontSize: 12, color: "#888", lineHeight: 1.6, padding: "8px 0" },
};
