import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { eventsApi, transportApi, type TRCEvent, type EventAttendance, type EventParticipantData, type EventParticipantRec } from "../api";
import ApplyEarningsModal from "../components/ApplyEarningsModal";
import EventSignups from "../components/EventSignups";
import EventBring from "../components/EventBring";
import EventTransport from "../components/EventTransport";
import EventTransportPrompt from "../components/EventTransportPrompt";
import EventSponsorshipPane from "../components/EventSponsorshipPane";
import { reservationsApi, fmtRange, type Reservation } from "../../reservations/api";
import { membersApi, type ChildSummary } from "../../members/api";
import { useGoBack } from "../../../core/useGoBack";
import { useIsMobile } from "../../../core/useIsMobile";
import {
  ArrowLeft, Edit2, MapPin, Clock,
  Truck, AlertTriangle, CheckCircle, Trash2, RefreshCw, X, Users, UserCheck, UserX, HelpCircle,
  DoorOpen, PlusCircle,
} from "lucide-react";
const EVENT_TYPE_COLORS: Record<string, string> = {
  "Regular Meeting": "#1565c0", "Add-On Meeting": "#1976d2", "Training": "#6a1b9a",
  "Scrimmage": "#e65100", "Competition": "#c62828", "Outreach Event": "#2e7d32",
  "Open House": "#00695c", "Information Session": "#4527a0", "Parent Meeting": "#558b2f",
  "Field Trip": "#f57f17", "Other": "#546e7a",
};

type DeleteScope = "this" | "future" | "all";

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack("/events");
  const { isAdmin, hasRole, user } = useAuth();
  const isMobile = useIsMobile();
  const canEdit = isAdmin || hasRole("Admin", "System Administrator", "Mentor");
  const canDelete = isAdmin || hasRole("Admin", "System Administrator");
  // Outside volunteers get a pared-down view: only Will You Attend, Quick Info, and the
  // event's volunteer sign-up information. Staff/coverage, resources, details, coverage
  // sign-ups, attendance and sponsorship are all hidden.
  const isVolunteer = user?.member_type === "volunteer";

  const [event, setEvent] = useState<TRCEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>("this");
  const [attendance, setAttendance] = useState<EventAttendance | null>(null);
  const [transportRefresh, setTransportRefresh] = useState(0);

  useEffect(() => {
    eventsApi.get(parseInt(id!))
      .then(setEvent)
      .finally(() => setLoading(false));
    eventsApi.getAttendance(parseInt(id!))
      .then(setAttendance)
      .catch(() => setAttendance(null));
  }, [id]);

  function initiateDelete() {
    if (!event) return;
    if (event.is_recurring) {
      // Show the scope picker for recurring events
      setDeleteScope("this");
      setShowDeleteModal(true);
    } else {
      // Simple confirm for single events
      if (confirm(`Delete "${event.name}"? This cannot be undone.`)) {
        doDelete("this");
      }
    }
  }

  async function doDelete(scope: DeleteScope) {
    if (!event) return;
    setDeleting(true);
    setShowDeleteModal(false);
    try {
      if (scope === "this") {
        await eventsApi.delete(event.id);
      } else if (scope === "future" && event.recurrence_group_id) {
        await eventsApi.deleteRecurrenceGroup(event.recurrence_group_id, event.event_date);
      } else if (scope === "all" && event.recurrence_group_id) {
        await eventsApi.deleteRecurrenceGroup(event.recurrence_group_id);
      }
      navigate("/events");
    } catch {
      alert("Failed to delete event.");
      setDeleting(false);
    }
  }

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (!event) return <div style={styles.center}>Event not found.</div>;

  const color = EVENT_TYPE_COLORS[event.event_type ?? ""] ?? "#546e7a";
  const eventDate = new Date(event.event_date + "T00:00:00");
  const endDate = event.end_date ? new Date(event.end_date + "T00:00:00") : null;
  const isMultiDay = !!endDate;
  const dayName = eventDate.toLocaleDateString("en-US", { weekday: "long" });
  const fullDate = eventDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const fullEndDate = endDate?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const durationDays = endDate
    ? Math.round((endDate.getTime() - eventDate.getTime()) / 86400000) + 1
    : 1;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && (
            <button style={styles.editBtn} onClick={() => navigate(`/events/${event.id}/edit`)}>
              <Edit2 size={13} /> Edit
            </button>
          )}
          {canDelete && (
            <button style={styles.deleteBtn} onClick={initiateDelete} disabled={deleting}>
              <Trash2 size={13} /> {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>

      {/* Delete scope modal — shown only for recurring events */}
      {showDeleteModal && event && (
        <div style={styles.overlay} onClick={() => setShowDeleteModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                <Trash2 size={18} color="#c62828" />
                <span>Delete Recurring Event</span>
              </div>
              <button style={styles.closeBtn} onClick={() => setShowDeleteModal(false)}>
                <X size={16} />
              </button>
            </div>

            <p style={styles.modalDesc}>
              <strong>"{event.name}"</strong> is part of a recurring series
              {event.recurrence_description && ` (${event.recurrence_description})`}.
              What would you like to delete?
            </p>

            <div style={styles.options}>
              <label style={{ ...styles.option, ...(deleteScope === "this" ? styles.optionSelected : {}) }}>
                <input type="radio" name="scope" value="this"
                  checked={deleteScope === "this"}
                  onChange={() => setDeleteScope("this")} />
                <div style={styles.optionContent}>
                  <div style={styles.optionTitle}>This event only</div>
                  <div style={styles.optionDesc}>
                    Delete only {fullDate}. Other events in the series are unchanged.
                  </div>
                </div>
              </label>

              <label style={{ ...styles.option, ...(deleteScope === "future" ? styles.optionSelected : {}) }}>
                <input type="radio" name="scope" value="future"
                  checked={deleteScope === "future"}
                  onChange={() => setDeleteScope("future")} />
                <div style={styles.optionContent}>
                  <div style={styles.optionTitle}>This and all future occurrences</div>
                  <div style={styles.optionDesc}>
                    Delete {fullDate} and every event in the series on or after this date.
                    Past events are kept.
                  </div>
                </div>
              </label>

              <label style={{ ...styles.option, ...(deleteScope === "all" ? styles.optionSelected : {}) }}>
                <input type="radio" name="scope" value="all"
                  checked={deleteScope === "all"}
                  onChange={() => setDeleteScope("all")} />
                <div style={styles.optionContent}>
                  <div style={styles.optionTitle}>All events in the series</div>
                  <div style={styles.optionDesc}>
                    Delete every occurrence — past, present, and future.
                    This cannot be undone.
                  </div>
                </div>
              </label>
            </div>

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button style={styles.confirmDeleteBtn} onClick={() => doDelete(deleteScope)} disabled={deleting}>
                <Trash2 size={14} />
                {deleteScope === "this" ? "Delete This Event"
                  : deleteScope === "future" ? "Delete This & Future"
                  : "Delete Entire Series"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div style={{ ...styles.hero, borderTopColor: color }}>
        <div style={styles.heroDate}>
          {isMultiDay ? (
            <>
              <div style={styles.heroDateDay}>{eventDate.getDate()}</div>
              <div style={styles.heroDateMon}>{eventDate.toLocaleDateString("en-US", { month: "short" })}</div>
              <div style={styles.heroDateSep}>–</div>
              <div style={styles.heroDateDay}>{endDate!.getDate()}</div>
              <div style={styles.heroDateMon}>{endDate!.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</div>
              <div style={styles.heroDateDuration}>{durationDays} days</div>
            </>
          ) : (
            <>
              <div style={styles.heroDateDay}>{eventDate.getDate()}</div>
              <div style={styles.heroDateMon}>{eventDate.toLocaleDateString("en-US", { month: "short" })}</div>
              <div style={styles.heroDateYear}>{eventDate.getFullYear()}</div>
            </>
          )}
        </div>
        <div style={styles.heroInfo}>
          {event.is_tentative && (
            <span style={{ ...styles.typeBadge, background: "#c07a1a" }}>❓ Tentative — may not happen</span>
          )}
          {event.is_informational && (
            <span style={{ ...styles.typeBadge, background: "#7e57c2" }}>📣 Informational</span>
          )}
          {event.event_type && (
            <span style={{ ...styles.typeBadge, background: color }}>{event.event_type}</span>
          )}
          {event.is_recurring && (
            <span style={styles.recurBadge}>
              <RefreshCw size={11} /> Recurring
              {event.recurrence_index && event.recurrence_description && (
                <span style={styles.recurDetail}> · Occurrence {event.recurrence_index}</span>
              )}
            </span>
          )}
          <h1 style={styles.heroName}>{event.name}</h1>
          <div style={styles.heroMeta}>
            {isMultiDay ? (
              <span><strong>{fullDate}</strong> – <strong>{fullEndDate}</strong> ({durationDays} days)</span>
            ) : (
              <span><strong>{dayName}</strong>, {fullDate}</span>
            )}
            {event.start_time && (
              <span>
                <Clock size={13} style={{ verticalAlign: "middle" }} />{" "}
                {fmtTime(event.start_time)}{event.end_time ? ` – ${fmtTime(event.end_time)}` : ""}
              </span>
            )}
            {event.meeting_mode && event.meeting_mode !== "in_person" && (
              <span style={styles.modeChip}>{event.meeting_mode === "remote" ? "🖥 Remote" : "🖥 In person + Remote"}</span>
            )}
            {event.location && event.meeting_mode !== "remote" && (
              <span><MapPin size={13} style={{ verticalAlign: "middle" }} /> {event.location}</span>
            )}
            {event.meeting_mode !== "in_person" && event.remote_url && (
              <a href={event.remote_url} target="_blank" rel="noreferrer" style={styles.remoteLink}>🔗 Join remotely</a>
            )}
            {event.meeting_mode !== "in_person" && event.remote_details && (
              <span style={{ color: "#78909c" }}>{event.remote_details}</span>
            )}
          </div>
          {event.recurrence_description && (
            <div style={styles.recurDesc}>{event.recurrence_description}</div>
          )}
        </div>
        {!isVolunteer && (
        <div style={styles.heroFlags}>
          {!event.is_informational && <FlagChip ok={event.mentor_coverage_met} okLabel="Coverage Met" failLabel="Coverage Needed" failColor="#f57c00" />}
          {event.post_to_public_calendar && <FlagChip ok label="Public Calendar" />}
          {!event.is_informational && event.requires_logistics && <FlagChip ok={event.has_logistics} okLabel="Logistics Set" failLabel="Logistics Needed" failColor="#1565c0" />}
        </div>
        )}
      </div>

      <div style={{ ...styles.bodyGrid, ...(isMobile ? { gridTemplateColumns: "1fr" } : {}) }}>
        <div>
          {/* RSVP — self-service for the logged-in user + everyone's responses.
              Info events are announcements: no attendance, so no RSVP. */}
          {!event.is_informational && <RsvpCard eventId={event.id} eventName={event.name} onTransportChanged={() => setTransportRefresh((v) => v + 1)} />}

          {/* "What are you bringing" / potluck sign-up (0207) — opt-in per event */}
          {!event.is_informational && !isVolunteer && <EventBring eventId={event.id} />}

          {/* Transportation planning (0221) — opt-in per event, for off-site events */}
          {!event.is_informational && !isVolunteer && <EventTransport eventId={event.id} eventName={event.name} eventDate={event.event_date} refreshKey={transportRefresh} />}

          {/* Outside-volunteer sign-up info — shown to volunteers (from the event edit screen). */}
          {isVolunteer && event.volunteer_open && (event.volunteer_signup_note || event.volunteer_signup_url) && (
            <Card title="Volunteer Sign-Up Information">
              {event.volunteer_signup_note && <p style={{ ...styles.detailText, whiteSpace: "pre-wrap" }}>{event.volunteer_signup_note}</p>}
              {event.volunteer_signup_url && (
                <a href={event.volunteer_signup_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#1565c0", marginTop: event.volunteer_signup_note ? 10 : 0 }}>
                  External sign-up →
                </a>
              )}
            </Card>
          )}

          {/* Coverage sign-ups (#152) — SignupGenius-style time/area slots */}
          {!event.is_informational && !isVolunteer && <EventSignups eventId={event.id} />}

          {/* Details */}
          {!isVolunteer && event.details && (
            <Card title="Details">
              <p style={styles.detailText}>{event.details}</p>
              {event.event_url && (
                <a href={event.event_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1565c0", marginTop: 10 }}>
                  🌐 Event Website →
                </a>
              )}
            </Card>
          )}
          {!isVolunteer && !event.details && event.event_url && (
            <Card title="Details">
              <a href={event.event_url} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1565c0" }}>
                🌐 Event Website →
              </a>
            </Card>
          )}

          {/* Staff — not applicable to info-only events; hidden from outside volunteers */}
          {!event.is_informational && !isVolunteer && (
          <Card title="Staff & Coverage">
            <InfoRow label="Coordinator" value={event.coordinator_name} />
            <InfoRow label="Mentor 1" value={event.mentor1_name} icon={event.mentor1_id ? "✓" : "⚠"} />
            <InfoRow label="Mentor 2" value={event.mentor2_name} icon={event.mentor2_id ? "✓" : "⚠"} />
            <InfoRow label="Mentors attending" value={`${event.mentors_attending ?? 0} RSVP’d`} icon={event.mentor_coverage_met ? "✓" : "⚠"} />
            {!event.mentor_coverage_met && (
              <div style={styles.warningBox}>
                <AlertTriangle size={14} />
                At least 2 mentors must RSVP as Attending before this event has coverage.
              </div>
            )}
          </Card>
          )}

          {!event.is_informational && !isVolunteer && <ReservedResourcesCard eventId={event.id} canReserve={canEdit} />}

          {/* Attendance */}
          {!isVolunteer && attendance && (attendance.total_attending > 0 || attendance.present_count > 0) && (
            <AttendanceCard attendance={attendance} onCheckIn={() => navigate(`/checkin/event/${event.id}`)} canEdit={canEdit} />
          )}
        </div>

        {/* Logistics sidebar (volunteers always get the plain Quick Info) */}
        <div>
          {event.requires_logistics && !isVolunteer ? (
            <Card title="Logistics">
              <button
                style={styles.logisticsBtn}
                onClick={() => navigate(`/events/${event.id}/logistics`)}
              >
                <Truck size={14} /> Manage Logistics →
              </button>
              {!event.has_logistics && (
                <p style={styles.logisticsHint}>Logistics details not yet configured.</p>
              )}
            </Card>
          ) : (
            <Card title="Quick Info">
              <div style={styles.quickInfo}>
                <QuickRow icon="📅" label="Date" value={
                  isMultiDay ? `${fullDate} – ${fullEndDate}` : fullDate
                } />
                {event.start_time && <QuickRow icon="🕐" label="Time" value={`${fmtTime(event.start_time)}${event.end_time ? ` – ${fmtTime(event.end_time)}` : ""}`} />}
                {event.location && <QuickRow icon="📍" label="Location" value={event.location} />}
                {event.event_type && <QuickRow icon="🏷️" label="Type" value={event.event_type} />}
                {event.is_recurring && event.recurrence_index && (
                  <QuickRow icon="↻" label="Series" value={`Occurrence ${event.recurrence_index}`} />
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {!isVolunteer && <EventSponsorshipPane eventId={event.id} />}
    </div>
  );
}

const RSVP_OPTIONS = [
  { value: "Attending" as const, label: "Attending", color: "#2e7d32", Icon: UserCheck },
  { value: "Maybe" as const, label: "Maybe", color: "#f57c00", Icon: HelpCircle },
  { value: "Not Attending" as const, label: "Not Attending", color: "#c62828", Icon: UserX },
];
const RSVP_STATUS_COLORS: Record<string, string> = {
  "Attending": "#2e7d32", "Maybe": "#f57c00", "Not Attending": "#c62828", "No Reply": "#888",
};

function RsvpCard({ eventId, eventName, onTransportChanged }: { eventId: number; eventName: string; onTransportChanged?: () => void }) {
  const navigate = useNavigate();
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [data, setData] = useState<EventParticipantData | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [transportOpen, setTransportOpen] = useState(false);
  const [kids, setKids] = useState<ChildSummary[]>([]);
  const [savingKid, setSavingKid] = useState<number | null>(null);
  const [youthTransport, setYouthTransport] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    eventsApi.getMyRsvp(eventId).then((r) => setMyStatus(r.status)).catch(() => {});
    eventsApi.listParticipants(eventId).then(setData).catch(() => {});
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { membersApi.myChildren().then(setKids).catch(() => setKids([])); }, []);

  // RSVP on behalf of a youth in the family; refresh the roster so their new status shows.
  async function chooseForChild(childId: number, status: "Attending" | "Not Attending" | "Maybe") {
    setSavingKid(childId);
    try {
      await eventsApi.rsvp(eventId, status, childId);
      setData(await eventsApi.listParticipants(eventId));
      // If the event asks for transportation and this youth hasn't answered yet, prompt now —
      // attributed to the youth, not the parent.
      if (status === "Attending" || status === "Maybe") {
        try {
          const t = await transportApi.list(eventId);
          const yr = t.my_youth.find((y) => y.member_id === childId);
          if (t.transport_enabled && yr && !yr.ride_to && !yr.ride_back) {
            const kid = kids.find((k) => k.id === childId);
            setYouthTransport({ id: childId, name: kid ? kid.first_name : "your youth" });
          }
        } catch { /* transport not enabled */ }
      }
    } finally { setSavingKid(null); }
  }

  async function choose(status: "Attending" | "Not Attending" | "Maybe") {
    setSaving(true);
    try {
      await eventsApi.rsvp(eventId, status);
      setMyStatus(status);
      const fresh = await eventsApi.listParticipants(eventId);
      setData(fresh);
      // If attending a fundraising event and the youth is on multiple eligible
      // teams, ask now which team(s) get their earnings.
      if (status === "Attending") {
        try {
          const dist = await eventsApi.getMyDistribution(eventId);
          if (dist.enabled && dist.needs_choice) setApplyOpen(true);
        } catch { /* not a fundraising event */ }
      }
      // Off-site events with transportation planning on: ask how they'll get there,
      // unless they've already answered. Also prompt on "Maybe" so we can pre-plan a
      // ride in case they end up attending.
      if (status === "Attending" || status === "Maybe") {
        try {
          const t = await transportApi.list(eventId);
          if (t.transport_enabled && !t.my_response) setTransportOpen(true);
        } catch { /* transport not enabled */ }
      }
    } finally { setSaving(false); }
  }

  // Flatten everyone, then group by status for display.
  const everyone = (data?.sections ?? []).flatMap((s) => s.participants);
  const groups = RSVP_OPTIONS.map((o) => ({
    ...o, people: everyone.filter((p) => p.status === o.value),
  }));
  const name = (p: EventParticipantRec) => p.participant_type === "other"
    ? (p.other_name ?? "Guest")
    : `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();

  return (
    <div style={styles.card}>
      {applyOpen && (
        <ApplyEarningsModal eventId={eventId} eventName={eventName} onClose={() => setApplyOpen(false)} />
      )}
      {transportOpen && (
        <EventTransportPrompt eventId={eventId} eventName={eventName}
          onClose={() => setTransportOpen(false)} onSaved={() => onTransportChanged?.()} />
      )}
      {youthTransport && (
        <EventTransportPrompt eventId={eventId} eventName={eventName}
          memberId={youthTransport.id} forName={youthTransport.name}
          onClose={() => setYouthTransport(null)} onSaved={() => onTransportChanged?.()} />
      )}
      <div style={styles.cardTitle}>Will you attend?</div>

      {/* My RSVP buttons */}
      <div style={styles.rsvpBtns}>
        {RSVP_OPTIONS.map(({ value, label, color, Icon }) => {
          const active = myStatus === value;
          return (
            <button key={value} disabled={saving}
              style={{
                ...styles.rsvpBtn,
                ...(active ? { background: color, color: "#fff", borderColor: color } : { color }),
              }}
              onClick={() => choose(value)}>
              <Icon size={15} /> {label}
            </button>
          );
        })}
      </div>
      {myStatus && (
        <p style={styles.rsvpNote}>
          You're marked as <strong style={{ color: RSVP_STATUS_COLORS[myStatus] }}>{myStatus}</strong>. Tap another option to change it.
        </p>
      )}

      {/* RSVP for your youth — parents/guardians can reply for the youth in their family. */}
      {kids.length > 0 && (
        <div style={styles.kidRsvpWrap}>
          <div style={styles.kidRsvpHead}>RSVP for your youth</div>
          {kids.map((kid) => {
            const kidStatus = everyone.find((p) => p.member_id === kid.id)?.status ?? null;
            const busy = savingKid === kid.id;
            return (
              <div key={kid.id} style={styles.kidRow}>
                <div style={styles.kidName}>
                  {kid.first_name} {kid.last_name}
                  {kidStatus && kidStatus !== "No Reply" && (
                    <span style={{ ...styles.kidStatusTag, color: RSVP_STATUS_COLORS[kidStatus] }}>{kidStatus}</span>
                  )}
                </div>
                <div style={styles.kidBtns}>
                  {RSVP_OPTIONS.map(({ value, label, color, Icon }) => {
                    const active = kidStatus === value;
                    return (
                      <button key={value} disabled={busy} title={label}
                        style={{ ...styles.kidBtn, ...(active ? { background: color, color: "#fff", borderColor: color } : { color }) }}
                        onClick={() => chooseForChild(kid.id, value)}>
                        <Icon size={13} /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Everyone's responses */}
      {groups.some((g) => g.people.length > 0) && (
        <div style={styles.rsvpGroups}>
          {groups.map((g) => g.people.length === 0 ? null : (
            <div key={g.value} style={styles.rsvpGroup}>
              <div style={{ ...styles.rsvpGroupHead, color: g.color }}>
                <g.Icon size={13} /> {g.label} <span style={styles.rsvpGroupCount}>{g.people.length}</span>
              </div>
              <div style={styles.rsvpPeople}>
                {g.people.map((p) => (
                  <div key={p.id} style={styles.rsvpPerson}
                    onClick={() => p.member_id && navigate(`/members/${p.member_id}`)}>
                    <div style={styles.rsvpAvatar}>
                      {p.photo_url
                        ? <img src={p.photo_url} style={styles.rsvpAvatarImg} alt="" />
                        : <span>{(p.first_name?.[0] ?? p.other_name?.[0] ?? "?").toUpperCase()}</span>}
                    </div>
                    <span style={styles.rsvpPersonName}>{name(p)}</span>
                    {p.member_type && <span style={styles.rsvpPersonType}>{p.member_type}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttendanceCard({ attendance, onCheckIn, canEdit }: {
  attendance: EventAttendance; onCheckIn: () => void; canEdit: boolean;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.attHeader}>
        <div style={styles.cardTitleInline}>
          <Users size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Attendance
        </div>
        {canEdit && (
          <button style={styles.attCheckInBtn} onClick={onCheckIn}>
            <UserCheck size={12} /> Check-In Screen →
          </button>
        )}
      </div>

      {/* Summary counts */}
      <div style={styles.attSummary}>
        <span style={styles.attStat}><strong>{attendance.total_attending}</strong> expected</span>
        <span style={{ ...styles.attStat, color: "#2e7d32" }}>
          <UserCheck size={13} /> <strong>{attendance.present_count}</strong> checked in
        </span>
        <span style={{ ...styles.attStat, color: "#c62828" }}>
          <UserX size={13} /> <strong>{attendance.absent_count}</strong> not present
        </span>
        {attendance.walk_in_count > 0 && (
          <span style={{ ...styles.attStat, color: "#e65100" }}>
            <strong>{attendance.walk_in_count}</strong> walk-in{attendance.walk_in_count !== 1 ? "s" : ""}
          </span>
        )}
        <span style={{ ...styles.attStat, color: "#1565c0" }}>
          <Clock size={13} /> <strong>{attendance.total_hours}</strong> hours total
        </span>
      </div>

      {/* Hours broken down by member-type category */}
      {attendance.total_hours > 0 && (
        <div style={styles.hoursBreakdown}>
          {["youth", "mentor", "parent", "volunteer"].map((t) => {
            const h = attendance.hours_by_type?.[t] ?? 0;
            if (h <= 0) return null;
            return (
              <span key={t} style={styles.hoursChip}>
                <span style={styles.hoursChipLabel}>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                <strong>{h}</strong> hr
              </span>
            );
          })}
          <span style={{ ...styles.hoursChip, ...styles.hoursChipTotal }}>
            <span style={styles.hoursChipLabel}>Grand total</span>
            <strong>{attendance.total_hours}</strong> hr
          </span>
        </div>
      )}

      {/* Roster list */}
      <div style={styles.attList}>
        {attendance.roster.map((m) => (
          <div key={m.member_id} style={styles.attRow}>
            <div style={styles.attAvatar}>
              {m.photo_url
                ? <img src={m.photo_url} style={styles.attAvatarImg} alt="" />
                : <span>{(m.first_name?.[0] ?? "")}{(m.last_name?.[0] ?? "")}</span>}
            </div>
            <div style={styles.attName}>
              <span>
                {m.last_name}, {m.first_name}
                {m.walk_in && <span style={styles.walkInTag}>walk-in</span>}
              </span>
              <span style={styles.attType}>{m.member_type}</span>
            </div>
            {m.present ? (
              <span style={styles.attPresentWrap}>
                {m.still_in
                  ? <span style={styles.attStillIn}><CheckCircle size={12} /> Checked in</span>
                  : <span style={styles.attPresent}><CheckCircle size={12} /> Attended</span>}
                {m.hours > 0 && <span style={styles.attHours}>{m.hours} hr{m.hours !== 1 ? "s" : ""}</span>}
              </span>
            ) : (
              <span style={styles.attAbsent}>Not present</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlagChip({ ok, label, okLabel, failLabel, failColor = "#888" }: {
  ok?: boolean; label?: string; okLabel?: string; failLabel?: string; failColor?: string;
}) {
  const isOk = ok ?? true;
  const text = label ?? (isOk ? okLabel : failLabel) ?? "";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
      borderRadius: 8, fontSize: 12, fontWeight: 600,
      background: isOk ? "#e8f5e9" : "#fff8e1",
      color: isOk ? "#2e7d32" : failColor,
    }}>
      {isOk ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
      {text}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

const RESV_STATUS: Record<string, { label: string; color: string }> = {
  approved: { label: "Reserved", color: "#2e7d32" },
  pending: { label: "Requested", color: "#e65100" },
};
function ReservedResourcesCard({ eventId, canReserve }: { eventId: number; canReserve: boolean }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Reservation[] | null>(null);
  useEffect(() => { reservationsApi.forEvent(eventId).then(setRows).catch(() => setRows([])); }, [eventId]);
  return (
    <Card title="Reserved Rooms & Resources">
      {rows === null ? <p style={styles.muted}>Loading…</p>
        : rows.length === 0 ? <p style={styles.muted}>No rooms or resources reserved for this event yet.</p>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r) => {
              const meta = RESV_STATUS[r.status] ?? { label: r.status, color: "#78909c" };
              return (
                <div key={r.id} style={styles.resvRow} onClick={() => navigate(`/reservations/${r.id}`)}>
                  <DoorOpen size={14} style={{ color: "#00838f", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a3a5c" }}>{r.resource_name}</div>
                    <div style={{ fontSize: 11.5, color: "#888" }}>{fmtRange(r.start_at, r.end_at)}{r.member_name ? ` · ${r.member_name}` : ""}</div>
                  </div>
                  <span style={{ ...styles.resvBadge, background: meta.color }}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        )}
      {canReserve && (
        <button style={styles.reserveBtn} onClick={() => navigate(`/reservations/new?event=${eventId}`)}>
          <PlusCircle size={13} /> Reserve a room / resource
        </button>
      )}
    </Card>
  );
}

function InfoRow({ label, value, icon }: { label: string; value?: string | null; icon?: string }) {
  if (!value && !icon) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ fontSize: 13, color: value ? "#222" : "#bbb" }}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {value ?? "Not assigned"}
      </span>
    </div>
  );
}

function QuickRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={styles.quickRow}>
      <span>{icon}</span>
      <span style={{ color: "#888", fontSize: 12, minWidth: 60 }}>{label}</span>
      <span style={{ fontSize: 13, color: "#333" }}>{value}</span>
    </div>
  );
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ampm}`;
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  editBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  deleteBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 13 },

  // Delete modal
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, width: 500, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" },
  modalTitle: { display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "#c62828" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  modalDesc: { padding: "16px 20px 8px", fontSize: 14, color: "#444", lineHeight: 1.6, margin: 0 },
  options: { display: "flex", flexDirection: "column", gap: 8, padding: "8px 20px 16px" },
  option: { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", border: "2px solid #e2e8f0", borderRadius: 8, cursor: "pointer", background: "#fafafa" },
  optionSelected: { borderColor: "#c62828", background: "#fff5f5" },
  optionContent: {},
  optionTitle: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", marginBottom: 3 },
  optionDesc: { fontSize: 12, color: "#888", lineHeight: 1.5 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 20px", borderTop: "1px solid #f0f4f8", background: "#fafafa" },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  confirmDeleteBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },

  // Hero
  hero: { background: "#fff", border: "1px solid #e2e8f0", borderTop: "5px solid #ccc", borderRadius: 12, padding: "1.5rem", marginBottom: 16, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" },
  heroDate: { textAlign: "center", background: "#f0f4f8", borderRadius: 10, padding: "12px 16px", minWidth: 64 },
  heroDateDay: { fontSize: 32, fontWeight: 900, color: "#1a3a5c", lineHeight: 1 },
  heroDateMon: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase" as const },
  heroDateYear: { fontSize: 12, color: "#aaa" },
  heroDateSep: { fontSize: 18, color: "#ccc", lineHeight: 1, textAlign: "center" as const },
  heroDateDuration: { fontSize: 11, color: "#1565c0", fontWeight: 700, background: "#e3f2fd", borderRadius: 6, padding: "1px 6px", marginTop: 4 },
  heroInfo: { flex: 1 },
  typeBadge: { display: "inline-block", padding: "2px 10px", borderRadius: 10, color: "#fff", fontSize: 12, fontWeight: 600, marginBottom: 4, marginRight: 6 },
  recurBadge: { display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 10px", borderRadius: 10, background: "#e3f2fd", color: "#1565c0", fontSize: 12, fontWeight: 600, marginBottom: 4 },
  recurDetail: { fontWeight: 400, opacity: 0.8 },
  recurDesc: { fontSize: 12, color: "#888", marginTop: 4, fontStyle: "italic" },
  heroName: { margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  heroMeta: { display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 13, color: "#555" },
  heroFlags: { display: "flex", flexDirection: "column", gap: 6 },
  bodyGrid: { display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", marginBottom: 14 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 12, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  detailText: { fontSize: 13, color: "#444", lineHeight: 1.7, margin: 0 },
  infoRow: { display: "flex", gap: 8, marginBottom: 8, alignItems: "center", fontSize: 13 },
  infoLabel: { color: "#888", minWidth: 90, fontSize: 12 },
  warningBox: { display: "flex", alignItems: "center", gap: 8, background: "#fff8e1", border: "1px solid #ffc107", borderRadius: 7, padding: "8px 12px", fontSize: 12, color: "#795548", marginTop: 8 },
  modeChip: { fontSize: 12, fontWeight: 700, color: "#4527a0", background: "#ede7f6", borderRadius: 12, padding: "2px 10px" },
  remoteLink: { color: "#1565c0", fontWeight: 600, textDecoration: "none" },
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  resvRow: { display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 7, cursor: "pointer" },
  resvBadge: { color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "2px 8px", textTransform: "uppercase", flexShrink: 0 },
  reserveBtn: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, padding: "7px 12px", background: "#fff", color: "#7b1fa2", border: "1px solid #e1bee7", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  logisticsBtn: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, justifyContent: "center" },
  logisticsHint: { fontSize: 12, color: "#aaa", textAlign: "center", marginTop: 8 },
  quickInfo: { display: "flex", flexDirection: "column", gap: 6 },
  quickRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },

  // RSVP
  rsvpBtns: { display: "flex", gap: 8, flexWrap: "wrap" as const },
  rsvpBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, flex: 1, justifyContent: "center", minWidth: 110 },
  rsvpNote: { fontSize: 12, color: "#888", margin: "10px 0 0" },
  kidRsvpWrap: { marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef2f7" },
  kidRsvpHead: { fontSize: 11.5, fontWeight: 700, color: "#8b98a6", textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 8 },
  kidRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" as const, padding: "6px 0" },
  kidName: { fontSize: 13.5, fontWeight: 600, color: "#334", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const },
  kidStatusTag: { fontSize: 11.5, fontWeight: 700 },
  kidBtns: { display: "flex", gap: 6, flexWrap: "wrap" as const },
  kidBtn: { display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700 },
  rsvpGroups: { marginTop: 16, paddingTop: 14, borderTop: "1px solid #f0f4f8", display: "flex", flexDirection: "column" as const, gap: 12 },
  rsvpGroup: {},
  rsvpGroupHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 6 },
  rsvpGroupCount: { background: "#f0f4f8", color: "#555", borderRadius: 10, padding: "0 7px", fontSize: 11 },
  rsvpPeople: { display: "flex", flexWrap: "wrap" as const, gap: 6 },
  rsvpPerson: { display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 20, cursor: "pointer" },
  rsvpAvatar: { width: 24, height: 24, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, overflow: "hidden", flexShrink: 0, textTransform: "uppercase" as const },
  rsvpAvatarImg: { width: "100%", height: "100%", objectFit: "cover" as const },
  rsvpPersonName: { fontSize: 13, color: "#1a3a5c", fontWeight: 600 },
  rsvpPersonType: { fontSize: 10, color: "#aaa", textTransform: "capitalize" as const },

  // Attendance
  attHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f0f4f8", paddingBottom: 8, marginBottom: 12 },
  cardTitleInline: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  attCheckInBtn: { display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "#f0f4f8", color: "#1565c0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 },
  attSummary: { display: "flex", gap: 14, flexWrap: "wrap" as const, marginBottom: 14, paddingBottom: 12, borderBottom: "1px dashed #e2e8f0" },
  attStat: { display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#555" },
  hoursBreakdown: { display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0" },
  hoursChip: { display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#1565c0", background: "#f0f6ff", borderRadius: 12, padding: "3px 10px" },
  hoursChipLabel: { color: "#888", fontWeight: 600 },
  hoursChipTotal: { color: "#1a3a5c", background: "#e8f0fe", marginLeft: "auto" },
  attList: { display: "flex", flexDirection: "column" as const, gap: 4 },
  attRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 4px" },
  attAvatar: { width: 30, height: 30, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, overflow: "hidden", flexShrink: 0, textTransform: "uppercase" as const },
  attAvatarImg: { width: "100%", height: "100%", objectFit: "cover" as const },
  attName: { flex: 1, display: "flex", flexDirection: "column" as const, fontSize: 13, color: "#1a3a5c", fontWeight: 600, minWidth: 0 },
  attType: { fontSize: 11, color: "#999", fontWeight: 400, textTransform: "capitalize" as const },
  attPresent: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", padding: "3px 10px", borderRadius: 12, flexShrink: 0 },
  attStillIn: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#1565c0", background: "#e3f2fd", padding: "3px 10px", borderRadius: 12, flexShrink: 0 },
  attPresentWrap: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  attHours: { fontSize: 11, fontWeight: 600, color: "#555" },
  attAbsent: { fontSize: 12, fontWeight: 600, color: "#c62828", background: "#fdecea", padding: "3px 10px", borderRadius: 12, flexShrink: 0 },
  walkInTag: { marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#e65100", background: "#fff3e0", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" as const, letterSpacing: 0.3 },
};
