import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AuditEntry } from "../api";
import { api } from "../../../core/api";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const TABLE_LABELS: Record<string, string> = {
  members: "Member", enrollments: "Enrollment", checkins: "Check-In",
  teams: "Team", events: "Event", visitors: "Visitor",
  team_member_assignments: "Team Roster", system_config: "Config",
  hotel_rooms: "Hotel Room",
};

const ACTION_COLORS: Record<string, string> = {
  create: "#2e7d32", update: "#1565c0", delete: "#c62828",
  archive: "#6b7280", unarchive: "#0891b2", deactivate: "#b45309",
  convert: "#6a1b9a", checkin: "#2e7d32", checkout: "#e65100",
};

export default function AuditLog() {
  const goBack = useGoBack("/admin");
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: number; first_name: string; last_name: string; username?: string }[]>([]);
  const [selectedMember, setSelectedMember] = useState<{ id: number; name: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tableFilter, actionFilter, fromDate, toDate, selectedMember, page]);

  // Member search (debounced) for the "by user" filter.
  useEffect(() => {
    if (selectedMember || memberSearch.trim().length < 2) { setMemberResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/api/v1/members/?search=${encodeURIComponent(memberSearch.trim())}&limit=8`)
        .then((r) => setMemberResults(r.data.members ?? []))
        .catch(() => setMemberResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [memberSearch, selectedMember]);

  const anyFilter = tableFilter || actionFilter || selectedMember || fromDate || toDate;
  function clearFilters() {
    setTableFilter(""); setActionFilter(""); setSelectedMember(null); setMemberSearch("");
    setFromDate(""); setToDate(""); setPage(0);
  }

  async function load() {
    setLoading(true);
    adminApi.getAuditLog({
      table_name: tableFilter || undefined,
      action: actionFilter || undefined,
      actor_id: selectedMember?.id,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      skip: page * limit,
      limit,
    }).then((data) => {
      setLogs(data.logs);
      setTotal(data.total);
      if (data.actions) setActions(data.actions);
    }).finally(() => setLoading(false));
  }

  const tables = ["members","enrollments","checkins","teams","events","visitors","hotel_rooms","team_member_assignments"];

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>Audit Log</h1>
          <button style={styles.refreshBtn} onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <p style={styles.sub}>
          Immutable record of all data changes. {total} total entries.{" "}
          Looking for logins? See the <Link to="/admin/security" style={{ color: "#1565c0" }}>Security log</Link>.
        </p>
      </div>

      <div style={styles.toolbar}>
        <select style={styles.select} value={tableFilter}
          onChange={(e) => { setTableFilter(e.target.value); setPage(0); }}>
          <option value="">All Tables</option>
          {tables.map((t) => <option key={t} value={t}>{TABLE_LABELS[t] ?? t}</option>)}
        </select>

        <select style={styles.select} value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}>
          <option value="">All Actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <div style={styles.memberFilter}>
          {selectedMember ? (
            <span style={styles.selectedMember}>
              {selectedMember.name}
              <button style={styles.clearMember} title="Clear user filter"
                onClick={() => { setSelectedMember(null); setMemberSearch(""); setPage(0); }}><X size={12} /></button>
            </span>
          ) : (
            <>
              <input style={styles.select} placeholder="Filter by user…" value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)} />
              {memberResults.length > 0 && (
                <div style={styles.memberDropdown}>
                  {memberResults.map((m) => (
                    <div key={m.id} style={styles.memberOption}
                      onClick={() => { setSelectedMember({ id: m.id, name: `${m.first_name} ${m.last_name}` }); setMemberResults([]); setMemberSearch(""); setPage(0); }}>
                      {m.first_name} {m.last_name}{m.username ? <span style={styles.memberUser}> · {m.username}</span> : ""}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <label style={styles.dateLbl}>From
          <input type="date" style={styles.dateInput} value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} />
        </label>
        <label style={styles.dateLbl}>To
          <input type="date" style={styles.dateInput} value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} />
        </label>

        {anyFilter && <button style={styles.clearAll} onClick={clearFilters}>Clear filters</button>}
      </div>

      {loading ? <p style={styles.muted}>Loading…</p> : (
        <>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["When","Actor","Table","Record","Action","Details"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <>
                    <tr key={log.id} style={styles.tr}
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    >
                      <td style={styles.td}>{new Date(log.created_at).toLocaleString()}</td>
                      <td style={styles.td}>
                        {log.actor_name ?? (log.actor_id ? `#${log.actor_id}` : "System")}
                        {log.impersonating_role && <span style={styles.impersonateTag}> (test: {log.impersonating_role})</span>}
                      </td>
                      <td style={styles.td}>{TABLE_LABELS[log.table_name] ?? log.table_name}</td>
                      <td style={styles.td}>{log.record_id ?? "—"}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.actionBadge, background: ACTION_COLORS[log.action] ?? "#888" }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ ...styles.td, color: "#1565c0", cursor: "pointer" }}>
                        {expanded === log.id ? "▲ Hide" : "▼ Show changes"}
                      </td>
                    </tr>
                    {expanded === log.id && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={6} style={styles.detailCell}>
                          <div style={styles.detailGrid}>
                            {log.old_values && (
                              <div>
                                <div style={styles.detailLabel}>Before</div>
                                <pre style={styles.jsonPre}>{JSON.stringify(log.old_values, null, 2)}</pre>
                              </div>
                            )}
                            {log.new_values && (
                              <div>
                                <div style={styles.detailLabel}>After</div>
                                <pre style={styles.jsonPre}>{JSON.stringify(log.new_values, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && <p style={styles.empty}>No audit log entries found.</p>}
          </div>

          {/* Pagination */}
          <div style={styles.pagination}>
            <button style={styles.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 0}>← Previous</button>
            <span style={styles.pageInfo}>Page {page + 1} of {Math.ceil(total / limit)}</span>
            <button style={styles.pageBtn} onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  headingRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  refreshBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  toolbar: { marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  memberFilter: { position: "relative" },
  selectedMember: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "#eef4fb", border: "1px solid #cfe0f0", borderRadius: 6, fontSize: 13.5, color: "#1a3a5c", fontWeight: 600 },
  clearMember: { display: "inline-flex", alignItems: "center", background: "none", border: "none", color: "#6a7a8a", cursor: "pointer", padding: 0 },
  memberDropdown: { position: "absolute", zIndex: 20, top: "100%", left: 0, marginTop: 4, minWidth: 240, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, boxShadow: "0 6px 20px rgba(16,32,48,.12)", overflow: "hidden" },
  memberOption: { padding: "8px 11px", fontSize: 13.5, cursor: "pointer", borderBottom: "1px solid #f0f4f8", color: "#334" },
  memberUser: { color: "#90a4ae", fontSize: 12 },
  dateLbl: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#667" },
  dateInput: { padding: "7px 9px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13.5 },
  clearAll: { padding: "7px 12px", border: "1px solid #cdd7e3", background: "#fff", color: "#1565c0", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  muted: { color: "#888", fontSize: 13 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto", marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "9px 12px", background: "#f0f4f8", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" as const },
  tr: { borderBottom: "1px solid #f0f4f8", cursor: "pointer" },
  td: { padding: "9px 12px" },
  impersonateTag: { fontSize: 10, color: "#6a1b9a", fontStyle: "italic" },
  actionBadge: { padding: "2px 7px", borderRadius: 8, color: "#fff", fontSize: 11, fontWeight: 600 },
  detailCell: { padding: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  detailGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "12px 16px" },
  detailLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 6 },
  jsonPre: { margin: 0, fontSize: 11, color: "#333", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", overflowX: "auto" as const, maxHeight: 200, whiteSpace: "pre-wrap" as const },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
  pagination: { display: "flex", alignItems: "center", gap: 16, justifyContent: "center" },
  pageBtn: { padding: "7px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  pageInfo: { fontSize: 13, color: "#888" },
};
