import { useState, useEffect, useMemo } from "react";
import { reportsApi, type PermissionsReportData } from "../api";
import { adminApi, type SystemRole } from "../../admin/api";
import { ArrowLeft, Search, ShieldCheck, X } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";

const LEVEL_STYLE: Record<string, React.CSSProperties> = {
  write: { background: "#e8f5e9", color: "#2e7d32" },
  read: { background: "#e3f2fd", color: "#1565c0" },
  none: { background: "#f5f5f5", color: "#bbb" },
};
const cell = (lvl: string) => LEVEL_STYLE[lvl] ?? LEVEL_STYLE.none;
const abbr = (lvl: string) => (lvl === "write" ? "W" : lvl === "read" ? "R" : "—");

export default function PermissionsReport() {
  const goBack = useGoBack("/reports");
  const { canWrite } = useAuth();
  const canEdit = canWrite("members.system_permissions");
  const [data, setData] = useState<PermissionsReportData | null>(null);
  const [roleList, setRoleList] = useState<SystemRole[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  function reload() {
    return reportsApi.getPermissionsReport()
      .then(setData)
      .catch((e) => setError(e?.response?.status === 403
        ? "You need administrator access to view the permissions report."
        : "Could not load the permissions report."));
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
    if (canEdit) adminApi.listRoles().then(setRoleList).catch(() => {});
  }, [canEdit]);

  // role display-name -> id, for removing a role the report only gives us by name.
  const roleIdByName = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of roleList) { map[r.name] = r.id; map[r.display_name || r.name] = r.id; }
    return map;
  }, [roleList]);

  async function addRole(memberId: number, roleId: number) {
    if (!roleId) return;
    setSavingId(memberId);
    try { await adminApi.assignRole(memberId, roleId); await reload(); }
    catch { setError("Could not assign that role."); }
    finally { setSavingId(null); }
  }

  async function dropRole(memberId: number, roleName: string) {
    const roleId = roleIdByName[roleName];
    if (!roleId) return;
    setSavingId(memberId);
    try { await adminApi.removeRole(memberId, roleId); await reload(); }
    catch { setError("Could not remove that role."); }
    finally { setSavingId(null); }
  }

  const rows = useMemo(() => {
    const members = data?.members ?? [];
    const q = search.trim().toLowerCase();
    return members.filter((m) =>
      (!type || m.member_type === type) &&
      (!q || m.name.toLowerCase().includes(q) || m.roles.join(" ").toLowerCase().includes(q)));
  }, [data, search, type]);

  return (
    <div style={st.page}>
      <button onClick={goBack} style={st.back}><ArrowLeft size={14} /> Reports</button>
      <h1 style={st.h1}><ShieldCheck size={20} style={{ verticalAlign: -4 }} /> Permissions Report</h1>
      <p style={st.sub}>Every member's effective roles and per-module access (W = write/edit, R = read-only, — = none).{canEdit ? " Add or remove roles inline — the module columns refresh automatically." : " Read-only."}</p>

      {error && <div style={st.err}>{error}</div>}
      {loading ? <p style={st.muted}>Loading…</p> : data && (
        <>
          <div style={st.filters}>
            <div style={st.searchWrap}>
              <Search size={15} color="#aaa" />
              <input style={st.search} placeholder="Search name or role…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={st.select} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              <option value="youth">Youth</option>
              <option value="mentor">Mentor</option>
              <option value="parent">Parent</option>
              <option value="volunteer">Volunteer</option>
            </select>
            <span style={st.count}>{rows.length} member{rows.length === 1 ? "" : "s"}</span>
          </div>

          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={{ ...st.th, ...st.stickyL }}>Member</th>
                  <th style={st.th}>Roles</th>
                  {data.modules.map((m) => <th key={m.id} style={{ ...st.th, ...st.modTh }} title={m.label}>{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...st.td, ...st.stickyL, ...st.nameTd }}>
                      {m.name}{!m.is_active && <span style={st.inactive}> (inactive)</span>}
                      <div style={st.typeSub}>{m.member_type}</div>
                    </td>
                    <td style={st.td}>
                      {m.is_super ? <span style={st.superTag}>System Admin</span> : (
                        canEdit ? (
                          <div style={st.roleEdit}>
                            {m.roles.map((rn) => (
                              <span key={rn} style={st.roleChip}>
                                {rn}
                                <button style={st.chipX} disabled={savingId === m.id}
                                  title={`Remove ${rn}`} onClick={() => dropRole(m.id, rn)}>
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            <select style={st.addRole} value="" disabled={savingId === m.id}
                              onChange={(e) => { addRole(m.id, Number(e.target.value)); e.target.value = ""; }}>
                              <option value="">＋ role…</option>
                              {roleList
                                .filter((r) => r.is_active && r.name !== "Default" && !m.roles.includes(r.name) && !m.roles.includes(r.display_name || r.name))
                                .map((r) => <option key={r.id} value={r.id}>{r.display_name || r.name}</option>)}
                            </select>
                            {m.roles.length === 0 && <span style={st.noRole}>no roles</span>}
                          </div>
                        ) : (m.roles.length ? m.roles.join(", ") : <span style={st.noRole}>no roles</span>)
                      )}
                    </td>
                    {data.modules.map((mod) => {
                      const lvl = m.is_super ? "write" : (m.modules[mod.id] ?? "none");
                      return <td key={mod.id} style={{ ...st.td, ...st.lvlTd, ...cell(lvl) }} title={`${mod.label}: ${lvl}`}>{abbr(lvl)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={st.footnote}>Tip: hover a column header or cell to see the full module name and level.{canEdit ? " Assigning a real role automatically clears the placeholder “Default” role." : ""}</p>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1200, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  h1: { margin: 0, fontSize: 23, fontWeight: 800, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, marginTop: 4, marginBottom: 16 },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 8, padding: "12px 16px", fontSize: 13 },
  muted: { color: "#888", fontSize: 13 },
  filters: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  searchWrap: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #cdd7e3", borderRadius: 8, padding: "6px 10px", background: "#fff" },
  search: { border: "none", outline: "none", fontSize: 13, minWidth: 200 },
  select: { padding: "8px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff" },
  count: { fontSize: 12, color: "#888" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" },
  table: { borderCollapse: "separate", borderSpacing: 0, fontSize: 12 },
  th: { position: "sticky", top: 0, background: "#f0f4f8", color: "#1a3a5c", fontWeight: 700, padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  modTh: { writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: 120, fontSize: 11, fontWeight: 600, padding: "8px 4px" },
  stickyL: { position: "sticky", left: 0, zIndex: 1 },
  td: { padding: "7px 10px", borderBottom: "1px solid #f0f4f8", verticalAlign: "middle" },
  nameTd: { background: "#fff", fontWeight: 600, color: "#1a3a5c", whiteSpace: "nowrap" },
  typeSub: { fontSize: 10, color: "#aaa", textTransform: "capitalize", fontWeight: 400 },
  inactive: { color: "#c62828", fontSize: 10, fontWeight: 600 },
  superTag: { fontSize: 11, fontWeight: 700, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 6, padding: "1px 7px" },
  noRole: { color: "#c62828", fontStyle: "italic" },
  roleEdit: { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minWidth: 180 },
  roleChip: { display: "inline-flex", alignItems: "center", gap: 3, background: "#eef2f7", color: "#1a3a5c", borderRadius: 12, padding: "1px 4px 1px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" },
  chipX: { display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "#90a4b8", padding: 0, borderRadius: "50%" },
  addRole: { fontSize: 11, border: "1px dashed #b6c4d6", borderRadius: 10, padding: "1px 4px", background: "#fff", color: "#4a6178", cursor: "pointer" },
  lvlTd: { textAlign: "center", fontWeight: 700, fontSize: 11 },
  footnote: { fontSize: 12, color: "#999", marginTop: 10 },
};
