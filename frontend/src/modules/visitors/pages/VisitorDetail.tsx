import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { visitorsApi, type Visitor } from "../api";
import { waitlistApi, type ProgramNight } from "../waitlistApi";
import { nightPrefsApi, type NightPrefsData } from "../../../core/nightPrefsApi";
import { rolesApi, type AdultRoleRecord } from "../../roles/api";
import { schoolsApi, type School } from "../schoolsApi";
import { mentorProspectsApi } from "../mentorProspectsApi";
import { programsApi, type Program } from "../../enrollment/api";
import { useAuth } from "../../../core/AuthContext";
import { formatDate, currentSeasonLabel } from "../../../core/dateUtils";
import { MessageHistoryPanel } from "../../communications";
import {
  ArrowLeft, UserPlus, Mail, Phone, MapPin,
  CheckCircle, Clock, XCircle, Users, Trash2, Edit2, Archive, ArchiveRestore,
} from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const STATUS_COLORS: Record<string, string> = {
  new: "#1565c0", visited: "#2e7d32", follow_up: "#f57c00", visit_scheduled: "#00838f",
  waitlisted: "#c62828", not_interested: "#757575", enrolled: "#1b5e20",
};

// "Schedule a Visit" opens the inline date picker (handled specially, not a plain
// status change) — reused across several statuses.
const SCHEDULE_ACTION = { label: "Schedule a Visit", nextStatus: "visit_scheduled", color: "#00838f", icon: "📅" };

// Lifecycle action buttons per current status
const NEXT_ACTIONS: Record<string, { label: string; nextStatus: string; color: string; icon: string }[]> = {
  new: [
    SCHEDULE_ACTION,
    { label: "Mark as Visited", nextStatus: "visited", color: "#2e7d32", icon: "✓" },
    { label: "Not Interested", nextStatus: "not_interested", color: "#757575", icon: "✗" },
  ],
  visited: [
    { label: "Add to Follow-Up", nextStatus: "follow_up", color: "#f57c00", icon: "📋" },
    { label: "Add to Waitlist", nextStatus: "waitlisted", color: "#c62828", icon: "⏳" },
    { label: "Not Interested", nextStatus: "not_interested", color: "#757575", icon: "✗" },
  ],
  follow_up: [
    SCHEDULE_ACTION,
    { label: "Add to Waitlist", nextStatus: "waitlisted", color: "#c62828", icon: "⏳" },
    { label: "Ready to Enroll", nextStatus: "visited", color: "#2e7d32", icon: "→" },
    { label: "No Longer Interested", nextStatus: "not_interested", color: "#757575", icon: "✗" },
  ],
  visit_scheduled: [
    { label: "Mark as Visited", nextStatus: "visited", color: "#2e7d32", icon: "✓" },
    { label: "Back to Follow-Up", nextStatus: "follow_up", color: "#f57c00", icon: "📋" },
    { label: "Not Interested", nextStatus: "not_interested", color: "#757575", icon: "✗" },
  ],
  waitlisted: [
    SCHEDULE_ACTION,
    { label: "Spot Available — Move to Follow-Up", nextStatus: "follow_up", color: "#f57c00", icon: "📋" },
    { label: "No Longer Interested", nextStatus: "not_interested", color: "#757575", icon: "✗" },
  ],
  not_interested: [
    { label: "Re-open as Follow-Up", nextStatus: "follow_up", color: "#f57c00", icon: "↩" },
  ],
  enrolled: [],
};

// Follow-up email templates shown when status changes
const FOLLOWUP_TEMPLATES: Record<string, { subject: string; body: string }> = {
  not_interested: {
    subject: "Thank you for visiting the Tulsa Robotics Center!",
    body: `Dear [Guardian Name],\n\nThank you for taking the time to learn about the Tulsa Robotics Center. We enjoyed meeting [Youth Name] and hope to see you at future events!\n\nIf you ever change your mind, we'd love to have you join our program.\n\nWarm regards,\nThe TRC Team`,
  },
  follow_up: {
    subject: "Stay Connected with the Tulsa Robotics Center",
    body: `Dear [Guardian Name],\n\nThank you for your interest in our program! We'd love to keep you informed about upcoming events like our Open Houses, Information Sessions, and the Tulsa Maker Faire.\n\nWe'll be in touch when spots become available.\n\nWarm regards,\nThe TRC Team`,
  },
  waitlisted: {
    subject: "You're on the TRC Waitlist!",
    body: `Dear [Guardian Name],\n\nThank you for your interest in enrolling [Youth Name] in our program. We currently have a waitlist for [Program Name], and we've added you to it.\n\nWhen a spot opens up, we'll reach out to you directly. In the meantime, we'd love to see you at our open events!\n\nWarm regards,\nThe TRC Team`,
  },
  visited: {
    subject: "Ready to Join the Tulsa Robotics Center?",
    body: `Dear [Guardian Name],\n\nIt was wonderful meeting [Youth Name] at the TRC! We'd love to have them join our program.\n\nTo get started, please visit [enrollment link] to complete registration. If you have any questions, reply to this email or call us.\n\nWarm regards,\nThe TRC Team`,
  },
};

export default function VisitorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack("/visitors");
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [wlOpen, setWlOpen] = useState(false);
  const [wlNights, setWlNights] = useState<ProgramNight[]>([]);
  const [wl, setWl] = useState({ available: [] as number[], preferred: "", sibling: false, parentMentor: false });
  const { user, hasRole } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const blankEdit = { first_name: "", middle_name: "", last_name: "", birthday: "", email: "", phone: "", guardian1_name: "", guardian1_phone: "", guardian1_email: "", address_line1: "", address_line2: "", city: "", state: "", zip_code: "" };
  const [ed, setEd] = useState(blankEdit);
  const [adults, setAdults] = useState<AdultRoleRecord[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [ix, setIx] = useState({ method: "call", notes: "" });
  const [scheduling, setScheduling] = useState(false);
  const [visitDate, setVisitDate] = useState("");
  const [markingDone, setMarkingDone] = useState(false);
  const [markingVisited, setMarkingVisited] = useState(false);
  const [visitedMsg, setVisitedMsg] = useState("");
  const [showTemplate, setShowTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [emailCc, setEmailCc] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [recruiting, setRecruiting] = useState(false);
  const [recruitErr, setRecruitErr] = useState("");
  const [intake, setIntake] = useState<NightPrefsData | null>(null);
  const [edNight, setEdNight] = useState({ available: [] as number[], preferred: "", flexible: false, parentMentor: false });

  useEffect(() => {
    visitorsApi.get(parseInt(id!))
      .then((v) => { setVisitor(v); setNotes(v.additional_info ?? ""); })
      .finally(() => setLoading(false));
    rolesApi.listAdults().then(setAdults).catch(() => {});
    schoolsApi.list().then(setSchools).catch(() => {});
    programsApi.list().then(setPrograms).catch(() => {});
  }, [id]);

  // Surface the night preference captured at intake on the profile itself (it was
  // previously only loaded to prefill the waitlist dialog).
  useEffect(() => {
    if (!visitor?.program_interest_id) { setIntake(null); return; }
    nightPrefsApi.get({ program_id: visitor.program_interest_id, season: currentSeasonLabel(), visitor_id: visitor.id })
      .then(setIntake).catch(() => setIntake(null));
  }, [visitor?.id, visitor?.program_interest_id]);

  async function patch(data: Record<string, unknown>) { if (visitor) setVisitor(await visitorsApi.update(visitor.id, data)); }
  async function addIx() {
    if (!visitor || (!ix.notes.trim() && !ix.method)) return;
    setVisitor(await visitorsApi.addInteraction(visitor.id, ix));
    setIx({ method: "call", notes: "" });
  }
  async function delIx(iid: number) { if (visitor && confirm("Delete this log entry?")) setVisitor(await visitorsApi.deleteInteraction(iid)); }
  async function recruitMentor() {
    if (!visitor || recruiting) return;
    setRecruiting(true); setRecruitErr("");
    const youthName = [visitor.first_name, visitor.last_name].filter(Boolean).join(" ").trim();
    try {
      const p = await mentorProspectsApi.create({
        name: visitor.guardian1_name || (youthName ? `${youthName}'s parent` : "Parent"),
        email: visitor.guardian1_email || null, phone: visitor.guardian1_phone || null,
        source: "parent", from_visitor_id: visitor.id,
      });
      navigate(`/visitors/mentors?highlight=${p.id}`);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRecruitErr(detail || "Couldn't add to the mentor pipeline. Please try again or contact an administrator.");
      setRecruiting(false);
    }
  }

  async function updateStatus(nextStatus: string) {
    if (!visitor) return;
    setUpdating(true);
    try {
      const updated = await visitorsApi.update(visitor.id, { status: nextStatus });
      setVisitor(updated);
      if (FOLLOWUP_TEMPLATES[nextStatus]) {
        const tmpl = FOLLOWUP_TEMPLATES[nextStatus];
        setShowTemplate({
          subject: tmpl.subject,
          body: tmpl.body
            .replace("[Guardian Name]", visitor.guardian1_name ?? "Parent/Guardian")
            .replace(/\[Youth Name\]/g, visitor.full_name)
            .replace("[Program Name]", visitor.program_interest_name ?? "our program"),
        });
      }
    } finally {
      setUpdating(false);
    }
  }

  async function sendVisitorEmail() {
    if (!visitor || !showTemplate) return;
    setSendingEmail(true); setEmailMsg("");
    try {
      const cc = emailCc.split(",").map((s) => s.trim()).filter(Boolean);
      const updated = await visitorsApi.sendEmail(visitor.id, { subject: showTemplate.subject, body: showTemplate.body, cc });
      setVisitor(updated);
      setEmailMsg("✓ Email sent" + (cc.length ? ` (cc: ${cc.join(", ")})` : "") + ".");
      setEmailCc("");
      setTimeout(() => { setShowTemplate(null); setEmailMsg(""); }, 1800);
    } catch (e) {
      setEmailMsg("⚠ " + ((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not send the email."));
    } finally { setSendingEmail(false); }
  }

  // "Schedule a Visit" opens an inline date picker, then sets the status AND the
  // scheduled visit date together so the date is always captured/tracked.
  function startSchedule() {
    if (!visitor) return;
    setVisitDate(visitor.scheduled_visit_date ?? "");
    setScheduling(true);
  }
  async function confirmSchedule() {
    if (!visitor || !visitDate) return;
    setUpdating(true);
    try {
      setVisitor(await visitorsApi.update(visitor.id, { status: "visit_scheduled", scheduled_visit_date: visitDate }));
      setScheduling(false);
    } finally { setUpdating(false); }
  }

  // One-click "Mark follow-up done": logs the completion and clears the follow-up date.
  async function markFollowupDone() {
    if (!visitor) return;
    setMarkingDone(true);
    try { setVisitor(await visitorsApi.completeFollowup(visitor.id)); }
    finally { setMarkingDone(false); }
  }

  // One-click "Mark visited today": logs a dated in-person visit and advances the
  // pipeline to Visited when the visitor is still at an early stage. Works from any
  // status (a further-along visitor keeps their stage; the visit is still logged).
  async function markVisitedToday() {
    if (!visitor) return;
    setMarkingVisited(true);
    try {
      setVisitor(await visitorsApi.markVisitedToday(visitor.id));
      setVisitedMsg("✓ Visit recorded for today.");
      setTimeout(() => setVisitedMsg(""), 4000);
    } finally { setMarkingVisited(false); }
  }

  async function saveNotes() {
    if (!visitor) return;
    setSavingNotes(true);
    try {
      const updated = await visitorsApi.update(visitor.id, { additional_info: notes });
      setVisitor(updated);
      setEditNotes(false);
    } finally {
      setSavingNotes(false);
    }
  }

  function handleConvert() {
    if (!visitor) return;
    // Navigate to Add Member with visitor data pre-filled via query param
    navigate(`/members/add?visitor_id=${visitor.id}`);
  }

  const isSysAdmin = !!user?.roles?.includes("System Administrator");
  const canEdit = hasRole("Admin", "System Administrator", "Mentor");
  function openEdit() {
    if (!visitor) return;
    setEd({
      first_name: visitor.first_name ?? "", middle_name: visitor.middle_name ?? "", last_name: visitor.last_name ?? "",
      birthday: visitor.birthday?.split("T")[0] ?? "", email: visitor.email ?? "", phone: visitor.phone ?? "",
      guardian1_name: visitor.guardian1_name ?? "", guardian1_phone: visitor.guardian1_phone ?? "", guardian1_email: visitor.guardian1_email ?? "",
      address_line1: visitor.address_line1 ?? "", address_line2: visitor.address_line2 ?? "", city: visitor.city ?? "", state: visitor.state ?? "", zip_code: visitor.zip_code ?? "",
    });
    const pref = intake?.preference ?? null;
    setEdNight({
      available: pref?.available_night_ids ?? [],
      preferred: pref?.preferred_night_id ? String(pref.preferred_night_id) : "",
      flexible: !!pref?.flexible,
      parentMentor: !!visitor.parent_mentor_interest,
    });
    setEditOpen(true);
  }
  const editHasNights = !!intake && intake.nights.length > 0;
  async function saveEdit() {
    if (!visitor) return;
    const updated = await visitorsApi.update(visitor.id, { ...ed, parent_mentor_interest: edNight.parentMentor });
    // Night preference lives in night_preferences, not on the visitor row — save it
    // separately when the program of interest has meeting nights (FLL).
    if (editHasNights && visitor.program_interest_id) {
      await nightPrefsApi.save({
        program_id: visitor.program_interest_id, season: currentSeasonLabel(), visitor_id: visitor.id,
        available_night_ids: edNight.available, preferred_night_id: edNight.preferred ? Number(edNight.preferred) : null,
        flexible: edNight.flexible, source: "profile",
      });
      nightPrefsApi.get({ program_id: visitor.program_interest_id, season: currentSeasonLabel(), visitor_id: visitor.id })
        .then(setIntake).catch(() => {});
    }
    setVisitor(updated);
    setEditOpen(false);
  }
  async function deleteContact() {
    if (!visitor) return;
    if (!confirm(`Permanently delete ${visitor.full_name}? This removes their inquiry, interaction log, and any waitlist entry. This cannot be undone.`)) return;
    await visitorsApi.deleteVisitor(visitor.id);
    navigate("/visitors");
  }
  async function toggleArchive() {
    if (!visitor) return;
    if (!visitor.is_archived && !confirm(`Archive ${visitor.full_name}? They'll be hidden from the visitor list, search, status counts, and follow-up reminders. You can un-archive them later.`)) return;
    setVisitor(visitor.is_archived ? await visitorsApi.unarchive(visitor.id) : await visitorsApi.archive(visitor.id));
  }

  const season = currentSeasonLabel();
  async function openWaitlist() {
    if (!visitor?.program_interest_id) return;
    setWlNights(await waitlistApi.nights(visitor.program_interest_id, season));
    // Prefill from the night preference already captured at intake (or the family
    // default) so staff don't have to ask again. Falls back to blanks.
    let pref = { available: [] as number[], preferred: "" };
    try {
      const d = await nightPrefsApi.get({ program_id: visitor.program_interest_id, season, visitor_id: visitor.id });
      const src = d.preference ?? d.family_default;
      if (src) pref = {
        available: src.available_night_ids ?? [],
        preferred: src.preferred_night_id ? String(src.preferred_night_id) : "",
      };
    } catch { /* no preference yet — leave blank */ }
    setWl({ ...pref, sibling: false, parentMentor: !!visitor.parent_mentor_interest });
    setWlOpen(true);
  }
  async function submitWaitlist() {
    if (!visitor?.program_interest_id) return;
    await waitlistApi.add({
      visitor_id: visitor.id, program_id: visitor.program_interest_id, season,
      available_night_ids: wl.available, preferred_night_id: wl.preferred || null,
      sibling_of_member: wl.sibling, parent_mentor_interest: wl.parentMentor,
    });
    if (visitor.status !== "waitlisted") { const u = await visitorsApi.update(visitor.id, { status: "waitlisted" }); setVisitor(u); }
    setWlOpen(false);
    navigate("/visitors/waitlist");
  }

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (!visitor) return <div style={styles.center}>Visitor not found.</div>;

  const actions = NEXT_ACTIONS[visitor.status] ?? [];
  const isEnrolled = visitor.status === "enrolled";

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          <ArrowLeft size={14} /> Visitor Management
        </button>
        {!isEnrolled && (
          <div style={{ display: "flex", gap: 8 }}>
            {visitor.program_interest_id && (
              <button style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#c62828", border: "1px solid #f3cfcf", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }} onClick={openWaitlist}>
                <Users size={14} /> Place on Waitlist
              </button>
            )}
            <button style={styles.convertBtn} onClick={handleConvert}>
              <UserPlus size={14} /> Convert to Member
            </button>
          </div>
        )}
        {isEnrolled && visitor.converted_member_id && (
          <button
            style={styles.viewMemberBtn}
            onClick={() => navigate(`/members/${visitor.converted_member_id}`)}
          >
            <Users size={14} /> View Member Profile
          </button>
        )}
        {canEdit && (
          <button
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            title="Edit this contact's details"
            onClick={openEdit}
          ><Edit2 size={14} /> Edit</button>
        )}
        {canEdit && (
          <button
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, padding: "8px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            title="Send this visitor an email (with optional CC)"
            onClick={() => { setEmailMsg(""); setShowTemplate({ subject: "", body: "" }); }}
          >✉ Email</button>
        )}
        {canEdit && (
          <button
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#6b5b00", border: "1px solid #e6dca8", borderRadius: 7, padding: "8px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            title={visitor.is_archived ? "Restore this contact to the visitor list" : "Archive this contact (hide from list, search, and reminders)"}
            onClick={toggleArchive}
          >{visitor.is_archived ? <><ArchiveRestore size={14} /> Un-archive</> : <><Archive size={14} /> Archive</>}</button>
        )}
        {isSysAdmin && (
          <button
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#c62828", border: "1px solid #f3cfcf", borderRadius: 7, padding: "8px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            title="Permanently delete this contact (System Administrator)"
            onClick={deleteContact}
          ><Trash2 size={14} /> Delete</button>
        )}
      </div>

      {/* Email template popup */}
      {showTemplate && (
        <div style={styles.templateBanner}>
          <div style={styles.templateHeader}>
            <strong>📧 Email visitor</strong>
            <button style={styles.closeBannerBtn} onClick={() => { setShowTemplate(null); setEmailMsg(""); }}>✕</button>
          </div>
          <div style={{ fontSize: 12.5, color: "#556", marginBottom: 6 }}>
            To: <strong>{visitor.guardian1_email || visitor.email || "— no email on file —"}</strong>
          </div>
          <input
            style={styles.emailField}
            placeholder="CC (comma-separated emails)"
            value={emailCc}
            onChange={(e) => setEmailCc(e.target.value)}
          />
          <input
            style={styles.emailField}
            placeholder="Subject"
            value={showTemplate.subject}
            onChange={(e) => setShowTemplate((t) => t ? { ...t, subject: e.target.value } : t)}
          />
          <textarea
            style={{ ...styles.emailField, minHeight: 150, resize: "vertical" as const, fontFamily: "inherit" }}
            value={showTemplate.body}
            onChange={(e) => setShowTemplate((t) => t ? { ...t, body: e.target.value } : t)}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
            <button
              style={{ ...styles.actionBtn, borderColor: "#1565c0", color: "#1565c0", fontWeight: 700, opacity: (sendingEmail || !(visitor.guardian1_email || visitor.email)) ? 0.6 : 1 }}
              disabled={sendingEmail || !(visitor.guardian1_email || visitor.email)}
              onClick={sendVisitorEmail}
            >{sendingEmail ? "Sending…" : "Send email"}</button>
            {emailMsg && <span style={{ fontSize: 12.5, color: emailMsg.startsWith("✓") ? "#2e7d32" : "#c62828" }}>{emailMsg}</span>}
          </div>
        </div>
      )}

      {/* Follow-up / pipeline card */}
      {!isEnrolled && (
        <div style={pipe.card}>
          {visitor.parent_mentor_interest && (
            <div style={{ background: "#ede7f6", borderRadius: 7, padding: "8px 12px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#5e35b1", fontSize: 13, fontWeight: 600, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 180 }}>🙋 A parent here is open to mentoring — great mentor-recruiting lead, and it raises this youth's waitlist priority.</span>
                <button disabled={recruiting} style={{ background: recruiting ? "#9e8bc4" : "#5e35b1", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: recruiting ? "default" : "pointer", whiteSpace: "nowrap" }} onClick={recruitMentor}>{recruiting ? "Adding…" : "Add to mentor pipeline"}</button>
              </div>
              {recruitErr && <div style={{ marginTop: 8, color: "#c62828", fontSize: 12.5, fontWeight: 500 }}>{recruitErr}</div>}
            </div>
          )}
          <div style={pipe.row}>
            <div style={pipe.field}>
              <span style={pipe.label}>Follow-up owner</span>
              <div style={pipe.ownerRow}>
                <select style={pipe.sel} value={visitor.owner_id ?? ""} onChange={(e) => patch({ owner_id: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {adults.map((a) => <option key={a.member_id} value={a.member_id}>{a.first_name} {a.last_name}</option>)}
                </select>
                {user && visitor.owner_id !== user.id && <button style={pipe.meBtn} onClick={() => patch({ owner_id: user.id })}>Assign to me</button>}
              </div>
            </div>
            <div style={pipe.field}>
              <span style={pipe.label}>Next follow-up</span>
              <input type="date" style={pipe.sel} value={visitor.next_follow_up_date ?? ""} onChange={(e) => patch({ next_follow_up_date: e.target.value || null })} />
              {visitor.next_follow_up_date && (
                <button style={pipe.doneBtn} onClick={markFollowupDone} disabled={markingDone}>
                  {markingDone ? "Saving…" : "✓ Mark follow-up done"}
                </button>
              )}
            </div>
            <div style={pipe.field}>
              <span style={pipe.label}>Scheduled visit</span>
              <input type="date" style={{ ...pipe.sel, ...(visitor.status === "visit_scheduled" && !visitor.scheduled_visit_date ? { borderColor: "#e65100", background: "#fff3e0" } : {}) }}
                value={visitor.scheduled_visit_date ?? ""} onChange={(e) => patch({ scheduled_visit_date: e.target.value || null })} />
              {visitor.status === "visit_scheduled" && !visitor.scheduled_visit_date && (
                <span style={{ fontSize: 11, color: "#e65100", marginTop: 3 }}>Set the visit date so it's tracked.</span>
              )}
            </div>
          </div>
          <div style={pipe.row}>
            <div style={pipe.field}>
              <span style={pipe.label}>Program of interest</span>
              <select style={pipe.sel} value={visitor.program_interest_id ?? ""} onChange={(e) => patch({ program_interest_id: e.target.value || null })}>
                <option value="">— Not set —</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={pipe.field}>
              <span style={pipe.label}>Referred by school</span>
              <select style={pipe.sel} value={visitor.school_id ?? ""} onChange={(e) => patch({ school_id: e.target.value || null })}>
                <option value="">— None / unknown —</option>
                {schools.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
              </select>
            </div>
          </div>

          <div style={pipe.label}>Interaction log</div>
          <div style={pipe.ixAdd}>
            <select style={pipe.ixSel} value={ix.method} onChange={(e) => setIx({ ...ix, method: e.target.value })}>
              {["call", "email", "text", "in_person", "event", "other"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input style={pipe.ixIn} placeholder="What happened? (notes)" value={ix.notes} onChange={(e) => setIx({ ...ix, notes: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addIx()} />
            <button style={pipe.ixBtn} onClick={addIx}>Log</button>
          </div>
          {(visitor.interactions ?? []).map((it) => (
            <div key={it.id} style={pipe.ixRow}>
              <span style={pipe.ixMethod}>{it.method}</span>
              <span style={pipe.ixNotes}>{it.notes}</span>
              <span style={pipe.ixMeta}>{it.occurred_at}{it.member_name ? ` · ${it.member_name}` : ""}</span>
              <button style={pipe.ixDel} onClick={() => delIx(it.id)}>✕</button>
            </div>
          ))}
          {(visitor.interactions ?? []).length === 0 && <p style={pipe.muted}>No interactions logged yet.</p>}
        </div>
      )}

      {/* Profile card */}
      <div style={styles.profileCard}>
        <div style={styles.profileLeft}>
          <div style={styles.avatar}>{visitor.first_name[0]}{visitor.last_name[0]}</div>
          <div>
            <h1 style={styles.name}>{visitor.full_name}</h1>
            <div style={styles.metaRow}>
              {visitor.is_archived && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#8a7a2e", borderRadius: 8, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.5 }}>Archived</span>}
              <StatusBadge status={visitor.status} label={visitor.status_label} />
              <span style={styles.visitorNum}>Visitor #{visitor.visitor_number}</span>
              <span style={styles.inquiryDate}>
                Inquiry: {new Date(visitor.inquiry_date).toLocaleDateString()}
              </span>
            </div>
            {visitor.program_interest_name && (
              <div style={styles.programInterest}>
                Interested in: <strong>{visitor.program_interest_name}</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={styles.bodyGrid}>
        {/* Left: Info */}
        <div>
          <InfoCard title="Youth Contact">
            <InfoRow icon={<Phone size={13} />} label="Phone" value={visitor.phone} />
            <InfoRow icon={<Mail size={13} />} label="Email" value={visitor.email} />
            {visitor.birthday && <InfoRow label="Birthday" value={formatDate(visitor.birthday)} />}
            {visitor.grade_label && <InfoRow label="Grade" value={visitor.grade_label} />}
            {visitor.address_line1 && (
              <InfoRow icon={<MapPin size={13} />} label="Address" value={
                [visitor.address_line1, visitor.address_line2,
                  visitor.city && `${visitor.city}, ${visitor.state} ${visitor.zip_code}`]
                  .filter(Boolean).join(" · ")
              } />
            )}
          </InfoCard>

          <InfoCard title="Parent / Guardian">
            <InfoRow label="Name" value={visitor.guardian1_name} />
            <InfoRow icon={<Phone size={13} />} label="Phone" value={visitor.guardian1_phone} />
            <InfoRow icon={<Mail size={13} />} label="Email" value={visitor.guardian1_email} />
          </InfoCard>

          <InfoCard title="Program & Availability">
            {(() => {
              const nm = new Map((intake?.nights ?? []).map((n) => [n.id, n.name]));
              const pref = intake?.preference ?? null;
              // Show the night rows for any program that HAS meeting nights (i.e. FLL) or
              // that already has a preference on file — not gated on `applies`, which needs a
              // known birthday in the age band and so hid the rows for youth with no DOB.
              const showNights = !!intake && (intake.nights.length > 0 || !!pref);
              const preferred = pref?.preferred_night_id ? (nm.get(pref.preferred_night_id) ?? "—") : "Not specified";
              const avail = pref?.available_night_ids?.length
                ? pref.available_night_ids.map((i) => nm.get(i) ?? `#${i}`).join(", ")
                : "Not specified";
              return (
                <>
                  {showNights && <InfoRow label="Preferred night" value={preferred} />}
                  {showNights && <InfoRow label="Available nights" value={avail} />}
                  {showNights && <InfoRow label="Flexible on nights" value={pref?.flexible ? "Yes" : "No"} />}
                  {showNights && pref?.siblings_together && <InfoRow label="Keep siblings together" value="Yes" />}
                  <InfoRow label="Parent willing to mentor" value={visitor.parent_mentor_interest ? "Yes" : "No"} />
                </>
              );
            })()}
          </InfoCard>

          <InfoCard title="How They Found Us">
            <InfoRow label="Source" value={visitor.referral_source_label} />
            {visitor.referral_detail && <InfoRow label="Details" value={visitor.referral_detail} />}
          </InfoCard>

          {/* Notes */}
          <InfoCard title="Notes">
            {editNotes ? (
              <>
                <textarea
                  style={styles.textarea}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  autoFocus
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={styles.saveNotesBtn} onClick={saveNotes} disabled={savingNotes}>
                    {savingNotes ? "Saving…" : "Save Notes"}
                  </button>
                  <button style={styles.cancelNotesBtn} onClick={() => { setEditNotes(false); setNotes(visitor.additional_info ?? ""); }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={styles.notesText}>{visitor.additional_info || "No notes yet."}</p>
                <button style={styles.editNotesBtn} onClick={() => setEditNotes(true)}>Edit Notes</button>
              </>
            )}
          </InfoCard>
        </div>

        {/* Right: Lifecycle actions */}
        <div>
          <InfoCard title="Lifecycle Actions">
            {!isEnrolled && (
              <div style={{ marginBottom: 14 }}>
                <button style={styles.visitedTodayBtn} onClick={markVisitedToday} disabled={markingVisited}
                  title="Log a visit for today and move them to Visited">
                  {markingVisited ? "Saving…" : "✓ Mark visited today"}
                </button>
                {visitedMsg && <p style={styles.visitedMsg}>{visitedMsg}</p>}
              </div>
            )}
            <LifecycleTimeline status={visitor.status} />

            {!isEnrolled && actions.length > 0 && (
              <div style={styles.actionsSection}>
                <p style={styles.actionsLabel}>Move to next step:</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {actions.map((action) => (
                    <button
                      key={action.nextStatus}
                      style={{ ...styles.actionBtn, borderColor: action.color, color: action.color }}
                      onClick={() => action.nextStatus === "visit_scheduled" ? startSchedule() : updateStatus(action.nextStatus)}
                      disabled={updating}
                    >
                      <span style={styles.actionIcon}>{action.icon}</span>
                      {action.label}
                    </button>
                  ))}
                  {scheduling && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#e0f2f1", border: "1px solid #80cbc4", borderRadius: 8, padding: "8px 10px" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#00695c" }}>Visit date:</span>
                      <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)}
                        style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }} />
                      <button style={{ ...styles.actionBtn, borderColor: "#00838f", color: "#fff", background: "#00838f", flex: "none", padding: "6px 12px" }}
                        onClick={confirmSchedule} disabled={updating || !visitDate}>Confirm</button>
                      <button style={{ ...styles.actionBtn, borderColor: "#b0bec5", color: "#607d8b", flex: "none", padding: "6px 12px" }}
                        onClick={() => setScheduling(false)} disabled={updating}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isEnrolled && (
              <div style={styles.enrolledBanner}>
                <CheckCircle size={18} color="#2e7d32" />
                <span>This visitor has been converted to a member.</span>
              </div>
            )}

            {!isEnrolled && (
              <div style={styles.convertSection}>
                <p style={styles.convertLabel}>Ready to register?</p>
                <button style={styles.convertBtnLarge} onClick={handleConvert}>
                  <UserPlus size={14} /> Convert to Member
                </button>
                <p style={styles.convertHint}>
                  This will open the Add Member form pre-filled with this visitor's information.
                </p>
              </div>
            )}
          </InfoCard>
        </div>
      </div>

      {/* Communications panel */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 12, borderBottom: "1px solid #f0f4f8", paddingBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Mail size={13} /> Communications
        </div>
        <MessageHistoryPanel
          recipientType="visitor"
          recipientId={visitor.id}
          recipientName={visitor.full_name}
          recipientEmail={visitor.guardian1_email || visitor.email}
        />
      </div>

      {wlOpen && (
        <div style={wlS.overlay} onClick={() => setWlOpen(false)}>
          <div style={wlS.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={wlS.title}>Place {visitor.full_name} on the {visitor.program_interest_name ?? "program"} waitlist</h3>
            <p style={wlS.label}>Which nights work? (availability)</p>
            <div style={wlS.nights}>
              {wlNights.map((n) => {
                const on = wl.available.includes(n.id);
                return (
                  <label key={n.id} style={{ ...wlS.chip, ...(on ? wlS.chipOn : {}) }}>
                    <input type="checkbox" checked={on} style={{ display: "none" }}
                      onChange={() => setWl((p) => ({ ...p, available: on ? p.available.filter((x) => x !== n.id) : [...p.available, n.id] }))} />
                    {n.name} <span style={{ opacity: 0.7 }}>({n.spots_open} open)</span>
                  </label>
                );
              })}
              {wlNights.length === 0 && <span style={wlS.muted}>No nights defined yet — set them on the Waitlist page.</span>}
            </div>
            {wl.available.length > 0 && (
              <>
                <p style={wlS.label}>Preferred night (optional)</p>
                <select style={wlS.sel} value={wl.preferred} onChange={(e) => setWl((p) => ({ ...p, preferred: e.target.value }))}>
                  <option value="">No preference</option>
                  {wlNights.filter((n) => wl.available.includes(n.id)).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </>
            )}
            <label style={wlS.check}><input type="checkbox" checked={wl.sibling} onChange={(e) => setWl((p) => ({ ...p, sibling: e.target.checked }))} /> Sibling of a current member</label>
            <label style={wlS.check}><input type="checkbox" checked={wl.parentMentor} onChange={(e) => setWl((p) => ({ ...p, parentMentor: e.target.checked }))} /> Parent is willing to mentor / help lead a team</label>
            <div style={wlS.actions}>
              <button style={wlS.cancel} onClick={() => setWlOpen(false)}>Cancel</button>
              <button style={wlS.save} onClick={submitWaitlist}>Add to waitlist</button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div style={wlS.overlay} onClick={() => setEditOpen(false)}>
          <div style={{ ...wlS.modal, width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={wlS.title}>Edit contact details</h3>
            {([
              ["first_name", "First name"], ["middle_name", "Middle"], ["last_name", "Last name"], ["birthday", "Birthday"],
              ["email", "Email"], ["phone", "Phone"],
              ["guardian1_name", "Guardian name"], ["guardian1_phone", "Guardian phone"], ["guardian1_email", "Guardian email"],
              ["address_line1", "Address"], ["address_line2", "Address line 2"],
              ["city", "City"], ["state", "State"], ["zip_code", "ZIP"],
            ] as [keyof typeof ed, string][]).reduce<[keyof typeof ed, string][][]>((rows, f, i) => {
              if (i % 2 === 0) rows.push([]);
              rows[rows.length - 1].push(f);
              return rows;
            }, []).map((pair, ri) => (
              <div key={ri} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                {pair.map(([key, lbl]) => (
                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.3 }}>{lbl}</label>
                    <input
                      type={key === "birthday" ? "date" : key.includes("email") ? "email" : "text"}
                      value={ed[key]}
                      onChange={(e) => setEd((p) => ({ ...p, [key]: e.target.value }))}
                      style={{ padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box" }}
                    />
                  </div>
                ))}
              </div>
            ))}

            <div style={{ borderTop: "1px solid #eef2f7", marginTop: 4, paddingTop: 12 }}>
              {editHasNights && (
                <>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.3 }}>Which nights work? (availability)</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0 12px" }}>
                    {intake!.nights.map((n) => {
                      const on = edNight.available.includes(n.id);
                      return (
                        <button key={n.id} type="button"
                          onClick={() => setEdNight((p) => ({ ...p, available: on ? p.available.filter((i) => i !== n.id) : [...p.available, n.id] }))}
                          style={{ padding: "6px 12px", borderRadius: 20, border: `1px solid ${on ? "#1b7a3d" : "#cdd7e3"}`, background: on ? "#e6f4ea" : "#fff", color: on ? "#1b7a3d" : "#556", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          {n.name}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.3 }}>Preferred night</label>
                      <select value={edNight.preferred} onChange={(e) => setEdNight((p) => ({ ...p, preferred: e.target.value }))}
                        style={{ padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5 }}>
                        <option value="">No preference</option>
                        {intake!.nights.map((n) => <option key={n.id} value={String(n.id)}>{n.name}</option>)}
                      </select>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22, fontSize: 13.5, color: "#334" }}>
                      <input type="checkbox" checked={edNight.flexible} onChange={(e) => setEdNight((p) => ({ ...p, flexible: e.target.checked }))} />
                      Flexible on nights
                    </label>
                  </div>
                </>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#334" }}>
                <input type="checkbox" checked={edNight.parentMentor} onChange={(e) => setEdNight((p) => ({ ...p, parentMentor: e.target.checked }))} />
                Parent is willing to be a mentor
              </label>
            </div>

            <div style={wlS.actions}>
              <button style={wlS.cancel} onClick={() => setEditOpen(false)}>Cancel</button>
              <button style={wlS.save} onClick={saveEdit}>Save changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const pipe: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 16 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 11, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4, margin: "8px 0 6px" },
  ownerRow: { display: "flex", gap: 8, alignItems: "center" },
  sel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, background: "#fff", flex: 1 },
  meBtn: { padding: "7px 11px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  doneBtn: { marginTop: 6, padding: "7px 11px", background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", alignSelf: "flex-start" },
  ixAdd: { display: "flex", gap: 8, marginBottom: 8 },
  ixSel: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  ixIn: { flex: 1, padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  ixBtn: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  ixRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #f0f4f8", fontSize: 13 },
  ixMethod: { fontWeight: 700, color: "#1565c0", minWidth: 66, textTransform: "capitalize" },
  ixNotes: { flex: 1, color: "#334155" },
  ixMeta: { color: "#99a", fontSize: 12, whiteSpace: "nowrap" },
  ixDel: { background: "none", border: "none", color: "#c62828", cursor: "pointer", fontSize: 13 },
  muted: { color: "#889", fontSize: 13, margin: "6px 0" },
};

const wlS: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, padding: 22, width: 460, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
  title: { margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  label: { fontSize: 12, fontWeight: 700, color: "#556", margin: "10px 0 6px" },
  nights: { display: "flex", flexWrap: "wrap", gap: 7 },
  chip: { border: "1px solid #cdd7e3", borderRadius: 16, padding: "5px 12px", fontSize: 12.5, cursor: "pointer", background: "#fff", color: "#556" },
  chipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  sel: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#333", margin: "10px 0 0", cursor: "pointer" },
  muted: { color: "#889", fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  cancel: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 7, cursor: "pointer", fontSize: 14 },
  save: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 14, fontWeight: 600 },
};

// Shows the lifecycle pipeline visually
function LifecycleTimeline({ status }: { status: string }) {
  const steps = [
    { code: "new", label: "Inquiry" },
    { code: "visit_scheduled", label: "Scheduled" },
    { code: "visited", label: "Visited" },
    { code: "follow_up", label: "Follow-Up" },
    { code: "waitlisted", label: "Waitlisted" },
    { code: "enrolled", label: "Enrolled" },
  ];
  const isNotInterested = status === "not_interested";
  const currentIndex = steps.findIndex((s) => s.code === status);

  return (
    <div style={styles.timeline}>
      {isNotInterested ? (
        <div style={styles.notInterestedTag}>
          <XCircle size={14} /> Not Interested
        </div>
      ) : (
        steps.map((step, i) => {
          const done = i < currentIndex || status === "enrolled";
          const active = step.code === status;
          return (
            <div key={step.code} style={styles.timelineItem}>
              <div style={{
                ...styles.timelineDot,
                background: done || active ? STATUS_COLORS[step.code] ?? "#1a3a5c" : "#ddd",
                color: done || active ? "#fff" : "#bbb",
              }}>
                {done ? <CheckCircle size={12} /> : (active ? <Clock size={12} /> : i + 1)}
              </div>
              <span style={{
                fontSize: 11, color: active ? STATUS_COLORS[step.code] : done ? "#555" : "#bbb",
                fontWeight: active ? 700 : 400,
              }}>
                {step.label}
              </span>
              {i < steps.length - 1 && (
                <div style={{ ...styles.timelineLine, background: done ? "#1a3a5c" : "#ddd" }} />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: STATUS_COLORS[status] ?? "#555", color: "#fff",
    }}>
      {label}
    </span>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.infoCard}>
      <div style={styles.infoCardTitle}>{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      {icon && <span style={{ color: "#aaa", flexShrink: 0 }}>{icon}</span>}
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 960, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  convertBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  viewMemberBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },

  templateBanner: { background: "#fffde7", border: "1px solid #fbc02d", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 16 },
  templateHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  closeBannerBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#888" },
  templateSubject: { fontSize: 13, marginBottom: 8, color: "#555" },
  templateBody: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "10px 12px", fontSize: 12, lineHeight: 1.7, color: "#333", whiteSpace: "pre-wrap" as const, margin: "0 0 8px", fontFamily: "inherit" },
  templateNote: { fontSize: 11, color: "#999", margin: 0, fontStyle: "italic" },
  emailField: { width: "100%", boxSizing: "border-box" as const, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, marginBottom: 8 },

  profileCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 16 },
  profileLeft: { display: "flex", alignItems: "center", gap: 16 },
  avatar: { width: 60, height: 60, borderRadius: "50%", background: "#4527a0", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, flexShrink: 0 },
  name: { margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  metaRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  visitorNum: { fontSize: 12, color: "#888", fontWeight: 600 },
  inquiryDate: { fontSize: 12, color: "#aaa" },
  programInterest: { fontSize: 13, color: "#555", marginTop: 4 },

  bodyGrid: { display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" },

  infoCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", marginBottom: 12 },
  infoCardTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 10, borderBottom: "1px solid #f0f4f8", paddingBottom: 6 },
  infoRow: { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6, fontSize: 13 },
  infoLabel: { color: "#888", minWidth: 72, fontSize: 12, flexShrink: 0 },
  infoValue: { color: "#222", flex: 1 },
  notesText: { fontSize: 13, color: "#444", lineHeight: 1.6, margin: "0 0 8px" },
  editNotesBtn: { background: "none", border: "1px solid #ccc", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontSize: 12 },
  textarea: { width: "100%", minHeight: 90, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, resize: "vertical" as const, boxSizing: "border-box" as const },
  saveNotesBtn: { padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  cancelNotesBtn: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },

  timeline: { display: "flex", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 0 },
  timelineItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" },
  timelineDot: { width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 },
  timelineLine: { width: 20, height: 2, marginBottom: 14, alignSelf: "flex-start", marginTop: "-18px", marginLeft: "24px", position: "absolute", left: "100%", top: "11px" } as React.CSSProperties,
  notInterestedTag: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#f5f5f5", borderRadius: 8, color: "#757575", fontSize: 13, fontWeight: 600 },

  actionsSection: { marginTop: 16, borderTop: "1px solid #f0f4f8", paddingTop: 14 },
  visitedTodayBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 700 },
  visitedMsg: { fontSize: 12.5, color: "#2e7d32", fontWeight: 600, margin: "8px 0 0", textAlign: "center" as const },
  actionsLabel: { fontSize: 12, color: "#888", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.4, margin: "0 0 8px" },
  actionBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "#fff", border: "2px solid #ccc", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "left" as const },
  actionIcon: { fontSize: 16 },

  enrolledBanner: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#e8f5e9", borderRadius: 8, color: "#2e7d32", fontSize: 13, fontWeight: 600 },
  convertSection: { marginTop: 16, borderTop: "1px solid #f0f4f8", paddingTop: 14 },
  convertLabel: { fontSize: 12, color: "#888", fontWeight: 600, margin: "0 0 8px" },
  convertBtnLarge: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14, justifyContent: "center" },
  convertHint: { fontSize: 11, color: "#aaa", margin: "8px 0 0", lineHeight: 1.5 },
};
