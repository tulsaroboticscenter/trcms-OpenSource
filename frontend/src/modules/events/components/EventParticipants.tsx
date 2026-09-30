/**
 * EventParticipants — tracks who is attending an event.
 * Grouped by section, alphabetically within each section.
 *
 * Features:
 *  - Add from teams, by type, or by name (others)
 *  - RSVP status dropdown (configurable)
 *  - Flag toggles: separate travel to/from, separate housing
 *  - "No room" badge for attending participants without a room assignment
 *  - Remove participants
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { transportApi, type TransportData, type TransportLeg, type TransportWhich } from "../api";
import { UserPlus, Users, Trash2, ChevronDown, ChevronUp, RefreshCw, CheckCircle, Car, Home, BedDouble, X } from "lucide-react";

interface Participant {
  id: number; member_id?: number; participant_type: string; other_name?: string;
  section_label: string; status: string;
  separate_travel_to: boolean; separate_travel_from: boolean; separate_housing: boolean;
  notes?: string; first_name?: string; last_name?: string; member_type?: string; photo_url?: string;
}
interface Section { section_label: string; participants: Participant[]; count: number; }
interface ParticipantData { sections: Section[]; total: number; by_status: Record<string,number>; available_statuses: string[]; }
interface TeamOption { id: number; season: string; team_number: string; team_name?: string; }
interface Props { eventId: number; housingNeeded?: boolean; }

const STATUS_COLORS: Record<string,string> = {
  "Attending": "#2e7d32", "Not Attending": "#c62828", "Maybe": "#f57c00", "No Reply": "#888",
};

export default function EventParticipants({ eventId, housingNeeded = false }: Props) {
  const navigate = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const canManage = isAdmin || hasRole("Admin", "System Administrator", "Mentor");

  const [data, setData] = useState<ParticipantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [roomAssignments, setRoomAssignments] = useState<Record<string,string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"team"|"type"|"member"|"other"|null>(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedType, setSelectedType] = useState("mentor");
  const [otherName, setOtherName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberHits, setMemberHits] = useState<{ id:number; first_name:string; last_name:string; member_type?:string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState("");
  const [savingId, setSavingId] = useState<number|null>(null);
  const [transport, setTransport] = useState<TransportData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, rRes, tRes] = await Promise.all([
        // sync=1: reconcile the roster with current team memberships (adds new team members,
        // corrects transfers) — this is the coordinator's Logistics participants view.
        api.get(`/api/v1/events/${eventId}/participants`, { params: { sync: 1 } }),
        api.get(`/api/v1/events/${eventId}/participants/room-assignments`).catch(() => ({ data: {} })),
        transportApi.list(eventId).catch(() => null),
      ]);
      setData(pRes.data);
      setRoomAssignments(rRes.data);
      setTransport(tRes);
    } finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => {
    load();
    api.get(`/api/v1/teams/`).then(({ data: d }) =>
      setTeams(d.map((t: { id: number; team_number: string; current_season?: { id: number; season: string; team_name?: string } }) => ({
        id: t.current_season?.id, season: t.current_season?.season,
        team_number: t.team_number, team_name: t.current_season?.team_name,
      })).filter((t: TeamOption) => t.id))
    ).catch(() => {});
  }, [load]);

  async function updateStatus(pid: number, status: string) {
    setSavingId(pid);
    try {
      await api.patch(`/api/v1/events/${eventId}/participants/${pid}`, { status });
      setData(prev => {
        if (!prev) return prev;
        const sections = prev.sections.map(s => ({ ...s, participants: s.participants.map(p => p.id === pid ? { ...p, status } : p) }));
        const by: Record<string,number> = {};
        sections.forEach(s => s.participants.forEach(p => { by[p.status] = (by[p.status]||0)+1; }));
        return { ...prev, sections, by_status: by };
      });
    } finally { setSavingId(null); }
  }

  async function toggleFlag(pid: number, field: "separate_travel_to"|"separate_travel_from"|"separate_housing", cur: boolean) {
    setSavingId(pid);
    try {
      await api.patch(`/api/v1/events/${eventId}/participants/${pid}`, { [field]: !cur });
      setData(prev => prev ? {
        ...prev,
        sections: prev.sections.map(s => ({ ...s, participants: s.participants.map(p => p.id === pid ? { ...p, [field]: !cur } : p) })),
      } : prev);
    } finally { setSavingId(null); }
  }

  async function remove(pid: number) {
    if (!confirm("Remove this person?")) return;
    await api.delete(`/api/v1/events/${eventId}/participants/${pid}`);
    load();
  }

  // ── Transportation (merged into the roster) ────────────────────────────────
  const rideEnabled = !!transport?.transport_enabled;
  const rideMap = new Map(transport?.responses.map(r => [r.member_id, r]) ?? []);
  const driverName = (id: number | null | undefined) => id ? (rideMap.get(id)?.name ?? `#${id}`) : "";
  const RIDE_LABEL: Record<TransportLeg, string> = { have: "Has ride", need: "Needs ride", drive: "Driving", not_sure: "Not sure" };
  const RIDE_COLOR: Record<TransportLeg, string> = { have: "#2e7d32", need: "#c62828", drive: "#1565c0", not_sure: "#e65100" };

  async function setRide(memberId: number, leg: TransportWhich, value: TransportLeg | "") {
    const cur = rideMap.get(memberId);
    const ride_to = leg === "to" ? (value || null) : (cur?.ride_to ?? null);
    const ride_back = leg === "back" ? (value || null) : (cur?.ride_back ?? null);
    setSavingId(-memberId);
    try { setTransport(await transportApi.respond(eventId, { ride_to, ride_back, seats_available: cur?.seats_available ?? null, member_id: memberId })); }
    finally { setSavingId(null); }
  }
  async function assignRide(riderId: number, driverId: number | null, leg: TransportWhich) {
    setSavingId(-riderId);
    try { setTransport(await transportApi.assign(eventId, riderId, driverId, leg)); }
    finally { setSavingId(null); }
  }

  const renderRideStrip = (memberId: number) => {
    const rr = rideMap.get(memberId);
    return (
      <div style={st.rideStrip}>
        {(["to", "back"] as TransportWhich[]).map(leg => {
          const val = (leg === "to" ? rr?.ride_to : rr?.ride_back) ?? null;
          const assignedId = leg === "to" ? rr?.assigned_driver_to_id : rr?.assigned_driver_back_id;
          const legPlan = leg === "to" ? transport?.plan?.to : transport?.plan?.back;
          const openDrivers = (legPlan?.drivers ?? []).filter(d => d.open_seats == null || d.open_seats > 0 || d.member_id === assignedId);
          return (
            <div key={leg} style={st.rideLeg}>
              <span style={st.rideLegLabel}><Car size={10} style={{ transform: leg === "back" ? "scaleX(-1)" : undefined }} /> {leg === "to" ? "There" : "Back"}</span>
              {canManage ? (
                <select style={{ ...st.rideSel, color: val ? RIDE_COLOR[val] : "#888" }} value={val ?? ""}
                  disabled={savingId === -memberId} onChange={e => setRide(memberId, leg, e.target.value as TransportLeg | "")}>
                  <option value="">—</option>
                  <option value="have">Has ride</option>
                  <option value="need">Needs ride</option>
                  <option value="drive">Driving{rr?.seats_available != null ? ` (${rr.seats_available})` : ""}</option>
                  <option value="not_sure">Not sure</option>
                </select>
              ) : (
                <span style={{ ...st.rideChip, color: val ? RIDE_COLOR[val] : "#999" }}>{val ? RIDE_LABEL[val] : "—"}</span>
              )}
              {/* Assignment: only for riders who need a ride on this leg */}
              {val === "need" && (
                assignedId ? (
                  <span style={st.driverChip}>→ {driverName(assignedId)}
                    {canManage && <button style={st.driverX} disabled={savingId === -memberId} onClick={() => assignRide(memberId, null, leg)}><X size={9} /></button>}
                  </span>
                ) : canManage && openDrivers.length > 0 ? (
                  <select style={st.assignSel} value="" disabled={savingId === -memberId}
                    onChange={e => e.target.value && assignRide(memberId, parseInt(e.target.value), leg)}>
                    <option value="">Assign driver…</option>
                    {openDrivers.map(d => <option key={d.member_id} value={d.member_id}>{d.name}{d.open_seats != null ? ` (${d.open_seats})` : ""}</option>)}
                  </select>
                ) : <span style={st.needTag}>needs a ride</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const SECTION_BY_TYPE: Record<string,string> = {
    youth: "Youth Members", mentor: "Mentors", parent: "Parents", volunteer: "Volunteers",
  };

  async function searchMembers() {
    if (!memberQuery.trim()) { setMemberHits([]); return; }
    setSearching(true);
    try {
      const { data: d } = await api.get(`/api/v1/members/?search=${encodeURIComponent(memberQuery.trim())}&is_active=true&limit=15`);
      setMemberHits(d.members ?? []);
    } finally { setSearching(false); }
  }

  async function addMember(m: { id:number; first_name:string; last_name:string; member_type?:string }) {
    setAdding(true); setAddMsg("");
    try {
      await api.post(`/api/v1/events/${eventId}/participants`, {
        member_id: m.id,
        section_label: SECTION_BY_TYPE[m.member_type ?? ""] ?? "Members",
        status: "No Reply",
      });
      setAddMsg(`${m.first_name} ${m.last_name} added.`);
      setMemberQuery(""); setMemberHits([]);
      load(); setTimeout(() => setAddMsg(""), 4000);
    } catch (err: unknown) {
      setAddMsg((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed.");
    } finally { setAdding(false); }
  }

  async function doAdd() {
    setAdding(true); setAddMsg("");
    try {
      let msg = "";
      if (addMode === "team" && selectedTeam) {
        const { data: d } = await api.post(`/api/v1/events/${eventId}/participants/bulk-team`, { team_season_id: parseInt(selectedTeam) });
        msg = `Added ${d.added} member${d.added!==1?"s":""}${d.skipped?` (${d.skipped} already listed)`:""}`;
      } else if (addMode === "type") {
        const { data: d } = await api.post(`/api/v1/events/${eventId}/participants/bulk-type`, { member_type: selectedType });
        msg = `Added ${d.added} ${selectedType}${d.added!==1?"s":""}${d.skipped?` (${d.skipped} already listed)`:""}`;
      } else if (addMode === "other" && otherName.trim()) {
        await api.post(`/api/v1/events/${eventId}/participants`, { other_name: otherName.trim(), section_label: "Others", status: "No Reply" });
        msg = `"${otherName.trim()}" added.`; setOtherName("");
      }
      if (msg) { setAddMsg(msg); load(); setTimeout(() => setAddMsg(""), 4000); }
    } catch (err: unknown) {
      setAddMsg((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed.");
    } finally { setAdding(false); }
  }

  const displayName = (p: Participant) => p.participant_type === "other"
    ? (p.other_name ?? "Unknown")
    : `${p.last_name ?? ""}, ${p.first_name ?? ""}`.trim().replace(/^,\s*/,"");

  const noRoomIds = new Set(
    (data?.sections??[]).flatMap(s=>s.participants)
      .filter(p => p.member_id && !p.separate_housing && p.status === "Attending" && !roomAssignments[String(p.member_id)])
      .map(p => p.member_id!)
  );

  if (loading) return <p style={st.muted}>Loading participants…</p>;
  const statuses = data?.available_statuses ?? ["No Reply","Attending","Not Attending","Maybe"];

  return (
    <div>
      {/* Summary */}
      {data && data.total > 0 && (
        <div style={st.summary}>
          <span style={st.total}>{data.total} total</span>
          {Object.entries(data.by_status).map(([stat,cnt]) => (
            <span key={stat} style={{ ...st.statBadge, color: STATUS_COLORS[stat]??"#555" }}>{cnt} {stat}</span>
          ))}
          {housingNeeded && noRoomIds.size > 0 && (
            <span style={st.noRoomAlert}><BedDouble size={11} /> {noRoomIds.size} attending without a room</span>
          )}
          <button style={st.refreshBtn} onClick={load}><RefreshCw size={12} /></button>
        </div>
      )}

      {/* Flag legend */}
      {canManage && data && data.total > 0 && (
        <div style={st.legend}>
          <Car size={11} color="#1565c0" /><span>Sep. travel to</span>
          <span style={{ margin:"0 6px",color:"#ddd" }}>|</span>
          <Car size={11} color="#6a1b9a" style={{ transform:"scaleX(-1)" }} /><span>Sep. travel from</span>
          <span style={{ margin:"0 6px",color:"#ddd" }}>|</span>
          <Home size={11} color="#e65100" /><span>Sep. housing</span>
          <span style={st.legendNote}> — click to toggle</span>
        </div>
      )}

      {/* Transportation summary — rides are shown & assigned inline on each person below */}
      {rideEnabled && data && data.total > 0 && (
        <div style={st.rideLegend}>
          <Car size={12} color="#1565c0" />
          <span><strong>Transportation:</strong> set each person's ride there/back and assign drivers on their row.</span>
          {transport?.plan && (
            <span style={st.rideLegendCounts}>
              {transport.plan.to.unassigned_riders.length} still need a ride there · {transport.plan.back.unassigned_riders.length} back
            </span>
          )}
        </div>
      )}

      {/* Add panel */}
      {canManage && (
        <div style={{ marginBottom: 12 }}>
          {!showAdd ? (
            <button style={st.addBtn} onClick={() => setShowAdd(true)}><UserPlus size={13} /> Add Participants</button>
          ) : (
            <div style={st.addPanel}>
              <div style={st.addModes}>
                {(["team","type","member","other"] as const).map(m => (
                  <button key={m} style={{ ...st.modeBtn, ...(addMode===m?st.modeActive:{}) }} onClick={() => setAddMode(m)}>
                    {m==="team" ? <><Users size={12}/> From Team</> : m==="type" ? <><Users size={12}/> Mentors/Parents</> : m==="member" ? <><UserPlus size={12}/> Individual</> : <><UserPlus size={12}/> Add Other</>}
                  </button>
                ))}
                <button style={st.closeBtn} onClick={() => { setShowAdd(false); setAddMode(null); }}>✕</button>
              </div>
              {addMode === "team" && (
                <div style={st.addRow}>
                  <select style={st.sel} value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}>
                    <option value="">Select team…</option>
                    {teams.map(t => <option key={t.id} value={t.id}>#{t.team_number} — {t.team_name ?? `Team ${t.team_number}`} ({t.season})</option>)}
                  </select>
                  <button style={st.doBtn} onClick={doAdd} disabled={!selectedTeam||adding}>{adding?"Adding…":"Add Team"}</button>
                </div>
              )}
              {addMode === "type" && (
                <div style={st.addRow}>
                  <select style={st.sel} value={selectedType} onChange={e => setSelectedType(e.target.value)}>
                    <option value="mentor">All Mentors</option>
                    <option value="parent">All Parents</option>
                    <option value="volunteer">All Volunteers</option>
                  </select>
                  <button style={st.doBtn} onClick={doAdd} disabled={adding}>{adding?"Adding…":"Add All"}</button>
                </div>
              )}
              {addMode === "member" && (
                <div>
                  <div style={st.addRow}>
                    <input style={st.nameIn} value={memberQuery} onChange={e => setMemberQuery(e.target.value)}
                      onKeyDown={e => e.key==="Enter"&&searchMembers()} placeholder="Search member by name…" autoFocus />
                    <button style={st.doBtn} onClick={searchMembers} disabled={!memberQuery.trim()||searching}>{searching?"Searching…":"Search"}</button>
                  </div>
                  {memberHits.length > 0 && (
                    <div style={st.hits}>
                      {memberHits.map(m => (
                        <button key={m.id} style={st.hit} disabled={adding} onClick={() => addMember(m)}>
                          {m.last_name}, {m.first_name}{m.member_type && <span style={st.hitType}>{m.member_type}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {memberQuery && memberHits.length === 0 && !searching && <div style={st.noHits}>No matching members — press Search.</div>}
                </div>
              )}
              {addMode === "other" && (
                <div style={st.addRow}>
                  <input style={st.nameIn} value={otherName} onChange={e => setOtherName(e.target.value)}
                    onKeyDown={e => e.key==="Enter"&&doAdd()} placeholder="Guest / chaperone name…" autoFocus />
                  <button style={st.doBtn} onClick={doAdd} disabled={!otherName.trim()||adding}>{adding?"Adding…":"Add"}</button>
                </div>
              )}
              {addMsg && <div style={st.addMsg}><CheckCircle size={12} color="#2e7d32" /> {addMsg}</div>}
            </div>
          )}
        </div>
      )}

      {data && data.sections.length === 0 && <p style={st.muted}>No participants yet.</p>}

      {data && data.sections.map(section => {
        const isCollapsed = collapsed.has(section.section_label);
        return (
          <div key={section.section_label} style={st.section}>
            <div style={st.secHeader} onClick={() => setCollapsed(prev => { const n=new Set(prev); n.has(section.section_label)?n.delete(section.section_label):n.add(section.section_label); return n; })}>
              <span style={st.secLabel}>{section.section_label}</span>
              <span style={st.secCount}>{section.count}</span>
              {isCollapsed ? <ChevronDown size={14} color="#888"/> : <ChevronUp size={14} color="#888"/>}
            </div>
            {!isCollapsed && section.participants.map(p => {
              const roomLabel = roomAssignments[String(p.member_id)];
              const noRoom = housingNeeded && !p.separate_housing && p.status==="Attending" && !roomLabel && !!p.member_id;
              return (
                <div key={p.id} style={st.pWrap}>
                <div style={{ ...st.pRow, background: noRoom ? "#fff8f0" : undefined }}>
                  <div style={st.av} onClick={() => p.member_id && navigate(`/members/${p.member_id}`)}>
                    {p.photo_url ? <img src={p.photo_url} style={st.avImg} alt=""/> : <span style={st.avIn}>{(p.first_name?.[0]??p.other_name?.[0]??"?").toUpperCase()}</span>}
                  </div>
                  <div style={st.nameCol}>
                    <span style={{ ...st.pName, cursor: p.member_id?"pointer":"default" }} onClick={() => p.member_id && navigate(`/members/${p.member_id}`)}>
                      {displayName(p)}{p.member_type && <span style={st.typeTag}>{p.member_type}</span>}
                    </span>
                    {roomLabel && <span style={st.roomTag}><BedDouble size={9}/> {roomLabel}</span>}
                    {noRoom && <span style={st.noRoomTag}><BedDouble size={9}/> No room assigned</span>}
                  </div>
                  {canManage && (
                    <div style={st.flags}>
                      <button title="Separate travel TO event" disabled={savingId===p.id}
                        style={{ ...st.flag, ...(p.separate_travel_to ? st.flagTo : {}) }}
                        onClick={() => toggleFlag(p.id,"separate_travel_to",p.separate_travel_to)}>
                        <Car size={10}/>→
                      </button>
                      <button title="Separate travel FROM event" disabled={savingId===p.id}
                        style={{ ...st.flag, ...(p.separate_travel_from ? st.flagFrom : {}) }}
                        onClick={() => toggleFlag(p.id,"separate_travel_from",p.separate_travel_from)}>
                        ←<Car size={10}/>
                      </button>
                      <button title="Separate housing" disabled={savingId===p.id}
                        style={{ ...st.flag, ...(p.separate_housing ? st.flagHousing : {}) }}
                        onClick={() => toggleFlag(p.id,"separate_housing",p.separate_housing)}>
                        <Home size={10}/>
                      </button>
                    </div>
                  )}
                  <div style={st.statWrap}>
                    {savingId===p.id ? <span style={st.saving}>…</span> : (
                      <select style={{ ...st.statSel, color: STATUS_COLORS[p.status]??"#555", borderColor: STATUS_COLORS[p.status]??"#ccc" }}
                        value={p.status} onChange={e => updateStatus(p.id, e.target.value)}>
                        {statuses.map(st2 => <option key={st2} value={st2}>{st2}</option>)}
                      </select>
                    )}
                  </div>
                  {canManage && <button style={st.remBtn} onClick={() => remove(p.id)}><Trash2 size={11}/></button>}
                </div>
                {rideEnabled && p.member_id && renderRideStrip(p.member_id)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const st: Record<string,React.CSSProperties> = {
  muted: { fontSize:13, color:"#aaa", margin:0 },
  summary: { display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:8, padding:"6px 10px", background:"#f8fafc", borderRadius:7 },
  total: { fontSize:12, fontWeight:700, color:"#1a3a5c" },
  statBadge: { fontSize:11, fontWeight:600 },
  noRoomAlert: { display:"flex", alignItems:"center", gap:4, fontSize:11, fontWeight:700, color:"#e65100", background:"#fff3e0", padding:"2px 8px", borderRadius:8 },
  refreshBtn: { marginLeft:"auto", background:"none", border:"none", cursor:"pointer", color:"#aaa", display:"flex" },
  legend: { display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#888", marginBottom:10, flexWrap:"wrap" },
  legendNote: { color:"#bbb", fontStyle:"italic" },
  addBtn: { display:"flex", alignItems:"center", gap:6, padding:"7px 14px", background:"#1a3a5c", color:"#fff", border:"none", borderRadius:6, cursor:"pointer", fontSize:13 },
  addPanel: { background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:9, padding:"12px" },
  addModes: { display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" },
  modeBtn: { display:"flex", alignItems:"center", gap:5, padding:"5px 12px", border:"1px solid #ccc", background:"#fff", borderRadius:5, cursor:"pointer", fontSize:12 },
  modeActive: { background:"#1a3a5c", color:"#fff", borderColor:"#1a3a5c" },
  closeBtn: { marginLeft:"auto", background:"none", border:"none", cursor:"pointer", color:"#aaa", fontSize:16 },
  addRow: { display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" },
  sel: { padding:"7px 10px", border:"1px solid #ccc", borderRadius:5, fontSize:13, flex:1, minWidth:180 },
  nameIn: { padding:"7px 10px", border:"1px solid #ccc", borderRadius:5, fontSize:13, flex:1, minWidth:240 },
  doBtn: { padding:"7px 16px", background:"#2e7d32", color:"#fff", border:"none", borderRadius:5, cursor:"pointer", fontSize:13, whiteSpace:"nowrap" as const },
  addMsg: { display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#2e7d32", marginTop:8 },
  hits: { display:"flex", flexDirection:"column", gap:4, marginTop:8, maxHeight:220, overflowY:"auto" },
  hit: { display:"flex", alignItems:"center", gap:6, textAlign:"left", padding:"7px 10px", background:"#fff", border:"1px solid #e2e8f0", borderRadius:6, cursor:"pointer", fontSize:13, color:"#1a3a5c" },
  hitType: { fontSize:10, color:"#aaa", textTransform:"capitalize" as const, marginLeft:"auto" },
  noHits: { fontSize:12, color:"#aaa", marginTop:8 },
  section: { border:"1px solid #e2e8f0", borderRadius:9, marginBottom:8, overflow:"hidden" },
  secHeader: { display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"#f0f4f8", cursor:"pointer", userSelect:"none" as const },
  secLabel: { fontWeight:700, fontSize:13, color:"#1a3a5c", flex:1 },
  secCount: { fontSize:11, background:"#1a3a5c", color:"#fff", borderRadius:10, padding:"1px 7px", fontWeight:700 },
  pWrap: { borderBottom:"1px solid #f8fafc" },
  pRow: { display:"flex", alignItems:"center", gap:8, padding:"6px 14px" },
  rideLegend: { display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", fontSize:11.5, color:"#556", marginBottom:10, padding:"7px 10px", background:"#f2f7fc", border:"1px solid #dceaf6", borderRadius:7 },
  rideLegendCounts: { color:"#c62828", fontWeight:700, marginLeft:"auto" },
  rideStrip: { display:"flex", gap:16, flexWrap:"wrap", padding:"4px 14px 8px 50px", background:"#fbfdff" },
  rideLeg: { display:"flex", alignItems:"center", gap:6 },
  rideLegLabel: { display:"inline-flex", alignItems:"center", gap:3, fontSize:11, fontWeight:700, color:"#8b98a6", minWidth:52 },
  rideSel: { padding:"3px 6px", border:"1px solid #d5dee8", borderRadius:6, fontSize:12, fontWeight:600, background:"#fff" },
  rideChip: { fontSize:12, fontWeight:700 },
  driverChip: { display:"inline-flex", alignItems:"center", gap:3, fontSize:11.5, fontWeight:700, color:"#1565c0", background:"#e7f0fb", borderRadius:6, padding:"2px 7px" },
  driverX: { display:"inline-flex", background:"none", border:"none", cursor:"pointer", color:"#c62828", padding:0, marginLeft:2 },
  assignSel: { padding:"3px 6px", border:"1px solid #f0c4c4", borderRadius:6, fontSize:11.5, background:"#fffafa", color:"#c62828" },
  needTag: { fontSize:11, fontStyle:"italic", color:"#c62828" },
  av: { width:28, height:28, borderRadius:"50%", background:"#1a3a5c", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0, cursor:"pointer" },
  avImg: { width:"100%", height:"100%", objectFit:"cover" },
  avIn: { color:"#fff", fontSize:10, fontWeight:700 },
  nameCol: { flex:1, display:"flex", flexDirection:"column", gap:2, minWidth:0 },
  pName: { fontSize:13, color:"#1a3a5c", fontWeight:500, display:"flex", alignItems:"center", gap:5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const },
  typeTag: { fontSize:10, color:"#aaa", textTransform:"capitalize" as const },
  roomTag: { display:"flex", alignItems:"center", gap:3, fontSize:10, color:"#2e7d32", fontWeight:600 },
  noRoomTag: { display:"flex", alignItems:"center", gap:3, fontSize:10, color:"#e65100", fontWeight:600 },
  flags: { display:"flex", gap:3, flexShrink:0 },
  flag: { display:"flex", alignItems:"center", padding:"2px 5px", border:"1px solid #e2e8f0", background:"#f8fafc", borderRadius:4, cursor:"pointer", fontSize:10, color:"#bbb" },
  flagTo:     { background:"#e3f2fd", color:"#1565c0", borderColor:"#90caf9" },
  flagFrom:   { background:"#ede7f6", color:"#6a1b9a", borderColor:"#ce93d8" },
  flagHousing:{ background:"#fff3e0", color:"#e65100", borderColor:"#ffcc80" },
  statWrap: { flexShrink:0 },
  statSel: { padding:"3px 6px", border:"1px solid #ccc", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", background:"#fff" },
  saving: { fontSize:12, color:"#aaa" },
  remBtn: { background:"none", border:"none", cursor:"pointer", color:"#ccc", display:"flex", padding:2, flexShrink:0 },
};
