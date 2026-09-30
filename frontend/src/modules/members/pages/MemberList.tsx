import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../../../core/api";
import { familiesApi, type Family, type FamilyMemberRecord } from "../../families/api";
import { Search, UserPlus, Users, List, ChevronRight, RefreshCw, Upload, GraduationCap } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";

const TYPE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#2e7d32", parent: "#e65100", volunteer: "#6a1b9a",
};

export default function Members() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, hasRole, canRead, canWrite } = useAuth();
  const canSeeNumber = isAdmin || hasRole("Mentor");
  const canViewFamilies = canRead("families.view");

  // Scholarship-application review lives on this page for the team that can see it.
  // The button + its red action bubble only render for holders of sponsors.view.
  const canSeeScholarships = canRead("scholarships.applications");
  const [scholarshipCount, setScholarshipCount] = useState(0);
  useEffect(() => {
    if (!canSeeScholarships) return;
    let alive = true;
    api.get("/api/v1/action-items")
      .then((r) => { if (alive) setScholarshipCount(r.data?.detail?.scholarships_pending ?? 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canSeeScholarships]);

  // Search state
  const [search, setSearch] = useState("");
  const [memberType, setMemberType] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [alumniOnly, setAlumniOnly] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);

  // Family view state
  const [viewMode, setViewMode] = useState<"list" | "families">("list");
  const [sort, setSort] = useState("");   // "" = name; grade / -grade / type
  const [families, setFamilies] = useState<Family[]>([]);
  const [unassigned, setUnassigned] = useState<any[]>([]);
  const [familiesLoading, setFamiliesLoading] = useState(false);
  const [familiesError, setFamiliesError] = useState("");

  const successMsg = (location.state as { success?: string })?.success;

  // Directory access is gated on members.directory — a role without it (e.g. Volunteer)
  // can't browse or search members, even by navigating straight to /members.
  if (!canRead("members.directory")) {
    return (
      <div style={{ maxWidth: 520, margin: "64px auto", textAlign: "center", color: "#556" }}>
        <Users size={40} color="#cbd5e1" />
        <h2 style={{ color: "#1a3a5c", margin: "12px 0 6px", fontSize: 20 }}>Member directory unavailable</h2>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>You don't have access to search the member directory. If you think this is a mistake, contact an administrator.</p>
      </div>
    );
  }

  async function doSearch(opts?: { includeInactive?: boolean; archivedOnly?: boolean; sort?: string }) {
    const includeInactive = opts?.includeInactive ?? showInactive;
    const archivedOnly = opts?.archivedOnly ?? showArchived;
    const params = new URLSearchParams({ limit: "100" });
    // Default to active-only; when "Include inactive" is on, omit the filter so
    // both active and inactive members come back (needed to find & reactivate).
    // "Show archived" ignores active status too — an archived member is usually
    // also inactive, and we still want them to show up so they can be restored.
    if (!includeInactive && !archivedOnly) params.set("is_active", "true");
    if (search) params.set("search", search);
    if (memberType) params.set("member_type", memberType);
    if (alumniOnly) params.set("is_alumni", "true");
    // When "Show archived" is on, return ONLY archived members so admins can
    // find someone to un-archive; otherwise archived are hidden (the default).
    if (archivedOnly) params.set("archived_only", "true");
    // Sorting is server-side so it orders the whole result set, not just this page.
    const sortBy = opts?.sort ?? sort;
    if (sortBy) params.set("sort", sortBy);
    const { data } = await api.get(`/api/v1/members/?${params}`);
    setResults(data.members);
    setTotal(data.total);
    setSearched(true);
  }

  async function loadFamilyView() {
    setFamiliesLoading(true);
    setFamiliesError("");
    try {
      // Load families and all members in parallel
      const [familyData, memberData] = await Promise.all([
        familiesApi.list(),
        api.get("/api/v1/members/?limit=500&is_active=true").then(r => r.data.members),
      ]);
      setFamilies(familyData);
      // Find members with no family association
      const assignedIds = new Set(
        familyData.flatMap((f: Family) => f.members.map((m: FamilyMemberRecord) => m.member_id))
      );
      setUnassigned(memberData.filter((m: any) => !assignedIds.has(m.id)));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFamiliesError(msg ?? "Failed to load families. Check that you have the required permissions.");
    } finally {
      setFamiliesLoading(false);
    }
  }

  function handleToggle(mode: "list" | "families") {
    setViewMode(mode);
    if (mode === "families") loadFamilyView();
  }

  return (
    <div>
      <div style={styles.pageHeader}>
        <h1 style={styles.heading}>Member Directory</h1>
        <div style={styles.headerRight}>
          {/* View mode toggle */}
          <div style={styles.viewToggle}>
            <button
              style={{ ...styles.toggleBtn, ...(viewMode === "list" ? styles.toggleBtnActive : {}) }}
              onClick={() => handleToggle("list")}
            >
              <List size={14} /> Members
            </button>
            {canViewFamilies && (
              <button
                style={{ ...styles.toggleBtn, ...(viewMode === "families" ? styles.toggleBtnActive : {}) }}
                onClick={() => handleToggle("families")}
              >
                <Users size={14} /> Families
              </button>
            )}
          </div>
          {canSeeScholarships && (
            <button style={styles.importBtn} onClick={() => navigate("/admin/scholarship-applications")} title="Review scholarship applications">
              <GraduationCap size={15} /> Scholarship Applications
              {scholarshipCount > 0 && <span style={styles.actionBubble}>{scholarshipCount}</span>}
            </button>
          )}
          {canWrite("members.create") && (
            <>
              <button style={styles.importBtn} onClick={() => navigate("/members/import")}>
                <Upload size={15} /> Import CSV
              </button>
              <button style={styles.addBtn} onClick={() => navigate("/members/add")}>
                <UserPlus size={15} /> Add Member
              </button>
            </>
          )}
        </div>
      </div>

      {successMsg && <div style={styles.successMsg}>{successMsg}</div>}

      {/* ── List view ── */}
      {viewMode === "list" && (
        <>
          <div style={styles.toolbar}>
            <input
              style={styles.input}
              placeholder="Search name, email, or member #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <select style={styles.select} value={memberType} onChange={(e) => setMemberType(e.target.value)}>
              <option value="">All types</option>
              <option value="youth">Youth</option>
              <option value="mentor">Mentor</option>
              <option value="parent">Parent</option>
              <option value="volunteer">Volunteer</option>
            </select>
            <select
              style={styles.select}
              value={sort}
              title="Sort the results"
              onChange={(e) => { setSort(e.target.value); doSearch({ sort: e.target.value }); }}
            >
              <option value="">Sort: Name (A–Z)</option>
              <option value="-name">Sort: Name (Z–A)</option>
              <option value="grade">Sort: Grade (lowest first)</option>
              <option value="-grade">Sort: Grade (highest first)</option>
              <option value="type">Sort: Member type</option>
            </select>
            <label style={styles.alumniToggle} title="Show only alumni (any current role)">
              <input type="checkbox" checked={alumniOnly} onChange={(e) => setAlumniOnly(e.target.checked)} />
              Alumni only
            </label>
            <button style={styles.searchBtn} onClick={() => doSearch()}>
              <Search size={15} /> Search
            </button>
          </div>

          {(isAdmin || hasRole("Admin", "System Administrator")) && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <label style={styles.archivedToggle}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  disabled={showArchived}
                  onChange={(e) => { setShowInactive(e.target.checked); doSearch({ includeInactive: e.target.checked }); }}
                />
                Include inactive members
              </label>
              <label style={styles.archivedToggle}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => { setShowArchived(e.target.checked); doSearch({ archivedOnly: e.target.checked }); }}
                />
                Show archived members only
              </label>
            </div>
          )}

          {searched && (
            <p style={styles.count}>
              {total} {showArchived ? "archived " : ""}member{total !== 1 ? "s" : ""} found{!showArchived && showInactive ? " (incl. inactive)" : ""}
            </p>
          )}

          <div style={styles.table}>
            {results.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                canSeeNumber={canSeeNumber}
                onClick={() => navigate(`/members/${m.id}`)}
              />
            ))}
            {searched && results.length === 0 && (
              <p style={styles.empty}>No members match your search.</p>
            )}
            {!searched && (
              <p style={styles.hint}>Enter a search term above and press Enter, or click Search.</p>
            )}
          </div>
        </>
      )}

      {/* ── Family view ── */}
      {viewMode === "families" && (
        <div>
          {/* Toolbar row with count + refresh */}
          {!familiesLoading && (
            <div style={styles.familiesToolbar}>
              {!familiesError && (
                <p style={{ ...styles.count, margin: 0 }}>
                  {families.length} famil{families.length !== 1 ? "ies" : "y"} ·{" "}
                  {unassigned.length} member{unassigned.length !== 1 ? "s" : ""} not in a family
                </p>
              )}
              <button style={styles.refreshBtn} onClick={loadFamilyView}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          )}

          {familiesLoading && <p style={styles.loading}>Loading family associations…</p>}

          {familiesError && (
            <div style={styles.errorBox}>
              {familiesError}
              <button style={styles.retryBtn} onClick={loadFamilyView}>Try again</button>
            </div>
          )}

          {!familiesLoading && !familiesError && (
            <>
              {families.length === 0 && (
                <div style={styles.emptyFamilies}>
                  <Users size={36} color="#ccc" style={{ marginBottom: 10 }} />
                  <p>No families have been set up yet.</p>
                  <p style={{ fontSize: 13, color: "#aaa" }}>
                    Open any member's profile and use the Family panel to create family associations.
                  </p>
                </div>
              )}

              {/* Family cards */}
              <div style={styles.familyGrid}>
                {families.map((family) => (
                  <div key={family.id} style={styles.familyCard}>
                    <div style={styles.familyCardHeader}>
                      <Users size={14} color="#1a3a5c" />
                      <span style={styles.familyCardName}>
                        {family.family_name ?? `Family #${family.id}`}
                      </span>
                      <span style={styles.familyMemberCount}>
                        {family.members.length} member{family.members.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {family.members.map((fm) => (
                      <div
                        key={fm.family_member_id}
                        style={styles.familyMemberRow}
                        onClick={() => navigate(`/members/${fm.member_id}`)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f4f8")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={styles.familyAvatar}>
                          {fm.photo_url
                            ? <img src={fm.photo_url} style={styles.avatarImg} alt="" />
                            : <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>
                                {fm.first_name[0]}{fm.last_name[0]}
                              </span>
                          }
                          {fm.is_primary_contact && (
                            <div style={styles.primaryStar}>★</div>
                          )}
                        </div>
                        <div style={styles.familyMemberInfo}>
                          <span style={styles.familyMemberName}>
                            {fm.first_name} {fm.last_name}
                          </span>
                          {fm.relationship_label && (
                            <span style={styles.relLabel}>{fm.relationship_label}</span>
                          )}
                        </div>
                        <span style={{ ...styles.badge, background: TYPE_COLORS[fm.member_type] ?? "#888" }}>
                          {fm.member_type}
                        </span>
                        <ChevronRight size={13} color="#ccc" style={{ flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Unassigned members */}
              {unassigned.length > 0 && (
                <div style={styles.unassignedSection}>
                  <div style={styles.unassignedHeader}>
                    No Family Association ({unassigned.length})
                  </div>
                  <div style={styles.table}>
                    {unassigned.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        canSeeNumber={canSeeNumber}
                        onClick={() => navigate(`/members/${m.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member: m, canSeeNumber, onClick }: {
  member: any; canSeeNumber: boolean; onClick: () => void;
}) {
  return (
    <div
      style={{ ...styles.row, cursor: "pointer" }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f4f8")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
    >
      <div style={styles.avatar}>
        {m.photo_url
          ? <img src={m.photo_url} style={styles.avatarImg} />
          : <span style={{ color: "#fff", fontWeight: 700 }}>{m.first_name[0]}{m.last_name[0]}</span>
        }
      </div>
      <div style={styles.info}>
        <div style={styles.name}>
          {m.last_name}, {m.first_name}
          {m.is_active === false && !m.is_archived && <span style={{ ...styles.archivedTag, background: "#c62828" }}>Inactive</span>}
          {m.is_archived && <span style={styles.archivedTag}>Archived</span>}
          {/* Grade, so sorting by it is legible — youth only, and only when a
              graduation year is on file to derive it from. */}
          {m.grade_label && <span style={styles.gradeTag}>{m.grade_label}</span>}
        </div>
        <div style={styles.meta}>
          {canSeeNumber ? `#${m.member_number} · ` : ""}{m.email}
        </div>
      </div>
      {m.is_alumni && <span style={{ ...styles.badge, background: "#b8860b" }}>Alumni</span>}
      <span style={{ ...styles.badge, background: TYPE_COLORS[m.member_type] ?? "#555" }}>
        {m.member_type}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  viewToggle: { display: "flex", border: "1px solid #ccc", borderRadius: 7, overflow: "hidden" },
  toggleBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#fff", border: "none", cursor: "pointer", fontSize: 13, color: "#555" },
  toggleBtnActive: { background: "#1a3a5c", color: "#fff" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  importBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#fff", color: "#1a3a5c", border: "1px solid #1a3a5c", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  actionBubble: { minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "#e53935", color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 },
  successMsg: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "10px 14px", color: "#2e7d32", marginBottom: 16, fontSize: 14 },
  toolbar: { display: "flex", gap: 10, marginBottom: 16 },
  input: { flex: 1, padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  select: { padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  searchBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  count: { color: "#666", fontSize: 13, marginBottom: 12 },
  archivedToggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666", marginBottom: 12, cursor: "pointer" },
  alumniToggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666", cursor: "pointer", whiteSpace: "nowrap" },
  archivedTag: { marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#fff", background: "#6b7280", borderRadius: 8, padding: "1px 8px", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  gradeTag: { marginLeft: 7, fontSize: 10.5, fontWeight: 700, color: "#1565c0", background: "#e8f0fe", borderRadius: 10, padding: "1px 8px", verticalAlign: 1 },
  table: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 8, padding: "10px 14px", border: "1px solid #e2e8f0", transition: "background 0.1s" },
  avatar: { width: 40, height: 40, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, fontSize: 14 },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" as const },
  info: { flex: 1 },
  name: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  meta: { fontSize: 12, color: "#888" },
  badge: { padding: "3px 10px", borderRadius: 12, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  empty: { color: "#888", textAlign: "center", padding: "2rem" },
  hint: { color: "#aaa", textAlign: "center", fontSize: 13, padding: "2rem 0" },
  loading: { color: "#888", fontSize: 13, padding: "1rem 0" },

  // Family view
  familiesToolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  refreshBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#555" },
  errorBox: { display: "flex", alignItems: "center", gap: 12, background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "12px 16px", color: "#c62828", fontSize: 13, marginBottom: 12 },
  retryBtn: { padding: "4px 12px", background: "#c62828", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" as const },
  emptyFamilies: { textAlign: "center", padding: "3rem 0", color: "#888" },
  familyGrid: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 },
  familyCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  familyCardHeader: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f0f4f8", borderBottom: "1px solid #e2e8f0" },
  familyCardName: { fontWeight: 700, fontSize: 14, color: "#1a3a5c", flex: 1 },
  familyMemberCount: { fontSize: 12, color: "#888", fontWeight: 500 },
  familyMemberRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid #f8fafc", transition: "background 0.1s" },
  familyAvatar: { position: "relative", width: 34, height: 34, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  primaryStar: { position: "absolute", bottom: -2, right: -2, width: 13, height: 13, borderRadius: "50%", background: "#f57c00", color: "#fff", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #fff" },
  familyMemberInfo: { flex: 1, display: "flex", alignItems: "center", gap: 8 },
  familyMemberName: { fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  relLabel: { fontSize: 11, color: "#888", background: "#f0f4f8", padding: "1px 7px", borderRadius: 8 },
  unassignedSection: { marginTop: 8 },
  unassignedHeader: { fontSize: 12, fontWeight: 700, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #e2e8f0" },
};
