import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, Trash2, ClipboardList, CheckCircle, Circle, Plus, Users, X, UserPlus, Lock, Unlock } from "lucide-react";
import DOMPurify from "dompurify";
import { api } from "../../../core/api";
import { minutesApi, type Meeting, type EventHit } from "../api";
import RichTextEditor from "../../communications/components/RichTextEditor";

// Security #2: minutes/agenda are rich text authored by any group member (YLC groups auto-enrol
// youth). Sanitize on render as well as on write, so a stored payload can never reach the DOM.
const cleanHtml = (html: string) => DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });

interface MemberOpt { id: number; first_name: string; last_name: string; }

// Agenda/minutes are stored as HTML now, but older meetings hold plain text. Detect which,
// and convert plain text to HTML (preserving line breaks) when loading the editor.
const looksHtml = (v?: string | null) => !!v && /<[a-z!/][\s\S]*>/i.test(v);
function toEditorHtml(v?: string | null): string {
  const s = v ?? "";
  if (looksHtml(s)) return s;
  if (s.trim() === "") return "";
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack("/minutes");
  const [m, setM] = useState<Meeting | null>(null);
  // Who can edit this meeting is decided server-side (group-aware — for a private group
  // like the board it's members + admins), and returned on the meeting.
  const canManage = !!m?.can_manage;
  // A locked meeting is frozen; editing needs both manage rights AND an unlocked meeting.
  const locked = !!m?.locked;
  const editable = canManage && !locked;
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [guestSearch, setGuestSearch] = useState("");
  const [agenda, setAgenda] = useState("");
  const [notes, setNotes] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [agendaMsg, setAgendaMsg] = useState("");
  // new action item
  const [aDesc, setADesc] = useState("");
  const [aWhoIds, setAWhoIds] = useState<number[]>([]);
  const [aDue, setADue] = useState("");
  // event link search
  const [evSearch, setEvSearch] = useState("");
  const [evHits, setEvHits] = useState<EventHit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const data = await minutesApi.get(Number(id));
    setM(data); setNotes(toEditorHtml(data.notes)); setAgenda(toEditorHtml(data.agenda));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (m?.can_manage) api.get("/api/v1/members/?is_active=true&limit=500").then((r) => setMembers(r.data.members ?? [])).catch(() => {}); }, [m?.can_manage]);

  if (!m) return <p style={{ padding: 20, color: "#889" }}>Loading…</p>;
  const flash = (t: string) => { setSavedMsg(t); setTimeout(() => setSavedMsg(""), 2500); };

  async function saveNotes() { setM(await minutesApi.update(Number(id), { notes })); flash("Minutes saved."); }
  async function saveAgenda() { setM(await minutesApi.update(Number(id), { agenda })); setAgendaMsg("Agenda saved."); setTimeout(() => setAgendaMsg(""), 2500); }
  async function runEvSearch(term: string) {
    setEvSearch(term);
    if (term.trim().length < 2) { setEvHits([]); return; }
    setSearching(true);
    try { setEvHits(await minutesApi.searchEvents(term.trim())); } finally { setSearching(false); }
  }
  async function linkEvent(ev: EventHit) {
    // Link, and if the meeting has no date yet, adopt the event's date.
    const patch: { event_id: number; meeting_date?: string } = { event_id: ev.id };
    if (!m!.meeting_date && ev.event_date) patch.meeting_date = ev.event_date;
    setM(await minutesApi.update(Number(id), patch));
    setEvSearch(""); setEvHits([]);
  }
  async function unlinkEvent() { setM(await minutesApi.update(Number(id), { event_id: null })); }
  async function saveField(field: "title" | "meeting_date" | "location", value: string) {
    setM(await minutesApi.update(Number(id), { [field]: value }));
  }
  async function addAction() {
    if (!aDesc.trim()) return;
    setM(await minutesApi.addAction(Number(id), { description: aDesc, assignee_member_ids: aWhoIds, due_date: aDue || null }));
    setADesc(""); setAWhoIds([]); setADue("");
  }
  const toggleAWho = (mid: number) => setAWhoIds((prev) => (prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]));
  async function toggleAction(actionId: number, status: string) {
    setM(await minutesApi.updateAction(actionId, { status: status === "done" ? "open" : "done" }));
  }
  async function delAction(actionId: number) { setM(await minutesApi.deleteAction(actionId)); }
  async function delMeeting() {
    if (!confirm(`Delete "${m!.title}" and its action items?`)) return;
    await minutesApi.remove(Number(id)); navigate("/minutes");
  }
  async function lockMeeting() {
    if (!confirm("Lock these minutes? The agenda, minutes, attendees and action items will be frozen. An officer can unlock later if a correction is needed.")) return;
    setM(await minutesApi.lock(Number(id)));
  }
  async function unlockMeeting() { setM(await minutesApi.unlock(Number(id))); }

  // ── Attendance ──
  // Attendees are stored as member ids (known people) + guest names (outside folks).
  // Board members are ticked present; anyone attending who isn't on the roster is a guest.
  const presentIds = (m.attendees ?? []).filter((a) => a.member_id).map((a) => a.member_id as number);
  const guestNames = (m.attendees ?? []).filter((a) => !a.member_id && a.name).map((a) => a.name as string);
  const roster = m.group_members ?? [];
  const rosterIds = new Set(roster.map((g) => g.member_id));
  const presentSet = new Set(presentIds);
  const presentCount = roster.filter((g) => presentSet.has(g.member_id)).length;
  // Guests = attendees not on the roster (a member attending as a guest, or a named guest).
  const guests = (m.attendees ?? []).filter((a) => (a.member_id ? !rosterIds.has(a.member_id) : true));

  // Action items can be assigned to any member on the group roster (the YLC/board members —
  // whether or not they were ticked present), plus any outside member who attended as a guest.
  // A plain meeting with no roster falls back to its recorded member attendees, or to all
  // members when none are recorded. (Outside name-only guests can't own an action item.)
  const attendeeOptions = (m.attendees ?? [])
    .filter((a) => a.member_id).map((a) => ({ id: a.member_id as number, label: a.name ?? `#${a.member_id}` }));
  const hasRoster = roster.length > 0;
  const assigneeList = hasRoster
    ? [
        ...roster.map((g) => ({ id: g.member_id, label: g.name })),
        ...attendeeOptions.filter((o) => !rosterIds.has(o.id)),   // member-guests who attended
      ]
    : (attendeeOptions.length > 0
        ? attendeeOptions
        : members.map((mem) => ({ id: mem.id, label: `${mem.first_name} ${mem.last_name}` })));

  const saveAttendance = async (mIds: number[], gNames: string[]) => setM(await minutesApi.setAttendees(Number(id), mIds, gNames));
  async function toggleMember(mid: number) {
    const set = new Set(presentIds);
    set.has(mid) ? set.delete(mid) : set.add(mid);
    await saveAttendance([...set], guestNames);
  }
  async function addGuestMember(mid: number) {
    setGuestSearch("");
    if (!presentIds.includes(mid)) await saveAttendance([...presentIds, mid], guestNames);
  }
  async function addGuestName(name: string) {
    const n = name.trim(); setGuestSearch("");
    if (n && !guestNames.some((g) => g.toLowerCase() === n.toLowerCase())) await saveAttendance(presentIds, [...guestNames, n]);
  }
  async function removeGuest(a: { member_id: number | null; name: string | null }) {
    if (a.member_id) await saveAttendance(presentIds.filter((x) => x !== a.member_id), guestNames);
    else await saveAttendance(presentIds, guestNames.filter((g) => g !== a.name));
  }
  // Members matching the guest search, excluding board members + those already attending.
  const guestMatches = guestSearch.trim().length >= 2
    ? members.filter((mem) => !rosterIds.has(mem.id) && !presentIds.includes(mem.id)
        && `${mem.first_name} ${mem.last_name}`.toLowerCase().includes(guestSearch.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <button style={s.back} onClick={goBack}><ArrowLeft size={15} /> All minutes</button>
        <div style={{ display: "flex", gap: 8 }}>
          {m.can_lock && (locked
            ? <button style={s.unlockBtn} onClick={unlockMeeting}><Unlock size={13} /> Unlock</button>
            : <button style={s.lockBtn} onClick={lockMeeting}><Lock size={13} /> Lock minutes</button>)}
          {editable && <button style={s.del} onClick={delMeeting}><Trash2 size={13} /> Delete</button>}
        </div>
      </div>

      {locked && (
        <div style={s.lockedBanner}>
          <Lock size={15} />
          <span>These minutes are <strong>locked</strong>{m.locked_by ? ` by ${m.locked_by}` : ""}{m.locked_at ? ` on ${m.locked_at.slice(0, 10)}` : ""} — approved and frozen. {m.can_lock ? "Unlock to make a correction." : "Contact a board officer to make a change."}</span>
        </div>
      )}

      <div style={s.cols}>
      <div style={s.mainCol}>
      <div style={s.card}>
        {editable ? (
          <>
            <input style={s.titleIn} value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} onBlur={(e) => saveField("title", e.target.value)} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input style={s.metaIn} type="date" defaultValue={m.meeting_date ?? ""} onBlur={(e) => saveField("meeting_date", e.target.value)} />
              <input style={s.metaIn} placeholder="Location" defaultValue={m.location ?? ""} onBlur={(e) => saveField("location", e.target.value)} />
            </div>
          </>
        ) : (
          <><h1 style={s.h1}>{m.title}</h1><div style={s.sub}>{m.meeting_date ?? ""}{m.location ? ` · ${m.location}` : ""}</div></>
        )}

        {/* Linked event */}
        <div style={s.eventRow}>
          {m.event_id ? (
            <div style={s.linked}>
              <span style={s.linkedLabel}>🔗 Event:</span>
              <button style={s.eventLink} onClick={() => navigate(`/events/${m.event_id}`)}>{m.event_name}{m.event_date ? ` (${m.event_date})` : ""}</button>
              {editable &&<button style={s.unlink} onClick={unlinkEvent}>Unlink</button>}
            </div>
          ) : editable ? (
            <div style={{ position: "relative" }}>
              <input style={s.evSearchIn} placeholder="🔗 Link to a scheduled event — search by name…" value={evSearch} onChange={(e) => runEvSearch(e.target.value)} />
              {(evHits.length > 0 || searching) && (
                <div style={s.evResults}>
                  {searching && <div style={s.evHintRow}>Searching…</div>}
                  {evHits.map((ev) => (
                    <button key={ev.id} style={s.evHit} onClick={() => linkEvent(ev)}>
                      {ev.name}{ev.event_date ? <span style={s.evHitDate}> · {ev.event_date}</span> : null}
                    </button>
                  ))}
                  {!searching && evHits.length === 0 && evSearch.length >= 2 && <div style={s.evHintRow}>No events found.</div>}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {(m.created_by || m.updated_by) && (
          <div style={s.byline}>
            {m.created_by && <span>Created by {m.created_by}{m.created_at ? ` · ${m.created_at.slice(0, 10)}` : ""}</span>}
            {m.updated_by && <span>{m.created_by ? " · " : ""}Last edited by {m.updated_by}{m.updated_at ? ` · ${m.updated_at.slice(0, 10)}` : ""}</span>}
          </div>
        )}
      </div>

      {/* Agenda — prepared ahead of the meeting */}
      <div style={s.card}>
        <div style={s.sectionH}>Agenda</div>
        {editable ? (
          <>
            <RichTextEditor value={agenda} onChange={setAgenda} minHeight={140}
              placeholder="Prepare the agenda ahead of the meeting — topics to cover, in order…" />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button style={s.save} onClick={saveAgenda}>Save agenda</button>
              {agendaMsg && <span style={s.savedMsg}>{agendaMsg}</span>}
            </div>
          </>
        ) : m.agenda ? (
          looksHtml(m.agenda)
            ? <div style={s.richRead} dangerouslySetInnerHTML={{ __html: cleanHtml(m.agenda) }} />
            : <div style={s.notesRead}>{m.agenda}</div>
        ) : <span style={{ color: "#aaa" }}>No agenda posted.</span>}
      </div>

      {/* Notes */}
      <div style={s.card}>
        <div style={s.sectionH}>Minutes</div>
        {editable ? (
          <>
            <RichTextEditor value={notes} onChange={setNotes} minHeight={220}
              placeholder="Discussion, decisions, notes…" />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button style={s.save} onClick={saveNotes}>Save minutes</button>
              {savedMsg && <span style={s.savedMsg}>{savedMsg}</span>}
            </div>
          </>
        ) : m.notes ? (
          looksHtml(m.notes)
            ? <div style={s.richRead} dangerouslySetInnerHTML={{ __html: cleanHtml(m.notes) }} />
            : <div style={s.notesRead}>{m.notes}</div>
        ) : <span style={{ color: "#aaa" }}>No minutes recorded.</span>}
      </div>

      {/* Action items */}
      <div style={s.card}>
        <div style={s.sectionH}><ClipboardList size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Action Items</div>
        {m.action_items.length === 0 && <p style={s.muted}>No action items yet.</p>}
        {m.action_items.map((a) => (
          <div key={a.id} style={s.action}>
            <button style={s.checkBtn} disabled={!editable} onClick={() => toggleAction(a.id, a.status)} title="Toggle done">
              {a.status === "done" ? <CheckCircle size={18} color="#2e7d32" /> : <Circle size={18} color="#bbb" />}
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ ...s.actionDesc, ...(a.status === "done" ? { textDecoration: "line-through", color: "#999" } : {}) }}>{a.description}</div>
              <div style={s.actionMeta}>
                {a.assignees.length > 0
                  ? <span style={s.assignee}>{a.assignees.map((x) => x.name).join(", ")}</span>
                  : <span style={{ color: "#aaa" }}>Unassigned</span>}
                {a.due_date && <span> · due {a.due_date}</span>}
              </div>
            </div>
            {editable &&<button style={s.iconDel} onClick={() => delAction(a.id)}><Trash2 size={13} /></button>}
          </div>
        ))}

        {editable &&(
          <div style={s.addWrap}>
            <div style={s.addRow}>
              <input style={{ ...s.in, flex: 1, minWidth: 160 }} placeholder="New action item…" value={aDesc} onChange={(e) => setADesc(e.target.value)} />
              <input style={{ ...s.in, width: 150 }} type="date" value={aDue} onChange={(e) => setADue(e.target.value)} />
              <button style={s.addBtn} onClick={addAction}><Plus size={14} /> Add</button>
            </div>
            {/* Assign to one OR MORE attendees — click to toggle each. */}
            <div style={s.assignRow}>
              <span style={s.assignLbl}>Assign to:</span>
              {assigneeList.length === 0 ? (
                <span style={s.assignHint}>{hasRoster ? "Mark who's attending to assign action items." : "No attendees to assign."}</span>
              ) : assigneeList.map((p) => {
                const on = aWhoIds.includes(p.id);
                return (
                  <button key={p.id} type="button" style={{ ...s.assignChip, ...(on ? s.assignChipOn : {}) }} onClick={() => toggleAWho(p.id)}>
                    {on ? "✓ " : ""}{p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p style={s.hint}>Assign an action item to one or more attendees — it shows on each person's dashboard with the item and due date.</p>
      </div>
      </div>

      {/* Attendance — board roster checklist + guests */}
      <aside style={s.side}>
        <div style={s.card}>
          <div style={s.sectionH}><Users size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Attendance</div>

          {locked ? (
            <>
              <div style={s.attHead}><span>Attended</span><span style={s.attCount}>{m.attendees.length}</span></div>
              <div style={s.attList}>
                {m.attendees.length === 0 && <p style={s.muted}>No attendance recorded.</p>}
                {m.attendees.map((a) => (
                  <div key={a.id} style={{ ...s.attRow, ...s.attRowOn }}>
                    <CheckCircle size={16} color="#2e7d32" />
                    <span style={s.attName}>{a.name}{a.member_id ? "" : " (guest)"}</span>
                  </div>
                ))}
              </div>
              <p style={s.lockedNote}>Locked — this attendance stays fixed even if board membership changes.</p>
            </>
          ) : (<>
          {roster.length > 0 ? (
            <>
              <div style={s.attHead}>
                <span>Members</span>
                <span style={s.attCount}>{presentCount} of {roster.length} present</span>
              </div>
              <div style={s.attList}>
                {roster.map((g) => {
                  const present = presentSet.has(g.member_id);
                  return (
                    <button key={g.member_id} type="button" style={{ ...s.attRow, ...(present ? s.attRowOn : {}) }}
                      disabled={!editable} onClick={() => toggleMember(g.member_id)}>
                      {present ? <CheckCircle size={16} color="#2e7d32" /> : <Circle size={16} color="#c3cdd9" />}
                      <span style={s.attName}>{g.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p style={s.muted}>This meeting isn't tied to a member group, so there's no roster — add everyone as guests below.</p>
          )}

          {/* Guests / non-voting attendees */}
          <div style={{ ...s.attHead, marginTop: 14 }}>
            <span>Guests &amp; non‑voting</span>
            <span style={s.attCount}>{guests.length}</span>
          </div>
          <div style={s.attList}>
            {guests.length === 0 && <p style={s.muted}>None yet.</p>}
            {guests.map((a) => (
              <div key={a.id} style={s.guestRow}>
                <span style={s.attName}>{a.name}{a.member_id ? "" : " (guest)"}</span>
                {editable &&<button style={s.guestX} onClick={() => removeGuest(a)} title="Remove"><X size={13} /></button>}
              </div>
            ))}
          </div>

          {editable &&(
            <div style={{ position: "relative", marginTop: 8 }}>
              <input style={s.guestIn} placeholder="Add a guest — search or type a name…"
                value={guestSearch} onChange={(e) => setGuestSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && guestSearch.trim()) addGuestName(guestSearch); }} />
              {(guestMatches.length > 0 || guestSearch.trim().length >= 2) && (
                <div style={s.guestResults}>
                  {guestMatches.map((mem) => (
                    <button key={mem.id} style={s.guestHit} onClick={() => addGuestMember(mem.id)}>
                      <UserPlus size={13} /> {mem.first_name} {mem.last_name}
                    </button>
                  ))}
                  {guestSearch.trim().length >= 2 && (
                    <button style={{ ...s.guestHit, color: "#1565c0" }} onClick={() => addGuestName(guestSearch)}>
                      <Plus size={13} /> Add “{guestSearch.trim()}” as an outside guest
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          </>)}
        </div>
      </aside>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, padding: 0 },
  del: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #f0c2c2", color: "#c62828", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" },
  lockBtn: { display: "flex", alignItems: "center", gap: 5, background: "#1a3a5c", border: "1px solid #1a3a5c", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  unlockBtn: { display: "flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #cdd7e3", color: "#33475b", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  lockedBanner: { display: "flex", alignItems: "center", gap: 9, background: "#fff8e1", border: "1px solid #ffe0a3", color: "#7a5b12", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12, lineHeight: 1.45 },
  lockedNote: { fontSize: 11.5, color: "#8b98a6", marginTop: 8, fontStyle: "italic", lineHeight: 1.4 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginBottom: 14 },
  h1: { fontSize: 21, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { fontSize: 13, color: "#667", marginTop: 4 },
  titleIn: { fontSize: 20, fontWeight: 800, color: "#1a3a5c", border: "none", borderBottom: "1px solid #eef2f6", width: "100%", padding: "2px 0 6px", marginBottom: 10, outline: "none" },
  metaIn: { padding: "6px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  eventRow: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2f6" },
  byline: { marginTop: 10, fontSize: 11.5, color: "#98a2b3" },
  linked: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  linkedLabel: { fontSize: 12.5, color: "#667" },
  eventLink: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, fontWeight: 600, padding: 0 },
  unlink: { background: "none", border: "1px solid #cdd7e3", color: "#889", borderRadius: 6, padding: "3px 10px", fontSize: 11.5, cursor: "pointer" },
  evSearchIn: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, boxSizing: "border-box" },
  evResults: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, marginTop: 4, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 20, maxHeight: 240, overflowY: "auto" },
  evHit: { display: "block", width: "100%", textAlign: "left", padding: "8px 11px", background: "none", border: "none", borderBottom: "1px solid #f4f6fa", fontSize: 13, color: "#243", cursor: "pointer" },
  evHitDate: { color: "#889", fontSize: 12 },
  evHintRow: { padding: "8px 11px", fontSize: 12.5, color: "#889" },
  sectionH: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  notes: { width: "100%", padding: "10px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 },
  notesRead: { fontSize: 14, color: "#243", whiteSpace: "pre-wrap", lineHeight: 1.6 },
  richRead: { fontSize: 14, color: "#243", lineHeight: 1.6 },
  save: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  savedMsg: { color: "#2e7d32", fontSize: 13 },
  muted: { color: "#889", fontSize: 13.5 },
  action: { display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid #f4f6fa" },
  checkBtn: { background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 1 },
  actionDesc: { fontSize: 14, color: "#243" },
  actionMeta: { fontSize: 12, color: "#667", marginTop: 2 },
  assignee: { color: "#1565c0", fontWeight: 600 },
  iconDel: { background: "none", border: "none", color: "#c62828", cursor: "pointer" },
  addWrap: { marginTop: 12, borderTop: "1px solid #eef2f6", paddingTop: 12 },
  addRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  assignRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 },
  assignLbl: { fontSize: 12, fontWeight: 700, color: "#7a8899" },
  assignHint: { fontSize: 12, color: "#aab4c0", fontStyle: "italic" },
  assignChip: { padding: "4px 10px", borderRadius: 14, border: "1px solid #cdd7e3", background: "#fff", color: "#33475b", fontSize: 12.5, cursor: "pointer" },
  assignChipOn: { background: "#1a3a5c", borderColor: "#1a3a5c", color: "#fff", fontWeight: 600 },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  hint: { fontSize: 11.5, color: "#99a", marginTop: 10 },
  cols: { display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  mainCol: { flex: "1 1 560px", minWidth: 0 },
  side: { flex: "1 1 280px", position: "sticky", top: 12, alignSelf: "flex-start" },
  attHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, fontWeight: 800, color: "#7a8899", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  attCount: { fontSize: 11.5, fontWeight: 700, color: "#2e7d32", textTransform: "none", letterSpacing: 0 },
  attList: { display: "flex", flexDirection: "column", gap: 4 },
  attRow: { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", background: "#f7fafc", border: "1px solid #eef2f6", borderRadius: 7, cursor: "pointer", fontSize: 13, color: "#33475b" },
  attRowOn: { background: "#eef7f0", borderColor: "#c5e6cd", color: "#1a3a2c", fontWeight: 600 },
  attName: { flex: 1 },
  guestRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#fff8e1", border: "1px solid #ffe6a3", borderRadius: 7, fontSize: 13, color: "#5a4b1c" },
  guestX: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 0, display: "inline-flex" },
  guestIn: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 12.5, boxSizing: "border-box" },
  guestResults: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, marginTop: 4, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 20, overflow: "hidden" },
  guestHit: { display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", padding: "8px 11px", background: "none", border: "none", borderBottom: "1px solid #f4f6fa", fontSize: 12.5, color: "#243", cursor: "pointer" },
};
