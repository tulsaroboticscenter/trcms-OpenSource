/**
 * FamilyPanel
 * ===========
 * Embedded in MemberProfile. Shows all family members with clickable profile links.
 * Admins can:
 *   - Create a new family (starting from this member)
 *   - Add existing members to the family
 *   - Set relationship labels (Parent, Child, Sibling, Spouse, etc.)
 *   - Mark the primary contact
 *   - Remove a member from the family
 *   - Rename the family
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { familiesApi, RELATIONSHIP_LABELS, type Family, type FamilyMemberRecord } from "../api";
import { api } from "../../../core/api";
import {
  Users, PlusCircle, Edit2, Trash2,
  ChevronRight, X, Check,
} from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#2e7d32", parent: "#e65100", volunteer: "#6a1b9a",
};

interface Props { memberId: number; }

interface MemberSearchResult {
  id: number; first_name: string; last_name: string;
  member_number: string; member_type: string; photo_url?: string;
}

export default function FamilyPanel({ memberId }: Props) {
  const navigate = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const canManage = isAdmin || hasRole("Admin", "System Administrator", "Mentor");
  const [family, setFamily] = useState<Family | null | undefined>(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"view" | "add-member" | "rename" | "edit-member" | "join-family">("view");
  const [editingFmId, setEditingFmId] = useState<number | null>(null);

  // Add member state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const [newRelLabel, setNewRelLabel] = useState("");
  const [addError, setAddError] = useState("");
  const [saving, setSaving] = useState(false);

  // Rename state
  const [newFamilyName, setNewFamilyName] = useState("");

  // Join-existing-family state
  const [joinSearch, setJoinSearch] = useState("");
  const [joinResults, setJoinResults] = useState<(MemberSearchResult & { family?: Family | null })[]>([]);
  const [joinError, setJoinError] = useState("");
  const [joinSaving, setJoinSaving] = useState(false);

  // Edit member state
  const [editRelLabel, setEditRelLabel] = useState("");
  const [editPrimary, setEditPrimary] = useState(false);

  useEffect(() => {
    familiesApi.getMemberFamily(memberId)
      .then(setFamily)
      .catch(() => setFamily(null))
      .finally(() => setLoading(false));
  }, [memberId]);

  // ── Search members to add ──────────────────────────────────────────────

  async function searchMembers() {
    if (!searchQuery.trim()) return;
    const { data } = await api.get(
      `/api/v1/members/?search=${encodeURIComponent(searchQuery)}&is_active=true&limit=15`
    );
    // Filter out members already in this family
    const familyMemberIds = new Set(family?.members.map(m => m.member_id) ?? []);
    setSearchResults(data.members.filter((m: MemberSearchResult) => !familyMemberIds.has(m.id)));
  }

  // ── Create new family starting from this member ────────────────────────

  async function createFamily() {
    setSaving(true);
    try {
      const f = await familiesApi.create({ member_ids: [memberId] });
      setFamily(f);
      setMode("add-member");  // immediately prompt to add more members
    } catch {
      alert("Failed to create family.");
    } finally { setSaving(false); }
  }

  // ── Search for existing families to join ──────────────────────────────

  async function searchForFamily() {
    if (!joinSearch.trim()) return;
    setJoinError("");
    const { data } = await api.get(
      `/api/v1/members/?search=${encodeURIComponent(joinSearch)}&is_active=true&limit=10`
    );
    // For each result, look up their family (skip self)
    const candidates = data.members.filter((m: MemberSearchResult) => m.id !== memberId);
    const withFamilies = await Promise.all(
      candidates.map(async (m: MemberSearchResult) => {
        try {
          const fam = await familiesApi.getMemberFamily(m.id);
          return { ...m, family: fam };
        } catch {
          return { ...m, family: null };
        }
      })
    );
    // Only show members who have a family
    const withFamily = withFamilies.filter(m => m.family !== null);
    setJoinResults(withFamily);
    if (withFamily.length === 0) {
      setJoinError("No members with a family found matching that search. Try a different name.");
    }
  }

  async function joinFamily(targetFamily: Family) {
    setJoinSaving(true);
    setJoinError("");
    try {
      const updated = await familiesApi.addMember(targetFamily.id, {
        member_id: memberId,
        relationship_label: undefined,
      });
      setFamily(updated);
      setMode("view");
      setJoinSearch("");
      setJoinResults([]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setJoinError(msg ?? "Failed to join family.");
    } finally {
      setJoinSaving(false);
    }
  }

  // ── Add selected member to family ─────────────────────────────────────

  async function addMember() {
    if (!selectedMember || !family) return;
    setSaving(true); setAddError("");
    try {
      const updated = await familiesApi.addMember(family.id, {
        member_id: selectedMember.id,
        relationship_label: newRelLabel || undefined,
      });
      setFamily(updated);
      setMode("view");       // return to view so the updated family is visible
      setSelectedMember(null);
      setNewRelLabel("");
      setSearchQuery("");
      setSearchResults([]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAddError(msg ?? "Failed to add member.");
    } finally { setSaving(false); }
  }

  // ── Update relationship label ──────────────────────────────────────────

  async function saveEditMember() {
    if (!family || !editingFmId) return;
    const fm = family.members.find(m => m.family_member_id === editingFmId);
    if (!fm) return;
    setSaving(true);
    try {
      const updated = await familiesApi.updateMember(family.id, fm.member_id, {
        relationship_label: editRelLabel || undefined,
        is_primary_contact: editPrimary,
      });
      setFamily(updated);
      setMode("view");
      setEditingFmId(null);
    } finally { setSaving(false); }
  }

  // ── Remove member from family ──────────────────────────────────────────

  async function removeMember(fm: FamilyMemberRecord) {
    if (!family) return;
    const isSelf = fm.member_id === memberId;
    const isLast = family.members.length === 1;
    const confirmMsg = isSelf
      ? `Remove yourself (${fm.first_name} ${fm.last_name}) from this family? You will no longer be associated with the other members.${isLast ? " This will also dissolve the family." : ""}`
      : `Remove ${fm.first_name} ${fm.last_name} from this family?${isLast ? " This will also dissolve the family." : ""}`;
    if (!confirm(confirmMsg)) return;
    try {
      await familiesApi.removeMember(family.id, fm.member_id);
      // If we removed the currently-viewed member, family is gone for them
      if (isSelf) {
        setFamily(null);
      } else {
        const updated = await familiesApi.getMemberFamily(memberId);
        setFamily(updated);
      }
    } catch {
      alert("Failed to remove member.");
    }
  }

  // ── Rename family ──────────────────────────────────────────────────────

  async function renameFamily() {
    if (!family) return;
    setSaving(true);
    try {
      const updated = await familiesApi.update(family.id, { family_name: newFamilyName || undefined });
      setFamily(updated);
      setMode("view");
    } finally { setSaving(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) return <p style={styles.muted}>Loading…</p>;

  if (!family) {
    // ── Join-family mode (searching for an existing family to join) ────────
    if (mode === "join-family") {
      return (
        <div>
          <div style={styles.addHeader}>
            <span style={styles.formTitle}>Join an Existing Family</span>
            <button style={styles.closeBtn} onClick={() => { setMode("view"); setJoinSearch(""); setJoinResults([]); setJoinError(""); }}>
              <X size={14} />
            </button>
          </div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 10, lineHeight: 1.5 }}>
            Search for any member who is already in a family. This member will be added to that family.
          </p>
          <div style={styles.searchRow}>
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="Search by name or member number…"
              value={joinSearch}
              onChange={(e) => setJoinSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchForFamily()}
              autoFocus
            />
            <button style={styles.searchBtn} onClick={searchForFamily}>Search</button>
          </div>

          {joinError && !joinResults.length && (
            <p style={styles.joinError}>{joinError}</p>
          )}

          {joinResults.length > 0 && (
            <div style={styles.joinResults}>
              {joinResults.map((m) => (
                <div key={m.id} style={styles.joinResultRow}>
                  <div style={styles.resultAvatar}>
                    {m.photo_url
                      ? <img src={m.photo_url} style={styles.avatarImg} alt="" />
                      : <span style={styles.avatarInitials}>{m.first_name[0]}{m.last_name[0]}</span>
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.cardName}>{m.first_name} {m.last_name}</div>
                    <div style={styles.joinFamilyName}>
                      Family: <strong>{m.family?.family_name ?? `Family #${m.family?.id}`}</strong>
                      <span style={styles.joinMemberCount}>
                        · {m.family?.members.length} member{m.family?.members.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <button
                    style={styles.joinBtn}
                    onClick={() => m.family && joinFamily(m.family)}
                    disabled={joinSaving}
                  >
                    {joinSaving ? "Joining…" : "Join this family"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── No family — show options ───────────────────────────────────────────
    return (
      <div style={styles.noFamilyBox}>
        <Users size={28} color="#ccc" style={{ marginBottom: 8 }} />
        <p style={styles.noFamilyText}>This member is not associated with a family yet.</p>
        {canManage && (
          <div style={styles.noFamilyActions}>
            <button style={styles.createBtn} onClick={createFamily} disabled={saving}>
              <PlusCircle size={13} /> Create New Family
            </button>
            <button
              style={styles.joinExistingBtn}
              onClick={() => { setJoinSearch(""); setJoinResults([]); setJoinError(""); setMode("join-family"); }}
            >
              <Users size={13} /> Add to Existing Family
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── View mode ─────────────────────────────────────────────────────────

  if (mode === "view") {
    return (
      <div>
        {/* Family header */}
        <div style={styles.familyHeader}>
          <div style={styles.familyName}>
            <Users size={14} color="#1a3a5c" />
            <span>{family.family_name ?? `Family #${family.id}`}</span>
          </div>
          {canManage && (
            <div style={styles.headerActions}>
              <button style={styles.iconBtn} title="Family invoice" onClick={() => navigate(`/invoices/family/${family.id}`)}>🧾</button>
              <button style={styles.iconBtn} title="Rename family" onClick={() => { setNewFamilyName(family.family_name ?? ""); setMode("rename"); }}>
                <Edit2 size={13} />
              </button>
              <button style={styles.iconBtn} title="Add member to family" onClick={() => { setSearchQuery(""); setSearchResults([]); setSelectedMember(null); setNewRelLabel(""); setAddError(""); setMode("add-member"); }}>
                <PlusCircle size={13} />
              </button>
              <button
                style={{ ...styles.iconBtn, color: "#c62828", borderColor: "#fcc" }}
                title="Dissolve this family (removes all associations)"
                onClick={async () => {
                  if (!confirm(`Dissolve the entire family group "${family.family_name ?? `Family #${family.id}`}"? All ${family.members.length} members will be unlinked. This cannot be undone.`)) return;
                  try {
                    await familiesApi.deleteFamily(family.id);
                    setFamily(null);
                  } catch {
                    alert("Failed to dissolve family.");
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Member cards */}
        <div style={styles.memberGrid}>
          {family.members.map(fm => (
            <div key={fm.family_member_id} style={styles.memberCard}>
              {/* Avatar — clicking goes to profile */}
              <div style={styles.cardTop} onClick={() => navigate(`/members/${fm.member_id}`)}>
                <div style={styles.avatar}>
                  {fm.photo_url
                    ? <img src={fm.photo_url} style={styles.avatarImg} alt="" />
                    : <span style={styles.avatarInitials}>{fm.first_name[0]}{fm.last_name[0]}</span>
                  }
                  {fm.is_primary_contact && (
                    <div style={styles.primaryDot} title="Primary contact">★</div>
                  )}
                </div>
                <div style={styles.cardInfo}>
                  <div style={styles.cardName}>{fm.first_name} {fm.last_name}</div>
                  {fm.relationship_label && (
                    <div style={styles.relLabel}>{fm.relationship_label}</div>
                  )}
                  <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                    <span style={{ ...styles.typeBadge, background: TYPE_COLORS[fm.member_type] ?? "#888" }}>
                      {fm.member_type}
                    </span>
                    {!fm.is_active && <span style={styles.inactiveBadge}>inactive</span>}
                  </div>
                  {(fm.phone || fm.email) && (
                    <div style={styles.contactInfo}>
                      {fm.phone && <span>{fm.phone}</span>}
                      {fm.email && <span>{fm.email}</span>}
                    </div>
                  )}
                </div>
                <ChevronRight size={14} color="#ccc" style={{ flexShrink: 0 }} />
              </div>

              {/* Admin actions */}
              {canManage && (
                <div style={styles.cardActions}>
                  <button style={styles.editMemberBtn} onClick={() => {
                    setEditingFmId(fm.family_member_id);
                    setEditRelLabel(fm.relationship_label ?? "");
                    setEditPrimary(fm.is_primary_contact);
                    setMode("edit-member");
                  }}>
                    <Edit2 size={11} /> Edit
                  </button>
                  <button style={styles.removeBtn} onClick={() => removeMember(fm)}>
                    <Trash2 size={11} /> Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Rename mode ───────────────────────────────────────────────────────

  if (mode === "rename") {
    return (
      <div style={styles.formPanel}>
        <div style={styles.formTitle}>Rename Family</div>
        <input style={styles.input} value={newFamilyName}
          onChange={e => setNewFamilyName(e.target.value)}
          placeholder="e.g. Smith Family" autoFocus />
        <div style={styles.formActions}>
          <button style={styles.cancelBtn} onClick={() => setMode("view")}>Cancel</button>
          <button style={styles.saveBtn} onClick={renameFamily} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  // ── Edit member mode ──────────────────────────────────────────────────

  if (mode === "edit-member") {
    const fm = family.members.find(m => m.family_member_id === editingFmId);
    return (
      <div style={styles.formPanel}>
        <div style={styles.formTitle}>
          Edit: {fm?.first_name} {fm?.last_name}
        </div>
        <label style={styles.label}>Relationship</label>
        <select style={styles.input} value={editRelLabel} onChange={e => setEditRelLabel(e.target.value)}>
          <option value="">No label</option>
          {RELATIONSHIP_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <label style={styles.checkRow}>
          <input type="checkbox" checked={editPrimary} onChange={e => setEditPrimary(e.target.checked)} />
          <span>Primary contact for the family</span>
        </label>
        <div style={styles.formActions}>
          <button style={styles.cancelBtn} onClick={() => { setMode("view"); setEditingFmId(null); }}>Cancel</button>
          <button style={styles.saveBtn} onClick={saveEditMember} disabled={saving}>
            {saving ? "Saving…" : <><Check size={13} /> Save</>}
          </button>
        </div>
      </div>
    );
  }

  // ── Add member mode ───────────────────────────────────────────────────

  return (
    <div>
      <div style={styles.addHeader}>
        <span style={styles.formTitle}>Add Family Member</span>
        <button style={styles.closeBtn} onClick={() => { setMode("view"); setSelectedMember(null); }}>
          <X size={14} />
        </button>
      </div>

      {!selectedMember ? (
        <>
          <div style={styles.searchRow}>
            <input style={{ ...styles.input, flex: 1 }}
              placeholder="Search by name or member number…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchMembers()}
              autoFocus
            />
            <button style={styles.searchBtn} onClick={searchMembers}>Search</button>
          </div>

          {searchResults.length > 0 && (
            <div style={styles.results}>
              {searchResults.map(m => (
                <div key={m.id} style={styles.resultRow} onClick={() => setSelectedMember(m)}>
                  <div style={styles.resultAvatar}>
                    {m.photo_url
                      ? <img src={m.photo_url} style={styles.avatarImg} alt="" />
                      : <span style={styles.avatarInitials}>{m.first_name[0]}{m.last_name[0]}</span>
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.cardName}>{m.first_name} {m.last_name}</div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>#{m.member_number} · {m.member_type}</div>
                  </div>
                  <span style={{ ...styles.typeBadge, background: TYPE_COLORS[m.member_type] ?? "#888" }}>
                    {m.member_type}
                  </span>
                </div>
              ))}
            </div>
          )}
          {searchResults.length === 0 && searchQuery && (
            <p style={styles.muted}>No members found. Try a different search.</p>
          )}
        </>
      ) : (
        <div>
          {/* Selected member confirmation */}
          <div style={styles.selectedCard}>
            <div style={styles.resultAvatar}>
              {selectedMember.photo_url
                ? <img src={selectedMember.photo_url} style={styles.avatarImg} alt="" />
                : <span style={styles.avatarInitials}>{selectedMember.first_name[0]}{selectedMember.last_name[0]}</span>
              }
            </div>
            <div style={{ flex: 1 }}>
              <div style={styles.cardName}>{selectedMember.first_name} {selectedMember.last_name}</div>
              <div style={{ fontSize: 11, color: "#aaa" }}>#{selectedMember.member_number}</div>
            </div>
            <button style={styles.closeBtn} onClick={() => setSelectedMember(null)}><X size={13} /></button>
          </div>

          <label style={styles.label}>Relationship to this family</label>
          <select style={styles.input} value={newRelLabel} onChange={e => setNewRelLabel(e.target.value)}>
            <option value="">No label (add label later)</option>
            {RELATIONSHIP_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          {addError && <p style={styles.error}>{addError}</p>}

          <div style={styles.formActions}>
            <button style={styles.cancelBtn} onClick={() => setSelectedMember(null)}>Back</button>
            <button style={styles.saveBtn} onClick={addMember} disabled={saving}>
              {saving ? "Adding…" : <><PlusCircle size={13} /> Add to Family</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  empty: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" },
  noFamilyBox: { display: "flex", flexDirection: "column", alignItems: "center", padding: "1.25rem 0.5rem", gap: 6 },
  noFamilyText: { fontSize: 13, color: "#888", margin: 0 },
  noFamilyActions: { display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" as const, justifyContent: "center" },
  createBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  joinExistingBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#fff", color: "#1a3a5c", border: "2px solid #1a3a5c", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  joinResults: { display: "flex", flexDirection: "column", gap: 6 },
  joinResultRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fafafa" },
  joinFamilyName: { fontSize: 12, color: "#555", marginTop: 2 },
  joinMemberCount: { color: "#aaa" },
  joinBtn: { padding: "6px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const },
  joinError: { fontSize: 12, color: "#888", fontStyle: "italic", marginTop: 4 },

  familyHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  familyName: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  headerActions: { display: "flex", gap: 6 },
  iconBtn: { display: "flex", alignItems: "center", padding: "4px 8px", border: "1px solid #e2e8f0", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#555", fontSize: 12 },

  memberGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 },
  memberCard: { border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", background: "#fff" },
  cardTop: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer" },
  avatar: { position: "relative", width: 42, height: 42, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  avatarInitials: { color: "#fff", fontSize: 14, fontWeight: 700 },
  primaryDot: { position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: "#f57c00", color: "#fff", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #fff" },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontWeight: 600, fontSize: 13, color: "#1a3a5c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  relLabel: { fontSize: 11, color: "#888", marginTop: 1 },
  typeBadge: { padding: "1px 7px", borderRadius: 8, color: "#fff", fontSize: 10, fontWeight: 600, textTransform: "capitalize" as const },
  inactiveBadge: { padding: "1px 7px", borderRadius: 8, background: "#f5f5f5", color: "#aaa", fontSize: 10 },
  contactInfo: { display: "flex", flexDirection: "column", fontSize: 11, color: "#aaa", marginTop: 3, gap: 1 },
  cardActions: { display: "flex", gap: 4, padding: "5px 12px", borderTop: "1px solid #f0f4f8", background: "#fafafa" },
  editMemberBtn: { display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", border: "1px solid #ccc", background: "#fff", borderRadius: 4, cursor: "pointer", fontSize: 11 },
  removeBtn: { display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", border: "1px solid #fcc", background: "#fff5f5", borderRadius: 4, cursor: "pointer", fontSize: 11, color: "#c62828" },

  // Forms
  formPanel: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px" },
  addHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  formTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 8, display: "block" },
  label: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3, marginTop: 8 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  checkRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, cursor: "pointer" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  cancelBtn: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  searchRow: { display: "flex", gap: 8, marginBottom: 10 },
  searchBtn: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" as const },
  results: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 },
  resultRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", background: "#fafafa" },
  resultAvatar: { width: 34, height: 34, borderRadius: "50%", background: "#1a3a5c", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  selectedCard: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, marginBottom: 10 },
  error: { fontSize: 12, color: "#c62828", margin: "4px 0" },
};
