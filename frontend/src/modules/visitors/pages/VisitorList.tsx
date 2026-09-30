import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { visitorsApi, type Visitor } from "../api";
import { Search, ChevronRight, RefreshCw, UserPlus, CalendarClock, Archive } from "lucide-react";
import AddVisitorModal from "../components/AddVisitorModal";
import { api } from "../../../core/api";
import { schoolsApi, type School } from "../schoolsApi";
import InlineHelp from "../../help/InlineHelp";

interface Program { id: number; name: string; }

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new:            { bg: "#e3f2fd", text: "#1565c0" },
  visited:        { bg: "#e8f5e9", text: "#2e7d32" },
  follow_up:      { bg: "#fff8e1", text: "#f57c00" },
  waitlisted:     { bg: "#fce4ec", text: "#c62828" },
  not_interested: { bg: "#f5f5f5", text: "#757575" },
  enrolled:       { bg: "#e8f5e9", text: "#1b5e20" },
};

interface StatusCount { code: string; label: string; count: number; }

export default function VisitorList() {
  const navigate = useNavigate();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<{ code: string; label: string }[]>([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterProgram, setFilterProgram] = useState("");
  const [filterSchool, setFilterSchool] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [scheduledOnly, setScheduledOnly] = useState(false); // #177: expected-visitor view
  const [archivedOnly, setArchivedOnly] = useState(false);   // show archived contacts to restore
  const [programs, setPrograms] = useState<Program[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    visitorsApi.getStatuses().then(setStatuses);
    visitorsApi.getStats().then(setStats);
    api.get("/api/v1/programs/").then((r) => setPrograms(r.data)).catch(() => setPrograms([]));
    schoolsApi.list().then(setSchools).catch(() => setSchools([]));
  }, []);

  // Re-run the search whenever a dropdown/age filter changes (search text is manual).
  useEffect(() => { doSearch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterStatus, filterProgram, filterSchool, ageMin, ageMax, scheduledOnly, archivedOnly]);

  async function doSearch(_initial = false) {
    setLoading(true);
    try {
      const result = await visitorsApi.list({
        search: search || undefined,
        status: filterStatus || undefined,
        program_interest_id: filterProgram ? Number(filterProgram) : undefined,
        school_id: filterSchool ? Number(filterSchool) : undefined,
        age_min: ageMin !== "" ? Number(ageMin) : undefined,
        age_max: ageMax !== "" ? Number(ageMax) : undefined,
        scheduled: scheduledOnly ? 1 : undefined,
        archived_only: archivedOnly ? 1 : undefined,
        limit: 150,
      });
      setVisitors(result.visitors);
      setTotal(result.total);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  // #177: printable expected-visitor list for the meeting-night check-in table.
  function printScheduled() {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const rows = visitors.map((v) => `<tr>
      <td>${v.scheduled_visit_date ? new Date(v.scheduled_visit_date + "T00:00:00").toLocaleDateString() : ""}</td>
      <td>${esc(v.full_name)}</td>
      <td>${esc(v.grade_label ?? "")}</td>
      <td>${esc(v.program_interest_name ?? "")}</td>
      <td>${esc([v.guardian1_name, v.guardian1_phone].filter(Boolean).join(" · "))}</td>
      <td style="width:70px"></td></tr>`).join("");
    const html = `<!doctype html><html><head><title>Expected Visitors</title>
      <style>body{font-family:Arial,sans-serif;margin:24px;color:#1a2733}h1{font-size:18px;color:#1a3a5c}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#eef4fb}</style></head>
      <body><h1>Expected Visitors</h1>
      <table><thead><tr><th>Date</th><th>Name</th><th>Grade</th><th>Program</th><th>Guardian / phone</th><th>Arrived?</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No scheduled visitors.</td></tr>'}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  const statusCounts: StatusCount[] = statuses.map((s) => ({
    ...s,
    count: stats[s.code] ?? 0,
  }));

  const totalVisitors = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.heading}>Visitor Management <InlineHelp helpKey="add-visitor" /></h1>
          <p style={styles.sub}>Track inquiries through the enrollment lifecycle</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setAdding(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#1565c0", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          ><UserPlus size={15} /> Add Visitor</button>
          <button
            onClick={() => navigate("/visitors/import")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          >Import</button>
          <button
            onClick={() => navigate("/visitors/mentors")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          >Mentors</button>
          <button
            onClick={() => navigate("/visitors/analytics")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          >Analytics</button>
          <button
            onClick={() => navigate("/visitors/schools")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          >Schools</button>
          <button
            onClick={() => navigate("/visitors/waitlist")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          >Waitlist</button>
          <button
            onClick={() => navigate("/visitors/duplicates")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", height: "fit-content" }}
          >Duplicates</button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={styles.statsStrip}>
        <StatChip
          label="All Visitors"
          count={totalVisitors}
          active={filterStatus === ""}
          color="#1a3a5c"
          onClick={() => setFilterStatus("")}
        />
        {statusCounts.map((s) => (
          <StatChip
            key={s.code}
            label={s.label}
            count={s.count}
            active={filterStatus === s.code}
            color={STATUS_COLORS[s.code]?.text ?? "#555"}
            onClick={() => setFilterStatus(s.code)}
          />
        ))}
      </div>

      {/* Search bar */}
      <div style={styles.searchRow}>
        <input
          style={styles.input}
          placeholder="Search by name, email, guardian name, or visitor #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
        />
        <button style={styles.searchBtn} onClick={() => doSearch()} disabled={loading}>
          {loading ? <RefreshCw size={15} /> : <Search size={15} />}
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Filters */}
      <div style={styles.filterRow}>
        <select style={styles.filterSel} value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)}>
          <option value="">All programs</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select style={styles.filterSel} value={filterSchool} onChange={(e) => setFilterSchool(e.target.value)}>
          <option value="">All schools</option>
          {schools.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
        </select>
        <div style={styles.ageGroup}>
          <span style={styles.ageLbl}>Age</span>
          <input style={styles.ageIn} type="number" min={0} max={30} placeholder="min" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} />
          <span style={styles.ageDash}>–</span>
          <input style={styles.ageIn} type="number" min={0} max={30} placeholder="max" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} />
        </div>
        {(filterProgram || filterSchool || ageMin || ageMax || filterStatus) && (
          <button style={styles.clearBtn} onClick={() => { setFilterProgram(""); setFilterSchool(""); setAgeMin(""); setAgeMax(""); setFilterStatus(""); }}>Clear filters</button>
        )}
        {/* #177: expected/scheduled-visitor view for meeting nights */}
        <button
          style={{ ...styles.clearBtn, marginLeft: "auto", ...(scheduledOnly ? { background: "#1565c0", color: "#fff", borderColor: "#1565c0" } : {}) }}
          onClick={() => setScheduledOnly((v) => !v)}
        ><CalendarClock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{scheduledOnly ? "Showing scheduled" : "Scheduled visits"}</button>
        {scheduledOnly && visitors.length > 0 && (
          <button style={styles.clearBtn} onClick={printScheduled}>Print list</button>
        )}
        <button
          style={{ ...styles.clearBtn, ...(archivedOnly ? { background: "#8a7a2e", color: "#fff", borderColor: "#8a7a2e" } : {}) }}
          title="Show archived contacts so you can restore one"
          onClick={() => setArchivedOnly((v) => !v)}
        ><Archive size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{archivedOnly ? "Showing archived" : "Archived"}</button>
      </div>

      {searched && (
        <p style={styles.resultCount}>
          {total} visitor{total !== 1 ? "s" : ""}
          {filterStatus ? ` with status "${statuses.find(s => s.code === filterStatus)?.label}"` : ""}
        </p>
      )}

      {/* Visitor list */}
      <div style={styles.list}>
        {visitors.map((v) => (
          <div
            key={v.id}
            style={styles.row}
            onClick={() => navigate(`/visitors/${v.id}`)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
          >
            <div style={styles.visitorAvatar}>
              {v.first_name[0]}{v.last_name[0]}
            </div>
            <div style={styles.visitorInfo}>
              <div style={styles.visitorName}>{v.full_name}</div>
              <div style={styles.visitorMeta}>
                {v.grade_label && <span>{v.grade_label}</span>}
                {v.guardian1_name && <span>{v.grade_label ? "· " : ""}{v.guardian1_name}</span>}
                {v.guardian1_phone && <span>· {v.guardian1_phone}</span>}
                {v.program_interest_name && <span>· Interested in {v.program_interest_name}</span>}
              </div>
              <div style={styles.visitorDate}>
                Inquiry: {new Date(v.inquiry_date).toLocaleDateString()}
                {v.referral_source_label && ` · Via ${v.referral_source_label}`}
                {v.referral_detail && ` (${v.referral_detail})`}
              </div>
              {v.scheduled_visit_date && (
                <div style={{ fontSize: 12, color: "#1565c0", fontWeight: 600, marginTop: 2 }}>
                  <CalendarClock size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                  Expected {new Date(v.scheduled_visit_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </div>
              )}
            </div>
            <StatusPill status={v.status} label={v.status_label} />
            <ChevronRight size={16} color="#ccc" style={{ flexShrink: 0 }} />
          </div>
        ))}
        {searched && visitors.length === 0 && (
          <div style={styles.empty}>No visitors match your search.</div>
        )}
      </div>

      {adding && <AddVisitorModal onClose={() => setAdding(false)} onCreated={(id) => navigate(`/visitors/${id}`)} />}
    </div>
  );
}

function StatChip({ label, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      style={{
        ...styles.statChip,
        borderColor: active ? color : "#e2e8f0",
        background: active ? color : "#fff",
        color: active ? "#fff" : "#555",
      }}
      onClick={onClick}
    >
      <span style={styles.statCount}>{count}</span>
      <span style={styles.statLabel}>{label}</span>
    </button>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const c = STATUS_COLORS[status] ?? { bg: "#f5f5f5", text: "#555" };
  return (
    <span style={{ ...styles.statusPill, background: c.bg, color: c.text }}>
      {label}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  statsStrip: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  statChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 14px", border: "2px solid #e2e8f0", borderRadius: 8, cursor: "pointer", minWidth: 80, transition: "all 0.15s" },
  statCount: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 11, marginTop: 2, fontWeight: 600, whiteSpace: "nowrap" as const },
  searchRow: { display: "flex", gap: 8, marginBottom: 12 },
  input: { flex: 1, padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  filterRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
  filterSel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  ageGroup: { display: "flex", alignItems: "center", gap: 5, border: "1px solid #cdd7e3", borderRadius: 6, padding: "3px 8px", background: "#fff" },
  ageLbl: { fontSize: 12.5, color: "#556", fontWeight: 600 },
  ageIn: { width: 52, padding: "5px 6px", border: "1px solid #dde3ea", borderRadius: 5, fontSize: 13 },
  ageDash: { color: "#889" },
  clearBtn: { padding: "8px 12px", background: "none", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  searchBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  resultCount: { fontSize: 13, color: "#888", marginBottom: 10 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 9, padding: "12px 16px", border: "1px solid #e2e8f0", cursor: "pointer", transition: "background 0.1s" },
  visitorAvatar: { width: 40, height: 40, borderRadius: "50%", background: "#4527a0", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  visitorInfo: { flex: 1 },
  visitorName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  visitorMeta: { fontSize: 12, color: "#666", display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 },
  visitorDate: { fontSize: 11, color: "#aaa", marginTop: 2 },
  statusPill: { padding: "4px 12px", borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const, flexShrink: 0 },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};
