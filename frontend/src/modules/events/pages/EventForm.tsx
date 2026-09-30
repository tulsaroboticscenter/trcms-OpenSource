/**
 * EventForm — shared by both Add and Edit.
 * When eventId is provided, loads existing data and patches on save.
 * When not provided, creates a new event (optionally recurring).
 */
import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { eventsApi, type TRCEvent, type RecurrenceOptions, type RecurrencePreview } from "../api";
import { api } from "../../../core/api";
import { RefreshCw, CalendarDays, CheckCircle } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface MemberOption { id: number; first_name: string; last_name: string; member_type: string; }

const PATTERNS = [
  { value: "daily",    label: "Daily" },
  { value: "weekly",   label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly",  label: "Monthly" },
  { value: "custom",   label: "Custom interval" },
];

// const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function EventForm() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;
  const goBack = useGoBack(isEdit ? `/events/${id}` : "/events");

  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [mentors, setMentors] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Core fields
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [meetingMode, setMeetingMode] = useState<"in_person" | "remote" | "hybrid">("in_person");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteDetails, setRemoteDetails] = useState("");
  const [details, setDetails] = useState("");
  const [eventUrl, setEventUrl] = useState("");
  const [eventType, setEventType] = useState("");
  const [coordinator, setCoordinator] = useState("");
  const [mentor1, setMentor1] = useState("");
  const [mentor2, setMentor2] = useState("");
  const [postPublic, setPostPublic] = useState(false);
  const [isInformational, setIsInformational] = useState(false);
  const [isTentative, setIsTentative] = useState(false);
  const [quicktrackEnabled, setQuicktrackEnabled] = useState(false);
  const [requiresLogistics, setRequiresLogistics] = useState(false);
  const [fundraisingOpportunity, setFundraisingOpportunity] = useState(false);
  const [benefitsSeason, setBenefitsSeason] = useState("");
  // Outside-volunteer sign-up: flag the event for the My Volunteering page + its own details.
  const [volunteerOpen, setVolunteerOpen] = useState(false);
  const [volunteerSignupUrl, setVolunteerSignupUrl] = useState("");
  const [volunteerSignupNote, setVolunteerSignupNote] = useState("");
  // Default check-in activities (auto-logged at check-out) per member type.
  const [activityAreas, setActivityAreas] = useState<string[]>([]);
  const [defaultAreaYouth, setDefaultAreaYouth] = useState("");
  const [defaultAreaAdult, setDefaultAreaAdult] = useState("");
  const [defaultAreaParent, setDefaultAreaParent] = useState("");
  const [seasons, setSeasons] = useState<string[]>([]);

  // Outreach → which teams' events panes this shows on
  const [teams, setTeams] = useState<{ id: number; team_number: string; season: string; team_name?: string }[]>([]);
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  // recurrenceExpanded state removed
  const [pattern, setPattern] = useState<RecurrenceOptions["pattern"]>("weekly");
  const [interval, setInterval] = useState(1);
  const [endType, setEndType] = useState<"occurrences" | "until_date">("occurrences");
  const [occurrences, setOccurrences] = useState(10);
  const [untilDate, setUntilDate] = useState("");
  const [preview, setPreview] = useState<RecurrencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [createResult, setCreateResult] = useState<{ count: number; description: string } | null>(null);

  useEffect(() => {
    eventsApi.getTypes().then(setEventTypes);
    api.get("/api/v1/activity/areas").then((r) => setActivityAreas((r.data as { areas: string[] }).areas ?? [])).catch(() => {});
    api.get("/api/v1/seasons/").then((r) => setSeasons((r.data as { season: string }[]).map((s) => s.season))).catch(() => {});
    api.get("/api/v1/groups").then((r) => setGroups((r.data as { id: number; name: string; is_active: boolean }[]).filter((g) => g.is_active))).catch(() => {});
    api.get("/api/v1/members/?member_type=mentor&is_active=true&limit=200")
      .then((r) => setMentors(r.data.members));
    api.get("/api/v1/teams/").then(({ data }) =>
      setTeams(
        data
          .map((t: { team_number: string; current_season?: { id: number; season: string; team_name?: string } }) => ({
            id: t.current_season?.id, team_number: t.team_number,
            season: t.current_season?.season, team_name: t.current_season?.team_name,
          }))
          .filter((t: { id?: number }) => t.id)
      )
    ).catch(() => {});

    if (!isEdit) {
      // Prepopulate dates when arriving from a calendar click/drag.
      const start = searchParams.get("start");
      const end = searchParams.get("end");
      if (start) setEventDate(start);
      if (end && end !== start) setEndDate(end);
    }

    if (isEdit) {
      eventsApi.get(parseInt(id!)).then((e: TRCEvent) => {
        setName(e.name);
        setEventDate(e.event_date);
        setEndDate(e.end_date ?? "");
        setStartTime(e.start_time ?? "");
        setEndTime(e.end_time ?? "");
        setLocation(e.location ?? "");
        setMeetingMode(e.meeting_mode ?? "in_person");
        setRemoteUrl(e.remote_url ?? "");
        setRemoteDetails(e.remote_details ?? "");
        setDetails(e.details ?? "");
        setEventUrl(e.event_url ?? "");
        setEventType(e.event_type ?? "");
        setCoordinator(String(e.coordinator_id ?? ""));
        setMentor1(String(e.mentor1_id ?? ""));
        setMentor2(String(e.mentor2_id ?? ""));
        setPostPublic(e.post_to_public_calendar);
        setIsInformational(e.is_informational ?? false);
        setIsTentative(e.is_tentative ?? false);
        setQuicktrackEnabled(e.quicktrack_enabled ?? false);
        setRequiresLogistics(e.requires_logistics);
        setFundraisingOpportunity(e.fundraising_opportunity ?? false);
        setBenefitsSeason(e.benefits_season ?? "");
        setVolunteerOpen(e.volunteer_open ?? false);
        setVolunteerSignupUrl(e.volunteer_signup_url ?? "");
        setVolunteerSignupNote(e.volunteer_signup_note ?? "");
        setDefaultAreaYouth(e.default_area_youth ?? "");
        setDefaultAreaAdult(e.default_area_adult ?? "");
        setDefaultAreaParent(e.default_area_parent ?? "");
        setTeamIds(e.team_season_ids ?? []);
        setGroupIds((e as { group_ids?: number[] }).group_ids ?? []);
      }).finally(() => setLoading(false));
    }
  }, []);

  // Auto-preview when recurrence params change
  useEffect(() => {
    if (isRecurring && eventDate) {
      const timer = setTimeout(() => loadPreview(), 500);
      return () => clearTimeout(timer);
    }
  }, [isRecurring, eventDate, pattern, interval, endType, occurrences, untilDate]);

  async function loadPreview() {
    if (!eventDate) return;
    setPreviewing(true);
    try {
      const opts: RecurrenceOptions = {
        pattern, interval,
        end_type: endType,
        occurrences: endType === "occurrences" ? occurrences : undefined,
        until_date: endType === "until_date" ? untilDate || undefined : undefined,
      };
      const p = await eventsApi.previewRecurrence(eventDate, opts);
      setPreview(p);
    } catch { /* ignore preview errors */ }
    finally { setPreviewing(false); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Event name is required."); return; }
    if (!eventDate) { setError("Event date is required."); return; }
    setError("");
    setSaving(true);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      event_date: eventDate,
      end_date: endDate || null,
      start_time: startTime || null,
      end_time: endTime || null,
      location: location || null,
      meeting_mode: meetingMode,
      remote_url: meetingMode !== "in_person" ? (remoteUrl || null) : null,
      remote_details: meetingMode !== "in_person" ? (remoteDetails || null) : null,
      details: details || null,
      event_url: eventUrl || null,
      event_type: eventType || null,
      is_informational: isInformational,
      is_tentative: isTentative,
      // FLL attendance quick-tracking kiosk. Info events skip check-in, so force off there.
      quicktrack_enabled: !isInformational && quicktrackEnabled,
      coordinator_id: coordinator ? parseInt(coordinator) : null,
      // Info events are announcements only — no one checks in, so mentor coverage,
      // logistics and fundraising don't apply. Force them off regardless of prior state.
      mentor1_id: isInformational ? null : (mentor1 ? parseInt(mentor1) : null),
      mentor2_id: isInformational ? null : (mentor2 ? parseInt(mentor2) : null),
      post_to_public_calendar: postPublic,
      requires_logistics: !isInformational && requiresLogistics,
      fundraising_opportunity: !isInformational && requiresLogistics && fundraisingOpportunity,
      benefits_season: (!isInformational && requiresLogistics && fundraisingOpportunity && benefitsSeason) ? benefitsSeason : null,
      // Default check-in activities (auto-logged at check-out). Info events skip check-in.
      default_area_youth:  isInformational ? "" : defaultAreaYouth,
      default_area_adult:  isInformational ? "" : defaultAreaAdult,
      default_area_parent: isInformational ? "" : defaultAreaParent,
      team_season_ids: teamIds,   // teams whose calendars this event appears on
      group_ids: groupIds,        // member groups (YLC, committees) this event belongs to
      volunteer_open: volunteerOpen,
      volunteer_signup_url: volunteerOpen ? (volunteerSignupUrl.trim() || "") : "",
      volunteer_signup_note: volunteerOpen ? (volunteerSignupNote.trim() || "") : "",
    };

    try {
      if (isEdit) {
        const result = await eventsApi.update(parseInt(id!), payload);
        navigate(`/events/${result.id}`);
      } else if (isRecurring) {
        const recurringPayload = {
          ...payload,
          recurrence: {
            pattern,
            interval,
            end_type: endType,
            occurrences: endType === "occurrences" ? occurrences : undefined,
            until_date: endType === "until_date" ? untilDate || undefined : undefined,
          },
        };
        const result = await eventsApi.createRecurring(recurringPayload);
        setCreateResult({ count: result.count, description: result.description });
      } else {
        const result = await eventsApi.create(payload);
        if (!isInformational && requiresLogistics) navigate(`/events/${result.id}/logistics`);
        else navigate(`/events/${result.id}`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to save event.");
    } finally { setSaving(false); }
  }

  // ── Success screen after creating recurring series ─────────────────────
  if (createResult) {
    return (
      <div style={styles.successPage}>
        <div style={styles.successCard}>
          <CheckCircle size={48} color="#2e7d32" style={{ margin: "0 auto 12px", display: "block" }} />
          <h2 style={styles.successTitle}>Recurring Series Created!</h2>
          <p style={styles.successDesc}>{createResult.description}</p>
          <p style={styles.successCount}>{createResult.count} individual event records created.</p>
          <p style={styles.successNote}>Each event can be edited independently from the calendar.</p>
          <div style={styles.successActions}>
            <button style={styles.cancelBtn} onClick={goBack}>View Calendar</button>
            <button style={styles.saveBtn} onClick={() => { setCreateResult(null); setIsRecurring(false); }}>Add Another Event</button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading…</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          ← {isEdit ? "Back to Event" : "Back to Calendar"}
        </button>
        <h1 style={styles.heading}>{isEdit ? "Edit Event" : "Add Event"}</h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Core event details ── */}
        <Card title="Event Details">
          <div style={styles.grid2}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Event Name *">
                <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Team Meeting" />
              </Field>
            </div>
            <Field label="Event Type">
              <select style={styles.input} value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="">Select type…</option>
                {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Meeting Mode">
              <select style={styles.input} value={meetingMode} onChange={(e) => setMeetingMode(e.target.value as "in_person" | "remote" | "hybrid")}>
                <option value="in_person">In person</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Both (in person + remote)</option>
              </select>
            </Field>
            {meetingMode !== "remote" && (
              <Field label="Location">
                <input style={styles.input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="4500 S 129th E Ave, Tulsa" />
              </Field>
            )}
            {meetingMode !== "in_person" && (
              <>
                <Field label="Remote link">
                  <input style={styles.input} value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://meet.google.com/… or Zoom link" />
                </Field>
                <Field label="Remote details (optional)">
                  <input style={styles.input} value={remoteDetails} onChange={(e) => setRemoteDetails(e.target.value)} placeholder="Meeting ID / passcode / dial-in" />
                </Field>
              </>
            )}
            <Field label="Start Date *">
              <input type="date" style={styles.input} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </Field>
            <Field label="End Date (leave blank for single-day events)">
              <input type="date" style={styles.input} value={endDate}
                min={eventDate || undefined}
                onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <div style={styles.timeRow}>
              <Field label="Start Time">
                <input type="time" style={styles.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </Field>
              <span style={styles.timeSep}>–</span>
              <Field label="End Time">
                <input type="time" style={styles.input} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Details / Notes">
                <textarea style={styles.textarea} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Agenda, instructions, reminders…" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Event Website URL">
                <input type="url" style={styles.input} value={eventUrl} onChange={(e) => setEventUrl(e.target.value)} placeholder="https://…" />
              </Field>
            </div>
          </div>
        </Card>

        {/* ── Outside volunteers ── */}
        <Card title="Outside Volunteers">
          <label style={styles.checkRow}>
            <input type="checkbox" checked={volunteerOpen} onChange={(e) => setVolunteerOpen(e.target.checked)} />
            <span>Open this event to outside volunteers <span style={{ color: "#889", fontSize: 12.5 }}>— it will appear on the My Volunteering page for volunteers to sign up.</span></span>
          </label>
          {volunteerOpen && (
            <div style={{ marginTop: 12 }}>
              <Field label="External sign-up link (optional)">
                <input type="url" style={styles.input} value={volunteerSignupUrl} onChange={(e) => setVolunteerSignupUrl(e.target.value)} placeholder="https://… (e.g. the FIRST volunteer registration page)" />
                <div style={{ fontSize: 12, color: "#889", marginTop: 4 }}>Shown in addition to signing up through our system — e.g. a FIRST event where volunteers also register on the FIRST site.</div>
              </Field>
              <div style={{ marginTop: 12 }}>
                <Field label="Sign-up instructions (optional)">
                  <textarea style={styles.textarea} value={volunteerSignupNote} onChange={(e) => setVolunteerSignupNote(e.target.value)} placeholder="How outside volunteers should sign up, what to bring, who to contact…" />
                </Field>
              </div>
            </div>
          )}
        </Card>

        {/* ── Staff & Coverage ── (not applicable to info-only events) */}
        {!isInformational && (
        <Card title="Staff & Coverage">
          <div style={styles.grid3}>
            <Field label="Event Coordinator">
              <select style={styles.input} value={coordinator} onChange={(e) => setCoordinator(e.target.value)}>
                <option value="">Not assigned</option>
                {mentors.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </Field>
            <Field label="Mentor 1">
              <select style={styles.input} value={mentor1} onChange={(e) => setMentor1(e.target.value)}>
                <option value="">Not assigned</option>
                {mentors.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </Field>
            <Field label="Mentor 2">
              <select style={styles.input} value={mentor2} onChange={(e) => setMentor2(e.target.value)}>
                <option value="">Not assigned</option>
                {mentors.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </Field>
          </div>
          {!isRecurring && (!mentor1 || !mentor2) && (
            <div style={styles.coverageNote}>⚠ Two mentors are required for mentor coverage to be considered met.</div>
          )}
        </Card>
        )}

        {/* ── Options ── */}
        <Card title="Options">
          <label style={{ ...styles.checkRow, background: "#f3effa", border: "1px solid #d6c9ee", borderRadius: 8, padding: 10 }}>
            <input type="checkbox" checked={isInformational} onChange={(e) => setIsInformational(e.target.checked)} />
            <div>
              <div style={styles.checkLabel}>📣 Informational event (no check-in)</div>
              <div style={styles.checkHint}>An announcement, deadline, or reminder — like a holiday, but tagged to your teams. It appears on the calendar and on the calendars of any teams you select below, but no one checks in and it needs no mentors or logistics.</div>
            </div>
          </label>
          <label style={{ ...styles.checkRow, background: "#fff5e6", border: "1px solid #f0d6a8", borderRadius: 8, padding: 10, marginTop: 10 }}>
            <input type="checkbox" checked={isTentative} onChange={(e) => setIsTentative(e.target.checked)} />
            <div>
              <div style={styles.checkLabel}>❓ Tentative event (may not happen)</div>
              <div style={styles.checkHint}>Shows on the calendar with a “Tentative” tag so people know it isn’t confirmed yet. Use it to pencil something in; clear it once the event is locked in.</div>
            </div>
          </label>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={postPublic} onChange={(e) => setPostPublic(e.target.checked)} />
            <div>
              <div style={styles.checkLabel}>Post to Public Google Calendar</div>
              <div style={styles.checkHint}>Makes this event visible on the public-facing TRC calendar.</div>
            </div>
          </label>
          {!isInformational && (<>
          <label style={{ ...styles.checkRow, background: "#eef6ff", border: "1px solid #cfe2f7", borderRadius: 8, padding: 10, marginTop: 12 }}>
            <input type="checkbox" checked={quicktrackEnabled} onChange={(e) => setQuicktrackEnabled(e.target.checked)} />
            <div>
              <div style={styles.checkLabel}>🤖 Enable Quick Tracking for FLL</div>
              <div style={styles.checkHint}>Turns on the FLL Attendance Station kiosk for this event — a one-screen roster of every FLL (Explore &amp; Challenge) team with check-in / check-out boxes. Use it for FLL meeting nights so attendance credits each youth's time.</div>
            </div>
          </label>
          <label style={{ ...styles.checkRow, marginTop: 12 }}>
            <input type="checkbox" checked={requiresLogistics} onChange={(e) => setRequiresLogistics(e.target.checked)} />
            <div>
              <div style={styles.checkLabel}>Requires Logistical Support</div>
              <div style={styles.checkHint}>Adds hotel rooms, equipment checklists, and meal planning.</div>
            </div>
          </label>
          {requiresLogistics && (
            <label style={{ ...styles.checkRow, marginTop: 12 }}>
              <input type="checkbox" checked={fundraisingOpportunity} onChange={(e) => setFundraisingOpportunity(e.target.checked)} />
              <div>
                <div style={styles.checkLabel}>Team Fundraising Opportunity</div>
                <div style={styles.checkHint}>Adds a Fundraising pane to the logistics screen to split event funds among youth and credit their teams.</div>
              </div>
            </label>
          )}
          {requiresLogistics && fundraisingOpportunity && (
            <div style={{ marginTop: 12, paddingLeft: 26 }}>
              <div style={styles.checkLabel}>Benefits which season?</div>
              <div style={styles.checkHint}>
                For a summer fundraiser (camp, golf) held between seasons, pick the upcoming
                season so its earnings post into next season's team budgets. Leave as “Current /
                in-season” for a normal in-season event.
              </div>
              <select value={benefitsSeason} onChange={(e) => setBenefitsSeason(e.target.value)}
                style={{ marginTop: 6, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, minWidth: 240 }}>
                <option value="">Current / in-season</option>
                {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* Default check-in activities — pre-fill the activity dropdown at check-in
              and auto-log time at check-out, per member type. */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef2f7" }}>
            <div style={styles.checkLabel}>Default check-in activities</div>
            <div style={styles.checkHint}>
              At check-in, the activity dropdown is pre-set to these per member type; the
              person can accept it or change it. Time is auto-logged at check-out.
              Leave Parents on “None” so casual hang-outs don’t inflate the activity log.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10 }}>
              {([
                ["Youth", defaultAreaYouth, setDefaultAreaYouth],
                ["Adults / Mentors", defaultAreaAdult, setDefaultAreaAdult],
                ["Parents", defaultAreaParent, setDefaultAreaParent],
              ] as [string, string, (v: string) => void][]).map(([lbl, val, setter]) => (
                <div key={lbl} style={{ minWidth: 180 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#475569", marginBottom: 4 }}>{lbl}</div>
                  <select value={val} onChange={(e) => setter(e.target.value)}
                    style={{ padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, width: "100%" }}>
                    <option value="">— None (don’t log) —</option>
                    {activityAreas.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          </>)}
        </Card>

        {/* ── Show on team calendars (any event) ── */}
        <Card title="Show on Team Calendars">
            <p style={styles.checkHint}>
              Select the teams this event should appear on. It will show in each
              selected team's events pane, grouped by event type.
            </p>
            {teams.length === 0 ? (
              <p style={styles.previewEmpty}>No teams with a current season found.</p>
            ) : (
              <div style={styles.teamGrid}>
                {teams.map((t) => {
                  const checked = teamIds.includes(t.id);
                  return (
                    <label key={t.id} style={{ ...styles.teamRow, ...(checked ? styles.teamRowChecked : {}) }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => setTeamIds((prev) =>
                          e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id))} />
                      <span>#{t.team_number}{t.team_name ? ` — ${t.team_name}` : ""} <span style={styles.teamSeason}>({t.season})</span></span>
                    </label>
                  );
                })}
              </div>
            )}
        </Card>

        {/* ── Show to groups (YLC, committees) ── */}
        {groups.length > 0 && (
          <Card title="Show to Groups">
            <p style={styles.checkHint}>
              Tie this event to a group (like the YLC). It appears on the group's page
              and on the dashboard of every member in that group.
            </p>
            <div style={styles.teamGrid}>
              {groups.map((grp) => {
                const checked = groupIds.includes(grp.id);
                return (
                  <label key={grp.id} style={{ ...styles.teamRow, ...(checked ? styles.teamRowChecked : {}) }}>
                    <input type="checkbox" checked={checked}
                      onChange={(e) => setGroupIds((prev) =>
                        e.target.checked ? [...prev, grp.id] : prev.filter((x) => x !== grp.id))} />
                    <span>{grp.name}</span>
                  </label>
                );
              })}
            </div>
          </Card>
        )}

        {/* ── Recurrence (new events only) ── */}
        {!isEdit && (
          <Card title="Recurring Event">
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => { setIsRecurring(e.target.checked);  }}
              />
              <div>
                <div style={styles.checkLabel}>Make this a recurring event</div>
                <div style={styles.checkHint}>
                  Creates individual event records for each occurrence — each can be edited separately.
                </div>
              </div>
            </label>

            {isRecurring && (
              <div style={styles.recurrenceBox}>
                {/* Pattern */}
                <div style={styles.recurrenceGrid}>
                  <Field label="Repeats">
                    <select style={styles.input} value={pattern} onChange={(e) => setPattern(e.target.value as RecurrenceOptions["pattern"])}>
                      {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </Field>
                  {(pattern === "daily" || pattern === "custom") && (
                    <Field label={`Every N ${pattern === "daily" ? "days" : "days"}`}>
                      <input type="number" min="1" max="30" style={styles.input}
                        value={interval} onChange={e => setInterval(parseInt(e.target.value) || 1)} />
                    </Field>
                  )}
                  {pattern === "weekly" && (
                    <Field label="Every N weeks">
                      <input type="number" min="1" max="12" style={styles.input}
                        value={interval} onChange={e => setInterval(parseInt(e.target.value) || 1)} />
                    </Field>
                  )}
                </div>

                {/* End condition */}
                <div style={styles.recurrenceGrid}>
                  <Field label="Ends">
                    <div style={styles.endTypeRow}>
                      <label style={styles.radioLabel}>
                        <input type="radio" name="endType" value="occurrences"
                          checked={endType === "occurrences"} onChange={() => setEndType("occurrences")} />
                        After
                      </label>
                      <label style={styles.radioLabel}>
                        <input type="radio" name="endType" value="until_date"
                          checked={endType === "until_date"} onChange={() => setEndType("until_date")} />
                        On date
                      </label>
                    </div>
                  </Field>
                  {endType === "occurrences" ? (
                    <Field label="Number of occurrences (max 52)">
                      <input type="number" min="2" max="52" style={styles.input}
                        value={occurrences} onChange={e => setOccurrences(Math.min(52, Math.max(2, parseInt(e.target.value) || 2)))} />
                    </Field>
                  ) : (
                    <Field label="End date">
                      <input type="date" style={styles.input} value={untilDate}
                        min={eventDate} onChange={e => setUntilDate(e.target.value)} />
                    </Field>
                  )}
                </div>

                {/* Live preview */}
                <div style={styles.previewBox}>
                  <div style={styles.previewHeader}>
                    <CalendarDays size={14} color="#1a3a5c" />
                    <span style={styles.previewTitle}>Schedule Preview</span>
                    {previewing && <RefreshCw size={12} color="#aaa" style={{ animation: "spin 0.8s linear infinite" }} />}
                  </div>
                  {preview ? (
                    <>
                      <div style={styles.previewDescription}>{preview.description}</div>
                      <div style={styles.previewCount}>
                        <strong>{preview.count}</strong> event{preview.count !== 1 ? "s" : ""} will be created
                        {preview.first_date && (
                          <span style={styles.previewDates}>
                            {" "}· from {new Date(preview.first_date + "T00:00:00").toLocaleDateString()} to{" "}
                            {new Date(preview.last_date! + "T00:00:00").toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {preview.count > 0 && (
                        <div style={styles.previewScroll}>
                          {preview.dates.slice(0, 6).map((d, i) => (
                            <span key={d} style={styles.previewDateChip}>
                              {i + 1}. {new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                          ))}
                          {preview.dates.length > 6 && (
                            <span style={{ ...styles.previewDateChip, background: "#f0f4f8", color: "#888" }}>
                              +{preview.dates.length - 6} more
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={styles.previewEmpty}>Set a start date above to see the schedule.</p>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Recurring badge on edit */}
        {isEdit && (
          <div style={styles.recurringEditNote}>
            💡 This is an individual event record. To see all events in its series, use the calendar.
          </div>
        )}

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={() => navigate(isEdit ? `/events/${id}` : "/events")} style={styles.cancelBtn}>
            Cancel
          </button>
          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving
              ? (isRecurring ? "Creating series…" : "Saving…")
              : isEdit
              ? "Save Changes"
              : isRecurring
              ? `Create ${preview?.count ?? ""} Events`
              : (!isInformational && requiresLogistics)
              ? "Save & Set Up Logistics →"
              : isInformational
              ? "Save Info Event"
              : "Save Event"
            }
          </button>
        </div>
      </form>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 780, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 1rem", fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px" },
  timeRow: { display: "flex", alignItems: "flex-end", gap: 8 },
  timeSep: { paddingBottom: 9, color: "#888", fontWeight: 700 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical" as const, boxSizing: "border-box" as const },
  coverageNote: { marginTop: 10, padding: "8px 12px", background: "#fff8e1", border: "1px solid #ffc107", borderRadius: 6, fontSize: 12, color: "#795548" },
  checkRow: { display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" },
  checkLabel: { fontSize: 14, fontWeight: 600, color: "#333" },
  checkHint: { fontSize: 12, color: "#888", marginTop: 2, lineHeight: 1.5 },
  // Recurrence
  teamGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginTop: 10 },
  teamRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 13, color: "#1a3a5c", background: "#fafafa" },
  teamRowChecked: { background: "#e8f5e9", borderColor: "#a5d6a7" },
  teamSeason: { color: "#888", fontSize: 11 },
  recurrenceBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px", marginTop: 10, display: "flex", flexDirection: "column", gap: 12 },
  recurrenceGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  endTypeRow: { display: "flex", gap: 16, paddingTop: 4 },
  radioLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" },
  previewBox: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px" },
  previewHeader: { display: "flex", alignItems: "center", gap: 7, marginBottom: 8 },
  previewTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  previewDescription: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", marginBottom: 4 },
  previewCount: { fontSize: 13, color: "#555", marginBottom: 8 },
  previewDates: { color: "#888", fontWeight: 400 },
  previewScroll: { display: "flex", flexWrap: "wrap", gap: 4 },
  previewDateChip: { fontSize: 11, padding: "2px 8px", background: "#e3f2fd", color: "#1565c0", borderRadius: 6 },
  previewEmpty: { fontSize: 12, color: "#aaa", margin: 0 },
  recurringEditNote: { padding: "10px 14px", background: "#f0f4f8", borderRadius: 7, fontSize: 13, color: "#666", marginBottom: 14 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 32 },
  cancelBtn: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  successPage: { minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" },
  successCard: { background: "#fff", border: "1px solid #a5d6a7", borderRadius: 14, padding: "2.5rem", textAlign: "center", maxWidth: 480, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" },
  successTitle: { margin: "0 0 10px", fontSize: 22, fontWeight: 700, color: "#2e7d32" },
  successDesc: { fontSize: 15, fontWeight: 600, color: "#1a3a5c", margin: "0 0 6px" },
  successCount: { fontSize: 14, color: "#555", margin: "0 0 6px" },
  successNote: { fontSize: 12, color: "#888", margin: "0 0 20px" },
  successActions: { display: "flex", gap: 10, justifyContent: "center" },
};
