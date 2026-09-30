import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../../core/AuthContext";
import { campApi, type CampSeason, type CampSession, type CampRegistration, type CampAttendance } from "../api";
import { campScopeOptions, sessionWeekMap, sortSessions } from "../campSort";
import CampTabs from "../components/CampTabs";
import CampEmailModal from "../components/CampEmailModal";
import { UserPlus, CalendarCheck, AlertTriangle, Plus, Pencil, X, Mail } from "lucide-react";

const STATUSES = ["pending", "confirmed", "waitlist", "cancelled"];

function sortArrow(sort: { key: string; dir: 1 | -1 } | null, key: string) {
  if (!sort || sort.key !== key) return <span style={{ color: "#cbd5e1", fontSize: 10 }}> ⇅</span>;
  return <span style={{ color: "#1a3a5c", fontSize: 10 }}>{sort.dir === 1 ? " ▲" : " ▼"}</span>;
}
const PAYMENTS = ["unpaid", "paid", "scholarship", "waived"];

export default function CampRegistrations() {
  const { canWrite } = useAuth();
  const canManage = canWrite("camp.manage");
  const [season, setSeason] = useState<CampSeason | null>(null);
  const [sessions, setSessions] = useState<CampSession[]>([]);
  // scope: "all" | "week:<label>" | "session:<id>"
  const [scope, setScope] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [regs, setRegs] = useState<CampRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [attendance, setAttendance] = useState<CampAttendance | null>(null);
  const [editor, setEditor] = useState<{ mode: "add" } | { mode: "edit"; reg: CampRegistration } | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailContact, setEmailContact] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    campApi.currentSeason().then(async (s) => {
      setSeason(s);
      if (s) setSessions(sortSessions(await campApi.listSessions(s.id).catch(() => [])));
    }).finally(() => setLoading(false));
  }, []);

  // Fetch the whole season once; scope + status filtering and week/camp sorting
  // happen client-side so every camp tab behaves the same way.
  const loadRegs = useCallback(() => {
    if (!season) return;
    campApi.listRegistrations({ season_id: season.id }).then(setRegs).catch(() => setRegs([]));
  }, [season]);
  useEffect(() => { loadRegs(); }, [loadRegs]);

  const weekGroups = useMemo(() => campScopeOptions(sessions), [sessions]);
  const weekOf = useMemo(() => sessionWeekMap(sessions), [sessions]);
  const activeSessionId: number | "all" = scope.startsWith("session:") ? parseInt(scope.slice(8)) : "all";

  // Click a column header to sort by it (toggle asc/desc); default is the
  // week → camp → camper-name grouping. (#111)
  const [sort, setSort] = useState<{ key: "name" | "camp" | "parent" | "status"; dir: 1 | -1 } | null>(null);
  function sortBy(key: "name" | "camp" | "parent" | "status") {
    setSort((p) => (p && p.key === key ? { key, dir: (p.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));
  }

  // Apply the scope (all / a week / a specific camp) + status, then sort.
  const visible = useMemo(() => {
    let list = regs;
    if (scope.startsWith("week:")) { const wk = scope.slice(5); list = list.filter((r) => weekOf[r.session_id] === wk); }
    else if (scope.startsWith("session:")) { const sid = parseInt(scope.slice(8)); list = list.filter((r) => r.session_id === sid); }
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    const name = (r: CampRegistration) => `${r.camper.last_name || ""}, ${r.camper.first_name || ""}`;
    if (sort) {
      const key = (r: CampRegistration) =>
        sort.key === "name" ? name(r) :
        sort.key === "camp" ? (r.session_title || "") :
        sort.key === "parent" ? (r.contact.name || "") : (r.status || "");
      return [...list].sort((a, b) => sort.dir * key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: "base" }) || name(a).localeCompare(name(b)));
    }
    const wk = (r: CampRegistration) => weekOf[r.session_id] || "~";
    return [...list].sort((a, b) =>
      wk(a).localeCompare(wk(b), undefined, { numeric: true }) ||
      (a.session_title || "").localeCompare(b.session_title || "") ||
      (a.camper.last_name || "").localeCompare(b.camper.last_name || "") ||
      (a.camper.first_name || "").localeCompare(b.camper.first_name || ""));
  }, [regs, scope, statusFilter, weekOf, sort]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }

  async function patch(r: CampRegistration, data: Record<string, unknown>) {
    const upd = await campApi.updateRegistration(r.id, data);
    setRegs((rs) => rs.map((x) => x.id === r.id ? upd : x));
  }
  async function convert(r: CampRegistration) {
    if (!confirm(`Create a youth member from ${r.camper.first_name} ${r.camper.last_name ?? ""}? They'll be added to Members (you can finish their profile there).`)) return;
    try { await campApi.convertToMember(r.camper.id); flash("Camper added to Members."); loadRegs(); }
    catch (e: unknown) { flash((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not convert."); }
  }
  async function openAttendance() {
    if (activeSessionId === "all") { flash("Pick a specific camp to take attendance."); return; }
    setAttendance(await campApi.getAttendance(activeSessionId));
  }
  function setDay(registrationId: number, day: string, present: boolean) {
    setAttendance((a) => a ? { ...a, campers: a.campers.map((c) => c.registration_id === registrationId ? { ...c, present: { ...c.present, [day]: present } } : c) } : a);
  }
  async function toggleDay(registrationId: number, day: string, present: boolean) {
    setDay(registrationId, day, present);          // update immediately
    try {
      await campApi.markAttendance(registrationId, day, present);
    } catch {
      setDay(registrationId, day, !present);       // revert on failure
      flash("Couldn't save attendance — check your access or connection and try again.");
    }
  }

  if (loading) return <div style={st.page}><CampTabs /><p style={st.muted}>Loading…</p></div>;
  if (!season) return <div style={st.page}><CampTabs /><p style={st.muted}>No camp season set up yet — create one on the Setup tab.</p></div>;

  return (
    <div style={st.page}>
      <CampTabs />
      {msg && <div style={st.flash}>{msg}</div>}
      <div style={st.toolbar}>
        <select style={st.select} value={scope} onChange={(e) => { setAttendance(null); setScope(e.target.value); }}>
          <option value="all">All camps</option>
          {weekGroups.map((g) => (
            <optgroup key={g.week} label={g.week}>
              {!g.weekless && g.sessions.length > 1 && <option value={`week:${g.week}`}>All of {g.week}</option>}
              {g.sessions.map((s) => <option key={s.id} value={`session:${s.id}`}>{s.title}</option>)}
            </optgroup>
          ))}
        </select>
        <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {activeSessionId !== "all" && <button style={st.attBtn} onClick={() => attendance ? setAttendance(null) : openAttendance()}><CalendarCheck size={14} /> {attendance ? "Hide attendance" : "Attendance"}</button>}
        {canManage && <button style={st.emailBtn} onClick={() => setEmailing(true)} title="Email the parents/guardians of the campers shown"><Mail size={14} /> Email contacts</button>}
        {canManage && <button style={st.addBtn} onClick={() => setEditor({ mode: "add" })}><Plus size={14} /> Add camper</button>}
        <span style={st.count}>{visible.length} registration{visible.length === 1 ? "" : "s"}</span>
      </div>

      {emailing && season && (
        <CampEmailModal
          season={{ id: season.id, name: season.name }}
          sessions={sessions}
          initialSessionId={activeSessionId}
          initialStatus={statusFilter || undefined}
          onClose={() => setEmailing(false)}
        />
      )}
      {emailContact && <CampEmailModal singleContact={emailContact} onClose={() => setEmailContact(null)} />}

      {editor && (
        <RegEditor
          mode={editor.mode}
          reg={editor.mode === "edit" ? editor.reg : null}
          sessions={sessions}
          allRegs={regs}
          onClose={() => setEditor(null)}
          onSaved={(m) => { setEditor(null); flash(m); loadRegs(); }}
        />
      )}

      {attendance && (
        <div style={st.card}>
          <div style={st.attHead}>Attendance — {attendance.session.title} <span style={st.attNote}>(confirmed campers only)</span></div>
          <div style={st.attWrap}>
            <table style={st.table}>
              <thead><tr><th style={st.th}>Camper</th>{attendance.days.map((d) => <th key={d} style={st.thDay}>{d.slice(5)}</th>)}</tr></thead>
              <tbody>
                {attendance.campers.map((c) => (
                  <tr key={c.registration_id}>
                    <td style={st.td}>{c.name}</td>
                    {attendance.days.map((d) => (
                      <td key={d} style={st.tdDay}>
                        <input type="checkbox" checked={!!c.present[d]} disabled={!canManage} onChange={(e) => toggleDay(c.registration_id, d, e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                ))}
                {attendance.campers.length === 0 && <tr><td style={st.td} colSpan={attendance.days.length + 1}>No registrations for this camp.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={st.card}>
        {visible.length === 0 ? <p style={st.muted}>No registrations match.</p> : (
          <div style={st.listWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={{ ...st.th, cursor: "pointer" }} onClick={() => sortBy("name")}>Camper{sortArrow(sort, "name")}</th>
                  <th style={{ ...st.th, cursor: "pointer" }} onClick={() => sortBy("camp")}>Camp{sortArrow(sort, "camp")}</th>
                  <th style={{ ...st.th, cursor: "pointer" }} onClick={() => sortBy("parent")}>Parent{sortArrow(sort, "parent")}</th>
                  <th style={{ ...st.th, cursor: "pointer" }} onClick={() => sortBy("status")}>Status{sortArrow(sort, "status")}</th>
                  <th style={st.th}>Payment</th><th style={st.thC}>Shirt</th><th style={st.th}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} style={st.tr}>
                    <td style={st.td}>
                      <strong>{r.camper.first_name} {r.camper.last_name}</strong>
                      <div style={st.sub}>{[r.camper.grade && `Gr ${r.camper.grade}`, r.camper.school].filter(Boolean).join(" · ")}</div>
                      {(r.camper.medical_notes || r.camper.food_allergies || r.camper.accommodations) &&
                        <div style={st.flag} title={[r.camper.medical_notes, r.camper.food_allergies && `Food: ${r.camper.food_allergies}`, r.camper.accommodations].filter(Boolean).join(" | ")}><AlertTriangle size={11} /> medical/allergy/accommodation note</div>}
                    </td>
                    <td style={st.td}>{weekOf[r.session_id] ? <span style={st.weekTag}>{weekOf[r.session_id]}</span> : null}{r.session_title}</td>
                    <td style={st.td}>{r.contact.name}<div style={st.sub}>{r.contact.email}{r.contact.phone ? ` · ${r.contact.phone}` : ""}</div></td>
                    <td style={st.td}>
                      <select style={st.cellSel} disabled={!canManage} value={r.status} onChange={(e) => patch(r, { status: e.target.value })}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={st.td}>
                      <select style={st.cellSel} disabled={!canManage} value={r.payment_status} onChange={(e) => patch(r, { payment_status: e.target.value })}>
                        {PAYMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {r.payment_method && <div style={st.sub}>via {r.payment_method}</div>}
                    </td>
                    <td style={st.tdC}><input type="checkbox" disabled={!canManage} checked={r.shirt_received} onChange={(e) => patch(r, { shirt_received: e.target.checked })} title="Shirt received" /> <span style={st.shirt}>{r.shirt_size || r.camper.shirt_size || ""}</span></td>
                    <td style={st.td}>
                      <div style={st.rowActions}>
                        {canManage && r.contact.email && <button style={st.editBtn} onClick={() => setEmailContact({ email: r.contact.email!, name: r.contact.name || r.contact.email! })} title={`Email ${r.contact.name || "this parent"}`}><Mail size={13} /></button>}
                        {canManage && <button style={st.editBtn} onClick={() => setEditor({ mode: "edit", reg: r })} title="Edit camper details"><Pencil size={13} /></button>}
                        {r.camper.member_id
                          ? <span style={st.memberTag}>Member ✓</span>
                          : canManage && <button style={st.convertBtn} onClick={() => convert(r)} title="Create a TRC youth member from this camper"><UserPlus size={13} /> To member</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type EditorForm = {
  session_id: number | "";
  status: string; payment_status: string; payment_method: string;
  first_name: string; last_name: string; grade: string; school: string; shirt_size: string;
  medical_notes: string; food_allergies: string; accommodations: string;
  contact_name: string; contact_email: string; contact_phone: string;
  emergency1_name: string; emergency1_relation: string; emergency1_phone: string;
  notes: string;
};

function RegEditor({ mode, reg, sessions, allRegs, onClose, onSaved }: {
  mode: "add" | "edit"; reg: CampRegistration | null; sessions: CampSession[]; allRegs: CampRegistration[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [f, setF] = useState<EditorForm>({
    session_id: reg?.session_id ?? "",
    status: reg?.status ?? "confirmed", payment_status: reg?.payment_status ?? "unpaid", payment_method: reg?.payment_method ?? "",
    first_name: reg?.camper.first_name ?? "", last_name: reg?.camper.last_name ?? "", grade: reg?.camper.grade ?? "",
    school: reg?.camper.school ?? "", shirt_size: reg?.shirt_size ?? reg?.camper.shirt_size ?? "",
    medical_notes: reg?.camper.medical_notes ?? "", food_allergies: reg?.camper.food_allergies ?? "", accommodations: reg?.camper.accommodations ?? "",
    contact_name: reg?.contact.name ?? "", contact_email: reg?.contact.email ?? "", contact_phone: reg?.contact.phone ?? "",
    emergency1_name: reg?.emergency1_name ?? "", emergency1_relation: reg?.emergency1_relation ?? "", emergency1_phone: reg?.emergency1_phone ?? "",
    notes: reg?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [addSession, setAddSession] = useState<number | "">("");
  function s<K extends keyof EditorForm>(k: K, v: EditorForm[K]) { setF((p) => ({ ...p, [k]: v })); }

  // Other camps this same camper is already registered for (for transfer/multi-camp UI).
  const otherRegs = reg ? allRegs.filter((r) => r.camper.id === reg.camper.id && r.id !== reg.id) : [];
  const enrolledSessionIds = new Set(otherRegs.map((r) => r.session_id).concat(reg ? [reg.session_id] : []));

  async function enrollAnother() {
    if (!addSession || !reg) return;
    setSaving(true); setErr("");
    try {
      await campApi.createRegistration({ camper_id: reg.camper.id, session_id: addSession });
      onSaved("Enrolled in another camp.");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not enroll in that camp.");
      setSaving(false);
    }
  }

  async function save() {
    if (!f.first_name.trim()) { setErr("Camper's first name is required."); return; }
    if (!f.last_name.trim()) { setErr("Camper's last name is required."); return; }
    if (mode === "add" && !f.session_id) { setErr("Please choose a camp."); return; }
    setSaving(true); setErr("");
    const camper = {
      first_name: f.first_name, last_name: f.last_name, grade: f.grade, school: f.school, shirt_size: f.shirt_size,
      medical_notes: f.medical_notes, food_allergies: f.food_allergies, accommodations: f.accommodations,
    };
    const contact = { name: f.contact_name, email: f.contact_email, phone: f.contact_phone };
    const common = {
      status: f.status, payment_status: f.payment_status, payment_method: f.payment_method,
      emergency1_name: f.emergency1_name, emergency1_relation: f.emergency1_relation, emergency1_phone: f.emergency1_phone,
      notes: f.notes, shirt_size: f.shirt_size,
    };
    try {
      if (mode === "add") await campApi.createRegistration({ session_id: f.session_id, camper, contact, ...common });
      else await campApi.updateRegistration(reg!.id, { session_id: f.session_id, camper, contact, ...common });
      onSaved(mode === "add" ? "Camper added." : "Camper updated.");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
      setSaving(false);
    }
  }

  return (
    <div style={st.overlay} onMouseDown={onClose}>
      <div style={st.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={st.modalHead}>
          <strong>{mode === "add" ? "Add a camper" : `Edit ${reg?.camper.first_name} ${reg?.camper.last_name ?? ""}`}</strong>
          <button style={st.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        {err && <div style={st.err}>{err}</div>}
        <div style={st.formBody}>
          <div style={st.section}>Camp</div>
          {mode === "add" ? (
            <select style={st.in} value={f.session_id} onChange={(e) => s("session_id", e.target.value ? parseInt(e.target.value) : "")}>
              <option value="">— choose a camp —</option>
              {sessions.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          ) : (
            <>
              <Fld label="Camp (change this to transfer the camper)">
                <select style={st.in} value={f.session_id} onChange={(e) => s("session_id", e.target.value ? parseInt(e.target.value) : "")}>
                  {sessions.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>
              </Fld>
              {otherRegs.length > 0 && (
                <div style={st.otherCamps}>Also registered for: {otherRegs.map((r) => r.session_title).join(", ")}</div>
              )}
              <div style={st.enrollRow}>
                <select style={st.in} value={addSession} onChange={(e) => setAddSession(e.target.value ? parseInt(e.target.value) : "")}>
                  <option value="">— enroll in another camp —</option>
                  {sessions.filter((x) => !enrolledSessionIds.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>
                <button type="button" style={st.enrollBtn} disabled={!addSession || saving} onClick={enrollAnother}>Enroll</button>
              </div>
            </>
          )}

          <div style={st.section}>Camper</div>
          <div style={st.grid2}>
            <Fld label="First name *"><input style={st.in} value={f.first_name} onChange={(e) => s("first_name", e.target.value)} /></Fld>
            <Fld label="Last name *"><input style={st.in} value={f.last_name} onChange={(e) => s("last_name", e.target.value)} /></Fld>
            <Fld label="Grade (fall)"><input style={st.in} value={f.grade} onChange={(e) => s("grade", e.target.value)} /></Fld>
            <Fld label="School"><input style={st.in} value={f.school} onChange={(e) => s("school", e.target.value)} /></Fld>
            <Fld label="Shirt size"><input style={st.in} value={f.shirt_size} onChange={(e) => s("shirt_size", e.target.value)} /></Fld>
          </div>
          <Fld label="Medical / allergy notes"><textarea style={st.ta} value={f.medical_notes} onChange={(e) => s("medical_notes", e.target.value)} /></Fld>
          <div style={st.grid2}>
            <Fld label="Food allergies"><input style={st.in} value={f.food_allergies} onChange={(e) => s("food_allergies", e.target.value)} /></Fld>
            <Fld label="Accommodations"><input style={st.in} value={f.accommodations} onChange={(e) => s("accommodations", e.target.value)} /></Fld>
          </div>

          <div style={st.section}>Parent / guardian</div>
          <div style={st.grid2}>
            <Fld label="Name"><input style={st.in} value={f.contact_name} onChange={(e) => s("contact_name", e.target.value)} /></Fld>
            <Fld label="Email"><input style={st.in} value={f.contact_email} onChange={(e) => s("contact_email", e.target.value)} /></Fld>
            <Fld label="Phone"><input style={st.in} value={f.contact_phone} onChange={(e) => s("contact_phone", e.target.value)} /></Fld>
          </div>

          <div style={st.section}>Emergency contact</div>
          <div style={st.grid3}>
            <Fld label="Name"><input style={st.in} value={f.emergency1_name} onChange={(e) => s("emergency1_name", e.target.value)} /></Fld>
            <Fld label="Relation"><input style={st.in} value={f.emergency1_relation} onChange={(e) => s("emergency1_relation", e.target.value)} /></Fld>
            <Fld label="Phone"><input style={st.in} value={f.emergency1_phone} onChange={(e) => s("emergency1_phone", e.target.value)} /></Fld>
          </div>

          <div style={st.section}>Status</div>
          <div style={st.grid3}>
            <Fld label="Status"><select style={st.in} value={f.status} onChange={(e) => s("status", e.target.value)}>{STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select></Fld>
            <Fld label="Payment"><select style={st.in} value={f.payment_status} onChange={(e) => s("payment_status", e.target.value)}>{PAYMENTS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Fld>
            <Fld label="Payment method"><input style={st.in} value={f.payment_method} onChange={(e) => s("payment_method", e.target.value)} placeholder="cash, check, card…" /></Fld>
          </div>
          <Fld label="Notes"><textarea style={st.ta} value={f.notes} onChange={(e) => s("notes", e.target.value)} /></Fld>
        </div>
        <div style={st.modalFoot}>
          <button style={st.ghost} onClick={onClose}>Cancel</button>
          <button style={st.save} disabled={saving} onClick={save}>{saving ? "Saving…" : mode === "add" ? "Add camper" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.lbl}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: "0 auto" },
  muted: { color: "#888", fontSize: 14 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  select: { padding: "8px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff" },
  attBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#0277bd", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  emailBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  count: { fontSize: 12, color: "#888", marginLeft: "auto" },
  weekTag: { display: "inline-block", fontSize: 10, fontWeight: 700, color: "#0277bd", background: "#e3f2fd", borderRadius: 4, padding: "1px 5px", marginRight: 6 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 14 },
  listWrap: { overflowX: "auto" },
  attWrap: { overflowX: "auto" },
  attHead: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  attNote: { fontSize: 11, fontWeight: 400, color: "#888" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  thC: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  thDay: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "8px", verticalAlign: "top", borderBottom: "1px solid #f4f6fa" },
  tdC: { padding: "8px", textAlign: "center", borderBottom: "1px solid #f4f6fa" },
  tdDay: { padding: "6px 8px", textAlign: "center", borderBottom: "1px solid #f4f6fa" },
  sub: { fontSize: 11, color: "#99a", marginTop: 2 },
  flag: { fontSize: 10, color: "#e65100", fontWeight: 600, marginTop: 3, display: "flex", alignItems: "center", gap: 3 },
  cellSel: { padding: "4px 6px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 12, background: "#fff" },
  shirt: { fontSize: 11, color: "#778" },
  memberTag: { fontSize: 11, fontWeight: 700, color: "#2e7d32" },
  convertBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  rowActions: { display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" },
  editBtn: { display: "flex", alignItems: "center", padding: "5px 7px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", zIndex: 1000, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 620, boxShadow: "0 12px 48px rgba(0,0,0,0.25)" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #eef0f4", fontSize: 15 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#667", padding: 4, display: "flex" },
  err: { background: "#fdecea", border: "1px solid #f5c6cb", color: "#c62828", borderRadius: 8, padding: "8px 14px", fontSize: 13, margin: "10px 18px 0" },
  formBody: { padding: "8px 18px 4px", maxHeight: "70vh", overflowY: "auto" },
  section: { fontSize: 11, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 6px" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 12px" },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  ta: { width: "100%", minHeight: 48, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, resize: "vertical", boxSizing: "border-box" },
  readonly: { padding: "8px 10px", background: "#f1f5f9", borderRadius: 6, fontSize: 14, color: "#334155", fontWeight: 600 },
  otherCamps: { fontSize: 12, color: "#667", marginTop: 6 },
  enrollRow: { display: "flex", gap: 8, marginTop: 8, alignItems: "center" },
  enrollBtn: { padding: "8px 14px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 18px", borderTop: "1px solid #eef0f4" },
  ghost: { padding: "8px 16px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
