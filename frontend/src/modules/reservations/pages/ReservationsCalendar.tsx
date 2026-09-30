import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { reservationsApi, fmtRange, STATUS_META, RESERVATION_COLOR, resourceColor, PURPOSES, type Reservation } from "../api";
import { CalendarClock, PlusCircle, Settings, Check, X, AlertTriangle, DoorOpen, Wrench } from "lucide-react";

type Tab = "calendar" | "mine" | "approvals";

const purposeLabel = (p: string) => PURPOSES.find((x) => x.value === p)?.label ?? p;

function ymd(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export default function ReservationsCalendar() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canApprove = canWrite("reservations.approve");
  const canManage = canWrite("reservations.manage");

  const [tab, setTab] = useState<Tab>("calendar");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [items, setItems] = useState<Reservation[]>([]);
  const [mine, setMine] = useState<Reservation[]>([]);
  const [pending, setPending] = useState<Reservation[]>([]);
  const [selDay, setSelDay] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const loadMonth = useCallback(() => {
    const from = ymd(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = ymd(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    reservationsApi.list({ from, to }).then(setItems).catch(() => setItems([]));
  }, [month]);

  function loadMine() { reservationsApi.list({ mine: "1" }).then(setMine).catch(() => setMine([])); }
  function loadPending() { reservationsApi.list({ pending: "1" }).then(setPending).catch(() => setPending([])); }

  useEffect(() => { loadMonth(); }, [loadMonth]);
  useEffect(() => { loadMine(); if (canApprove) loadPending(); }, [canApprove]);

  async function decide(id: number, action: "approve" | "deny") {
    let note: string | undefined;
    if (action === "deny") { note = window.prompt("Reason for denial (optional):") ?? undefined; }
    setBusy(id);
    try { await reservationsApi.decision(id, action, note); loadPending(); loadMonth(); loadMine(); }
    finally { setBusy(null); }
  }
  async function cancel(id: number) {
    if (!window.confirm("Cancel this reservation?")) return;
    setBusy(id);
    try { await reservationsApi.cancel(id); loadMine(); loadMonth(); if (canApprove) loadPending(); }
    finally { setBusy(null); }
  }

  // Distinct resources appearing this month, for the color legend (name-sorted).
  const monthResources = Array.from(
    new Map(items.map((r) => [r.resource_id, { id: r.resource_id, name: r.resource_name ?? `Resource ${r.resource_id}` }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Calendar grid
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const approvedByDay: Record<string, Reservation[]> = {};
  for (const r of items) {
    if (r.status === "cancelled" || r.status === "denied") continue;
    const key = r.start_at.slice(0, 10);
    (approvedByDay[key] ||= []).push(r);
  }
  const selItems = selDay ? (approvedByDay[selDay] ?? []) : [];

  return (
    <div>
      <div style={st.head}>
        <h1 style={st.heading}><CalendarClock size={22} style={{ verticalAlign: -3 }} /> Room &amp; Resource Reservations</h1>
        <div style={st.headBtns}>
          {canManage && <button style={st.ghostBtn} onClick={() => navigate("/reservations/manage")}><Settings size={15} /> Manage Resources</button>}
          <button style={st.addBtn} onClick={() => navigate("/reservations/new")}><PlusCircle size={15} /> New Reservation</button>
        </div>
      </div>

      <div style={st.tabs}>
        <button style={{ ...st.tab, ...(tab === "calendar" ? st.tabActive : {}) }} onClick={() => setTab("calendar")}>Calendar</button>
        <button style={{ ...st.tab, ...(tab === "mine" ? st.tabActive : {}) }} onClick={() => setTab("mine")}>My Requests</button>
        {canApprove && (
          <button style={{ ...st.tab, ...(tab === "approvals" ? st.tabActive : {}) }} onClick={() => setTab("approvals")}>
            Pending Approvals{pending.length > 0 && <span style={st.badgeCount}>{pending.length}</span>}
          </button>
        )}
      </div>

      {tab === "calendar" && (
        <div>
          <div style={st.monthBar}>
            <button style={st.navBtn} onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); setSelDay(null); }}>‹</button>
            <span style={st.monthLabel}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <button style={st.navBtn} onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); setSelDay(null); }}>›</button>
          </div>
          <div style={st.weekHead}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} style={st.weekCell}>{d}</div>)}</div>
          <div style={st.grid}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} style={{ ...st.cell, background: "#fafafa" }} />;
              const key = ymd(new Date(month.getFullYear(), month.getMonth(), d));
              const dayItems = approvedByDay[key] ?? [];
              const isSel = selDay === key;
              const isToday = key === ymd(new Date());
              return (
                <div key={i} style={{ ...st.cell, ...(isSel ? st.cellSel : {}), cursor: "pointer" }}
                     title="New reservation on this day"
                     onClick={() => navigate(`/reservations/new?date=${key}`)}>
                  <div style={{ ...st.dayNum, ...(isToday ? st.today : {}) }}>{d}</div>
                  {dayItems.slice(0, 3).map((r) => (
                    <div key={r.id} style={{ ...st.chip, background: resourceColor(r.resource_id), opacity: r.status === "pending" ? 0.55 : 1 }} title={`${r.resource_name} — ${r.member_name}`}
                         onClick={(e) => { e.stopPropagation(); navigate(`/reservations/${r.id}`); }}>
                      {r.resource_name}
                    </div>
                  ))}
                  {dayItems.length > 3 && (
                    <div style={st.more} onClick={(e) => { e.stopPropagation(); setSelDay(key); }}>+{dayItems.length - 3} more</div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={st.legend}>
            {monthResources.map((r) => (
              <span key={r.id} style={st.legendItem}><span style={{ ...st.dot, background: resourceColor(r.id) }} /> {r.name}</span>
            ))}
            <span style={{ ...st.legendItem, color: "#999", marginLeft: monthResources.length ? 10 : 0 }}>
              <span style={{ ...st.dot, background: "#90a4ae" }} /> solid = approved · faded = pending
            </span>
          </div>

          {selDay && (
            <div style={st.dayPanel}>
              <h3 style={st.dayPanelTitle}>{new Date(selDay + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h3>
              {selItems.map((r) => <ResvRow key={r.id} r={r} />)}
            </div>
          )}
        </div>
      )}

      {tab === "mine" && (
        <div style={st.list}>
          {mine.length === 0 ? <p style={st.muted}>You have no reservations yet.</p> :
            mine.map((r) => <ResvRow key={r.id} r={r} canCancel busy={busy === r.id} onCancel={() => cancel(r.id)} onEdit={r.status === "pending" ? () => navigate(`/reservations/${r.id}/edit`) : undefined} />)}
        </div>
      )}

      {tab === "approvals" && canApprove && (
        <div style={st.list}>
          {pending.length === 0 ? <p style={st.muted}>No reservations are awaiting approval.</p> :
            pending.map((r) => (
              <ResvRow key={r.id} r={r} busy={busy === r.id}
                onApprove={() => decide(r.id, "approve")} onDeny={() => decide(r.id, "deny")} />
            ))}
        </div>
      )}
    </div>
  );

  function ResvRow({ r, canCancel, onApprove, onDeny, onCancel, onEdit, busy }: {
    r: Reservation; canCancel?: boolean; busy?: boolean;
    onApprove?: () => void; onDeny?: () => void; onCancel?: () => void; onEdit?: () => void;
  }) {
    const sm = STATUS_META[r.status];
    return (
      <div style={st.row}>
        <div style={{ ...st.kindIcon, background: resourceColor(r.resource_id) + "18", color: resourceColor(r.resource_id) }}>
          {r.resource_kind === "equipment" ? <Wrench size={16} /> : <DoorOpen size={16} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.rowTitle}>{r.resource_name} <span style={{ ...st.badge, color: sm.color, background: sm.color + "22" }}>{sm.label}</span></div>
          <div style={st.rowSub}>{fmtRange(r.start_at, r.end_at)}</div>
          {r.event_name && (
            <div style={st.eventTag}><CalendarClock size={11} style={{ verticalAlign: -1 }} /> for {r.event_name}</div>
          )}
          <div style={st.rowMeta}>
            {r.member_name} · {purposeLabel(r.purpose)}{r.team_label ? ` (${r.team_label})` : ""}
            {r.usage_details ? ` · ${r.usage_details}` : ""}
          </div>
          {r.special_considerations && <div style={st.special}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {r.special_considerations}</div>}
          {!!r.conflicts && <div style={st.conflict}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Overlaps {r.conflicts} approved reservation{r.conflicts > 1 ? "s" : ""} on this resource</div>}
          {r.review_note && <div style={st.rowMeta}>Note: {r.review_note}</div>}
        </div>
        <div style={st.rowActions}>
          {onApprove && <button disabled={busy} style={st.approveBtn} onClick={onApprove}><Check size={14} /> Approve</button>}
          {onDeny && <button disabled={busy} style={st.denyBtn} onClick={onDeny}><X size={14} /> Deny</button>}
          {onEdit && <button style={st.smallGhost} onClick={onEdit}>Edit</button>}
          {canCancel && r.status !== "cancelled" && r.status !== "denied" && <button disabled={busy} style={st.smallGhost} onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    );
  }
}

const st: Record<string, React.CSSProperties> = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  headBtns: { display: "flex", gap: 8 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: RESERVATION_COLOR, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  ghostBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  tabs: { display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid #e2e8f0" },
  tab: { padding: "9px 16px", background: "none", border: "none", borderBottom: "3px solid transparent", cursor: "pointer", fontWeight: 600, fontSize: 14, color: "#667", marginBottom: -1 },
  tabActive: { color: RESERVATION_COLOR, borderBottom: `3px solid ${RESERVATION_COLOR}` },
  badgeCount: { marginLeft: 6, background: "#e65100", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 },
  monthBar: { display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 10 },
  navBtn: { width: 32, height: 32, borderRadius: 6, border: "1px solid #cdd7e3", background: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1 },
  monthLabel: { fontSize: 18, fontWeight: 700, color: "#1a3a5c", minWidth: 200, textAlign: "center" },
  weekHead: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
  weekCell: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", padding: "4px 0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
  cell: { minHeight: 86, border: "1px solid #e7ebf0", borderRadius: 6, padding: 4, background: "#fff", overflow: "hidden" },
  cellSel: { borderColor: RESERVATION_COLOR, boxShadow: `0 0 0 1px ${RESERVATION_COLOR}` },
  dayNum: { fontSize: 12, fontWeight: 600, color: "#667", marginBottom: 3 },
  today: { color: "#fff", background: RESERVATION_COLOR, width: 20, height: 20, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" },
  chip: { background: RESERVATION_COLOR, color: "#fff", borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 600, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  more: { fontSize: 10, color: "#888", fontWeight: 600 },
  legend: { display: "flex", gap: 18, marginTop: 10 },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#667" },
  dot: { width: 12, height: 12, borderRadius: 3, display: "inline-block" },
  dayPanel: { marginTop: 18, background: "#faf7fc", border: "1px solid #ecdff2", borderRadius: 8, padding: 14 },
  dayPanelTitle: { margin: "0 0 10px", fontSize: 16, color: "#1a3a5c" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "flex-start", gap: 12, padding: 14, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 8 },
  kindIcon: { width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowTitle: { fontWeight: 700, fontSize: 15, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  rowSub: { fontSize: 13, color: "#445", marginTop: 2, fontWeight: 600 },
  rowMeta: { fontSize: 12, color: "#778", marginTop: 2 },
  eventTag: { fontSize: 12, color: "#7b1fa2", fontWeight: 600, marginTop: 2 },
  special: { fontSize: 12, color: "#b26a00", marginTop: 4, background: "#fff6e6", padding: "3px 8px", borderRadius: 4, display: "inline-block" },
  conflict: { fontSize: 12, color: "#c62828", marginTop: 4, fontWeight: 600 },
  badge: { padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 700 },
  rowActions: { display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 },
  approveBtn: { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  denyBtn: { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  smallGhost: { padding: "6px 12px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
};
