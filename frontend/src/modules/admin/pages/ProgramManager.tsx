import { useState, useEffect } from "react";
import { adminApi, type ProgramAdmin } from "../api";
import { ArrowLeft, PlusCircle, Edit2 } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const STATUS_OPTIONS = ["active", "inactive", "pending_mentor_support"];

export default function ProgramManager() {
  const goBack = useGoBack("/admin");
  const [programs, setPrograms] = useState<ProgramAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state (shared for add and edit)
  const [fName, setFName] = useState("");
  const [fFullName, setFFullName] = useState("");
  const [fAffiliation, setFAffiliation] = useState("");
  const [fAgeRange, setFAgeRange] = useState("");
  const [fStatus, setFStatus] = useState("active");
  const [fDesc, setFDesc] = useState("");
  const [fOrder, setFOrder] = useState("0");
  const [fQuick, setFQuick] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    adminApi.listPrograms().then(setPrograms).finally(() => setLoading(false));
  }

  function startAdd() {
    setFName(""); setFFullName(""); setFAffiliation(""); setFAgeRange("");
    setFStatus("active"); setFDesc(""); setFOrder(String(programs.length + 1)); setFQuick(false);
    setEditingId(null); setShowAdd(true); setError("");
  }

  function startEdit(p: ProgramAdmin) {
    setFName(p.name); setFFullName(p.full_name ?? ""); setFAffiliation(p.affiliation ?? "");
    setFAgeRange(p.age_range ?? ""); setFStatus(p.status); setFDesc(p.description ?? "");
    setFOrder(String(p.display_order)); setFQuick(!!p.quick_attendance);
    setShowAdd(false); setEditingId(p.id); setError("");
  }

  async function handleSave() {
    if (!fName.trim()) { setError("Program name is required."); return; }
    setSaving(true); setError("");
    const payload = {
      name: fName.trim(), full_name: fFullName || null, affiliation: fAffiliation || null,
      age_range: fAgeRange || null, status: fStatus, description: fDesc || null,
      display_order: parseInt(fOrder) || 0, quick_attendance: fQuick,
    };
    try {
      if (editingId) {
        await adminApi.updateProgram(editingId, payload);
        setEditingId(null);
      } else {
        await adminApi.createProgram(payload);
        setShowAdd(false);
      }
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to save program.");
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>Program Management</h1>
          <button style={styles.addBtn} onClick={startAdd}><PlusCircle size={13} /> Add Program</button>
        </div>
        <p style={styles.sub}>Programs are the building blocks of enrollment and team assignments.</p>
      </div>

      {/* Add form */}
      {showAdd && (
        <ProgramForm
          title="Add New Program"
          fName={fName} fFullName={fFullName} fAffiliation={fAffiliation}
          fAgeRange={fAgeRange} fStatus={fStatus} fDesc={fDesc} fOrder={fOrder} fQuick={fQuick}
          setFName={setFName} setFFullName={setFFullName} setFAffiliation={setFAffiliation}
          setFAgeRange={setFAgeRange} setFStatus={setFStatus} setFDesc={setFDesc} setFOrder={setFOrder} setFQuick={setFQuick}
          error={error} saving={saving}
          onSave={handleSave} onCancel={() => { setShowAdd(false); setError(""); }}
        />
      )}

      {/* Program list */}
      {loading ? <p style={styles.muted}>Loading…</p> : (
        <div style={styles.list}>
          {programs.map((p) => (
            <div key={p.id}>
              {editingId === p.id ? (
                <ProgramForm
                  title={`Edit: ${p.name}`}
                  fName={fName} fFullName={fFullName} fAffiliation={fAffiliation}
                  fAgeRange={fAgeRange} fStatus={fStatus} fDesc={fDesc} fOrder={fOrder} fQuick={fQuick}
                  setFName={setFName} setFFullName={setFFullName} setFAffiliation={setFAffiliation}
                  setFAgeRange={setFAgeRange} setFStatus={setFStatus} setFDesc={setFDesc} setFOrder={setFOrder} setFQuick={setFQuick}
                  error={error} saving={saving}
                  onSave={handleSave} onCancel={() => { setEditingId(null); setError(""); }}
                />
              ) : (
                <div style={styles.programRow}>
                  <div style={styles.orderBadge}>{p.display_order}</div>
                  <div style={styles.programInfo}>
                    <div style={styles.programName}>
                      {p.name}
                      {p.full_name && <span style={styles.fullName}> — {p.full_name}</span>}
                    </div>
                    <div style={styles.programMeta}>
                      {p.affiliation && <span>{p.affiliation}</span>}
                      {p.age_range && <span>Ages {p.age_range}</span>}
                      <span style={{ color: p.active_enrollment_count > 0 ? "#2e7d32" : "#aaa" }}>
                        {p.active_enrollment_count} enrolled
                      </span>
                      <span style={{ color: p.team_count > 0 ? "#1565c0" : "#aaa" }}>
                        {p.team_count} team{p.team_count !== 1 ? "s" : ""}
                      </span>
                      {p.quick_attendance && <span style={{ color: "#0b5c4f", fontWeight: 600 }}>Attendance kiosk</span>}
                    </div>
                  </div>
                  <StatusPill status={p.status} />
                  <button style={styles.editBtn} onClick={() => startEdit(p)}>
                    <Edit2 size={13} /> Edit
                  </button>
                </div>
              )}
            </div>
          ))}
          {programs.length === 0 && <p style={styles.empty}>No programs yet. Add one above.</p>}
        </div>
      )}
    </div>
  );
}

function ProgramForm({ title, fName, fFullName, fAffiliation, fAgeRange, fStatus, fDesc, fOrder, fQuick,
  setFName, setFFullName, setFAffiliation, setFAgeRange, setFStatus, setFDesc, setFOrder, setFQuick,
  error, saving, onSave, onCancel }: {
  title: string;
  fName: string; fFullName: string; fAffiliation: string; fAgeRange: string;
  fStatus: string; fDesc: string; fOrder: string; fQuick: boolean;
  setFName: (v: string) => void; setFFullName: (v: string) => void;
  setFAffiliation: (v: string) => void; setFAgeRange: (v: string) => void;
  setFStatus: (v: string) => void; setFDesc: (v: string) => void; setFOrder: (v: string) => void;
  setFQuick: (v: boolean) => void;
  error: string; saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div style={styles.formCard}>
      <div style={styles.formTitle}>{title}</div>
      <div style={styles.grid}>
        <Field label="Short Name *"><input style={styles.input} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. FTC" /></Field>
        <Field label="Full Name"><input style={styles.input} value={fFullName} onChange={(e) => setFFullName(e.target.value)} placeholder="e.g. FIRST Tech Challenge" /></Field>
        <Field label="Affiliation"><input style={styles.input} value={fAffiliation} onChange={(e) => setFAffiliation(e.target.value)} placeholder="e.g. FIRST" /></Field>
        <Field label="Age Range"><input style={styles.input} value={fAgeRange} onChange={(e) => setFAgeRange(e.target.value)} placeholder="e.g. 12-18" /></Field>
        <Field label="Status">
          <select style={styles.input} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </Field>
        <Field label="Display Order"><input type="number" style={styles.input} value={fOrder} onChange={(e) => setFOrder(e.target.value)} /></Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33475b", cursor: "pointer" }}>
            <input type="checkbox" checked={fQuick} onChange={(e) => setFQuick(e.target.checked)} />
            Show this program's teams on the quick attendance kiosk
          </label>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Description"><textarea style={styles.textarea} value={fDesc} onChange={(e) => setFDesc(e.target.value)} /></Field>
        </div>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={styles.saveBtn} onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save Program"}</button>
        <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const c: Record<string, string> = { active: "#2e7d32", inactive: "#757575", pending_mentor_support: "#f57c00" };
  return (
    <span style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600, color: "#fff", background: c[status] ?? "#888", textTransform: "capitalize" as const }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={styles.label}>{label}</label>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 20 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  headingRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  muted: { color: "#888", fontSize: 13 },
  formCard: { background: "#fff", border: "2px solid #1a3a5c", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 16 },
  formTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 12 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 12 },
  label: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  textarea: { width: "100%", minHeight: 60, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical" as const, boxSizing: "border-box" as const },
  error: { fontSize: 12, color: "#c62828", marginBottom: 8 },
  saveBtn: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancelBtn: { padding: "8px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  programRow: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "12px 14px" },
  orderBadge: { width: 28, height: 28, borderRadius: "50%", background: "#f0f4f8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#888", flexShrink: 0 },
  programInfo: { flex: 1 },
  programName: { fontWeight: 700, fontSize: 14, color: "#1a3a5c" },
  fullName: { fontWeight: 400, color: "#666" },
  programMeta: { display: "flex", gap: 10, fontSize: 12, color: "#888", marginTop: 3, flexWrap: "wrap" },
  editBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};
