import { useState, useEffect, useCallback, useRef } from "react";
import { currentSeasonYear } from "../../../core/dateUtils";
import { useAuth } from "../../../core/AuthContext";
import {
  activityApi, fmtMinutes, fmtHours, fmtTime, localToday,
  type TimeEntry, type MemberSummary, type DayCheckin, type SubEntry, type Checkin, type MemberTeamOption,
} from "../api";
import { Clock, Plus, Trash2, Pencil, Heart, Layers, Megaphone, X, DoorOpen, ChevronDown, ChevronRight } from "lucide-react";
import { asOverAllocation, hoursLabel } from "../overAllocation";
import InlineHelp from "../../help/InlineHelp";

/** Season "YYYY-YYYY+1" → its date window (mirrors SEASON_START_MONTH = July). */
function seasonWindow(season: string): { from: string; to: string } {
  const [a, b] = season.split("-");
  return { from: `${a}-07-01`, to: `${b}-06-30` };
}

function currentSeason(): string {
  const now = new Date();
  const y = currentSeasonYear(now);
  return `${y}-${y + 1}`;
}

/** Check-in times are UTC; get the check-in's local calendar date (YYYY-MM-DD). */
function teamLabel(t: MemberTeamOption): string {
  return t.team_name || (t.team_number != null ? `Team ${t.team_number}` : "Team");
}

function checkinLocalDate(c: Checkin): string {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(c.time_in) ? c.time_in : c.time_in + "Z";
  const d = new Date(iso);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export default function MyTimePage() {
  const { user } = useAuth();
  const memberId = user?.id;

  const [areas, setAreas] = useState<string[]>([]);
  const [isVol, setIsVol] = useState(false);
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [events, setEvents] = useState<{ event_id: number; name: string; date: string; suggested_minutes: number }[]>([]);
  const [adding, setAdding] = useState(false);
  const [season, setSeason] = useState(currentSeason());
  const [seasons, setSeasons] = useState<string[]>([]);
  const [teams, setTeams] = useState<MemberTeamOption[]>([]);
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([localToday().slice(0, 7)]));

  const load = useCallback(() => {
    if (!memberId) return;
    activityApi.memberSummary(memberId, undefined, undefined, season).then(setSummary).catch(() => {});
    activityApi.listEntries(memberId, season).then(setEntries).catch(() => setEntries([]));
    const w = seasonWindow(season);
    activityApi.memberCheckins(memberId, w.from, w.to).then(setCheckins).catch(() => setCheckins([]));
    // Outreach events the member attended but hasn't logged yet.
    activityApi.loggableEvents(memberId).then(setEvents).catch(() => setEvents([]));
  }, [memberId, season]);

  useEffect(() => {
    if (!memberId) return;
    activityApi.areas(memberId).then((a) => { setAreas(a.areas); setIsVol(a.is_volunteer_member); }).catch(() => {});
    activityApi.memberTeams(memberId)
      .then((ts) => {
        const usable = ts.filter((t) => t.team_season_id != null && (t.status ?? "active") !== "inactive");
        // Rosters roll forward, so the same team appears once per season. Offer each
        // team once, on its newest season ("YYYY-YYYY" sorts correctly as a string).
        const newest = new Map<string, MemberTeamOption>();
        for (const t of usable) {
          const key = String(t.team_number ?? t.team_name ?? t.team_season_id);
          const prev = newest.get(key);
          if (!prev || (t.season ?? "") > (prev.season ?? "")) newest.set(key, t);
        }
        setTeams([...newest.values()]);
      })
      .catch(() => setTeams([]));
    activityApi.seasons().then((s) => {
      const cur = currentSeason();
      setSeasons(Array.from(new Set([cur, ...s])).sort().reverse());
      // Right after the season rolls over, the new season has no logged time yet.
      // Land the view on the most recent season that DOES have data so history is
      // visible instead of a blank current season (the picker still offers current).
      if (!s.includes(cur) && s.length) {
        setSeason([...s].sort().reverse()[0]);
      }
    }).catch(() => setSeasons([currentSeason()]));
  }, [memberId]);

  useEffect(() => { load(); }, [load]);

  if (!memberId) return null;

  // Logged time not tied to any check-in → shown in the "Other logged time" section.
  const untied = entries.filter((e) => e.checkin_id == null);

  // Unified chronological timeline: check-ins (with their nested classified time)
  // and stand-alone logged time, newest first, grouped by month (collapsible).
  type TLItem =
    | { key: string; date: string; kind: "checkin"; checkin: Checkin }
    | { key: string; date: string; kind: "entry"; entry: TimeEntry };
  const tlItems: TLItem[] = [
    ...checkins.map((c) => ({ key: `c${c.id}`, date: checkinLocalDate(c), kind: "checkin" as const, checkin: c })),
    ...untied.map((e) => ({ key: `e${e.id}`, date: e.entry_date, kind: "entry" as const, entry: e })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const monthGroups: { key: string; label: string; items: TLItem[] }[] = [];
  for (const it of tlItems) {
    const mk = it.date.slice(0, 7);
    let g = monthGroups.find((x) => x.key === mk);
    if (!g) { g = { key: mk, label: new Date(it.date + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }), items: [] }; monthGroups.push(g); }
    g.items.push(it);
  }
  const toggleMonth = (k: string) => setOpenMonths((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div style={st.page}>
      <div style={st.titleRow}>
        <div>
          <h1 style={st.h1}><Clock size={22} /> My Time <InlineHelp helpKey="logging-time" /></h1>
          <p style={st.sub}>Log the time you spend on the robot, portfolio, outreach, and more.</p>
        </div>
        <label style={st.seasonPick}>
          <span style={st.seasonLbl}>Season</span>
          <select style={st.seasonSel} value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* Summary */}
      {summary && (
        <div style={st.stats}>
          <Stat label="Total Logged" value={fmtMinutes(summary.total_minutes)} color="#1a3a5c" icon={<Clock size={16} />} />
          <Stat label={isVol ? "Volunteer Time" : "Community / Outreach"} value={fmtMinutes(summary.volunteer_minutes)} color="#2e7d32" icon={<Heart size={16} />} />
          <Stat label="Areas" value={String(Object.keys(summary.by_area).length)} color="#6a1b9a" icon={<Layers size={16} />} />
        </div>
      )}
      {summary && Object.keys(summary.by_area).length > 0 && (
        <div style={st.bars}>
          {Object.entries(summary.by_area).sort((a, b) => b[1] - a[1]).map(([area, mins]) => {
            const pct = summary.total_minutes ? Math.round((mins / summary.total_minutes) * 100) : 0;
            return (
              <div key={area} style={st.barRow}>
                <span style={st.barLabel}>{area}</span>
                <div style={st.barTrack}><div style={{ ...st.barFill, width: `${pct}%` }} /></div>
                <span style={st.barVal}>{fmtMinutes(mins)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Outreach events attended — log as community/volunteer time */}
      {events.length > 0 && (
        <div style={st.section}>
          <div style={st.sectionHead}><Megaphone size={15} /> Outreach events to log</div>
          <p style={st.note}>You attended these outreach events. Log them as community / volunteer time.</p>
          {events.map((ev) => (
            <div key={ev.event_id} style={st.session}>
              <div style={st.sessionInfo}>
                <strong>{ev.name}</strong>
                <span style={st.sessionTime}>{new Date(ev.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span style={st.sessionRemain}>{fmtMinutes(ev.suggested_minutes)} suggested</span>
              </div>
              <div style={st.sessionForm}>
                <button style={st.smallBtn} onClick={async () => {
                  await activityApi.createEntry({
                    member_id: memberId, entry_date: ev.date, minutes: ev.suggested_minutes,
                    area: "Outreach", event_id: ev.event_id,
                  });
                  load();
                }}>Log {fmtMinutes(ev.suggested_minutes)} Outreach</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unified, chronological time & check-in history, grouped by month */}
      <div style={st.section}>
        <div style={st.sectionHeadRow}>
          <div style={st.sectionHead}>Time &amp; check-ins</div>
          <button style={st.addBtn} onClick={() => setAdding((v) => !v)}><Plus size={15} /> Log Time</button>
        </div>
        <p style={st.note}>Your check-ins and logged time in one timeline, newest first. Time classified during a check-in is nested under it.</p>
        {adding && (
          <DailyLogForm areas={areas} memberId={memberId} teams={teams}
            onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
        )}
        {monthGroups.length === 0 ? <p style={st.note}>No time logged or checked in yet.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {monthGroups.map((g) => {
              const open = openMonths.has(g.key);
              return (
                <div key={g.key}>
                  <button style={st.monthHead} onClick={() => toggleMonth(g.key)}>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span style={st.monthLabel}>{g.label}</span>
                    <span style={st.monthCount}>{g.items.length}</span>
                  </button>
                  {open && (
                    <div style={{ ...st.list, marginTop: 8 }}>
                      {g.items.map((it) => it.kind === "checkin"
                        ? <CheckinGroup key={it.key} checkin={it.checkin}
                            entries={entries.filter((e) => e.checkin_id === it.checkin.id)}
                            areas={areas} memberId={memberId} teams={teams} onChanged={load} />
                        : <EntryRow key={it.key} entry={it.entry} areas={areas} teams={teams} onChanged={load} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A check-in and the time logs classified during it, with a roll-up + quick log button. */
function CheckinGroup({ checkin, entries, areas, memberId, teams, onChanged }: {
  checkin: Checkin; entries: TimeEntry[]; areas: string[]; memberId: number; teams: MemberTeamOption[]; onChanged: () => void;
}) {
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const classified = entries.reduce((t, e) => t + e.minutes, 0);
  const remaining = checkin.time_out ? Math.max(0, checkin.minutes - classified) : null;
  // A check-in that isn't split across multiple categories can be classified in ONE
  // step: pick a category and the whole session is tagged (or re-tagged) with it —
  // no hours to type, no capacity wall (#181/#185). The dropdown reflects the current
  // category when there's exactly one entry, so changing it re-classifies.
  const multiEntry = entries.length > 1;
  const currentArea = entries.length === 1 ? (entries[0].area || "") : "";

  async function setCategory(area: string) {
    setBusy(true); setErr(null);
    try { await activityApi.classifyCheckin(checkin.id, area); onChanged(); }
    catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not update this check-in."); }
    finally { setBusy(false); }
  }

  return (
    <div style={st.ciGroup}>
      <CheckinRow checkin={checkin} onChanged={onChanged} />
      <div style={st.ciBody}>
        {entries.length === 0
          ? <p style={st.ciEmpty}>No time classified for this check-in yet.</p>
          : entries.map((e) => <EntryRow key={e.id} entry={e} areas={areas} teams={teams} onChanged={onChanged} />)}
        <div style={st.ciFooter}>
          <span style={st.ciRoll}>
            {fmtHours(classified)} classified{checkin.time_out ? ` of ${fmtHours(checkin.minutes)}` : ""}
            {remaining && remaining > 0 ? <span style={st.ciRemain}> · {fmtHours(remaining)} unclassified</span> : null}
          </span>
          {checkin.time_out && !multiEntry && (
            <label style={st.ciClassify}>
              <span style={st.ciClassifyLbl}>Category</span>
              <select style={st.ciSelect} value={currentArea} disabled={busy}
                onChange={(e) => setCategory(e.target.value)} aria-label="Set category for this check-in">
                <option value="">— Unclassified —</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          )}
          {checkin.time_out && (
            <button style={st.ciLogBtn} onClick={() => setSplitting((v) => !v)}>
              <Plus size={13} /> {multiEntry ? "Edit split" : "Split across categories"}
            </button>
          )}
        </div>
        {err && <p style={st.ciErr}>{err}</p>}
        {splitting && (
          <DailyLogForm areas={areas} memberId={memberId} teams={teams}
            initialDate={checkinLocalDate(checkin)} initialCheckinId={checkin.id}
            onSaved={() => { setSplitting(false); onChanged(); }} onCancel={() => setSplitting(false)} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div style={st.stat}>
      <div style={{ ...st.statIcon, color }}>{icon}</div>
      <div><div style={{ ...st.statVal, color }}>{value}</div><div style={st.statLabel}>{label}</div></div>
    </div>
  );
}

/** A logged entry — view mode with Edit/Delete, expanding to an inline editor. */
function EntryRow({ entry, areas, teams, onChanged }: { entry: TimeEntry; areas: string[]; teams: MemberTeamOption[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(entry.entry_date);
  const [area, setArea] = useState(entry.area ?? "");
  const [teamSel, setTeamSel] = useState<string>(entry.team_season_id != null ? String(entry.team_season_id) : "");
  const [mode, setMode] = useState<"hours" | "range">(entry.entry_method === "range" ? "range" : "hours");
  const [hours, setHours] = useState(entry.entry_method === "range" ? "" : String(Math.round((entry.minutes / 60) * 100) / 100));
  const [start, setStart] = useState(entry.start_time ?? "");
  const [end, setEnd] = useState(entry.end_time ?? "");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [checkins, setCheckins] = useState<DayCheckin[]>([]);
  const [checkinId, setCheckinId] = useState<string>(entry.checkin_id != null ? String(entry.checkin_id) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Load the member's check-ins for the entry's date so it can be (re)tied to one.
  useEffect(() => {
    if (!editing) return;
    activityApi.checkinsForDay(entry.member_id, date).then(setCheckins).catch(() => setCheckins([]));
  }, [editing, entry.member_id, date]);

  const ciLabel = (c: DayCheckin) => {
    // Server timestamps are naive UTC — normalize to a UTC instant before
    // formatting to local, otherwise the browser reads the value as local and
    // shows the GMT time (e.g. 11:05 PM instead of 6:05 PM). Mirrors line ~28.
    const norm = c.time_in && /[zZ]|[+-]\d\d:?\d\d$/.test(c.time_in) ? c.time_in : c.time_in ? c.time_in + "Z" : "";
    const t = norm ? new Date(norm).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    return `${c.event_name ?? "General TRC"}${t ? ` · checked in ${t}` : ""}${c.open ? " (still in)" : ""}`;
  };

  async function save() {
    setErr("");
    const payload: Record<string, unknown> = { entry_date: date, area, notes, team_season_id: teamSel ? parseInt(teamSel) : null };
    if (mode === "range") {
      if (!start || !end) { setErr("Enter a start and end time."); return; }
      payload.start_time = start; payload.end_time = end;
    } else {
      const h = parseFloat(hours);
      if (!h || h <= 0) { setErr("Enter hours greater than zero."); return; }
      payload.hours = h;
    }
    payload.checkin_id = checkinId ? parseInt(checkinId) : null; // "" clears the tie
    setBusy(true);
    try { await activityApi.editEntry(entry.id, payload); setEditing(false); onChanged(); }
    catch (e) {
      // Over the check-in's remaining time: reset the field to what actually fits and
      // keep the editor open so the correction is one keystroke away.
      const over = asOverAllocation(e);
      if (over) {
        setHours(over.availableHours > 0 ? String(over.availableHours) : "");
        setMode("hours");
        setErr(over.availableMinutes > 0
          ? `${over.message} We've set it to ${hoursLabel(over.availableHours)} — adjust if that's not right, then save.`
          : `${over.message} Shorten or remove another activity on this check-in first.`);
      } else {
        const ax = e as { response?: { data?: { detail?: string } } };
        setErr(ax.response?.data?.detail ?? "Could not save.");
      }
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div style={st.editCard}>
        <div style={st.editGrid}>
          <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select style={st.input} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Area…</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            {area && !areas.includes(area) && <option value={area}>{area}</option>}
          </select>
          <select style={st.input} value={mode} onChange={(e) => setMode(e.target.value as "hours" | "range")}>
            <option value="hours">Hours</option>
            <option value="range">Start / stop</option>
          </select>
          {mode === "hours" ? (
            <span style={st.inlineTime}><input style={st.minInput} type="number" min={0} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} /><span style={st.minLbl}>hrs</span></span>
          ) : (
            <span style={st.inlineTime}>
              <input style={st.timeInput} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              <span style={st.minLbl}>–</span>
              <input style={st.timeInput} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </span>
          )}
        </div>
        <input style={{ ...st.input, marginTop: 8 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comment" />
        {teams.length > 0 && (
          <>
            <label style={st.l}>Credit to a team (optional) — counts toward the team's Time &amp; Impact</label>
            <select style={st.input} value={teamSel} onChange={(e) => setTeamSel(e.target.value)}>
              <option value="">Just me (no team)</option>
              {teams.map((t) => <option key={t.team_season_id} value={t.team_season_id!}>{teamLabel(t)}</option>)}
            </select>
          </>
        )}
        <label style={st.l}>Tie to a check-in (optional)</label>
        <select style={st.input} value={checkinId} onChange={(e) => setCheckinId(e.target.value)} disabled={checkins.length === 0 && !checkinId}>
          <option value="">{checkins.length === 0 ? "No check-ins on this date" : "Not tied to a check-in"}</option>
          {checkins.map((c) => <option key={c.checkin_id} value={c.checkin_id}>{ciLabel(c)}</option>)}
        </select>
        {err && <div style={st.editErr}>{err}</div>}
        <div style={st.editActions}>
          <button style={st.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
          <button style={st.saveBtn} onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div style={st.row}>
      <div style={st.rowDate}>{new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={st.rowArea}>
          {entry.area ?? "Uncategorized"}
          {entry.is_volunteer && <span style={st.volTag}>volunteer</span>}
          {entry.source === "checkin" && <span style={st.srcTag}>from check-in</span>}
          {entry.entry_method === "range" && entry.start_time && (
            <span style={st.srcTag}>{fmtTime(entry.start_time)}–{fmtTime(entry.end_time)}</span>
          )}
        </div>
        {entry.notes && <div style={st.rowNotes}>{entry.notes}</div>}
      </div>
      <div style={st.rowMin} title={fmtMinutes(entry.minutes)}>{fmtHours(entry.minutes)}</div>
      <button style={st.iconAction} title="Edit" onClick={() => setEditing(true)}><Pencil size={14} /></button>
      <button style={st.del} title="Delete" onClick={async () => {
        if (confirm("Delete this time entry?")) { await activityApi.deleteEntry(entry.id); onChanged(); }
      }}><Trash2 size={14} /></button>
    </div>
  );
}

/** A check-in shown in the entries log — view with Edit, expanding to adjust in/out times. */
function CheckinRow({ checkin, onChanged }: { checkin: Checkin; onChanged: () => void }) {
  // Check-in times are stored in UTC; show and edit them in the viewer's local time.
  const asUtcIso = (iso: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dIn = new Date(asUtcIso(checkin.time_in));
  const dOut = checkin.time_out ? new Date(asUtcIso(checkin.time_out)) : null;
  const localDate = `${dIn.getFullYear()}-${p2(dIn.getMonth() + 1)}-${p2(dIn.getDate())}`;
  const inHHMM = `${p2(dIn.getHours())}:${p2(dIn.getMinutes())}`;
  const outHHMM = dOut ? `${p2(dOut.getHours())}:${p2(dOut.getMinutes())}` : "";
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(localDate);
  const [tin, setTin] = useState(inHHMM);
  const [tout, setTout] = useState(outHHMM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!tin) { setErr("Enter a check-in time."); return; }
    if (tout && tout < tin) { setErr("Check-out can't be before check-in."); return; }
    setBusy(true);
    try {
      await activityApi.adjustCheckin(checkin.id, {
        time_in: new Date(`${date}T${tin}`).toISOString(),
        time_out: tout ? new Date(`${date}T${tout}`).toISOString() : null,
      });
      setEditing(false); onChanged();
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not save.");
    } finally { setBusy(false); }
  }

  async function del() {
    if (!confirm("Delete this check-in? This removes the record and its time. This can't be undone.")) return;
    setErr(""); setBusy(true);
    try {
      await activityApi.deleteCheckin(checkin.id);
      onChanged();
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not delete this check-in.");
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div style={st.editCard}>
        <div style={st.editGrid}>
          <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <span style={st.inlineTime}>
            <span style={st.minLbl}>In</span><input style={st.timeInput} type="time" value={tin} onChange={(e) => setTin(e.target.value)} />
            <span style={st.minLbl}>Out</span><input style={st.timeInput} type="time" value={tout} onChange={(e) => setTout(e.target.value)} />
          </span>
        </div>
        {err && <div style={st.editErr}>{err}</div>}
        <div style={st.editActions}>
          <button style={st.checkinDelBtn} onClick={del} disabled={busy}><Trash2 size={13} /> Delete</button>
          <div style={{ flex: 1 }} />
          <button style={st.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
          <button style={st.saveBtn} onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div style={st.row}>
      <div style={st.rowDate}>{new Date(localDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={st.rowArea}>
          <DoorOpen size={13} style={{ verticalAlign: -2, marginRight: 4, color: "#00838f" }} />
          {checkin.event_name ?? "General TRC"}
          <span style={st.checkinTag}>check-in</span>
        </div>
        <div style={st.rowNotes}>
          {fmtTime(inHHMM)}{checkin.time_out ? `–${fmtTime(outHHMM)}` : " · still checked in"}
        </div>
      </div>
      <div style={st.rowMin} title={fmtMinutes(checkin.minutes)}>{checkin.time_out ? fmtHours(checkin.minutes) : "—"}</div>
      <button style={st.iconAction} title="Edit times" onClick={() => setEditing(true)}><Pencil size={14} /></button>
    </div>
  );
}

type SubRow = { area: string; mode: "hours" | "range"; hours: string; start: string; end: string; notes: string };
const emptyRow = (): SubRow => ({ area: "", mode: "hours", hours: "", start: "", end: "", notes: "" });

/** Log a whole day at once: one date (+ optional check-in) with multiple sub-entries. */
function DailyLogForm({ areas, memberId, teams, onSaved, onCancel, initialDate, initialCheckinId }: {
  areas: string[]; memberId: number; teams: MemberTeamOption[]; onSaved: () => void; onCancel: () => void;
  initialDate?: string; initialCheckinId?: number;   // pre-tie when logging under a check-in
}) {
  const [entryDate, setEntryDate] = useState(initialDate ?? localToday());
  const [rows, setRows] = useState<SubRow[]>([emptyRow()]);
  const [checkins, setCheckins] = useState<DayCheckin[]>([]);
  const [checkinId, setCheckinId] = useState<string>(initialCheckinId != null ? String(initialCheckinId) : "");
  const [teamSel, setTeamSel] = useState<string>(teams.length === 1 ? String(teams[0].team_season_id) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const prevDate = useRef(entryDate);

  useEffect(() => {
    activityApi.checkinsForDay(memberId, entryDate).then(setCheckins).catch(() => setCheckins([]));
    // Clear the tie only when the user actually changes the date (not on mount, so a
    // pre-selected check-in is preserved).
    if (prevDate.current !== entryDate) { setCheckinId(""); setConfirmOverlap(false); prevDate.current = entryDate; }
  }, [memberId, entryDate]);

  function setRow(i: number, patch: Partial<SubRow>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); }

  function rowHours(r: SubRow): number {
    if (r.mode === "range") {
      if (!r.start || !r.end) return 0;
      const [sh, sm] = r.start.split(":").map(Number); const [eh, em] = r.end.split(":").map(Number);
      return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
    }
    return parseFloat(r.hours) || 0;
  }
  const totalHours = rows.reduce((t, r) => t + rowHours(r), 0);

  async function save(ack = false) {
    setErr("");
    if (!ack) setConfirmOverlap(false);
    const entries: SubEntry[] = [];
    for (const r of rows) {
      if (!r.area && rowHours(r) <= 0) continue; // skip blank rows
      if (!r.area) { setErr("Pick a category for every activity."); return; }
      if (r.mode === "range") {
        if (!r.start || !r.end) { setErr("Enter a start and end time for each timed activity."); return; }
        entries.push({ area: r.area, start_time: r.start, end_time: r.end, notes: r.notes || undefined });
      } else {
        const h = parseFloat(r.hours);
        if (!h || h <= 0) { setErr("Enter hours (greater than zero) for each activity."); return; }
        entries.push({ area: r.area, hours: h, notes: r.notes || undefined });
      }
    }
    if (entries.length === 0) { setErr("Add at least one activity."); return; }
    const ci = checkins.find((c) => String(c.checkin_id) === checkinId);
    setBusy(true);
    try {
      await activityApi.createEntries({
        member_id: memberId, entry_date: entryDate,
        checkin_id: ci ? ci.checkin_id : undefined, event_id: ci?.event_id ?? undefined,
        team_season_id: teamSel ? parseInt(teamSel) : null,
        entries, acknowledge_overlap: ack || undefined,
      });
      onSaved();
    } catch (e) {
      const resp = (e as { response?: { status?: number; data?: { error?: string; detail?: string } } })?.response;
      if (resp?.status === 409 && resp?.data?.error === "checkin_overlap") {
        setErr(resp.data.detail ?? "This may overlap a check-in you already have that day.");
        setConfirmOverlap(true);
        return;
      }
      setErr(resp?.data?.detail ?? "Could not save the timesheet.");
    } finally { setBusy(false); }
  }

  const ciLabel = (c: DayCheckin) => {
    // Server timestamps are naive UTC — normalize to a UTC instant before
    // formatting to local, otherwise the browser reads the value as local and
    // shows the GMT time (e.g. 11:05 PM instead of 6:05 PM). Mirrors line ~28.
    const norm = c.time_in && /[zZ]|[+-]\d\d:?\d\d$/.test(c.time_in) ? c.time_in : c.time_in ? c.time_in + "Z" : "";
    const t = norm ? new Date(norm).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    return `${c.event_name ?? "General TRC"}${t ? ` · checked in ${t}` : ""}${c.open ? " (still in)" : ""}`;
  };

  return (
    <div style={st.form}>
      <div style={st.dlHead}>
        <div><label style={st.l}>Date</label><input style={st.input} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label style={st.l}>Tie to a check-in (optional)</label>
          <select style={st.input} value={checkinId} onChange={(e) => setCheckinId(e.target.value)} disabled={checkins.length === 0}>
            <option value="">{checkins.length === 0 ? "No check-ins on this date" : "Not tied to a check-in"}</option>
            {checkins.map((c) => <option key={c.checkin_id} value={c.checkin_id}>{ciLabel(c)}</option>)}
          </select>
        </div>
        {teams.length > 0 && (
          <div style={{ flex: 1 }}><label style={st.l}>Credit to a team (optional)</label>
            <select style={st.input} value={teamSel} onChange={(e) => setTeamSel(e.target.value)}>
              <option value="">Just me (no team)</option>
              {teams.map((t) => <option key={t.team_season_id} value={t.team_season_id!}>{teamLabel(t)}</option>)}
            </select>
          </div>
        )}
      </div>

      <label style={st.l}>Activities</label>
      <div style={st.subList}>
        {rows.map((r, i) => (
          <div key={i} style={st.subRow}>
            <select style={st.subArea} value={r.area} onChange={(e) => setRow(i, { area: e.target.value })}>
              <option value="">Category…</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select style={st.subMode} value={r.mode} onChange={(e) => setRow(i, { mode: e.target.value as "hours" | "range" })}>
              <option value="hours">Hours</option>
              <option value="range">Start / stop</option>
            </select>
            {r.mode === "hours" ? (
              <span style={st.subTime}>
                <input style={st.minInput} type="number" min={0} step={0.25} placeholder="0"
                  value={r.hours} onChange={(e) => setRow(i, { hours: e.target.value })} /> <span style={st.minLbl}>hrs</span>
              </span>
            ) : (
              <span style={st.subTime}>
                <input style={st.timeInput} type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
                <span style={st.minLbl}>–</span>
                <input style={st.timeInput} type="time" value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
              </span>
            )}
            <input style={st.subNotes} value={r.notes} onChange={(e) => setRow(i, { notes: e.target.value })}
              placeholder="Comment (e.g. helping Project Peacock)" />
            <button style={st.subDel} title="Remove" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)} disabled={rows.length === 1}><X size={15} /></button>
          </div>
        ))}
      </div>
      <button style={st.addRowBtn} onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus size={14} /> Add another activity</button>

      {err && <div style={st.formErr}>{err}</div>}
      <div style={st.formActions}>
        <span style={st.totalLbl}>Total: <strong>{fmtHours(Math.round(totalHours * 60))}</strong></span>
        <button style={st.cancelBtn} onClick={onCancel}>Cancel</button>
        {confirmOverlap
          ? <button style={st.saveBtn} onClick={() => save(true)} disabled={busy}>Log anyway</button>
          : <button style={st.saveBtn} onClick={() => save(false)} disabled={busy || totalHours <= 0}>Save Timesheet</button>}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: "0 auto" },
  titleRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  sub: { color: "#666", fontSize: 14, marginTop: 4 },
  seasonPick: { display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 },
  seasonLbl: { fontSize: 11, fontWeight: 600, color: "#555" },
  seasonSel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff" },
  stats: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 },
  stat: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 18px", minWidth: 150 },
  statIcon: { display: "flex" },
  statVal: { fontSize: 20, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 12, color: "#888", marginTop: 3 },
  bars: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 18, display: "flex", flexDirection: "column", gap: 8 },
  barRow: { display: "flex", alignItems: "center", gap: 10 },
  barLabel: { width: 120, fontSize: 13, color: "#1a3a5c", fontWeight: 600 },
  barTrack: { flex: 1, height: 8, background: "#eef2f6", borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", background: "#1565c0" },
  barVal: { width: 64, textAlign: "right", fontSize: 12, color: "#666" },
  section: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px", marginBottom: 16 },
  sectionHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  sectionHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  note: { fontSize: 13, color: "#888", margin: "6px 0 10px" },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  session: { border: "1px solid #eef1f5", borderRadius: 8, padding: "10px 12px", marginBottom: 8 },
  sessionInfo: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13, color: "#444", marginBottom: 8 },
  sessionTime: { color: "#888" },
  sessionEvent: { color: "#6a1b9a", background: "#f3e5f5", borderRadius: 10, padding: "1px 8px", fontSize: 12 },
  sessionRemain: { marginLeft: "auto", color: "#e65100", fontWeight: 700, fontSize: 12 },
  sessionForm: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  ciGroup: { border: "1px solid #d8e6ea", borderRadius: 10, overflow: "hidden", background: "#fbfdfe" },
  ciBody: { borderLeft: "3px solid #b2dfdb", margin: "0 0 0 10px", padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 6 },
  ciEmpty: { fontSize: 12, color: "#99a", fontStyle: "italic", margin: "2px 0" },
  ciFooter: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 },
  ciRoll: { fontSize: 12, color: "#556", fontWeight: 600 },
  ciRemain: { color: "#e65100", fontWeight: 700 },
  ciLogBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", background: "#fff", color: "#00695c", border: "1px solid #b2dfdb", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  ciFullHint: { marginLeft: "auto", fontSize: 11.5, color: "#78909c", fontStyle: "italic" },
  ciClassify: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 },
  ciClassifyLbl: { fontSize: 11.5, color: "#556", fontWeight: 600 },
  ciSelect: { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 12.5, background: "#fff", minWidth: 150 },
  ciErr: { margin: "6px 0 0", fontSize: 12, color: "#c62828" },
  otherHint: { fontWeight: 400, color: "#99a", fontSize: 12 },
  monthHead: { display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "7px 10px", background: "#f0f4f8", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", color: "#1a3a5c" },
  monthLabel: { fontSize: 13.5, fontWeight: 800 },
  monthCount: { marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "#667", background: "#fff", border: "1px solid #dce4ee", borderRadius: 10, padding: "1px 9px" },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8 },
  rowDate: { width: 56, fontSize: 12, fontWeight: 700, color: "#1a3a5c", flexShrink: 0 },
  rowArea: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowNotes: { fontSize: 12, color: "#888", marginTop: 1 },
  rowMin: { fontSize: 13, fontWeight: 700, color: "#1565c0", flexShrink: 0 },
  volTag: { fontSize: 10, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" },
  srcTag: { fontSize: 10, color: "#888", background: "#f0f4f8", borderRadius: 8, padding: "1px 6px" },
  del: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 2 },
  iconAction: { background: "none", border: "none", cursor: "pointer", color: "#1565c0", padding: 2 },
  checkinTag: { fontSize: 10, color: "#00838f", background: "#e0f2f1", borderRadius: 8, padding: "1px 6px", fontWeight: 700, textTransform: "uppercase", marginLeft: 2 },
  editCard: { background: "#f8fafc", border: "1px solid #cdd7e3", borderRadius: 8, padding: 12 },
  editGrid: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  inlineTime: { display: "flex", alignItems: "center", gap: 5 },
  editErr: { color: "#c62828", fontSize: 12, marginTop: 6 },
  editActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  checkinDelBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 12 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 8 },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", margin: "8px 0 3px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: "#fff" },
  minInput: { width: 60, padding: "8px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  minLbl: { fontSize: 12, color: "#888" },
  smallBtn: { padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  formActions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 12 },
  cancelBtn: { padding: "8px 14px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
  saveBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  dlHead: { display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" },
  subList: { display: "flex", flexDirection: "column", gap: 8 },
  subRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  subArea: { flex: "1 1 130px", minWidth: 0, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  subMode: { flex: "0 0 110px", padding: "8px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  subTime: { display: "flex", alignItems: "center", gap: 5, flex: "0 0 auto" },
  timeInput: { width: 110, padding: "7px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  subNotes: { flex: "2 1 180px", minWidth: 0, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  subDel: { background: "none", border: "1px solid #f0c5c5", color: "#c62828", borderRadius: 6, cursor: "pointer", padding: "6px", display: "flex", flexShrink: 0 },
  addRowBtn: { display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 8, padding: "7px 12px", background: "#fff", color: "#1a3a5c", border: "1px dashed #b8c4d4", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  formErr: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, padding: "8px 12px", marginTop: 10, fontSize: 13 },
  totalLbl: { marginRight: "auto", fontSize: 13, color: "#444" },
};
