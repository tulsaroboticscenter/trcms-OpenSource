import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { eventsApi, mentorAvailabilityApi, transportApi, type TRCEvent, type CalendarSubscription, type MentorUnavailability, type Birthday } from "../api";
import { ChevronLeft, ChevronRight, PlusCircle, List, Search, X, CalendarPlus, Copy, Check, RefreshCw, ShieldCheck, UserCheck, CheckSquare, Plane, Cake } from "lucide-react";
import InlineHelp from "../../help/InlineHelp";
import EventTransportPrompt from "../components/EventTransportPrompt";

/** Coverage/RSVP overlay colors. */
const HL = { green: "#2e7d32", yellow: "#f9a825", red: "#c62828" };
/** Green ≥3 mentors attending, yellow =2, red <2. Info events don't need coverage. */
function mentorColor(e: TRCEvent): string | null {
  if (e.is_informational) return null;
  const n = e.mentor_attending ?? 0;
  return n >= 3 ? HL.green : n === 2 ? HL.yellow : HL.red;
}
/** Green = I'm Attending, yellow = Maybe/Not Attending, red = no response. */
function rsvpColor(e: TRCEvent): string | null {
  if (e.is_informational) return null;
  const s = e.my_rsvp;
  if (s === "Attending") return HL.green;
  if (s === "Maybe" || s === "Not Attending") return HL.yellow;
  return HL.red;
}
function overlayColor(mode: "none" | "mentor" | "rsvp", e: TRCEvent): string | null {
  return mode === "mentor" ? mentorColor(e) : mode === "rsvp" ? rsvpColor(e) : null;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  "Regular Meeting":   "#1565c0",
  "Add-On Meeting":    "#1976d2",
  "Training":          "#6a1b9a",
  "Scrimmage":         "#e65100",
  "Competition":       "#c62828",
  "Outreach Event":    "#2e7d32",
  "Open House":        "#00695c",
  "Information Session": "#4527a0",
  "Parent Meeting":    "#558b2f",
  "Field Trip":        "#f57f17",
  "Other":             "#546e7a",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function EventCalendar() {
  const navigate = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const canEdit = isAdmin || hasRole("Admin", "System Administrator", "Mentor");

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [events, setEvents] = useState<TRCEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"month" | "list">("month");
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [search, setSearch] = useState("");
  const [searchHits, setSearchHits] = useState<TRCEvent[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [holidays, setHolidays] = useState<Record<string, string[]>>({});
  // Mentor unavailability overlay — hidden by default; admins/lead see all, a
  // mentor sees only their own (enforced server-side).
  const canLogUnavail = isAdmin || hasRole("Admin", "System Administrator", "Mentor", "Mentor - Lead", "Mentor - Junior");
  const [showUnavail, setShowUnavail] = useState(false);
  const [showBirthdays, setShowBirthdays] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [unavail, setUnavail] = useState<MentorUnavailability[]>([]);
  const [addUnavail, setAddUnavail] = useState<{ start: string; end: string; note: string } | null>(null);
  // Calendar overlays: highlight events by mentor coverage or by my own RSVP.
  const [highlight, setHighlight] = useState<"none" | "mentor" | "rsvp">("none");
  const [hover, setHover] = useState<{ e: TRCEvent; x: number; y: number } | null>(null);
  const [transportPrompt, setTransportPrompt] = useState<{ eventId: number; eventName: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openHover = (e: TRCEvent, r: DOMRect) => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setHover({ e, x: r.left, y: r.bottom }); };
  const closeHoverSoon = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(null), 180); };
  async function quickRsvp(id: number, status: "Attending" | "Not Attending" | "Maybe") {
    await eventsApi.rsvp(id, status);
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, my_rsvp: status } : ev));
    setHover((h) => h && h.e.id === id ? { ...h, e: { ...h.e, my_rsvp: status } } : h);
    // If they're attending (or maybe) an event with transportation planning on and
    // haven't given a plan yet, ask now — same prompt as the event page.
    if (status === "Attending" || status === "Maybe") {
      try {
        const t = await transportApi.list(id);
        if (t.transport_enabled && !t.my_response) {
          const name = events.find((ev) => ev.id === id)?.name ?? "Event";
          setHover(null);
          setTransportPrompt({ eventId: id, eventName: name });
        }
      } catch { /* transport not enabled */ }
    }
  }
  // Load mentor unavailability for the visible month when the overlay is on.
  function loadUnavail() {
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${new Date(year, month + 1, 0).getDate()}`;
    mentorAvailabilityApi.list(from, to).then((r) => setUnavail(r.entries)).catch(() => setUnavail([]));
  }
  useEffect(() => { if (showUnavail) loadUnavail(); /* eslint-disable-next-line */ }, [showUnavail, year, month]);
  // Birthdays overlay: members whose birthday falls in the visible month. Staff-only —
  // the endpoint is gated to Mentor+, so ordinary members don't see the toggle at all.
  useEffect(() => {
    if (!showBirthdays || !canEdit) return;
    eventsApi.birthdays(month + 1).then((r) => setBirthdays(r.birthdays)).catch(() => setBirthdays([]));
  }, [showBirthdays, month, canEdit]);
  async function saveUnavail() {
    if (!addUnavail?.start) return;
    await mentorAvailabilityApi.create({ start_date: addUnavail.start, end_date: addUnavail.end || addUnavail.start, note: addUnavail.note || undefined });
    setAddUnavail(null); setShowUnavail(true); loadUnavail();
  }
  async function deleteUnavail(id: number) {
    if (!confirm("Remove this unavailability entry?")) return;
    await mentorAvailabilityApi.remove(id); loadUnavail();
  }

  // List-mode multi-select for bulk RSVP.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelect = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function bulkRsvp(status: "Attending" | "Not Attending" | "Maybe") {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      await eventsApi.bulkRsvp([...selected], status);
      setSelected(new Set()); setSelectMode(false);
      await loadMonth(year, month);
    } finally { setBulkBusy(false); }
  }

  async function runSearch() {
    const q = search.trim().toLowerCase();
    if (q.length < 2) { setSearchHits(null); return; }
    setSearching(true);
    try {
      // Search across a wide window (past 3y → next 2y), not just the current month.
      const from = new Date(today.getFullYear() - 3, 0, 1).toISOString().slice(0, 10);
      const to = new Date(today.getFullYear() + 2, 11, 31).toISOString().slice(0, 10);
      const result = await eventsApi.list({ from_date: from, to_date: to });
      setSearchHits(result.events.filter((e) => e.name.toLowerCase().includes(q)));
    } finally { setSearching(false); }
  }
  function clearSearch() { setSearch(""); setSearchHits(null); }

  // Click / drag-to-select for creating events (admins/mentors)
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    loadMonth(year, month);
  }, [year, month]);

  // Finalize a selection on mouse-up anywhere — navigate to create with the
  // earliest selected date as start and the latest as end (order-independent).
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => {
      setDragging(false);
      if (dragStart == null) return;
      const lo = Math.min(dragStart, dragEnd ?? dragStart);
      const hi = Math.max(dragStart, dragEnd ?? dragStart);
      const p = new URLSearchParams();
      p.set("start", dateStr(lo));
      if (hi !== lo) p.set("end", dateStr(hi));
      setDragStart(null); setDragEnd(null);
      navigate(`/events/add?${p.toString()}`);
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragging, dragStart, dragEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMonth(y: number, m: number) {
    setLoading(true);
    const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, "0")}-${lastDay}`;
    try {
      const result = await eventsApi.list({ from_date: from, to_date: to });
      setEvents(result.events);
      eventsApi.getHolidays(from, to).then((hs) => {
        const map: Record<string, string[]> = {};
        for (const h of hs) {
          const start = new Date(h.date + "T00:00:00");
          const end = new Date((h.end_date ?? h.date) + "T00:00:00");
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            (map[key] = map[key] ?? []).push(h.name);
          }
        }
        setHolidays(map);
      }).catch(() => setHolidays({}));
    } finally {
      setLoading(false);
    }
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete rows
  while (cells.length % 7 !== 0) cells.push(null);

  type EventPosition = "single" | "start" | "middle" | "end";

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function unavailForDay(day: number): MentorUnavailability[] {
    const d = dateStr(day);
    return unavail.filter((u) => u.start_date <= d && d <= u.end_date);
  }

  function birthdaysForDay(day: number): Birthday[] {
    return showBirthdays ? birthdays.filter((b) => b.day === day) : [];
  }

  function eventsForDay(day: number): { event: TRCEvent; position: EventPosition }[] {
    const d = dateStr(day);
    const result: { event: TRCEvent; position: EventPosition }[] = [];
    for (const e of events) {
      if (!e.end_date || e.end_date === e.event_date) {
        // Single-day event
        if (e.event_date === d) result.push({ event: e, position: "single" });
      } else {
        // Multi-day: include if this day is within the range
        if (e.event_date <= d && e.end_date >= d) {
          let position: EventPosition;
          if (e.event_date === d) position = "start";
          else if (e.end_date === d) position = "end";
          else position = "middle";
          result.push({ event: e, position });
        }
      }
    }
    // Sort: multi-day events first (so their bars align), then single
    result.sort((a, b) => {
      const aMulti = a.event.end_date ? 1 : 0;
      const bMulti = b.event.end_date ? 1 : 0;
      return bMulti - aMulti;
    });
    return result;
  }

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const selLo = dragStart != null ? Math.min(dragStart, dragEnd ?? dragStart) : null;
  const selHi = dragStart != null ? Math.max(dragStart, dragEnd ?? dragStart) : null;
  const inSelection = (day: number) => selLo != null && day >= selLo && day <= (selHi as number);

  return (
    <div>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.heading}>Events &amp; Calendar <InlineHelp helpKey="events-calendar" /></h1>
          <p style={styles.sub}>
            {loading ? "Loading…" : `${events.length} event${events.length !== 1 ? "s" : ""} in ${MONTHS[month]} ${year}`}
          </p>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.searchWrap}>
            <Search size={15} color="#aaa" />
            <input style={styles.searchInput} value={search} placeholder="Search events…"
              onChange={(e) => { setSearch(e.target.value); if (!e.target.value.trim()) setSearchHits(null); }}
              onKeyDown={(e) => e.key === "Enter" && runSearch()} />
            {search && <button style={styles.searchClear} onClick={clearSearch}><X size={13} /></button>}
          </div>
          <div style={styles.viewToggle}>
            <button
              style={{ ...styles.viewBtn, ...(view === "month" ? styles.viewBtnActive : {}) }}
              onClick={() => setView("month")}
            >📅 Month</button>
            <button
              style={{ ...styles.viewBtn, ...(view === "list" ? styles.viewBtnActive : {}) }}
              onClick={() => setView("list")}
            ><List size={13} /> List</button>
          </div>
          <button
            style={{ ...styles.overlayBtn, ...(highlight === "mentor" ? styles.overlayBtnActive : {}) }}
            onClick={() => setHighlight((h) => (h === "mentor" ? "none" : "mentor"))}
            title="Highlight every event by how many mentors have RSVP'd Attending (2-deep coverage)"
          ><ShieldCheck size={15} /> Mentor Coverage</button>
          <button
            style={{ ...styles.overlayBtn, ...(highlight === "rsvp" ? styles.overlayBtnActive : {}) }}
            onClick={() => setHighlight((h) => (h === "rsvp" ? "none" : "rsvp"))}
            title="Highlight every event by your own RSVP status"
          ><UserCheck size={15} /> RSVP Status</button>
          <button
            style={{ ...styles.overlayBtn, ...(showUnavail ? styles.overlayBtnActive : {}) }}
            onClick={() => setShowUnavail((v) => !v)}
            title="Show mentor travel / unavailable dates (visible to admins & lead mentors; you always see your own)"
          ><Plane size={15} /> Unavailability</button>
          {canEdit && (
            <button
              style={{ ...styles.overlayBtn, ...(showBirthdays ? styles.overlayBtnActive : {}) }}
              onClick={() => setShowBirthdays((v) => !v)}
              title="Show whose birthday falls in this month"
            ><Cake size={15} /> Birthdays{showBirthdays && birthdays.length > 0 ? ` (${birthdays.length})` : ""}</button>
          )}
          {canLogUnavail && (
            <button style={styles.subscribeBtn} onClick={() => { const n = new Date(); setAddUnavail({ start: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`, end: "", note: "" }); }}
              title="Log when you'll be traveling or unavailable">
              <Plane size={15} /> I'm Unavailable
            </button>
          )}
          <button style={styles.subscribeBtn} onClick={() => setShowSubscribe(true)} title="Subscribe in Google/Apple/Outlook or export .ics">
            <CalendarPlus size={15} /> Subscribe
          </button>
          {canEdit && (
            <button style={styles.addBtn} onClick={() => navigate("/events/add")}>
              <PlusCircle size={15} /> Add Event
            </button>
          )}
        </div>
      </div>

      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}

      {addUnavail && (
        <div style={styles.modalOverlay} onClick={() => setAddUnavail(null)}>
          <div style={{ ...styles.modalCard, width: "min(420px, 100%)", padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 4px", color: "#1a3a5c" }}><Plane size={16} style={{ verticalAlign: -2 }} /> Mark yourself unavailable</h3>
            <p style={{ fontSize: 12, color: "#888", margin: "0 0 14px" }}>Informational only — this doesn't affect events or RSVPs. Visible to admins & lead mentors; you can always see and remove your own.</p>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <label style={{ flex: 1, fontSize: 12, color: "#555" }}>From
                <input type="date" value={addUnavail.start} onChange={(e) => setAddUnavail({ ...addUnavail, start: e.target.value })} style={ua.input} />
              </label>
              <label style={{ flex: 1, fontSize: 12, color: "#555" }}>To
                <input type="date" value={addUnavail.end} min={addUnavail.start} onChange={(e) => setAddUnavail({ ...addUnavail, end: e.target.value })} style={ua.input} />
              </label>
            </div>
            <label style={{ fontSize: 12, color: "#555" }}>Note (optional)
              <input type="text" value={addUnavail.note} placeholder="e.g. Traveling for work" maxLength={300} onChange={(e) => setAddUnavail({ ...addUnavail, note: e.target.value })} style={ua.input} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button style={ua.cancel} onClick={() => setAddUnavail(null)}>Cancel</button>
              <button style={ua.save} onClick={saveUnavail} disabled={!addUnavail.start}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      {searchHits !== null ? (
        <div style={styles.listView}>
          <p style={styles.sub}>{searching ? "Searching…" : `${searchHits.length} event${searchHits.length !== 1 ? "s" : ""} matching “${search.trim()}”`}</p>
          {searchHits.length === 0 ? (
            <div style={styles.empty}>No events match “{search.trim()}”.</div>
          ) : (
            searchHits.map((e) => <EventListRow key={e.id} event={e} onClick={() => navigate(`/events/${e.id}`)} />)
          )}
        </div>
      ) : (
      <>
      <div style={styles.nav}>
        <button style={styles.navBtn} onClick={prevMonth}><ChevronLeft size={18} /></button>
        <div style={styles.monthLabel}>
          <span style={styles.monthName}>{MONTHS[month]}</span>
          <span style={styles.yearName}>{year}</span>
        </div>
        <button style={styles.navBtn} onClick={nextMonth}><ChevronRight size={18} /></button>
        <button style={styles.todayBtn} onClick={goToday}>Today</button>
      </div>

      {highlight !== "none" && (
        <div style={styles.legend}>
          <span style={styles.legendTitle}>{highlight === "mentor" ? "Mentor coverage:" : "My RSVP:"}</span>
          {highlight === "mentor" ? (
            <>
              <LegendDot color={HL.green} label="3+ attending" />
              <LegendDot color={HL.yellow} label="exactly 2" />
              <LegendDot color={HL.red} label="under 2" />
              <span style={styles.legendHint}>Number = mentors who RSVP'd Attending. Info events are excluded.</span>
            </>
          ) : (
            <>
              <LegendDot color={HL.green} label="Attending" />
              <LegendDot color={HL.yellow} label="Maybe / Not attending" />
              <LegendDot color={HL.red} label="No response yet" />
            </>
          )}
          <button style={styles.legendClear} onClick={() => setHighlight("none")}><X size={12} /> Clear</button>
        </div>
      )}

      {view === "month" && canEdit && (
        <p style={styles.dragHint}>💡 Click a day to add an event, or drag across days for a multi-day event.</p>
      )}

      {view === "month" ? (
        /* ── Month Grid ── */
        <div style={{ ...styles.calendar, ...(canEdit ? { userSelect: "none" as const } : {}) }}>
          {/* Day headers */}
          {DAYS.map((d) => (
            <div key={d} style={styles.dayHeader}>{d}</div>
          ))}
          {/* Date cells */}
          {cells.map((day, i) => (
            <div
              key={i}
              style={{
                ...styles.cell,
                ...(day === null ? styles.cellEmpty : {}),
                ...(canEdit && day ? styles.cellEditable : {}),
                ...(day && isToday(day) ? styles.cellToday : {}),
                ...(day && inSelection(day) ? styles.cellSelected : {}),
              }}
              onMouseDown={canEdit && day ? (e) => { e.preventDefault(); setDragStart(day); setDragEnd(day); setDragging(true); } : undefined}
              onMouseEnter={canEdit && dragging && day ? () => setDragEnd(day) : undefined}
            >
              {day && (
                <>
                  <div style={{ ...styles.dayNum, ...(isToday(day) ? styles.dayNumToday : {}) }}>
                    {day}
                  </div>
                  {holidays[dateStr(day)] && (
                    <div style={styles.holidayMark} title={holidays[dateStr(day)].join(", ")}>🎉 {holidays[dateStr(day)][0]}</div>
                  )}
                  <div style={styles.eventChips}>
                    {eventsForDay(day).slice(0, 3).map(({ event: e, position }) => (
                      <EventChip
                        key={`${e.id}-${position}`}
                        event={e}
                        position={position}
                        highlight={highlight}
                        onClick={() => navigate(`/events/${e.id}`)}
                        onHover={openHover}
                        onLeave={closeHoverSoon}
                      />
                    ))}
                    {eventsForDay(day).length > 3 && (
                      <div style={styles.moreChip}>+{eventsForDay(day).length - 3} more</div>
                    )}
                    {showUnavail && unavailForDay(day).map((u) => (
                      <div key={`u${u.id}`} style={styles.unavailChip}
                        title={`${u.member_name} unavailable${u.note ? ` — ${u.note}` : ""}`}
                        onClick={(ev) => { ev.stopPropagation(); if (u.is_own || canLogUnavail) deleteUnavail(u.id); }}>
                        <Plane size={10} /> {u.member_name}
                      </div>
                    ))}
                    {birthdaysForDay(day).map((b) => (
                      <div key={`b${b.member_id}`} style={styles.birthdayChip}
                        title={`${b.name}'s birthday`}
                        onClick={(ev) => { ev.stopPropagation(); navigate(`/members/${b.member_id}`); }}>
                        🎂 {b.name}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ── List View ── */
        <div style={styles.listView}>
          <div style={styles.listBar}>
            <button
              style={{ ...styles.selectToggle, ...(selectMode ? styles.selectToggleOn : {}) }}
              onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
            >
              <CheckSquare size={15} /> {selectMode ? "Cancel selection" : "Select to RSVP"}
            </button>
            {selectMode && events.length > 0 && (
              <button style={styles.selectAll}
                onClick={() => setSelected((s) => s.size === events.length ? new Set() : new Set(events.map((e) => e.id)))}>
                {selected.size === events.length ? "Clear all" : "Select all"}
              </button>
            )}
          </div>
          {events.length === 0 ? (
            <div style={styles.empty}>No events in {MONTHS[month]} {year}.</div>
          ) : (
            events.map((e) => (
              <EventListRow key={e.id} event={e}
                onClick={() => navigate(`/events/${e.id}`)}
                selectable={selectMode} selected={selected.has(e.id)} onToggleSelect={() => toggleSelect(e.id)} />
            ))
          )}
        </div>
      )}

      {/* Bulk RSVP action bar — appears when events are selected in list mode */}
      {selectMode && selected.size > 0 && (
        <div style={styles.bulkBar}>
          <span style={styles.bulkCount}>{selected.size} selected</span>
          <span style={styles.bulkLabel}>Set my RSVP to:</span>
          <button disabled={bulkBusy} style={{ ...styles.bulkBtn, background: "#2e7d32" }} onClick={() => bulkRsvp("Attending")}>Attending</button>
          <button disabled={bulkBusy} style={{ ...styles.bulkBtn, background: "#e65100" }} onClick={() => bulkRsvp("Maybe")}>Maybe</button>
          <button disabled={bulkBusy} style={{ ...styles.bulkBtn, background: "#c62828" }} onClick={() => bulkRsvp("Not Attending")}>Not Attending</button>
        </div>
      )}
      </>
      )}

      {/* Legend */}
      <div style={styles.legend}>
        {Object.entries(EVENT_TYPE_COLORS).map(([type, color]) => (
          <div key={type} style={styles.legendItem}>
            <div style={{ ...styles.legendDot, background: color }} />
            <span>{type}</span>
          </div>
        ))}
      </div>

      {hover && (
        <EventHoverCard event={hover.e} x={hover.x} y={hover.y}
          onEnter={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
          onLeave={() => setHover(null)}
          onRsvp={(s) => quickRsvp(hover.e.id, s)}
          onOpen={() => { setHover(null); navigate(`/events/${hover.e.id}`); }} />
      )}

      {transportPrompt && (
        <EventTransportPrompt eventId={transportPrompt.eventId} eventName={transportPrompt.eventName}
          onClose={() => setTransportPrompt(null)} onSaved={() => setTransportPrompt(null)} />
      )}
    </div>
  );
}

/** Google-style quick-peek shown on calendar event hover. */
function EventHoverCard({ event: e, x, y, onEnter, onLeave, onRsvp, onOpen }: {
  event: TRCEvent; x: number; y: number; onEnter: () => void; onLeave: () => void;
  onRsvp: (s: "Attending" | "Not Attending" | "Maybe") => void; onOpen: () => void;
}) {
  const cov = e.is_informational ? null : (e.mentor_attending ?? 0);
  const covColor = cov === null ? "#999" : cov >= 3 ? "#2e7d32" : cov === 2 ? "#f9a825" : "#c62828";
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y + 4, window.innerHeight - 220);
  const rsvpBtn = (s: "Attending" | "Not Attending" | "Maybe", bg: string) => (
    <button onClick={() => onRsvp(s)}
      style={{ flex: 1, padding: "5px 4px", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700,
        background: e.my_rsvp === s ? bg : "#eef1f5", color: e.my_rsvp === s ? "#fff" : "#556" }}>{s === "Not Attending" ? "No" : s}</button>
  );
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ position: "fixed", left, top, width: 280, background: "#fff", border: "1px solid #d5dde5", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.2)", zIndex: 2000, padding: 12, fontSize: 13 }}>
      <div style={{ fontWeight: 700, color: "#1a3a5c", fontSize: 14, marginBottom: 4 }}>{e.name}</div>
      <div style={{ color: "#607d8b", fontSize: 12, marginBottom: 2 }}>
        {new Date(e.event_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        {e.start_time ? ` · ${fmtTime(e.start_time)}${e.end_time ? `–${fmtTime(e.end_time)}` : ""}` : ""}
      </div>
      {e.meeting_mode && e.meeting_mode !== "in_person"
        ? <div style={{ color: "#4527a0", fontSize: 12, marginBottom: 2 }}>🖥 {e.meeting_mode === "remote" ? "Remote" : "In person + Remote"}</div>
        : e.location ? <div style={{ color: "#607d8b", fontSize: 12, marginBottom: 2 }}>📍 {e.location}</div> : null}
      {cov !== null && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: covColor, marginRight: 5 }} />
          Mentor coverage: <strong>{cov}</strong> attending {cov >= 2 ? "✓" : "(need 2)"}
        </div>
      )}
      {!e.is_informational && (
        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          {rsvpBtn("Attending", "#2e7d32")}{rsvpBtn("Maybe", "#e65100")}{rsvpBtn("Not Attending", "#c62828")}
        </div>
      )}
      <button onClick={onOpen} style={{ width: "100%", padding: "6px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>View full details →</button>
    </div>
  );
}

function EventChip({ event: e, onClick, position = "single", highlight = "none", onHover, onLeave }: {
  event: TRCEvent;
  onClick: () => void;
  position?: "single" | "start" | "middle" | "end";
  highlight?: "none" | "mentor" | "rsvp";
  onHover?: (e: TRCEvent, rect: DOMRect) => void;
  onLeave?: () => void;
}) {
  const overlay = overlayColor(highlight, e);
  // In an overlay mode, color the chip by coverage/RSVP; events it doesn't apply to
  // (info events) fade so they read as "not part of this check".
  const baseColor = e.is_informational ? "#7e57c2" : (EVENT_TYPE_COLORS[e.event_type ?? ""] ?? "#546e7a");
  const color = highlight !== "none" ? (overlay ?? baseColor) : baseColor;
  const faded = highlight !== "none" && !overlay;
  const isStart = position === "single" || position === "start";

  // Border radius: left corners rounded for start/single, right corners rounded for end/single
  const borderRadius =
    position === "single" ? 4
    : position === "start" ? "4px 0 0 4px"
    : position === "end"   ? "0 4px 4px 0"
    : 0;  // middle: square on both sides

  // Extend chips to fill the full cell width on continuation days (negative margins bleed to edges)
  const marginLeft  = (position === "middle" || position === "end")  ? -4 : 0;
  const marginRight = (position === "middle" || position === "start") ? -4 : 0;

  return (
    <div
      style={{
        ...styles.chip,
        background: color,
        borderRadius,
        marginLeft,
        marginRight,
        opacity: faded ? 0.35 : (position === "middle" || position === "end") ? 0.88 : 1,
        paddingLeft:  isStart ? undefined : 2,
        paddingRight: (position === "end" || position === "single") ? undefined : 2,
        // Tentative events read as "penciled in": a dashed outline sets them apart.
        ...(e.is_tentative ? { border: "1.5px dashed rgba(255,255,255,.9)", outline: "1px solid rgba(0,0,0,.06)" } : {}),
      }}
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      onMouseEnter={(ev) => onHover?.(e, ev.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onLeave?.()}
    >
      {/* Only show content on the start (or single) day */}
      {isStart && e.is_recurring && <span style={styles.recurringDot} />}
      {isStart && highlight === "mentor" && !e.is_informational && (
        <span style={styles.chipCount} title={`${e.mentor_attending ?? 0} mentor(s) attending`}>{e.mentor_attending ?? 0}</span>
      )}
      {isStart && highlight !== "mentor" && e.is_informational && <span style={styles.chipTime}>📣</span>}
      {isStart && highlight === "none" && !e.is_informational && e.start_time && <span style={styles.chipTime}>{fmtTime(e.start_time)}</span>}
      {isStart && e.is_tentative && <span style={styles.chipTime} title="Tentative — may not happen">❓</span>}
      {isStart && <span style={styles.chipName}>{e.name}</span>}
      {isStart && highlight === "none" && !e.is_informational && !e.mentor_coverage_met && !e.is_recurring && <span style={styles.chipWarning}>⚠</span>}
      {/* Middle/end: just a blank bar — the colour communicates continuation */}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={styles.legendItem}>
      <span style={{ ...styles.legendDot, background: color }} />
      <span>{label}</span>
    </span>
  );
}

function EventListRow({ event: e, onClick, selectable = false, selected = false, onToggleSelect }: {
  event: TRCEvent; onClick: () => void;
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
}) {
  const color = EVENT_TYPE_COLORS[e.event_type ?? ""] ?? "#546e7a";
  const myRsvpColor = e.my_rsvp === "Attending" ? "#2e7d32" : e.my_rsvp === "Maybe" ? "#e65100" : e.my_rsvp === "Not Attending" ? "#c62828" : null;
  return (
    <div style={{ ...styles.listRow, ...(selected ? { background: "#eef4ff", borderColor: "#9db8e8" } : {}) }}
      onClick={selectable ? onToggleSelect : onClick}>
      {selectable && (
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect?.()} onClick={(ev) => ev.stopPropagation()}
          style={{ width: 17, height: 17, flexShrink: 0, cursor: "pointer" }} />
      )}
      <div style={{ ...styles.listColorBar, background: color }} />
      <div style={styles.listDate}>
        {e.end_date ? (
          /* Multi-day: compact range */
          <>
            <div style={styles.listDateDay}>{new Date(e.event_date + "T00:00:00").getDate()}</div>
            <div style={{ fontSize: 10, color: "#aaa", lineHeight: 1 }}>
              {MONTHS[new Date(e.event_date + "T00:00:00").getMonth()].slice(0, 3)}
            </div>
            <div style={{ fontSize: 10, color: "#ccc" }}>↓</div>
            <div style={styles.listDateDay}>{new Date(e.end_date + "T00:00:00").getDate()}</div>
            <div style={{ fontSize: 10, color: "#aaa", lineHeight: 1 }}>
              {MONTHS[new Date(e.end_date + "T00:00:00").getMonth()].slice(0, 3)}
            </div>
          </>
        ) : (
          <>
            <div style={styles.listDateDay}>{new Date(e.event_date + "T00:00:00").getDate()}</div>
            <div style={styles.listDateMon}>{MONTHS[new Date(e.event_date + "T00:00:00").getMonth()].slice(0, 3)}</div>
          </>
        )}
      </div>
      <div style={styles.listInfo}>
        <div style={styles.listName}>{e.name}</div>
        <div style={styles.listMeta}>
          {e.event_type && <span style={{ ...styles.listTypeBadge, background: color }}>{e.event_type}</span>}
          {e.start_time && <span>{fmtTime(e.start_time)}{e.end_time ? ` – ${fmtTime(e.end_time)}` : ""}</span>}
          {e.location && <span>📍 {e.location}</span>}
          {myRsvpColor && <span style={{ ...styles.rsvpChip, color: myRsvpColor, background: "#f4f6fb", fontWeight: 700 }}>You: {e.my_rsvp}</span>}
          {e.rsvp && (e.rsvp.attending + e.rsvp.maybe + e.rsvp.not_attending) > 0 && (
            <span style={styles.rsvpGroup} title="RSVPs (Attending / Maybe / Not attending)">
              {e.rsvp.attending > 0 && <span style={{ ...styles.rsvpChip, color: "#2e7d32", background: "#e8f5e9" }}>✓ {e.rsvp.attending}</span>}
              {e.rsvp.maybe > 0 && <span style={{ ...styles.rsvpChip, color: "#e65100", background: "#fff3e0" }}>? {e.rsvp.maybe}</span>}
              {e.rsvp.not_attending > 0 && <span style={{ ...styles.rsvpChip, color: "#c62828", background: "#fdecea" }}>✗ {e.rsvp.not_attending}</span>}
            </span>
          )}
        </div>
      </div>
      <div style={styles.listFlags}>
        {e.is_recurring && <span style={styles.recurringTag}>↻ Recurring</span>}
        {!e.mentor_coverage_met && !e.is_recurring && <span style={styles.warnTag}>⚠ Coverage</span>}
        {e.requires_logistics && <span style={styles.logisticsTag}>✈ Travel</span>}
        {e.post_to_public_calendar && <span style={styles.publicTag}>📅 Public</span>}
      </div>
    </div>
  );
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function SubscribeModal({ onClose }: { onClose: () => void }) {
  const [sub, setSub] = useState<CalendarSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    eventsApi.getCalendarSubscription()
      .then(setSub)
      .catch(() => setError("Could not load your calendar subscription."))
      .finally(() => setLoading(false));
  }, []);

  function copy(key: string, value: string) {
    navigator.clipboard?.writeText(value)
      .then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); })
      .catch(() => {});
  }

  async function rotate() {
    if (!window.confirm("Reset your private calendar link? Any device already subscribed with the old link will stop updating until you re-subscribe.")) return;
    setRotating(true);
    try { setSub(await eventsApi.rotateCalendarToken()); }
    catch { setError("Could not reset the link."); }
    finally { setRotating(false); }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <h2 style={styles.modalTitle}><CalendarPlus size={18} /> Subscribe to the Calendar</h2>
          <button style={styles.modalClose} onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? <p style={styles.sub}>Loading…</p> : error ? <div style={styles.subError}>{error}</div> : sub && (
          <div style={styles.subBody}>
            <p style={styles.subIntro}>
              Subscribe once and TRC events stay up to date in your calendar app automatically.
              This is your <strong>private link</strong> — anyone with it can see the full calendar, so don't share it.
            </p>

            <div style={styles.subActions}>
              <a style={styles.subPrimary} href={sub.personal_webcal_url}>
                <CalendarPlus size={15} /> Add to Apple / Outlook
              </a>
              <a style={styles.subGoogle} href={sub.google_add_url} target="_blank" rel="noreferrer">
                Add to Google Calendar
              </a>
            </div>

            <CopyField label="Subscription link (paste into any calendar app)" value={sub.personal_ics_url}
              copied={copied === "personal"} onCopy={() => copy("personal", sub.personal_ics_url)} />

            <div style={styles.subDivider} />

            <p style={styles.subPublicNote}>
              <strong>Public feed</strong> — only events marked for the public calendar. Safe to share or embed on the website.
            </p>
            <CopyField label="Public calendar link" value={sub.public_ics_url}
              copied={copied === "public"} onCopy={() => copy("public", sub.public_ics_url)} />

            <button style={styles.subRotate} onClick={rotate} disabled={rotating}>
              <RefreshCw size={13} /> {rotating ? "Resetting…" : "Reset my private link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyField({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div style={styles.copyWrap}>
      <label style={styles.copyLabel}>{label}</label>
      <div style={styles.copyRow}>
        <input style={styles.copyInput} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button style={styles.copyBtn} onClick={onCopy} title="Copy">
          {copied ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  headerLeft: {},
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  headerRight: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const },
  searchWrap: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #cdd7e3", borderRadius: 8, padding: "6px 10px", background: "#fff" },
  searchInput: { border: "none", outline: "none", fontSize: 13, minWidth: 150 },
  searchClear: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 0 },
  viewToggle: { display: "flex", border: "1px solid #ccc", borderRadius: 6, overflow: "hidden" },
  viewBtn: { padding: "7px 14px", background: "#fff", border: "none", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 5 },
  viewBtnActive: { background: "#1a3a5c", color: "#fff" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  subscribeBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", color: "#1565c0", border: "1px solid #1565c0", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  overlayBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#fff", color: "#5e35b1", border: "1px solid #d6c9ee", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  overlayBtnActive: { background: "#5e35b1", color: "#fff", borderColor: "#5e35b1" },
  listBar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  selectToggle: { display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#fff", color: "#1565c0", border: "1px solid #1565c0", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  selectToggleOn: { background: "#1565c0", color: "#fff" },
  selectAll: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  bulkBar: { position: "sticky", bottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#1a3a5c", color: "#fff", borderRadius: 10, padding: "10px 16px", marginTop: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.25)", zIndex: 20 },
  bulkCount: { fontWeight: 800, fontSize: 14 },
  bulkLabel: { fontSize: 13, opacity: 0.85, marginLeft: 4 },
  bulkBtn: { color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modalCard: { background: "#fff", borderRadius: 12, width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #eef2f7" },
  modalTitle: { display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 17, fontWeight: 700, color: "#1a3a5c" },
  modalClose: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex", padding: 2 },
  subBody: { padding: "16px 20px 20px" },
  subIntro: { fontSize: 13, color: "#555", lineHeight: 1.6, margin: "0 0 14px" },
  subError: { padding: "12px 20px 20px", color: "#c62828", fontSize: 13 },
  subActions: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 },
  subPrimary: { display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#1a3a5c", color: "#fff", borderRadius: 7, textDecoration: "none", fontWeight: 600, fontSize: 13 },
  subGoogle: { display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 7, textDecoration: "none", fontWeight: 600, fontSize: 13 },
  subDivider: { height: 1, background: "#eef2f7", margin: "18px 0 14px" },
  subPublicNote: { fontSize: 12.5, color: "#555", lineHeight: 1.6, margin: "0 0 10px" },
  subRotate: { display: "flex", alignItems: "center", gap: 6, marginTop: 18, padding: "7px 12px", background: "#fff", color: "#b26a00", border: "1px solid #e0c08a", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  copyWrap: { marginBottom: 12 },
  copyLabel: { display: "block", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  copyRow: { display: "flex", gap: 6 },
  copyInput: { flex: 1, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, fontFamily: "monospace", color: "#333", background: "#f8fafc", boxSizing: "border-box" },
  copyBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 38, border: "1px solid #cdd7e3", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#555" },

  nav: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 },
  navBtn: { width: 34, height: 34, border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  monthLabel: { display: "flex", gap: 8, alignItems: "baseline" },
  monthName: { fontSize: 20, fontWeight: 700, color: "#1a3a5c" },
  yearName: { fontSize: 16, color: "#888" },
  todayBtn: { marginLeft: 8, padding: "5px 14px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 },

  calendar: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "#e2e8f0", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 16 },
  // minWidth:0 lets each of the 7 grid tracks shrink to fit the viewport — without
  // it, a long (nowrap) event/holiday label forces a cell wider than its 1fr share
  // and the whole month grid overflows off-screen with no way to scroll (esp. on
  // narrow phones, where only the first day or two were reachable).
  dayHeader: { background: "#f0f4f8", padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, minWidth: 0 },
  cell: { background: "#fff", minHeight: 100, padding: "6px 6px 4px", cursor: "default", minWidth: 0, overflow: "hidden" },
  cellEmpty: { background: "#fafafa" },
  cellEditable: { cursor: "pointer" },
  cellToday: { background: "#e3f2fd" },
  cellSelected: { background: "#bbdefb", boxShadow: "inset 0 0 0 2px #1565c0" },
  dragHint: { fontSize: 12, color: "#888", margin: "0 0 8px" },
  dayNum: { fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 4, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" },
  dayNumToday: { background: "#1565c0", color: "#fff" },
  eventChips: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  chip: { display: "flex", alignItems: "center", gap: 4, padding: "2px 5px", borderRadius: 4, cursor: "pointer", overflow: "hidden", minWidth: 0 },
  chipTime: { fontSize: 10, color: "rgba(255,255,255,0.8)", flexShrink: 0, fontWeight: 600 },
  chipName: { fontSize: 11, color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 },
  chipWarning: { fontSize: 10, flexShrink: 0 },
  chipCount: { fontSize: 10, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.28)", borderRadius: 8, padding: "0 5px", flexShrink: 0 },
  recurringDot: { width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.7)", flexShrink: 0, marginRight: 1 },
  multiDayDot: { width: 5, height: 5, borderRadius: 1, background: "rgba(255,255,0,0.7)", flexShrink: 0, marginRight: 1 },
  moreChip: { fontSize: 11, color: "#888", paddingLeft: 4 },
  unavailChip: { display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: "#6a1b9a", background: "#f3e5f5", border: "1px dashed #ce93d8", borderRadius: 4, padding: "1px 5px", marginTop: 2, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  birthdayChip: { display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: "#ad1457", background: "#fce4ec", border: "1px solid #f8bbd0", borderRadius: 4, padding: "1px 5px", marginTop: 2, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },

  listView: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  listRow: { display: "flex", alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", cursor: "pointer" },
  listColorBar: { width: 5, alignSelf: "stretch" },
  listDate: { width: 52, textAlign: "center", padding: "10px 8px", flexShrink: 0 },
  listDateDay: { fontSize: 20, fontWeight: 800, color: "#1a3a5c", lineHeight: 1 },
  listDateMon: { fontSize: 11, color: "#888", textTransform: "uppercase" as const, fontWeight: 600 },
  listInfo: { flex: 1, padding: "10px 12px" },
  listName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c", marginBottom: 4 },
  listMeta: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "#666" },
  listTypeBadge: { padding: "1px 7px", borderRadius: 10, color: "#fff", fontSize: 11, fontWeight: 600 },
  holidayMark: { fontSize: 10, color: "#8a6d3b", background: "#fdf3e3", borderRadius: 4, padding: "1px 4px", margin: "1px 2px 2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rsvpGroup: { display: "inline-flex", gap: 4, alignItems: "center" },
  rsvpChip: { fontSize: 11, fontWeight: 700, borderRadius: 9, padding: "1px 7px" },
  listFlags: { display: "flex", gap: 6, padding: "0 12px", flexShrink: 0 },
  recurringTag: { fontSize: 11, padding: "2px 7px", background: "#e3f2fd", color: "#1565c0", borderRadius: 8, fontWeight: 600 },
  warnTag: { fontSize: 11, padding: "2px 7px", background: "#fff8e1", color: "#f57c00", borderRadius: 8, fontWeight: 600 },
  logisticsTag: { fontSize: 11, padding: "2px 7px", background: "#e3f2fd", color: "#1565c0", borderRadius: 8, fontWeight: 600 },
  publicTag: { fontSize: 11, padding: "2px 7px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 8, fontWeight: 600 },
  empty: { textAlign: "center", color: "#888", padding: "3rem", fontSize: 14 },

  legend: { display: "flex", flexWrap: "wrap", gap: "8px 16px", padding: "12px 0 4px", borderTop: "1px solid #f0f4f8" },
  legendItem: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#666" },
  legendDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  legendTitle: { fontSize: 12, fontWeight: 700, color: "#5e35b1" },
  legendHint: { fontSize: 11, color: "#889", fontStyle: "italic" },
  legendClear: { display: "flex", alignItems: "center", gap: 3, marginLeft: "auto", background: "#f0f4f8", border: "1px solid #dbe3ec", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#556", cursor: "pointer", fontWeight: 600 },
};


const ua: Record<string, React.CSSProperties> = {
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, marginTop: 4, boxSizing: "border-box" },
  cancel: { padding: "8px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "8px 18px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
