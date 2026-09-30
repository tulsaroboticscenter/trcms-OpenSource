import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi, type SystemRole, type PermissionCatalog, type PermLevel, type RoleMemberRecord } from "../api";
import { api } from "../../../core/api";
import { ArrowLeft, PlusCircle, Edit2, ToggleLeft, ToggleRight, Shield, ChevronRight, ChevronDown, Lock, X, Eye, EyeOff, Pencil, Trash2, Search } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import ProfileLayoutSection from "../components/ProfileLayoutSection";
import TeamPaneTabsSection from "../components/TeamPaneTabsSection";

interface MemberResult { id: number; first_name: string; last_name: string; member_number: string; }

export default function RoleManager() {
  const navigate = useNavigate();
  const goBack = useGoBack("/admin");
  const { user } = useAuth();
  // Deleting a role is restricted to the System Administrator (matches the server).
  const isSysAdmin = !!user?.roles?.includes("System Administrator");
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [loading, setLoading] = useState(true);

  // New role form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [addError, setAddError] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit role
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Assign role to member
  const [assignRoleId, setAssignRoleId] = useState<number | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [assignError, setAssignError] = useState("");

  // Member role viewer
  const [viewMemberId, setViewMemberId] = useState("");
  const [memberRoles, setMemberRoles] = useState<{ id: number; name: string; display_name?: string; is_active: boolean }[] | null>(null);
  const [memberDetail, setMemberDetail] = useState<{ first_name: string; last_name: string } | null>(null);

  // Permissions editor
  const [permRole, setPermRole] = useState<{ id: number; name: string } | null>(null);

  // Expandable member list per role
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [roleMembers, setRoleMembers] = useState<Record<number, RoleMemberRecord[]>>({});
  const [membersLoading, setMembersLoading] = useState(false);

  async function toggleExpand(roleId: number) {
    if (expandedId === roleId) { setExpandedId(null); return; }
    setExpandedId(roleId);
    if (!roleMembers[roleId]) {
      setMembersLoading(true);
      try {
        const data = await adminApi.getRoleMembers(roleId);
        setRoleMembers((prev) => ({ ...prev, [roleId]: data.members }));
      } finally { setMembersLoading(false); }
    }
  }

  useEffect(() => { load(); }, []);

  async function load() {
    adminApi.listRoles().then(setRoles).finally(() => setLoading(false));
  }

  async function createRole() {
    if (!newName.trim()) { setAddError("Role name is required."); return; }
    setSaving(true); setAddError("");
    try {
      await adminApi.createRole({ name: newName.trim(), description: newDesc.trim() || undefined });
      setNewName(""); setNewDesc(""); setShowAdd(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAddError(msg ?? "Failed to create role.");
    } finally { setSaving(false); }
  }

  async function saveEdit(role: SystemRole) {
    if (role.is_protected) {
      // Built-in role: internal name is locked; only the display name (and
      // description) can change. Blank display name clears the override.
      await adminApi.updateRole(role.id, {
        name: role.name,
        display_name: editDisplayName.trim(),
        description: editDesc.trim() || undefined,
      });
    } else {
      if (!editName.trim()) return;
      await adminApi.updateRole(role.id, {
        name: editName.trim(),
        display_name: editDisplayName.trim(),
        description: editDesc.trim() || undefined,
      });
    }
    setEditingId(null);
    load();
  }

  async function toggleRole(id: number) {
    await adminApi.toggleRole(id);
    load();
  }

  async function deleteRole(r: SystemRole) {
    const warn = r.member_count > 0
      ? `\n\nThis role is assigned to ${r.member_count} member${r.member_count !== 1 ? "s" : ""}; they will be unassigned from it (their other roles are kept).`
      : "";
    if (!confirm(`Permanently delete the role "${r.display_name || r.name}"? This cannot be undone.${warn}`)) return;
    try {
      const res = await adminApi.deleteRole(r.id);
      if (res.members_unassigned > 0) alert(`Role deleted. ${res.members_unassigned} member${res.members_unassigned !== 1 ? "s were" : " was"} unassigned from it.`);
      load();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to delete the role.");
    }
  }

  async function searchMembers() {
    if (!memberSearch.trim()) return;
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(memberSearch)}&limit=10`);
    setMemberResults(data.members);
  }

  async function assignToMember(memberId: number) {
    if (!assignRoleId) return;
    setAssignError("");
    try {
      await adminApi.assignRole(memberId, assignRoleId);
      setRoleMembers((prev) => { const n = { ...prev }; delete n[assignRoleId]; return n; });
      setAssignRoleId(null); setMemberSearch(""); setMemberResults([]);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAssignError(msg ?? "Failed to assign role.");
    }
  }

  async function lookupMemberRoles() {
    const id = parseInt(viewMemberId);
    if (!id) return;
    const data = await adminApi.getMemberRoles(id);
    setMemberRoles(data.roles);
    setMemberDetail({ first_name: data.first_name, last_name: data.last_name });
  }

  async function removeRole(memberId: number, roleId: number) {
    await adminApi.removeRole(memberId, roleId);
    setRoleMembers((prev) => { const n = { ...prev }; delete n[roleId]; return n; });
    lookupMemberRoles();
  }

  const activeRoles = roles.filter((r) => r.is_active);
  const inactiveRoles = roles.filter((r) => !r.is_active);

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={styles.heading}>Role Management</h1>
        <p style={styles.sub}>System roles control what each member can see and do throughout the system.</p>
      </div>

      {/* Role list */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>System Roles</span>
          <button style={styles.addBtn} onClick={() => setShowAdd(!showAdd)}>
            <PlusCircle size={13} /> Add Role
          </button>
        </div>

        {showAdd && (
          <div style={styles.addForm}>
            <input style={styles.input} placeholder="Role name *" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input style={styles.input} placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            {addError && <p style={styles.error}>{addError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={styles.saveBtn} onClick={createRole} disabled={saving}>{saving ? "Saving…" : "Create Role"}</button>
              <button style={styles.cancelBtn} onClick={() => { setShowAdd(false); setAddError(""); }}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? <p style={styles.muted}>Loading…</p> : (
          <div style={styles.roleList}>
            {activeRoles.map((r) => (
              <RoleRow
                key={r.id} role={r}
                editing={editingId === r.id}
                editName={editName} editDisplayName={editDisplayName} editDesc={editDesc}
                onStartEdit={() => {
                  setEditingId(r.id);
                  setEditName(r.name);
                  setEditDisplayName(r.display_name && r.display_name !== r.name ? r.display_name : "");
                  setEditDesc(r.description ?? "");
                }}
                onSaveEdit={() => saveEdit(r)}
                onCancelEdit={() => setEditingId(null)}
                onEditName={setEditName} onEditDisplayName={setEditDisplayName} onEditDesc={setEditDesc}
                onToggle={() => toggleRole(r.id)}
                onAssign={(!isSysAdmin && r.name === "System Administrator") ? undefined : () => setAssignRoleId(r.id)}
                onPermissions={() => setPermRole({ id: r.id, name: r.name })}
                onDelete={isSysAdmin ? () => deleteRole(r) : undefined}
                expanded={expandedId === r.id}
                onToggleExpand={() => toggleExpand(r.id)}
                members={roleMembers[r.id]}
                membersLoading={membersLoading && expandedId === r.id}
                onGoToMember={(mid) => navigate(`/members/${mid}`)}
              />
            ))}
            {inactiveRoles.length > 0 && (
              <>
                <div style={styles.groupLabel}>Inactive Roles</div>
                {inactiveRoles.map((r) => (
                  <RoleRow
                    key={r.id} role={r} dimmed
                    editing={false} editName="" editDisplayName="" editDesc=""
                    onStartEdit={() => {}}
                    onSaveEdit={() => {}} onCancelEdit={() => {}}
                    onEditName={() => {}} onEditDisplayName={() => {}} onEditDesc={() => {}}
                    onToggle={() => toggleRole(r.id)}
                    onAssign={() => {}}
                    onPermissions={() => {}}
                    onDelete={isSysAdmin ? () => deleteRole(r) : undefined}
                    expanded={expandedId === r.id}
                    onToggleExpand={() => toggleExpand(r.id)}
                    members={roleMembers[r.id]}
                    membersLoading={membersLoading && expandedId === r.id}
                    onGoToMember={(mid) => navigate(`/members/${mid}`)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Assign role to member */}
      {assignRoleId && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            Assign "{roles.find(r => r.id === assignRoleId)?.name}" to a Member
          </div>
          <div style={styles.searchRow}>
            <input style={{ ...styles.input, flex: 1 }} placeholder="Search member by name or number…"
              value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchMembers()} />
            <button style={styles.searchBtn} onClick={searchMembers}>Search</button>
            <button style={styles.cancelBtn} onClick={() => { setAssignRoleId(null); setMemberSearch(""); setMemberResults([]); }}>Cancel</button>
          </div>
          {assignError && <p style={styles.error}>{assignError}</p>}
          {memberResults.map((m) => (
            <div key={m.id} style={styles.memberResultRow}>
              <div style={styles.memberAvatar}>{m.first_name[0]}{m.last_name[0]}</div>
              <span style={{ flex: 1, fontSize: 14 }}>{m.first_name} {m.last_name} <span style={{ color: "#aaa" }}>#{m.member_number}</span></span>
              <button style={styles.assignBtn} onClick={() => assignToMember(m.id)}>Assign Role</button>
            </div>
          ))}
        </div>
      )}

      {/* Member role viewer */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>View / Edit Member Roles</div>
        <div style={styles.searchRow}>
          <input style={{ ...styles.input, width: 160 }} placeholder="Member ID" type="number"
            value={viewMemberId} onChange={(e) => setViewMemberId(e.target.value)} />
          <button style={styles.searchBtn} onClick={lookupMemberRoles}>Look Up</button>
          {memberDetail && (
            <button style={styles.profileBtn} onClick={() => navigate(`/members/${viewMemberId}`)}>
              View Profile <ChevronRight size={13} />
            </button>
          )}
        </div>
        {memberRoles && memberDetail && (
          <div style={styles.memberRolesCard}>
            <div style={styles.memberRolesName}>{memberDetail.first_name} {memberDetail.last_name}</div>
            {memberRoles.length === 0 ? (
              <p style={styles.muted}>No roles assigned.</p>
            ) : (
              memberRoles.map((r) => (
                <div key={r.id} style={styles.memberRoleRow}>
                  <Shield size={13} color={r.is_active ? "#1a3a5c" : "#ccc"} />
                  <span style={{ flex: 1, fontSize: 14, color: r.is_active ? "#333" : "#aaa" }}>{r.display_name || r.name}</span>
                  {!r.is_active && <span style={styles.inactiveTag}>inactive</span>}
                  <button style={styles.removeBtn} onClick={() => removeRole(parseInt(viewMemberId), r.id)}>
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Profile Layout — global pane placement (Main / Side / Account Info) */}
      <ProfileLayoutSection />

      {/* Team Profile Tabs — global tab assignment for team panes */}
      <TeamPaneTabsSection />

      {/* Permissions editor modal */}
      {permRole && (
        <PermissionsEditor
          roleId={permRole.id}
          roleName={permRole.name}
          onClose={() => setPermRole(null)}
        />
      )}
    </div>
  );
}

// ── Permissions Editor ───────────────────────────────────────────────────────

const LEVEL_META: Record<PermLevel, { label: string; color: string; icon: React.ReactNode }> = {
  write: { label: "Write", color: "#2e7d32", icon: <Pencil size={12} /> },
  read:  { label: "Read",  color: "#1565c0", icon: <Eye size={12} /> },
  none:  { label: "Not Visible", color: "#c62828", icon: <EyeOff size={12} /> },
};

function PermissionsEditor({ roleId, roleName, onClose }: {
  roleId: number; roleName: string; onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [perms, setPerms] = useState<Record<string, PermLevel>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      adminApi.getPermissionCatalog(),
      adminApi.getRolePermissions(roleId),
    ]).then(([cat, rp]) => {
      setCatalog(cat);
      setPerms(rp.permissions);
    }).finally(() => setLoading(false));
  }, [roleId]);

  function setItem(key: string, level: PermLevel) {
    setPerms((p) => ({ ...p, [key]: level }));
    setSaved(false);
  }

  function setModule(moduleId: string, level: PermLevel) {
    if (!catalog) return;
    const mod = catalog.modules.find((m) => m.id === moduleId);
    if (!mod) return;
    setPerms((p) => {
      const next = { ...p };
      mod.items.forEach((it) => { next[it.key] = level; });
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await adminApi.setRolePermissions(roleId, perms);
      setSaved(true);
    } finally { setSaving(false); }
  }

  const isProtected = roleName === "System Administrator";

  // Filter modules/items by the search keyword (matches module label, item
  // label, or the underlying permission key). If the module name matches, all
  // its items are kept; otherwise only the matching items.
  const q = search.trim().toLowerCase();
  const filteredModules = !catalog ? [] : (!q ? catalog.modules : catalog.modules
    .map((mod) => {
      const modMatch = mod.label.toLowerCase().includes(q) || mod.id.toLowerCase().includes(q);
      const items = modMatch ? mod.items : mod.items.filter((it) => it.label.toLowerCase().includes(q) || it.key.toLowerCase().includes(q));
      return items.length ? { ...mod, items } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null));

  return (
    <div style={pe.overlay} onClick={onClose}>
      <div style={pe.modal} onClick={(e) => e.stopPropagation()}>
        <div style={pe.header}>
          <div style={pe.title}><Lock size={17} /> Permissions — {roleName}</div>
          <button style={pe.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        {isProtected ? (
          <div style={pe.body}>
            <p style={pe.protectedNote}>
              <Shield size={14} /> <strong>{roleName}</strong> always has full access to every
              module and cannot be restricted.
            </p>
          </div>
        ) : loading || !catalog ? (
          <div style={pe.body}><p style={{ color: "#888" }}>Loading…</p></div>
        ) : (
          <>
            <div style={pe.legend}>
              {(["write", "read", "none"] as PermLevel[]).map((lv) => (
                <span key={lv} style={{ ...pe.legendItem, color: LEVEL_META[lv].color }}>
                  {LEVEL_META[lv].icon} {LEVEL_META[lv].label}
                </span>
              ))}
              <span style={pe.legendHint}>Levels shown are this role's current effective access.</span>
            </div>

            <div style={pe.searchWrap}>
              <Search size={15} color="#889" />
              <input style={pe.searchInput} placeholder="Search permissions (e.g. inventory, report, event)…"
                value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              {search && <button style={pe.searchClear} onClick={() => setSearch("")}><X size={14} /></button>}
            </div>

            <div style={pe.body}>
              {filteredModules.length === 0 && <p style={{ color: "#888", padding: "8px 4px" }}>No permissions match “{search}”.</p>}
              {filteredModules.map((mod) => (
                <div key={mod.id} style={pe.moduleBlock}>
                  <div style={pe.moduleHeader}>
                    <span style={pe.moduleName}>{mod.label}</span>
                    <div style={pe.moduleQuick}>
                      <span style={pe.quickLabel}>Set all:</span>
                      {(["write", "read", "none"] as PermLevel[]).map((lv) => (
                        <button key={lv} style={pe.quickBtn}
                          onClick={() => setModule(mod.id, lv)}>
                          {LEVEL_META[lv].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {mod.items.map((item) => {
                    const cur = perms[item.key] ?? "write";
                    return (
                      <div key={item.key} style={pe.itemRow}>
                        <span style={pe.itemLabel}>{item.label}</span>
                        <div style={pe.segmented}>
                          {(["write", "read", "none"] as PermLevel[]).map((lv) => (
                            <button key={lv}
                              onClick={() => setItem(item.key, lv)}
                              style={{
                                ...pe.segBtn,
                                ...(cur === lv ? { background: LEVEL_META[lv].color, color: "#fff", borderColor: LEVEL_META[lv].color } : {}),
                              }}>
                              {LEVEL_META[lv].icon} {LEVEL_META[lv].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div style={pe.footer}>
              {saved && <span style={pe.savedMsg}>✓ Saved</span>}
              <button style={pe.cancelBtn} onClick={onClose}>Close</button>
              <button style={pe.saveBtn} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Permissions"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RoleRow({ role: r, editing, editName, editDisplayName, editDesc, onStartEdit, onSaveEdit, onCancelEdit,
  onEditName, onEditDisplayName, onEditDesc, onToggle, onAssign, onPermissions, onDelete,
  expanded, onToggleExpand, members, membersLoading, onGoToMember, dimmed = false }: {
  role: SystemRole; editing: boolean; editName: string; editDisplayName: string; editDesc: string;
  onStartEdit: () => void; onSaveEdit: () => void; onCancelEdit: () => void;
  onEditName: (v: string) => void; onEditDisplayName: (v: string) => void; onEditDesc: (v: string) => void;
  onToggle: () => void; onAssign?: () => void; onPermissions: () => void; onDelete?: () => void;
  expanded: boolean; onToggleExpand: () => void;
  members?: RoleMemberRecord[]; membersLoading: boolean; onGoToMember: (id: number) => void;
  dimmed?: boolean;
}) {
  const isProtected = r.is_protected ?? ["System Administrator", "Admin", "Mentor", "Youth Member", "Parent", "Volunteer", "Default"].includes(r.name);
  // Only System Administrator hides the Permissions editor; Admin is now editable.
  const isSuper = r.name === "System Administrator";
  const shownName = r.display_name || r.name;

  if (editing) {
    return (
      <div style={styles.roleRow}>
        <div style={{ flex: 1 }}>
          {isProtected ? (
            <div style={{ ...styles.input, marginBottom: 6, background: "#f4f6f9", color: "#888", display: "flex", alignItems: "center", gap: 6 }}>
              <Lock size={12} /> {r.name} <span style={{ fontSize: 11 }}>(built-in name — locked)</span>
            </div>
          ) : (
            <input style={{ ...styles.input, marginBottom: 6 }} value={editName} onChange={(e) => onEditName(e.target.value)} placeholder="Role name" />
          )}
          <input style={{ ...styles.input, marginBottom: 6 }} value={editDisplayName}
            onChange={(e) => onEditDisplayName(e.target.value)}
            placeholder={isProtected ? `Display name (e.g. shown instead of "${r.name}")` : "Display name (optional)"} />
          <input style={styles.input} value={editDesc} onChange={(e) => onEditDesc(e.target.value)} placeholder="Description" />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={styles.saveBtn} onClick={onSaveEdit}>Save</button>
            <button style={styles.cancelBtn} onClick={onCancelEdit}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.roleCard, opacity: dimmed ? 0.6 : 1 }}>
      <div style={styles.roleRow}>
        {/* Clickable name area toggles the member list */}
        <div style={styles.roleClickArea} onClick={onToggleExpand} title="Show members with this role">
          {expanded ? <ChevronDown size={16} color="#888" /> : <ChevronRight size={16} color="#888" />}
          <Shield size={15} color={r.is_active ? "#1a3a5c" : "#ccc"} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={styles.roleName}>{shownName}</div>
            {shownName !== r.name && (
              <div style={styles.roleInternalName}>internal: {r.name}</div>
            )}
            {r.description && <div style={styles.roleDesc}>{r.description}</div>}
            <div style={styles.roleCount}>{r.member_count} member{r.member_count !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div style={styles.roleActions}>
          {r.is_active && (
            <button style={styles.iconBtn} onClick={onStartEdit}
              title={isProtected ? "Edit display name" : "Edit"}><Edit2 size={13} /></button>
          )}
          {r.is_active && !isSuper && (
            <button style={styles.permBtn} onClick={onPermissions} title="Set module permissions">
              <Lock size={12} /> Permissions
            </button>
          )}
          {r.is_active && onAssign && (
            <button style={styles.assignSmallBtn} onClick={onAssign}>Assign to Member</button>
          )}
          <button style={styles.iconBtn} onClick={onToggle}
            title={r.is_active ? "Deactivate" : "Reactivate"}>
            {r.is_active ? <ToggleRight size={18} color="#2e7d32" /> : <ToggleLeft size={18} color="#ccc" />}
          </button>
          {onDelete && !isProtected && (
            <button style={{ ...styles.iconBtn, color: "#c62828" }} onClick={onDelete}
              title="Delete this role (System Administrator)">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded member list */}
      {expanded && (
        <div style={styles.roleMembersBox}>
          {membersLoading && !members ? (
            <p style={styles.roleMembersMuted}>Loading members…</p>
          ) : !members || members.length === 0 ? (
            <p style={styles.roleMembersMuted}>No members have this role.</p>
          ) : (
            <div style={styles.roleMembersGrid}>
              {members.map((m) => (
                <div key={m.id} style={styles.roleMemberChip} onClick={() => onGoToMember(m.id)}>
                  <div style={styles.roleMemberAvatar}>
                    {m.photo_url
                      ? <img src={m.photo_url} style={styles.roleMemberImg} alt="" />
                      : <span>{m.first_name[0]}{m.last_name[0]}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.roleMemberName}>
                      {m.last_name}, {m.first_name}
                      {!m.is_active && <span style={styles.roleMemberInactive}>inactive</span>}
                    </div>
                    <div style={styles.roleMemberMeta}>#{m.member_number} · {m.member_type}</div>
                  </div>
                  <ChevronRight size={13} color="#ccc" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  section: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 16 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  addForm: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const, width: "100%" },
  error: { fontSize: 12, color: "#c62828", margin: 0 },
  saveBtn: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  cancelBtn: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  muted: { fontSize: 13, color: "#888", margin: 0 },
  roleList: { display: "flex", flexDirection: "column", gap: 4 },
  groupLabel: { fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "10px 0 4px" },
  roleCard: { background: "#f8fafc", borderRadius: 7, border: "1px solid #f0f4f8", overflow: "hidden" },
  roleRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f8fafc", borderRadius: 7, border: "1px solid #f0f4f8" },
  roleClickArea: { display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer", minWidth: 0 },
  roleMembersBox: { padding: "10px 14px 12px", borderTop: "1px solid #e8edf3", background: "#fff" },
  roleMembersMuted: { fontSize: 12, color: "#aaa", margin: "4px 0" },
  roleMembersGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 },
  roleMemberChip: { display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 7, cursor: "pointer" },
  roleMemberAvatar: { width: 30, height: 30, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, overflow: "hidden" },
  roleMemberImg: { width: "100%", height: "100%", objectFit: "cover" as const },
  roleMemberName: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  roleMemberMeta: { fontSize: 11, color: "#999", textTransform: "capitalize" as const },
  roleMemberInactive: { fontSize: 9, color: "#aaa", background: "#f0f0f0", padding: "1px 5px", borderRadius: 5, marginLeft: 6, textTransform: "uppercase" as const },
  roleName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  roleInternalName: { fontSize: 11, color: "#aaa", marginTop: 1, fontFamily: "monospace" },
  roleDesc: { fontSize: 12, color: "#888", marginTop: 1 },
  roleCount: { fontSize: 11, color: "#aaa", marginTop: 2 },
  roleActions: { display: "flex", alignItems: "center", gap: 8 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: "#888" },
  assignSmallBtn: { padding: "4px 10px", fontSize: 11, border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap" as const },
  searchRow: { display: "flex", gap: 8, marginBottom: 10, alignItems: "center" },
  searchBtn: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  memberResultRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f8fafc", borderRadius: 7, border: "1px solid #e2e8f0", marginBottom: 4 },
  memberAvatar: { width: 30, height: 30, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  assignBtn: { padding: "5px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  profileBtn: { display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  memberRolesCard: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px" },
  memberRolesName: { fontWeight: 700, fontSize: 15, color: "#1a3a5c", marginBottom: 10 },
  memberRoleRow: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #f0f4f8", fontSize: 13 },
  inactiveTag: { fontSize: 10, color: "#aaa", background: "#f0f0f0", padding: "1px 6px", borderRadius: 6 },
  removeBtn: { padding: "3px 10px", border: "1px solid #ef9a9a", color: "#c62828", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 11 },
  permBtn: { display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, border: "1px solid #c5cae9", background: "#eef0fb", color: "#3949ab", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap" as const },
};

const pe: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, width: 680, maxWidth: "96vw", maxHeight: "90vh", display: "flex", flexDirection: "column" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" },
  title: { display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", margin: "0 16px", border: "1px solid #d6dee7", borderRadius: 8, background: "#fff" },
  searchInput: { flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent" },
  searchClear: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 2 },
  legend: { display: "flex", alignItems: "center", gap: 16, padding: "10px 20px", borderBottom: "1px solid #f0f4f8", fontSize: 12, flexWrap: "wrap" as const, background: "#fafbff" },
  legendItem: { display: "flex", alignItems: "center", gap: 5, fontWeight: 600 },
  legendHint: { color: "#999", fontStyle: "italic", marginLeft: "auto" },
  body: { padding: "12px 20px", overflowY: "auto" as const, flex: 1 },
  protectedNote: { display: "flex", alignItems: "center", gap: 8, background: "#f0f4f8", borderRadius: 8, padding: "14px 16px", fontSize: 13, color: "#444", lineHeight: 1.6 },
  moduleBlock: { marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden" },
  moduleHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "#f0f4f8", flexWrap: "wrap" as const, gap: 8 },
  moduleName: { fontWeight: 700, fontSize: 13, color: "#1a3a5c" },
  moduleQuick: { display: "flex", alignItems: "center", gap: 4 },
  quickLabel: { fontSize: 11, color: "#888", marginRight: 2 },
  quickBtn: { padding: "2px 8px", fontSize: 11, border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#555" },
  itemRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 14px", borderTop: "1px solid #f4f6fa" },
  itemLabel: { fontSize: 13, color: "#333", flex: 1 },
  segmented: { display: "flex", gap: 0, border: "1px solid #e2e8f0", borderRadius: 7, overflow: "hidden", flexShrink: 0 },
  segBtn: { display: "flex", alignItems: "center", gap: 4, padding: "5px 11px", fontSize: 12, border: "none", borderRight: "1px solid #e2e8f0", background: "#fff", color: "#666", cursor: "pointer", fontWeight: 600 },
  footer: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "12px 20px", borderTop: "1px solid #e2e8f0", background: "#fafafa" },
  savedMsg: { color: "#2e7d32", fontSize: 13, fontWeight: 600, marginRight: "auto" },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
