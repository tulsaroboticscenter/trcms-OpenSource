/**
 * EventCheckin — event-specific check-in screen.
 *
 * Single unified roster list. Each row has one toggle button:
 *   "Check In"  → green, when the person hasn't checked in yet
 *   "Check Out" → orange, when the person is currently checked in
 *
 * Walk-ins found via search are added to the list immediately on check-in.
 * All state updates are optimistic (instant UI) with a background reload.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Search, LogIn, LogOut, CheckCircle, Users, LogOut as LogOutAll, Clock, Check, X, Trash2 } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface RosterEntry {
  member_id: number;
  first_name: string;
  last_name: string;
  member_type: string;
  member_number: string;
  photo_url?: string;
  section_label: string;
  checkin_id: number | null;
  checked_in: boolean;   // currently here (no time_out)
  checked_out: boolean;  // was here, left
  time_in: string | null;
  time_out: string | null;
}

interface EventInfo {
  id: number;
  name: string;
  event_date: string;
  end_date?: string;
  start_time?: string;
  location?: string;
  event_type?: string;
  default_area_youth?: string | null;
  default_area_adult?: string | null;
  default_area_parent?: string | null;
}

interface SearchMember {
  id: number;
  first_name: string;
  last_name: string;
  member_type: string;
  member_number: string;
  photo_url?: string;
}

interface Toast { text: string; ok: boolean; warning?: string }

function fmtTime(t?: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtTs(iso: string | null) {
  if (!iso) return "";
  // Treat offset-less timestamps as UTC (the server stores naive UTC).
  const norm = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  return new Date(norm).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ISO (UTC) → value for a <input type="datetime-local"> in the viewer's local time.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// datetime-local value (local) → ISO (UTC) for the API.
function localInputToIso(v: string): string {
  return new Date(v).toISOString();
}

export default function EventCheckin() {
  const { eventId } = useParams<{ eventId: string }>();
  const goBack = useGoBack("/checkin");
  const { isAdmin, hasRole, canWrite } = useAuth();
  const canAdjust = isAdmin || hasRole("Admin", "System Administrator", "Mentor");
  const canManage = canWrite("checkin.manage"); // remove accidental check-ins

  const todayLocal = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (local)
  const [date, setDate] = useState(todayLocal); // which event day we're viewing/fixing
  const snappedRef = useRef(false);

  const [event, setEvent]   = useState<EventInfo | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]   = useState<Toast | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [busy, setBusy]     = useState<number | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmAllText, setConfirmAllText] = useState("");

  // Default check-in activities: shared activity list + the pending pick-activity prompt.
  const [activityAreas, setActivityAreas] = useState<string[]>([]);
  const [activityPrompt, setActivityPrompt] =
    useState<{ member: SearchMember | RosterEntry; name: string; area: string } | null>(null);

  // Inline time adjustment
  const [editId, setEditId] = useState<number | null>(null);   // checkin_id being edited
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Search
  const [search, setSearch]           = useState("");
  const [searchResults, setSearchResults] = useState<SearchMember[]>([]);
  const [searching, setSearching]     = useState(false);

  const showToast = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), t.warning ? 7000 : 4000);
  };

  const loadRoster = useCallback(async () => {
    if (!eventId) return;
    const { data } = await api.get(`/api/v1/checkin/event/${eventId}/roster`, { params: { date } });
    setEvent(data.event);
    setRoster(data.roster);
    setLoading(false);
  }, [eventId, date]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  useEffect(() => {
    api.get("/api/v1/activity/areas")
      .then((r) => setActivityAreas((r.data as { areas: string[] }).areas ?? []))
      .catch(() => {});
  }, []);

  // Once the event loads, snap the viewed day into the event's date range (so a
  // past multi-day event opens on a real event day rather than an empty "today").
  useEffect(() => {
    if (!event || snappedRef.current) return;
    snappedRef.current = true;
    const lo = event.event_date;
    const hi = event.end_date && event.end_date !== event.event_date ? event.end_date : event.event_date;
    if (date < lo) setDate(lo);
    else if (date > hi) setDate(hi);
  }, [event]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMultiDay = !!event?.end_date && event.end_date !== event.event_date;
  const viewingToday = date === todayLocal;

  // The event's default activity for a member type ("" = none / not configured).
  function defaultAreaFor(memberType: string): string {
    if (!event) return "";
    if (memberType === "youth") return event.default_area_youth ?? "";
    if (memberType === "parent") return event.default_area_parent ?? "";
    return event.default_area_adult ?? "";
  }
  const eventHasDefaults = !!event &&
    !!(event.default_area_youth || event.default_area_adult || event.default_area_parent);

  // ── Check-in a member ────────────────────────────────────────────────────
  // When the event defines default check-in activities, open a quick dropdown
  // (pre-set to this member type's default) so time can be auto-logged at
  // check-out. Otherwise check in immediately.
  function doCheckIn(member: SearchMember | RosterEntry) {
    if (eventHasDefaults) {
      const name = `${member.first_name} ${member.last_name}`;
      setActivityPrompt({ member, name, area: defaultAreaFor(member.member_type) });
      return;
    }
    postCheckIn(member);
  }

  async function postCheckIn(member: SearchMember | RosterEntry, area?: string) {
    if (!eventId) return;
    const mid = "member_id" in member ? member.member_id : member.id;
    setBusy(mid);
    try {
      const { data } = await api.post("/api/v1/checkin/", {
        member_id: mid,
        event_id: parseInt(eventId),
        ...(area !== undefined ? { activity_area: area } : {}),
      });

      if (data.ok) {
        showToast({ text: data.message, ok: true, warning: data.grace_warning });

        setRoster(prev => {
          const existing = prev.find(r => r.member_id === mid);
          const now = new Date().toISOString();
          if (existing) {
            // Update in place
            return prev.map(r =>
              r.member_id === mid
                ? { ...r, checked_in: true, checked_out: false, time_in: now, time_out: null, checkin_id: -1 }
                : r
            );
          } else {
            // Walk-in: append to roster
            const m = member as SearchMember;
            const newEntry: RosterEntry = {
              member_id: m.id,
              first_name: m.first_name,
              last_name: m.last_name,
              member_type: m.member_type,
              member_number: m.member_number,
              photo_url: m.photo_url,
              section_label: "Walk-In",
              checkin_id: -1,
              checked_in: true,
              checked_out: false,
              time_in: now,
              time_out: null,
            };
            return [...prev, newEntry];
          }
        });

        setSearch("");
        setSearchResults([]);
        // Background reload to get real checkin_id
        loadRoster();
      } else {
        // Check-in blocked (e.g. compliance/enrollment) — show a modal so it's
        // not missed at the bottom of a long roster.
        setFailMsg(data.message || "This member can't be checked in.");
      }
    } catch {
      setFailMsg("Check-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  // ── Check-out a member ───────────────────────────────────────────────────
  async function doCheckOut(memberId: number) {
    if (!eventId) return;
    // Confirm so we don't inadvertently check someone out.
    const who = roster.find(r => r.member_id === memberId);
    const name = who ? `${who.first_name} ${who.last_name}` : "this member";
    if (!confirm(`Check out ${name}? This ends their check-in for this event.`)) return;
    setBusy(memberId);
    try {
      const { data } = await api.post(`/api/v1/checkin/event/${eventId}/checkout/${memberId}`, {}, { params: { date } });
      showToast({ text: data.message, ok: true });

      // Optimistic: flip the button immediately
      setRoster(prev =>
        prev.map(r =>
          r.member_id === memberId
            ? { ...r, checked_in: false, checked_out: true, time_out: new Date().toISOString() }
            : r
        )
      );

      loadRoster(); // background sync
    } catch {
      showToast({ text: "Check-out failed. Please try again.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  // ── Check out everyone still checked in ──────────────────────────────────
  // Guarded by a type-"Confirm" modal so this can't be triggered by accident.
  async function doCheckOutAll() {
    if (!eventId) return;
    const n = roster.filter(r => r.checked_in).length;
    if (n === 0) { showToast({ text: "No one is currently checked in.", ok: false }); return; }
    setConfirmAllText("");
    setConfirmAll(true);
  }

  async function runCheckOutAll() {
    if (!eventId) return;
    setConfirmAll(false);
    setBusy(-999); // sentinel: bulk operation in progress
    try {
      const { data } = await api.post(`/api/v1/checkin/event/${eventId}/checkout-all`, {}, { params: { date } });
      showToast({ text: data.message, ok: true });
      const now = new Date().toISOString();
      setRoster(prev =>
        prev.map(r => r.checked_in
          ? { ...r, checked_in: false, checked_out: true, time_out: now }
          : r
        )
      );
      loadRoster();
    } catch {
      showToast({ text: "Check-out all failed. Please try again.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  // ── Search ───────────────────────────────────────────────────────────────
  async function doSearch() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search.trim())}&is_active=true&limit=20`);
      setSearchResults(data.members);
    } finally {
      setSearching(false);
    }
  }

  // ── Adjust check-in / check-out times (admin/mentor) ─────────────────────
  function startEdit(r: RosterEntry) {
    setEditId(r.checkin_id);
    setEditIn(isoToLocalInput(r.time_in));
    setEditOut(isoToLocalInput(r.time_out));
  }
  function cancelEdit() { setEditId(null); setEditIn(""); setEditOut(""); }

  async function saveTimes(checkinId: number) {
    if (!editIn) { showToast({ text: "Time in is required.", ok: false }); return; }
    setSavingEdit(true);
    try {
      await api.patch(`/api/v1/checkin/${checkinId}`, {
        time_in: localInputToIso(editIn),
        time_out: editOut ? localInputToIso(editOut) : null,
      });
      showToast({ text: "Times updated.", ok: true });
      cancelEdit();
      loadRoster();
    } catch (e: unknown) {
      showToast({ text: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to update times.", ok: false });
    } finally { setSavingEdit(false); }
  }

  // ── Remove an accidentally checked-in attendee (permission-gated) ────────
  async function removeAttendee(r: RosterEntry) {
    if (!eventId) return;
    if (!confirm(`Remove ${r.first_name} ${r.last_name}'s check-in for this event? This deletes their attendance record and cannot be undone.`)) return;
    setBusy(r.member_id);
    try {
      await api.delete(`/api/v1/checkin/event/${eventId}/attendee/${r.member_id}`);
      showToast({ text: `Removed ${r.first_name} ${r.last_name}'s check-in.`, ok: true });
      await loadRoster();
    } catch (e: unknown) {
      showToast({ text: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to remove check-in.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  // ── Derived counts ───────────────────────────────────────────────────────
  const checkedInCount = roster.filter(r => r.checked_in).length;

  if (loading) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;
  if (!event)  return <div style={st.page}><p style={st.muted}>Event not found.</p></div>;

  return (
    <div style={st.page}>

      {/* Check-in blocked dialog — centered, dismiss with OK (so it's not missed
          at the bottom of a long roster). */}
      {failMsg && (
        <div style={st.failOverlay} onClick={() => setFailMsg(null)}>
          <div style={st.failModal} onClick={(e) => e.stopPropagation()}>
            <div style={st.failIcon}><X size={26} color="#fff" /></div>
            <div style={st.failTitle}>Cannot Check In</div>
            <div style={st.failText}>{failMsg}</div>
            <button style={st.failOk} onClick={() => setFailMsg(null)} autoFocus>OK</button>
          </div>
        </div>
      )}

      {/* Pick the check-in activity (pre-set to the event default for this member type). */}
      {activityPrompt && (
        <div style={st.failOverlay} onClick={() => setActivityPrompt(null)}>
          <div style={st.failModal} onClick={(e) => e.stopPropagation()}>
            <div style={st.failTitle}>Check in {activityPrompt.name}</div>
            <div style={st.failText}>What activity should we log for this visit?</div>
            <select
              style={st.confirmInput}
              value={activityPrompt.area}
              onChange={(e) => setActivityPrompt({ ...activityPrompt, area: e.target.value })}
              autoFocus
            >
              <option value="">— None (don’t log time) —</option>
              {activityAreas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <div style={st.confirmActions}>
              <button style={st.confirmCancel} onClick={() => setActivityPrompt(null)}>Cancel</button>
              <button style={st.confirmGo} onClick={() => {
                const p = activityPrompt; setActivityPrompt(null); postCheckIn(p.member, p.area);
              }}>
                Check In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check-out-all confirmation — must type "Confirm" so it can't be hit by accident. */}
      {confirmAll && (
        <div style={st.failOverlay} onClick={() => setConfirmAll(false)}>
          <div style={st.failModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...st.failIcon, background: "#e65100" }}><LogOutAll size={24} color="#fff" /></div>
            <div style={st.failTitle}>Check Out Everyone?</div>
            <div style={st.failText}>
              This will check out all {checkedInCount} {checkedInCount === 1 ? "person" : "people"} still
              checked in for this event. To confirm, type <strong>Confirm</strong> below.
            </div>
            <input
              style={st.confirmInput}
              value={confirmAllText}
              onChange={(e) => setConfirmAllText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && confirmAllText.trim().toLowerCase() === "confirm") runCheckOutAll(); }}
              placeholder="Type Confirm"
              autoFocus
            />
            <div style={st.confirmActions}>
              <button style={st.confirmCancel} onClick={() => setConfirmAll(false)}>Cancel</button>
              <button
                style={{ ...st.confirmGo, opacity: confirmAllText.trim().toLowerCase() === "confirm" ? 1 : 0.5 }}
                disabled={confirmAllText.trim().toLowerCase() !== "confirm"}
                onClick={runCheckOutAll}
              >
                <LogOutAll size={14} /> Check Out All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back — return to wherever you came from (the event, the check-in list, etc.) */}
      <button style={st.back} onClick={goBack}>
        <ArrowLeft size={15} /> Back
      </button>

      {/* Event header */}
      <div style={st.header}>
        <div style={st.eventMeta}>
          <span style={st.eventType}>{event.event_type ?? "Event"}</span>
          <h1 style={st.eventName}>{event.name}</h1>
          <div style={st.eventDetails}>
            <span>{event.event_date}{event.end_date && event.end_date !== event.event_date ? ` – ${event.end_date}` : ""}</span>
            {event.start_time && <span>· {fmtTime(event.start_time)}</span>}
            {event.location   && <span>· {event.location}</span>}
          </div>
          {(isMultiDay || !viewingToday) && (
            <div style={st.dayPicker}>
              <span style={st.dayPickerLabel}>Viewing day</span>
              <input
                type="date"
                style={st.dayInput}
                value={date}
                min={event.event_date}
                max={event.end_date && event.end_date !== event.event_date ? event.end_date : event.event_date}
                onChange={(e) => setDate(e.target.value)}
              />
              {!viewingToday && <span style={st.pastDayTag}>editing a past day</span>}
            </div>
          )}
        </div>
        <div style={st.statBox}>
          <Users size={20} color="#90caf9" />
          <div>
            <div style={st.statNum}>{checkedInCount}<span style={st.statOf}>/{roster.length}</span></div>
            <div style={st.statLabel}>Checked In</div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ ...st.toast, background: toast.ok ? "#2e7d32" : "#c62828" }}>
          {toast.ok && <CheckCircle size={16} />} {toast.text}
        </div>
      )}
      {toast?.warning && <div style={st.graceToast}>⏳ {toast.warning}</div>}

      {/* Search panel */}
      <div style={st.searchPanel}>
        <div style={st.searchLabel}><Search size={14} /> Walk-In / Search</div>
        <div style={st.searchRow}>
          <input
            style={st.searchInput}
            placeholder="Search by name or member ID…"
            value={search}
            onChange={e => { setSearch(e.target.value); if (!e.target.value) setSearchResults([]); }}
            onKeyDown={e => e.key === "Enter" && doSearch()}
          />
          <button style={st.searchBtn} onClick={doSearch} disabled={searching}>
            {searching ? "…" : "Search"}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div style={st.searchResults}>
            {searchResults.map(m => {
              const inRoster = roster.find(r => r.member_id === m.id);
              return (
                <div key={m.id} style={st.searchItem}>
                  <Avatar m={m} size={34} />
                  <div style={st.nameCol}>
                    <span style={st.name}>{m.last_name}, {m.first_name}</span>
                    <span style={st.sub}>{m.member_type} · #{m.member_number}</span>
                  </div>
                  {inRoster?.checked_in ? (
                    <button
                      style={st.coBtn}
                      disabled={busy === m.id}
                      onClick={() => doCheckOut(m.id)}
                    >
                      <LogOut size={13} /> {busy === m.id ? "…" : "Check Out"}
                    </button>
                  ) : (
                    <button
                      style={st.ciBtn}
                      disabled={busy === m.id}
                      onClick={() => doCheckIn(m)}
                    >
                      <LogIn size={13} /> {busy === m.id ? "…" : "Check In"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {search && !searching && searchResults.length === 0 && (
          <p style={st.muted}>No members found.</p>
        )}
      </div>

      {/* ── Roster ── */}
      {roster.length === 0 ? (
        <p style={st.muted}>No members have marked Attending for this event yet. Use the search above to check in walk-ins.</p>
      ) : (
        <div style={st.rosterWrap}>
          {/* Roster toolbar: title + Check Out All */}
          <div style={st.rosterToolbar}>
            <span style={st.rosterTitle}>Roster</span>
            <button
              style={{ ...st.checkoutAllBtn, ...(checkedInCount === 0 ? st.checkoutAllDisabled : {}) }}
              onClick={doCheckOutAll}
              disabled={checkedInCount === 0 || busy === -999}
              title="Check out everyone still checked in"
            >
              <LogOutAll size={14} /> {busy === -999 ? "Checking out…" : `Check Out All (${checkedInCount})`}
            </button>
          </div>
          {/* Header row */}
          <div style={st.rosterHeader}>
            <span style={{ flex: 1 }}>Member</span>
            <span style={{ width: 130, textAlign: "center" as const }}>Time In / Out</span>
            <span style={{ width: 120 }}></span>
          </div>

          {roster.map(r => {
            const isCheckedIn  = r.checked_in;
            const isCheckedOut = r.checked_out;
            const isBusy = busy === r.member_id;
            const hasRecord = r.checkin_id != null && r.checkin_id > 0;
            const editing = editId != null && editId === r.checkin_id;

            return (
              <div key={r.member_id} style={st.rowWrap}>
                <div
                  style={{
                    ...st.row,
                    background: isCheckedIn ? "#f0fdf4" : isCheckedOut ? "#fef2f2" : "#fff",
                    borderLeftColor: isCheckedIn ? "#2e7d32" : isCheckedOut ? "#c62828" : "#e2e8f0",
                  }}
                >
                  <Avatar m={r} size={38} />
                  <div style={st.nameCol}>
                    <span style={st.name}>{r.last_name}, {r.first_name}</span>
                    <span style={st.sub}>{r.member_type} · #{r.member_number}</span>
                    {r.section_label && r.section_label !== "Youth Members" && r.section_label !== "Mentors" && r.section_label !== "Parents" && r.section_label !== "Volunteers" && (
                      <span style={st.sectionTag}>{r.section_label}</span>
                    )}
                  </div>
                  <div style={st.timeCol}>
                    {r.time_in  && <span style={st.timeIn}><LogIn  size={10} /> {fmtTs(r.time_in)}</span>}
                    {r.time_out && <span style={st.timeOut}><LogOut size={10} /> {fmtTs(r.time_out)}</span>}
                    {canAdjust && hasRecord && !editing && (
                      <button style={st.editTimeBtn} onClick={() => startEdit(r)} title="Adjust times">
                        <Clock size={10} /> Edit
                      </button>
                    )}
                  </div>
                  {canManage && hasRecord && (
                    <button style={st.removeBtn} disabled={isBusy} onClick={() => removeAttendee(r)}
                      title="Remove this check-in (e.g. accidentally checked in)">
                      <Trash2 size={14} />
                    </button>
                  )}
                  <div style={st.btnCol}>
                    {isCheckedIn ? (
                      <button style={st.coBtn} disabled={isBusy} onClick={() => doCheckOut(r.member_id)}>
                        <LogOut size={13} /> {isBusy ? "…" : "Check Out"}
                      </button>
                    ) : (
                      <button style={st.ciBtn} disabled={isBusy} onClick={() => doCheckIn(r)}>
                        <LogIn size={13} /> {isBusy ? "…" : "Check In"}
                      </button>
                    )}
                  </div>
                </div>

                {editing && (
                  <div style={st.editPanel}>
                    <div style={st.editField}>
                      <label style={st.editLabel}>Time In</label>
                      <input type="datetime-local" style={st.editInput} value={editIn} onChange={(e) => setEditIn(e.target.value)} />
                    </div>
                    <div style={st.editField}>
                      <label style={st.editLabel}>Time Out <span style={st.editHint}>(blank = still here)</span></label>
                      <input type="datetime-local" style={st.editInput} value={editOut} onChange={(e) => setEditOut(e.target.value)} />
                    </div>
                    <button style={st.editSave} disabled={savingEdit} onClick={() => saveTimes(r.checkin_id!)}>
                      <Check size={14} /> {savingEdit ? "Saving…" : "Save"}
                    </button>
                    <button style={st.editCancel} onClick={cancelEdit}><X size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Avatar helper ────────────────────────────────────────────────────────────

function Avatar({ m, size }: { m: { first_name: string; last_name: string; photo_url?: string }; size: number }) {
  return (
    <div style={{ ...st.avatar, width: size, height: size, fontSize: size * 0.36 }}>
      {m.photo_url
        ? <img src={m.photo_url} style={st.avatarImg} alt="" />
        : <span>{(m.first_name?.[0] ?? "").toUpperCase()}{(m.last_name?.[0] ?? "").toUpperCase()}</span>
      }
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st: Record<string, React.CSSProperties> = {
  page:         { maxWidth: 860, margin: "0 auto", paddingBottom: 40 },
  back:         { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: "0 0 16px", fontWeight: 600 },

  header:       { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, padding: "20px 24px", background: "#1a3a5c", borderRadius: 12, color: "#fff" },
  eventMeta:    { flex: 1 },
  eventType:    { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1, color: "#90caf9", display: "block", marginBottom: 4 },
  eventName:    { fontSize: 22, fontWeight: 800, margin: "0 0 6px", color: "#fff" },
  eventDetails: { display: "flex", gap: 10, fontSize: 13, color: "#b3d1f5", flexWrap: "wrap" as const },
  dayPicker:    { display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" as const },
  dayPickerLabel: { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.5, color: "#90caf9" },
  dayInput:     { padding: "5px 8px", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, fontSize: 13, background: "rgba(255,255,255,0.12)", color: "#fff" },
  pastDayTag:   { fontSize: 11, fontWeight: 700, color: "#ffcc80", background: "rgba(230,81,0,0.25)", borderRadius: 10, padding: "2px 9px" },
  statBox:      { display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 18px", flexShrink: 0 },
  statNum:      { fontSize: 26, fontWeight: 800, color: "#fff", lineHeight: 1 },
  statOf:       { fontSize: 16, fontWeight: 400, color: "rgba(255,255,255,0.6)" },
  statLabel:    { fontSize: 11, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" as const, letterSpacing: 0.5, marginTop: 2 },

  toast:        { display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 15, marginBottom: 10 },
  graceToast:   { padding: "10px 16px", background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 8, color: "#e65100", fontSize: 13, marginBottom: 10 },

  searchPanel:  { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 18 },
  searchLabel:  { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  searchRow:    { display: "flex", gap: 8 },
  searchInput:  { flex: 1, padding: "9px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  searchBtn:    { padding: "9px 20px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  searchResults:{ marginTop: 10, display: "flex", flexDirection: "column" as const, gap: 5 },
  searchItem:   { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 },
  alreadyBadge: { fontSize: 12, fontWeight: 700, color: "#2e7d32", background: "#f0fdf4", padding: "4px 12px", borderRadius: 12, flexShrink: 0 },

  rosterWrap:   { display: "flex", flexDirection: "column" as const, gap: 4 },
  rosterToolbar:{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  rosterTitle:  { fontSize: 14, fontWeight: 800, color: "#1a3a5c" },
  checkoutAllBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#e65100", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  checkoutAllDisabled: { background: "#e0e0e0", color: "#999", cursor: "not-allowed" },
  rosterHeader: { display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 56px", fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 0.5 },

  rowWrap:      { display: "flex", flexDirection: "column" as const },
  row:          { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid #e2e8f0", borderLeft: "4px solid", borderRadius: 8, transition: "background 0.2s" },
  editTimeBtn:  { display: "inline-flex", alignItems: "center", gap: 3, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 10, fontWeight: 600, padding: "1px 0", marginTop: 1 },
  editPanel:    { display: "flex", alignItems: "flex-end", gap: 10, padding: "10px 14px", margin: "2px 0 4px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, flexWrap: "wrap" as const },
  editField:    { display: "flex", flexDirection: "column" as const, gap: 3 },
  editLabel:    { fontSize: 11, fontWeight: 700, color: "#555" },
  editHint:     { fontWeight: 400, color: "#aaa" },
  editInput:    { padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  editSave:     { display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  editCancel:   { display: "flex", alignItems: "center", padding: "7px 9px", background: "#fff", color: "#888", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer" },
  nameCol:      { flex: 1, display: "flex", flexDirection: "column" as const, gap: 1, minWidth: 0 },
  name:         { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  sub:          { fontSize: 11, color: "#888", textTransform: "capitalize" as const },
  sectionTag:   { fontSize: 10, color: "#1565c0", background: "#e3f2fd", borderRadius: 4, padding: "1px 6px", display: "inline-block", marginTop: 1 },
  timeCol:      { width: 130, display: "flex", flexDirection: "column" as const, gap: 2, flexShrink: 0 },
  timeIn:       { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#2e7d32", fontWeight: 600 },
  timeOut:      { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#888" },
  btnCol:       { width: 120, display: "flex", justifyContent: "flex-end" as const, flexShrink: 0 },
  removeBtn:    { display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 6, background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer" },

  avatar:       { borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, overflow: "hidden", flexShrink: 0 },
  avatarImg:    { width: "100%", height: "100%", objectFit: "cover" as const },

  // Buttons are colored by the member's CURRENT status, not the action: a
  // checked-in person shows green (Check Out), a not-checked-in/checked-out
  // person shows red (Check In).
  ciBtn:        { display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" as const },
  coBtn:        { display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" as const },

  muted:        { fontSize: 13, color: "#aaa", margin: "16px 0" },

  failOverlay:  { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  failModal:    { background: "#fff", borderRadius: 14, padding: "26px 28px", maxWidth: 440, width: "100%", textAlign: "center" as const, boxShadow: "0 12px 48px rgba(0,0,0,0.3)" },
  failIcon:     { width: 56, height: 56, borderRadius: "50%", background: "#c62828", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" },
  failTitle:    { fontSize: 20, fontWeight: 800, color: "#1a3a5c", marginBottom: 8 },
  failText:     { fontSize: 15, color: "#444", lineHeight: 1.55, marginBottom: 20 },
  failOk:       { padding: "11px 40px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 15 },
  confirmInput: { width: "100%", padding: "11px 12px", border: "2px solid #ccc", borderRadius: 8, fontSize: 16, textAlign: "center" as const, marginBottom: 16, boxSizing: "border-box" as const },
  confirmActions: { display: "flex", gap: 10 },
  confirmCancel: { flex: 1, padding: "11px 16px", background: "#f0f4f8", border: "1px solid #d6dde6", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 15, color: "#1a3a5c" },
  confirmGo:    { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 16px", background: "#e65100", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 15 },
};
