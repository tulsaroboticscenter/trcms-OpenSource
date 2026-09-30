/**
 * Report an Incident — the priority surface (§6, §12). Phone-first, one-handed, few required
 * fields. Type picker up top; a red "someone is still at risk" banner jumps ahead of everything;
 * the anonymity checkbox is OFF by default with its warning copy. Ugly-but-fast by design.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { incidentsApi, PHASE1_TYPES, SEVERITIES, type IncidentTypeDef } from "../api";
import { eventsApi, type TRCEvent } from "../../events/api";
import { api } from "../../../core/api";
import { AlertTriangle, Phone, ArrowLeft, ShieldOff, X } from "lucide-react";

type Person = { member_id?: number; name: string };
type CareProvider = { member_id?: number; name: string; contact?: string };

type Detail = Record<string, unknown>;

// Mentor emergency contacts shown on the "someone is still at risk" banner — reach a mentor for
// immediate action rather than an outside line. First entry shows first; add more here as needed.
const MENTOR_CONTACTS: { name: string; phone: string }[] = [
  // Add your organization's emergency mentor contacts here, e.g.
  // { name: "Jane Doe", phone: "555-123-4567" },
];

// Areas at TRC for the "Where" picker (plus an "Other…" free-text option).
const TRC_AREAS = [
  "FLL Area", "FTC Area", "Team Room", "FRC Area", "Machine Shop", "3DP Room",
  "FTC Parts Room", "Hall", "Collab Lab", "Computer Lab",
  "Kitchen", "Restrooms", "Storage", "Parking Lot", "Outside",
];

export default function ReportIncident() {
  const nav = useNavigate();
  const [type, setType] = useState<IncidentTypeDef | null>(null);
  const [atRisk, setAtRisk] = useState<"" | "yes" | "no">("");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 16));
  const [approx, setApprox] = useState(false);
  const [locKind, setLocKind] = useState("trc");
  const [locArea, setLocArea] = useState("");
  const [locAreaOther, setLocAreaOther] = useState("");
  const [locOther, setLocOther] = useState("");
  const [eventId, setEventId] = useState("");
  const [events, setEvents] = useState<TRCEvent[]>([]);
  const [onBehalf, setOnBehalf] = useState(false);
  const [forPerson, setForPerson] = useState<Person | null>(null);
  const [relationship, setRelationship] = useState("");
  const [affectedPeople, setAffectedPeople] = useState<Person[]>([]);
  const [witnesses, setWitnesses] = useState("");
  const [description, setDescription] = useState("");
  const [immediate, setImmediate] = useState("");
  const [severity, setSeverity] = useState("");
  const [detail, setDetail] = useState<Detail>({});
  const [injury, setInjury] = useState<Detail>({});
  const [careProviders, setCareProviders] = useState<CareProvider[]>([]);
  const [anon, setAnon] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const d = (k: string, v: unknown) => setDetail((p) => ({ ...p, [k]: v }));
  const inj = (k: string, v: unknown) => setInjury((p) => ({ ...p, [k]: v }));

  // Recent + near-future events to tag the incident to (most incidents happened at a meeting).
  useEffect(() => {
    const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    eventsApi.list({ from_date: from, to_date: to })
      .then((r) => setEvents((r.events ?? []).slice().sort((a, b) =>
        (b.event_date + (b.start_time ?? "")).localeCompare(a.event_date + (a.start_time ?? "")))))
      .catch(() => setEvents([]));
  }, []);

  async function submit() {
    setError("");
    if (!type) { setError("Pick what kind of report this is."); return; }
    if (!description.trim()) { setError("Please describe what happened."); return; }
    if (!severity) { setError("Choose how serious it was."); return; }
    if (atRisk === "") { setError("Tell us whether anyone is still at risk."); return; }
    setSaving(true);
    try {
      const people: { member_id?: number; name: string; person_role: string; is_youth: null; notes?: string }[] = [];
      affectedPeople.forEach((p) => people.push({ member_id: p.member_id, name: p.name, person_role: "affected", is_youth: null }));
      witnesses.split(",").map((w) => w.trim()).filter(Boolean).forEach((w) => people.push({ name: w, person_role: "witness", is_youth: null }));
      careProviders.forEach((c) => people.push({ member_id: c.member_id, name: c.name, person_role: "responder", is_youth: null, notes: c.contact || undefined }));
      const inc = await incidentsApi.submit({
        type: type.slug,
        reporter_severity: severity,
        is_anonymous: anon,
        ongoing_risk: atRisk === "yes",
        occurred_at: when,
        occurred_approx: approx,
        location_kind: locKind,
        location_area: locKind === "trc" ? (locArea === "__other" ? (locAreaOther.trim() || null) : (locArea || null)) : null,
        location_other: locKind === "other" ? locOther || null : null,
        event_id: eventId ? Number(eventId) : null,
        filed_for_member_id: onBehalf ? (forPerson?.member_id ?? null) : null,
        filed_for_name: onBehalf ? (forPerson?.name || null) : null,
        filed_for_relationship: onBehalf ? relationship || null : null,
        description,
        immediate_actions: immediate || null,
        ems_called: !!injury.ems_called,
        people,
        detail: { ...detail, follow_up_contact: anon ? null : followUp || null },
        injury: (type.slug === "injury" || type.slug === "medical") ? injury : null,
      });
      nav(anon ? "/incidents/thanks" : `/incidents/mine`, { state: { ref: inc.ref_no } });
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Could not file the report. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div style={s.wrap}>
      <button onClick={() => nav(-1)} style={s.back}><ArrowLeft size={15} /> Back</button>
      <h1 style={s.h1}>Report an Incident</h1>
      <p style={s.sub}>Facts only — what you saw and heard. No diagnoses or conclusions. A quick partial report now beats a perfect one later.</p>

      {/* 1. Type picker */}
      <div style={s.section}>
        <div style={s.qlabel}>What kind of report is this?</div>
        <div style={s.typeGrid}>
          {PHASE1_TYPES.map((t) => (
            <button key={t.slug} type="button" onClick={() => setType(t)}
              style={{ ...s.typeCard, ...(type?.slug === t.slug ? s.typeCardOn : {}) }}>
              <div style={s.typeName}>{t.label}</div>
              <div style={s.typeBlurb}>{t.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      {type && (<>
        {/* At-risk — jumps ahead of everything */}
        <div style={s.section}>
          <div style={s.qlabel}>Is anyone still at risk right now?</div>
          <div style={s.yn}>
            <button type="button" onClick={() => setAtRisk("yes")} style={{ ...s.ynBtn, ...(atRisk === "yes" ? s.ynDanger : {}) }}>Yes</button>
            <button type="button" onClick={() => setAtRisk("no")} style={{ ...s.ynBtn, ...(atRisk === "no" ? s.ynOk : {}) }}>No</button>
          </div>
          {atRisk === "yes" && (
            <div style={s.redBanner}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 16 }}><AlertTriangle size={20} /> Get help first, then finish this report.</div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <a href="tel:911" style={s.callBtn}><Phone size={16} /> Call 911 — emergency</a>
                {MENTOR_CONTACTS.map((c) => (
                  <a key={c.phone} href={`tel:${c.phone.replace(/[^0-9]/g, "")}`} style={s.callBtn}><Phone size={16} /> {c.name} — {c.phone}</a>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>Reach a mentor right away for immediate help. Filing this report does <strong>not</strong> replace getting help now.</div>
            </div>
          )}
        </div>

        {/* When / where */}
        <div style={s.section}>
          <label style={s.field}><span style={s.lbl}>When did it happen?</span>
            <input type="datetime-local" style={s.input} value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          <label style={s.check}><input type="checkbox" checked={approx} onChange={(e) => setApprox(e.target.checked)} /> Time is approximate</label>
          <label style={s.field}><span style={s.lbl}>Where?</span>
            <select style={s.input} value={locKind} onChange={(e) => setLocKind(e.target.value)}>
              <option value="trc">At TRC</option><option value="offsite">Off-site event</option><option value="other">Somewhere else</option>
            </select></label>
          {locKind === "trc" && (<>
            <select style={s.input} value={locArea} onChange={(e) => setLocArea(e.target.value)}>
              <option value="">Area (optional)…</option>
              {TRC_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              <option value="__other">Other…</option>
            </select>
            {locArea === "__other" && <input style={{ ...s.input, marginTop: 6 }} placeholder="Enter the area" value={locAreaOther} onChange={(e) => setLocAreaOther(e.target.value)} />}
          </>)}
          {locKind === "other" && <input style={s.input} placeholder="Where?" value={locOther} onChange={(e) => setLocOther(e.target.value)} />}
          <label style={{ ...s.field, marginTop: 10 }}><span style={s.lbl}>Related event / meeting (optional)</span>
            <select style={s.input} value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Not tied to a calendar event…</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.event_date} — {ev.name}</option>)}
            </select></label>
        </div>

        {/* Who */}
        <div style={s.section}>
          <div style={s.field}><span style={s.lbl}>Who was affected? (pick TRC members, or type a name — you can add several)</span>
            <PeoplePicker people={affectedPeople} setPeople={setAffectedPeople} /></div>
          <label style={s.field}><span style={s.lbl}>Witnesses / others present (names, comma-separated)</span>
            <input style={s.input} value={witnesses} onChange={(e) => setWitnesses(e.target.value)} placeholder="Anyone who saw it or was nearby" /></label>
          <label style={s.check}><input type="checkbox" checked={onBehalf} onChange={(e) => setOnBehalf(e.target.checked)} /> I'm filing on behalf of someone else</label>
          {onBehalf && (<>
            <div style={{ marginBottom: 8 }}><OnBehalfPicker value={forPerson} onChange={setForPerson} /></div>
            <input style={s.input} placeholder="Your relationship to them" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
          </>)}
        </div>

        {/* Type-specific block */}
        {type.slug === "medical" && <MedicalBlock d={d} inj={inj} injury={injury} careProviders={careProviders} setCareProviders={setCareProviders} />}
        {type.slug === "injury" && <InjuryBlock d={d} inj={inj} />}
        {type.slug === "behavior" && <BehaviorBlock d={d} />}
        {type.slug === "near_miss" && <NearMissBlock d={d} />}

        {/* Narrative */}
        <div style={s.section}>
          <label style={s.field}><span style={s.lbl}>What happened? *</span>
            <textarea style={{ ...s.input, minHeight: 96, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you saw and heard — facts, not conclusions." /></label>
          <label style={s.field}><span style={s.lbl}>What was done right away?</span>
            <textarea style={{ ...s.input, minHeight: 56, resize: "vertical" }} value={immediate} onChange={(e) => setImmediate(e.target.value)} /></label>
        </div>

        {/* Severity */}
        <div style={s.section}>
          <div style={s.qlabel}>How serious was it, as you saw it? *</div>
          <div style={s.sevGrid}>
            {SEVERITIES.map((sv) => (
              <button key={sv.value} type="button" onClick={() => setSeverity(sv.value)} style={{ ...s.sevCard, ...(severity === sv.value ? s.sevOn : {}) }}>
                <div style={{ fontWeight: 800 }}>{sv.label}</div>
                <div style={s.sevAnchor}>{sv.anchor}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Anonymity */}
        <div style={s.section}>
          <label style={{ ...s.check, alignItems: "flex-start" }}>
            <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
            <span><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}><ShieldOff size={15} /> Submit anonymously</span>
              <div style={s.anonWarn}>Your name won't be attached. But a story can still identify you — if only a few people were there, what you describe may point back to you. No one at TRC can see who filed anonymously.</div></span>
          </label>
          {!anon && (
            <label style={s.field}><span style={s.lbl}>Best way to follow up with you (optional)</span>
              <input style={s.input} value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="Phone, email, or 'catch me at the shop'" /></label>
          )}
        </div>

        {error && <div style={s.err}>{error}</div>}
        <button onClick={submit} disabled={saving} style={s.submit}>{saving ? "Filing…" : "File this report"}</button>
        <p style={s.foot}>Attachments (photos) can be added after filing, from the report page.</p>
      </>)}
    </div>
  );
}

function Sel({ label, opts, onChange, value }: { label: string; opts: string[]; onChange: (v: string) => void; value?: string }) {
  // Self-controlled: the parent only wants onChange, so the picker tracks its own displayed value
  // (previously it was hard-bound to an empty prop, so a selection never "stuck" visually).
  const [v, setV] = useState(value ?? "");
  return (
    <label style={s.field}><span style={s.lbl}>{label}</span>
      <select style={s.input} value={v} onChange={(e) => { setV(e.target.value); onChange(e.target.value); }}>
        <option value="">Choose…</option>
        {opts.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
      </select></label>
  );
}

// A picker with an "Other…" choice that reveals a details field; onChange gets the selected value,
// or the typed text when "Other" is chosen.
function SelOther({ label, opts, onChange }: { label: string; opts: string[]; onChange: (v: string) => void }) {
  const [sel, setSel] = useState("");
  const [other, setOther] = useState("");
  return (
    <>
      <label style={s.field}><span style={s.lbl}>{label}</span>
        <select style={s.input} value={sel} onChange={(e) => { const val = e.target.value; setSel(val); onChange(val === "__other" ? other : val); }}>
          <option value="">Choose…</option>
          {opts.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          <option value="__other">Other…</option>
        </select></label>
      {sel === "__other" && <input style={{ ...s.input, marginTop: 6 }} placeholder="Please provide details" value={other} onChange={(e) => { setOther(e.target.value); onChange(e.target.value); }} />}
    </>
  );
}

function PeoplePicker({ people, setPeople }: { people: Person[]; setPeople: (p: Person[]) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [freeName, setFreeName] = useState("");
  async function doSearch() {
    if (!search.trim()) return;
    try { const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search)}&is_active=true&limit=10`); setResults(data.members ?? []); }
    catch { setResults([]); }
  }
  const add = (p: Person) => { if (p.member_id && people.some((x) => x.member_id === p.member_id)) return; setPeople([...people, p]); };
  return (
    <div>
      {people.length > 0 && (
        <div style={s.chips}>
          {people.map((p, i) => (
            <span key={i} style={s.chip}>{p.name}{!p.member_id && <span style={{ color: "#999" }}> (not a member)</span>}
              <button type="button" style={s.chipX} onClick={() => setPeople(people.filter((_, j) => j !== i))}><X size={12} /></button></span>
          ))}
        </div>
      )}
      <div style={s.searchRow}>
        <input style={s.input} placeholder="Search TRC members…" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }} />
        <button type="button" style={s.searchBtn} onClick={doSearch}>Search</button>
      </div>
      {results.map((m) => (
        <div key={m.id} style={s.itemOpt} onClick={() => { add({ member_id: m.id, name: `${m.first_name} ${m.last_name}` }); setResults([]); setSearch(""); }}>{m.first_name} {m.last_name}</div>
      ))}
      <div style={{ ...s.searchRow, marginTop: 6 }}>
        <input style={s.input} placeholder="…or type a name (non-member)" value={freeName} onChange={(e) => setFreeName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && freeName.trim()) { e.preventDefault(); add({ name: freeName.trim() }); setFreeName(""); } }} />
        <button type="button" style={s.searchBtn} onClick={() => { if (freeName.trim()) { add({ name: freeName.trim() }); setFreeName(""); } }}>Add</button>
      </div>
    </div>
  );
}

// Multiple people who administered care: a TRC member (picked), or a non-member with contact info.
function CareProviderPicker({ providers, setProviders }: { providers: CareProvider[]; setProviders: (p: CareProvider[]) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [freeName, setFreeName] = useState("");
  const [freeContact, setFreeContact] = useState("");
  async function doSearch() {
    if (!search.trim()) return;
    try { const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search)}&is_active=true&limit=10`); setResults(data.members ?? []); }
    catch { setResults([]); }
  }
  const addMember = (m: { id: number; first_name: string; last_name: string }) => {
    if (!providers.some((x) => x.member_id === m.id)) setProviders([...providers, { member_id: m.id, name: `${m.first_name} ${m.last_name}` }]);
    setResults([]); setSearch("");
  };
  const addFree = () => { if (freeName.trim()) { setProviders([...providers, { name: freeName.trim(), contact: freeContact.trim() || undefined }]); setFreeName(""); setFreeContact(""); } };
  return (
    <div>
      {providers.length > 0 && (
        <div style={s.chips}>
          {providers.map((p, i) => (
            <span key={i} style={s.chip}>{p.name}{p.member_id ? "" : (p.contact ? ` — ${p.contact}` : " (non-member)")}
              <button type="button" style={s.chipX} onClick={() => setProviders(providers.filter((_, j) => j !== i))}><X size={12} /></button></span>
          ))}
        </div>
      )}
      <div style={s.searchRow}>
        <input style={s.input} placeholder="Search TRC members…" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }} />
        <button type="button" style={s.searchBtn} onClick={doSearch}>Search</button>
      </div>
      {results.map((m) => <div key={m.id} style={s.itemOpt} onClick={() => addMember(m)}>{m.first_name} {m.last_name}</div>)}
      <div style={{ ...s.searchRow, marginTop: 6 }}>
        <input style={{ ...s.input, flex: 2 }} placeholder="…or name of a non-member" value={freeName} onChange={(e) => setFreeName(e.target.value)} />
        <input style={{ ...s.input, flex: 2 }} placeholder="their contact (phone/email)" value={freeContact} onChange={(e) => setFreeContact(e.target.value)} />
        <button type="button" style={s.searchBtn} disabled={!freeName.trim()} onClick={addFree}>Add</button>
      </div>
    </div>
  );
}

function OnBehalfPicker({ value, onChange }: { value: Person | null; onChange: (p: Person | null) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [freeName, setFreeName] = useState("");
  async function doSearch() {
    if (!search.trim()) return;
    try { const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search)}&is_active=true&limit=10`); setResults(data.members ?? []); }
    catch { setResults([]); }
  }
  if (value) return <div style={s.picked}>{value.name}{!value.member_id && <span style={{ color: "#999" }}> (not a member)</span>} <button type="button" style={s.changeBtn} onClick={() => onChange(null)}>change</button></div>;
  return (
    <div>
      <div style={s.searchRow}>
        <input style={s.input} placeholder="Search TRC members…" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }} />
        <button type="button" style={s.searchBtn} onClick={doSearch}>Search</button>
      </div>
      {results.map((m) => (
        <div key={m.id} style={s.itemOpt} onClick={() => { onChange({ member_id: m.id, name: `${m.first_name} ${m.last_name}` }); setResults([]); setSearch(""); }}>{m.first_name} {m.last_name}</div>
      ))}
      <div style={{ ...s.searchRow, marginTop: 6 }}>
        <input style={s.input} placeholder="…or type a name (non-member)" value={freeName} onChange={(e) => setFreeName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && freeName.trim()) { e.preventDefault(); onChange({ name: freeName.trim() }); } }} />
        <button type="button" style={s.searchBtn} onClick={() => { if (freeName.trim()) onChange({ name: freeName.trim() }); }}>Set</button>
      </div>
    </div>
  );
}

function MedicalBlock({ d, inj, injury, careProviders, setCareProviders }: { d: (k: string, v: unknown) => void; inj: (k: string, v: unknown) => void; injury: Record<string, unknown>; careProviders: CareProvider[]; setCareProviders: (p: CareProvider[]) => void }) {
  return (
    <div style={s.section}>
      <div style={s.blockTitle}>Medical details</div>
      <SelOther label="Nature *" opts={["allergic reaction", "asthma/breathing", "seizure", "diabetic", "fainting/dizziness", "heat illness", "nausea/vomiting", "headache", "known-condition flare-up", "unknown"]} onChange={(v) => d("nature", v)} />
      <SelOther label="Rescue medication used?" opts={["none", "epi_pen", "inhaler", "glucagon"]} onChange={(v) => inj("rescue_med", (v === "none" || v === "") ? "" : v)} />
      <div style={s.field}><span style={s.lbl}>Who administered care? (pick TRC members, or add a non-member with contact info — you can add several)</span>
        <CareProviderPicker providers={careProviders} setProviders={setCareProviders} /></div>
      <SelOther label="Outcome" opts={["resolved on site", "sent home", "parent picked up", "urgent care", "ER", "EMS transport", "care refused"]} onChange={(v) => { d("outcome", v); inj("treatment_level", v === "EMS transport" ? "ems_transport" : (injury.treatment_level as string) || ""); }} />
      <label style={s.check}><input type="checkbox" onChange={(e) => inj("ems_called", e.target.checked)} /> 911 / EMS was called</label>
    </div>
  );
}

function InjuryBlock({ d, inj }: { d: (k: string, v: unknown) => void; inj: (k: string, v: unknown) => void }) {
  return (
    <div style={s.section}>
      <div style={s.blockTitle}>Injury details</div>
      <label style={s.field}><span style={s.lbl}>Body part(s)</span><input style={s.input} placeholder="e.g. left hand, forehead" onChange={(e) => inj("body_parts", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></label>
      <SelOther label="Nature *" opts={["cut/laceration", "puncture", "burn", "bruise", "sprain/strain", "suspected fracture", "eye injury", "crush/pinch", "electrical shock", "chemical exposure", "inhalation", "head injury", "dental"]} onChange={(v) => inj("injury_nature", v)} />
      <Sel label="How it happened *" opts={["power tool", "hand tool", "robot/mechanism", "battery/charger", "slip/trip/fall", "struck by/against", "sharp edge", "lifting/carrying", "heat/soldering", "chemical", "vehicle", "horseplay", "unknown"]} onChange={(v) => inj("mechanism", v)} />
      <Sel label="Treatment level" opts={["none", "first_aid", "sent_to_parent_or_doctor", "urgent_care", "er", "ems_transport", "refused"]} onChange={(v) => inj("treatment_level", v)} />
      <label style={s.check}><input type="checkbox" onChange={(e) => inj("loss_of_consciousness", e.target.checked)} /> Any loss of consciousness, confusion, or memory gap (head injury)</label>
      <label style={s.check}><input type="checkbox" onChange={(e) => inj("ems_called", e.target.checked)} /> 911 / EMS was called</label>
      <label style={s.check}><input type="checkbox" onChange={(e) => d("hazard_corrected", e.target.checked)} /> The hazard was corrected before anyone else used that area</label>
    </div>
  );
}

function BehaviorBlock({ d }: { d: (k: string, v: unknown) => void }) {
  return (
    <div style={s.section}>
      <div style={s.blockTitle}>Behavior details</div>
      <Sel label="Category *" opts={["disruption", "disrespect/defiance", "unsafe behavior/horseplay", "property damage", "language", "teasing/exclusion", "bullying (repeated, targeted)", "harassment", "physical altercation", "threat", "theft", "dishonesty", "tool misuse", "left area without permission", "phone/social media", "substance", "other"]} onChange={(v) => d("category", v)} />
      <label style={s.check}><input type="checkbox" onChange={(e) => d("someone_hurt_or_frightened", e.target.checked)} /> Someone was hurt or frightened</label>
      <label style={s.check}><input type="checkbox" onChange={(e) => d("protected_basis", e.target.checked)} /> This targets who someone is (race, sex, religion, disability, orientation)</label>
    </div>
  );
}

function NearMissBlock({ d }: { d: (k: string, v: unknown) => void }) {
  return (
    <div style={s.section}>
      <div style={s.blockTitle}>Near-miss details</div>
      <Sel label="Type of hazard *" opts={["tool/equipment defect", "missing guard", "electrical", "battery/LiPo", "chemicals", "trip hazard", "clutter/housekeeping", "blocked exit/extinguisher", "working at height", "lifting", "lighting", "ventilation/fumes", "stored material", "unsafe practice", "PPE unavailable", "facility/structural", "other"]} onChange={(v) => d("hazard_type", v)} />
      <label style={s.check}><input type="checkbox" onChange={(e) => d("still_present", e.target.checked)} /> The hazard is still there right now</label>
      <label style={s.field}><span style={s.lbl}>What do you think would fix it?</span><textarea style={{ ...s.input, minHeight: 52 }} onChange={(e) => d("suggested_fix", e.target.value)} /></label>
      <label style={s.check}><input type="checkbox" onChange={(e) => d("recognize_me", e.target.checked)} /> Good catch — okay to recognize me for reporting this</label>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 640, margin: "0 auto", padding: "8px 14px 60px" },
  back: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4, padding: 0, marginBottom: 6 },
  h1: { margin: 0, fontSize: 26, fontWeight: 800, color: "#7a1d1d" },
  sub: { margin: "6px 0 14px", fontSize: 13.5, color: "#666" },
  section: { background: "#fff", border: "1px solid #e6e2e2", borderRadius: 12, padding: "14px 14px", marginBottom: 12 },
  qlabel: { fontSize: 15, fontWeight: 700, color: "#2a2a2a", marginBottom: 10 },
  blockTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: "#a05", marginBottom: 8 },
  typeGrid: { display: "grid", gap: 8 },
  typeCard: { textAlign: "left", border: "2px solid #e2d7d7", borderRadius: 10, padding: "12px 14px", background: "#fff", cursor: "pointer" },
  typeCardOn: { borderColor: "#b23b3b", background: "#fdf3f3" },
  typeName: { fontSize: 16, fontWeight: 700, color: "#2a2a2a" },
  typeBlurb: { fontSize: 12.5, color: "#777", marginTop: 3 },
  yn: { display: "flex", gap: 10 },
  ynBtn: { flex: 1, padding: "14px 0", fontSize: 16, fontWeight: 800, border: "2px solid #cdd7e3", borderRadius: 10, background: "#fff", cursor: "pointer", color: "#5a6b7b" },
  ynDanger: { borderColor: "#c62828", background: "#c62828", color: "#fff" },
  ynOk: { borderColor: "#2e7d32", background: "#eaf6ea", color: "#2e7d32" },
  redBanner: { marginTop: 12, background: "#fff0f0", border: "2px solid #c62828", borderRadius: 10, padding: 14, color: "#7a1d1d" },
  callBtn: { display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 14px", background: "#c62828", color: "#fff", borderRadius: 10, fontWeight: 700, textDecoration: "none", fontSize: 15 },
  field: { display: "block", marginBottom: 10 },
  lbl: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #cdd7e3", borderRadius: 9, fontSize: 15, fontFamily: "inherit" },
  check: { display: "flex", gap: 9, alignItems: "center", fontSize: 13.5, color: "#333", margin: "8px 0", cursor: "pointer" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, background: "#eef3f8", border: "1px solid #d7e3f0", borderRadius: 16, padding: "5px 6px 5px 12px", fontSize: 13.5, color: "#243b52" },
  chipX: { display: "inline-flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "#8a97a6", padding: 2 },
  searchRow: { display: "flex", gap: 6 },
  searchBtn: { padding: "0 16px", background: "#5a6b7b", color: "#fff", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" },
  itemOpt: { padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, marginTop: 4, cursor: "pointer", fontSize: 14, background: "#fff" },
  picked: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#eef3f8", border: "1px solid #d7e3f0", borderRadius: 9, fontSize: 14, color: "#243b52" },
  changeBtn: { marginLeft: "auto", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, textDecoration: "underline" },
  sevGrid: { display: "grid", gap: 8 },
  sevCard: { textAlign: "left", border: "2px solid #e2d7d7", borderRadius: 10, padding: "10px 12px", background: "#fff", cursor: "pointer" },
  sevOn: { borderColor: "#b23b3b", background: "#fdf3f3" },
  sevAnchor: { fontSize: 12, color: "#888", marginTop: 2 },
  anonWarn: { fontSize: 12.5, color: "#8a4b00", background: "#fff7e6", border: "1px solid #f0d6a8", borderRadius: 8, padding: "8px 10px", marginTop: 6 },
  err: { background: "#fdecea", color: "#a4291c", border: "1px solid #f5b8b0", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, marginBottom: 10, fontWeight: 600 },
  submit: { width: "100%", padding: "15px 0", fontSize: 17, fontWeight: 800, background: "#b23b3b", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer" },
  foot: { fontSize: 12, color: "#999", textAlign: "center", marginTop: 10 },
};
