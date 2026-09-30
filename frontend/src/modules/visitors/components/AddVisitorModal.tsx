import { useEffect, useRef, useState } from "react";
import { X, Search, Tent, Check } from "lucide-react";
import { api } from "../../../core/api";
import { visitorsApi, type CamperMatch } from "../api";
import { nightPrefsApi, type NightOption } from "../../../core/nightPrefsApi";
import NightPreferencePicker, { type NightPrefValue } from "../../../components/NightPreferencePicker";
import { GRADE_OPTIONS } from "../../../core/grade";

interface Program { id: number; name: string; }

const REFERRAL_SOURCES = [
  { value: "", label: "How they heard about us…" },
  { value: "word_of_mouth", label: "Word of mouth" },
  { value: "google", label: "Google search" },
  { value: "magazine_ad", label: "Magazine ad" },
  { value: "event", label: "Saw us at an event" },
  { value: "other", label: "Other" },
];

/** Staff quick-add for a visitor/inquiry (e.g. a phone call). */
export default function AddVisitorModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [f, setF] = useState({
    first_name: "", last_name: "", birthday: "", grade: "",
    guardian1_name: "", guardian1_phone: "", guardian1_email: "",
    program_interest_id: "", referral_source: "", referral_detail: "",
    parent_mentor_interest: false, additional_info: "", scheduled_visit_date: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Meeting-night preference, captured at this earliest touch against the program of
  // interest, so it's known the moment they're waitlisted. Nights load when a program
  // is picked; the question hides for "not sure / any".
  const [nights, setNights] = useState<NightOption[]>([]);
  const [nightApplies, setNightApplies] = useState(false);
  const [night, setNight] = useState<NightPrefValue>({ available: [], preferred: null, siblings: false });

  // Camper lookup (#141) — document a camper's visit without re-typing.
  const [camperQ, setCamperQ] = useState("");
  const [camperResults, setCamperResults] = useState<CamperMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [camperId, setCamperId] = useState<number | null>(null);
  const [prefilledFrom, setPrefilledFrom] = useState<string>("");
  const [existing, setExisting] = useState<CamperMatch | null>(null);
  const [logging, setLogging] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { api.get("/api/v1/programs/").then((r) => setPrograms(r.data)).catch(() => setPrograms([])); }, []);

  // Load the program's nights whenever the selected program changes.
  useEffect(() => {
    const pid = f.program_interest_id ? parseInt(f.program_interest_id) : 0;
    if (!pid) { setNights([]); setNightApplies(false); setNight({ available: [], preferred: null, siblings: false }); return; }
    let live = true;
    nightPrefsApi.get({ program_id: pid })
      .then((d) => { if (live) { setNights(d.nights); setNightApplies(d.applies); } })
      .catch(() => { if (live) { setNights([]); setNightApplies(false); } });
    return () => { live = false; };
  }, [f.program_interest_id]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = camperQ.trim();
    if (q.length < 2) { setCamperResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      visitorsApi.searchCampers(q)
        .then((rows) => setCamperResults(rows))
        .catch(() => setCamperResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [camperQ]);

  function pickCamper(c: CamperMatch) {
    setCamperResults([]);
    setCamperQ("");
    if (c.existing_visitor_id) { setExisting(c); return; }
    // Prefill the form from the camper's record.
    setExisting(null);
    setCamperId(c.camper_id);
    setPrefilledFrom(`${c.first_name} ${c.last_name}`.trim());
    const note = [c.grade ? `Grade ${c.grade}` : "", c.school || "", c.last_camp_year ? `Camp ${c.last_camp_year}` : ""]
      .filter(Boolean).join(" · ");
    setF((p) => ({
      ...p,
      first_name: c.first_name || "",
      last_name: c.last_name || "",
      guardian1_name: c.guardian_name || "",
      guardian1_phone: c.guardian_phone || "",
      guardian1_email: c.guardian_email || "",
      additional_info: note ? `Former camper — ${note}` : "Former camper",
    }));
  }

  async function logExistingVisit() {
    if (!existing?.existing_visitor_id) return;
    setLogging(true);
    try {
      await visitorsApi.addInteraction(existing.existing_visitor_id, { method: "visit", notes: "Visited TRC" });
      onCreated(existing.existing_visitor_id);
    } catch {
      setErr("Could not log the visit."); setLogging(false);
    }
  }

  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const needsDetail = ["word_of_mouth", "magazine_ad", "event", "other"].includes(f.referral_source);

  async function save() {
    if (!f.first_name.trim() || !f.last_name.trim()) { setErr("First and last name are required."); return; }
    setBusy(true); setErr("");
    try {
      const v = await visitorsApi.create({
        first_name: f.first_name.trim(), last_name: f.last_name.trim(),
        birthday: f.birthday || null,
        grade: f.grade !== "" ? parseInt(f.grade) : null,
        guardian1_name: f.guardian1_name.trim() || null,
        guardian1_phone: f.guardian1_phone.trim() || null,
        guardian1_email: f.guardian1_email.trim() || null,
        program_interest_id: f.program_interest_id ? parseInt(f.program_interest_id) : null,
        referral_source: f.referral_source || null,
        referral_detail: needsDetail ? (f.referral_detail.trim() || null) : null,
        parent_mentor_interest: f.parent_mentor_interest,
        additional_info: f.additional_info.trim() || null,
        scheduled_visit_date: f.scheduled_visit_date || null,
        camper_id: camperId,
        // Night preference (only meaningful once a program is chosen).
        available_night_ids: night.available,
        preferred_night_id: night.preferred,
        siblings_together: night.siblings,
      });
      onCreated(v.id);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not add the visitor.");
      setBusy(false);
    }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <h3 style={s.title}>Add Visitor</h3>
          <button style={s.close} onClick={onClose}><X size={18} /></button>
        </div>

        {/* Camper lookup — document a camper's visit without re-typing (#141). */}
        <div style={s.camperBox}>
          <label style={{ ...s.l, marginTop: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <Tent size={13} /> Visiting camper? Find them to skip re-typing
          </label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 9, top: 10, color: "#94a3b8" }} />
            <input style={{ ...s.in, paddingLeft: 30 }} placeholder="Search campers by name…"
              value={camperQ} onChange={(e) => { setCamperQ(e.target.value); }} />
            {(camperResults.length > 0 || searching) && (
              <div style={s.results}>
                {searching && camperResults.length === 0 && <div style={s.resultEmpty}>Searching…</div>}
                {camperResults.map((c) => (
                  <button key={c.camper_id} style={s.resultRow} onClick={() => pickCamper(c)}>
                    <span style={{ fontWeight: 600, color: "#1a3a5c" }}>{c.first_name} {c.last_name}</span>
                    <span style={s.resultMeta}>
                      {[c.grade ? `Gr ${c.grade}` : "", c.school || "", c.last_camp_year ? `Camp ${c.last_camp_year}` : ""].filter(Boolean).join(" · ")}
                      {c.existing_visitor_id ? "  · already a visitor" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {existing && (
            <div style={s.existingBanner}>
              <div style={{ fontSize: 13, color: "#334" }}>
                <strong>{existing.first_name} {existing.last_name}</strong> is already a visitor
                {existing.existing_visitor_number ? ` (#${existing.existing_visitor_number})` : ""}.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button style={s.logVisitBtn} onClick={logExistingVisit} disabled={logging}>
                  {logging ? "Logging…" : "Log a visit today"}
                </button>
                <button style={s.cancel} onClick={() => setExisting(null)}>Dismiss</button>
              </div>
            </div>
          )}

          {prefilledFrom && !existing && (
            <div style={s.prefillTag}>
              <Check size={13} /> Prefilled from {prefilledFrom}'s camp record — review and save.
              <button style={s.clearPrefill} onClick={() => { setCamperId(null); setPrefilledFrom(""); }}>clear</button>
            </div>
          )}
        </div>

        <label style={s.l}>Youth name *</label>
        <div style={s.two}>
          <input style={s.in} placeholder="First" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus />
          <input style={s.in} placeholder="Last" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </div>

        <div style={s.two}>
          <div>
            <label style={s.l}>Date of birth <span style={{ fontWeight: 400, color: "#8a97a5" }}>(helps match programs)</span></label>
            <input type="date" style={s.in} value={f.birthday} max={new Date().toISOString().split("T")[0]}
              onChange={(e) => set("birthday", e.target.value)} />
          </div>
          <div>
            <label style={s.l}>Grade <span style={{ fontWeight: 400, color: "#8a97a5" }}>(FLL level)</span></label>
            <select style={s.in} value={f.grade} onChange={(e) => set("grade", e.target.value)}>
              <option value="">—</option>
              {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <label style={s.l}>Parent / guardian</label>
        <input style={s.in} placeholder="Guardian name" value={f.guardian1_name} onChange={(e) => set("guardian1_name", e.target.value)} />
        <div style={s.two}>
          <input style={s.in} placeholder="Phone" value={f.guardian1_phone} onChange={(e) => set("guardian1_phone", e.target.value)} />
          <input style={s.in} placeholder="Email" value={f.guardian1_email} onChange={(e) => set("guardian1_email", e.target.value)} />
        </div>

        <label style={s.l}>Program interest</label>
        <select style={s.in} value={f.program_interest_id} onChange={(e) => set("program_interest_id", e.target.value)}>
          <option value="">Not sure / any</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {nightApplies && nights.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <NightPreferencePicker nights={nights} value={night} onChange={setNight} />
          </div>
        )}

        <label style={s.l}>How did they hear about us?</label>
        <select style={s.in} value={f.referral_source} onChange={(e) => set("referral_source", e.target.value)}>
          {REFERRAL_SOURCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {needsDetail && <input style={{ ...s.in, marginTop: 6 }} placeholder="Details (who / which / where)" value={f.referral_detail} onChange={(e) => set("referral_detail", e.target.value)} />}

        <label style={s.check}>
          <input type="checkbox" checked={f.parent_mentor_interest} onChange={(e) => set("parent_mentor_interest", e.target.checked)} />
          <span>Parent may be interested in mentoring / leading a team</span>
        </label>

        <label style={s.l}>Scheduled visit date <span style={{ fontWeight: 400, color: "#8a97a5" }}>(optional — if they're planning to come on a specific night)</span></label>
        <input type="date" style={s.in} value={f.scheduled_visit_date} onChange={(e) => set("scheduled_visit_date", e.target.value)} />

        <label style={s.l}>Notes</label>
        <textarea style={{ ...s.in, minHeight: 60, resize: "vertical" }} placeholder="e.g. Called 7/5, asked about FLL start dates" value={f.additional_info} onChange={(e) => set("additional_info", e.target.value)} />

        {err && <div style={s.err}>{err}</div>}
        <div style={s.actions}>
          <button style={s.cancel} onClick={onClose}>Cancel</button>
          <button style={s.save} onClick={save} disabled={busy}>{busy ? "Adding…" : "Add Visitor"}</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 24, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: 20, width: 480, maxWidth: "95vw", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { margin: 0, fontSize: 17, fontWeight: 800, color: "#1a3a5c" },
  close: { background: "none", border: "none", cursor: "pointer", color: "#888" },
  l: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#556", margin: "10px 0 3px" },
  two: { display: "flex", gap: 8 },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box", background: "#fff" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334", cursor: "pointer", margin: "12px 0 2px" },
  err: { color: "#c62828", fontSize: 12.5, marginTop: 10 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancel: { padding: "9px 16px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 13.5 },
  save: { padding: "9px 18px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 700 },
  camperBox: { background: "#f6f9fc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 12 },
  results: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 5, maxHeight: 240, overflowY: "auto" },
  resultRow: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: "none", borderBottom: "1px solid #f1f5f9", cursor: "pointer" },
  resultMeta: { fontSize: 11.5, color: "#64748b" },
  resultEmpty: { padding: "8px 10px", fontSize: 12.5, color: "#94a3b8" },
  existingBanner: { marginTop: 10, background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 7, padding: "10px 12px" },
  logVisitBtn: { padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  prefillTag: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12.5, color: "#2e7d32", fontWeight: 600 },
  clearPrefill: { marginLeft: "auto", background: "none", border: "none", color: "#94a3b8", textDecoration: "underline", cursor: "pointer", fontSize: 12 },
};
