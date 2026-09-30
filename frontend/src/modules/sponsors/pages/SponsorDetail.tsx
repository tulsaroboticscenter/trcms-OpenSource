/**
 * SponsorDetail — sponsor profile. Overview + tabbed Contributions, Deliverables,
 * and Outreach. Managers can edit; the "Log outreach" action is gated by the
 * server-provided can_contact (team-scoped guardrail).
 */
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { sponsorsApi, scholarshipsApi, tierColor, money, type SponsorDetail as Sponsor, type ScholarshipFund } from "../api";
import { ArrowLeft, Pencil, Trash2, Plus, ShieldAlert, ExternalLink, Globe } from "lucide-react";

type Tab = "contributions" | "deliverables" | "events" | "outreach";

export default function SponsorDetail() {
  const navigate = useNavigate();
  const goBack = useGoBack("/sponsors");
  const { id } = useParams();
  const { canWrite } = useAuth();
  const canManage = canWrite("sponsors.manage");
  const [sp, setSp] = useState<Sponsor | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [tab, setTab] = useState<Tab>("contributions");
  const [busy, setBusy] = useState(false);

  const load = () => sponsorsApi.get(Number(id)).then(setSp);
  useEffect(() => { load(); teamsApi.list().then(setTeams); /* eslint-disable-next-line */ }, [id]);

  if (!sp) return <div style={s.page}><p style={s.muted}>Loading…</p></div>;
  const teamName = (tid: number | null) => tid == null ? "Program" : (teams.find((t) => t.id === tid)?.team_number ? `#${teams.find((t) => t.id === tid)!.team_number}` : `Team ${tid}`);

  async function remove() {
    if (!confirm(`Delete sponsor "${sp!.name}"? This also removes its budget lines. This can't be undone.`)) return;
    setBusy(true);
    try { await sponsorsApi.remove(sp!.id); navigate("/sponsors"); } finally { setBusy(false); }
  }

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Sponsors</button>

      <div style={s.header}>
        <div style={{ ...s.tierStripe, background: tierColor(sp.tier) }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.titleRow}>
            <h1 style={s.h1}>{sp.name}</h1>
            {sp.youth_safety_flag && <span style={s.safetyFlag}><ShieldAlert size={14} /> Youth safety review</span>}
          </div>
          <div style={s.badges}>
            <span style={{ ...s.scopeBadge, background: sp.scope === "program" ? "#1565c0" : "#00695c" }}>{sp.scope === "program" ? "Program" : "Team"} sponsor</span>
            {sp.tier && <span style={{ ...s.tierChip, background: tierColor(sp.tier) }}>{sp.tier}{sp.tier_locked ? "" : " (auto)"}</span>}
            <span style={s.stateChip}>{sp.lifecycle_state}</span>
            <span style={s.season}>{sp.season}</span>
          </div>
          {sp.owning_teams.length > 0 && <div style={s.owned}>Owned by: {sp.owning_teams.map((t) => t.label).join(", ")}</div>}
        </div>
        {canManage && (
          <div style={s.headActions}>
            <button style={s.iconBtn} onClick={() => navigate(`/sponsors/${sp.id}/edit`)} title="Edit"><Pencil size={15} /></button>
            <button style={{ ...s.iconBtn, color: "#c62828" }} onClick={remove} disabled={busy} title="Delete"><Trash2 size={15} /></button>
          </div>
        )}
      </div>

      {/* Overview */}
      <div style={s.overview}>
        <Info label="Contact" value={sp.primary_contact_name} />
        <Info label="Email" value={sp.primary_contact_email} />
        <Info label="Phone" value={sp.primary_contact_phone} />
        <Info label="Relationship owner" value={sp.relationship_owner_name} />
        <Info label="Received this season" value={money(sp.received_total)} />
        {sp.website && <div style={s.info}><span style={s.infoLabel}>Website</span>
          <a style={s.link} href={sp.website} target="_blank" rel="noreferrer"><Globe size={12} /> Visit <ExternalLink size={11} /></a></div>}
      </div>
      {sp.youth_safety_flag && sp.youth_safety_notes && <div style={s.safetyNote}><strong>Youth safety:</strong> {sp.youth_safety_notes}</div>}

      {/* Tabs */}
      <div style={s.tabs}>
        {(["contributions", "deliverables", "events", "outreach"] as Tab[]).map((t) => (
          <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === "contributions" ? "Contributions" : t === "deliverables" ? "Deliverables" : t === "events" ? "Events" : "Outreach"}
            <span style={s.tabCount}>{t === "contributions" ? sp.contributions.length : t === "deliverables" ? sp.deliverables.length : t === "events" ? sp.events.length : sp.contacts.length}</span>
          </button>
        ))}
      </div>

      {tab === "contributions" && <Contributions sp={sp} teams={teams} teamName={teamName} canManage={canManage} reload={load} />}
      {tab === "deliverables" && <Deliverables sp={sp} canManage={canManage} reload={load} />}
      {tab === "events" && <Events sp={sp} navigate={navigate} />}
      {tab === "outreach" && <Outreach sp={sp} reload={load} canManage={canManage} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return <div style={s.info}><span style={s.infoLabel}>{label}</span><span style={s.infoValue}>{value}</span></div>;
}

// ── Contributions ──────────────────────────────────────────────────────────
function Contributions({ sp, teams, teamName, canManage, reload }: {
  sp: Sponsor; teams: TeamSummary[]; teamName: (t: number | null) => string; canManage: boolean; reload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [funds, setFunds] = useState<ScholarshipFund[]>([]);
  const blank = { contribution_type: "monetary", amount: "", in_kind_description: "", in_kind_value: "", status: "pledged", credited_team_id: "", pledge_date: "", received_date: "", notes: "", designation: "general", scholarship_fund_id: "", program_model: "" };
  const [f, setF] = useState(blank);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => { if (canManage) scholarshipsApi.listFunds().then((x) => setFunds(x.filter((y) => y.is_active))).catch(() => {}); }, [canManage]);
  async function add() {
    await sponsorsApi.addContribution(sp.id, { ...f, credited_team_id: f.credited_team_id || null, scholarship_fund_id: f.scholarship_fund_id || null, program_model: f.program_model || null });
    setAdding(false); setF(blank);
    reload();
  }
  async function setStatus(cid: number, status: string) { await sponsorsApi.updateContribution(cid, { status, received_date: status === "received" ? new Date().toISOString().slice(0, 10) : "" }); reload(); }
  async function del(cid: number) { if (confirm("Delete this contribution?")) { await sponsorsApi.deleteContribution(cid); reload(); } }

  return (
    <div>
      {sp.contributions.map((c) => (
        <div key={c.id} style={s.row}>
          <div style={{ flex: 1 }}>
            <div style={s.rowTitle}>
              {c.contribution_type === "monetary" ? money(c.amount) : `In-kind: ${c.in_kind_description ?? ""} (${money(c.in_kind_value)})`}
              <span style={{ ...s.statusChip, background: c.status === "received" ? "#e8f5e9" : "#fff3e0", color: c.status === "received" ? "#2e7d32" : "#e65100" }}>{c.status}</span>
            </div>
            <div style={s.rowMeta}>{c.season} · credited to {teamName(c.credited_team_id)} {c.recorded_by_name ? `· ${c.recorded_by_name}` : ""}</div>
          </div>
          {canManage && (
            <div style={s.rowActions}>
              {c.status !== "received" && <button style={s.smallBtn} onClick={() => setStatus(c.id, "received")}>Mark received</button>}
              <button style={s.iconBtnSm} onClick={() => del(c.id)}><Trash2 size={13} /></button>
            </div>
          )}
        </div>
      ))}
      {sp.contributions.length === 0 && <p style={s.muted}>No contributions recorded.</p>}
      {canManage && (adding ? (
        <div style={s.addForm}>
          <div style={s.formRow}>
            <select style={s.fin} value={f.contribution_type} onChange={(e) => set("contribution_type", e.target.value)}>
              <option value="monetary">Monetary</option><option value="in_kind">In-kind</option>
            </select>
            {f.contribution_type === "monetary"
              ? <input style={s.fin} placeholder="Amount" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
              : <><input style={s.fin} placeholder="Description" value={f.in_kind_description} onChange={(e) => set("in_kind_description", e.target.value)} /><input style={s.fin} placeholder="Est. value" value={f.in_kind_value} onChange={(e) => set("in_kind_value", e.target.value)} /></>}
            <select style={s.fin} value={f.status} onChange={(e) => set("status", e.target.value)}>
              {["pledged", "received", "declined", "refunded"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div style={s.formRow}>
            <select style={s.fin} value={f.credited_team_id} onChange={(e) => set("credited_team_id", e.target.value)}>
              <option value="">Credit: Program (no team budget)</option>
              {teams.map((t) => <option key={t.id} value={t.id}>Credit: #{t.team_number}</option>)}
            </select>
            <input style={s.fin} type="date" title="Received date" value={f.received_date} onChange={(e) => set("received_date", e.target.value)} />
          </div>
          <div style={s.formRow}>
            <select style={s.fin} value={f.designation} onChange={(e) => set("designation", e.target.value)}>
              <option value="general">General gift</option>
              <option value="scholarship">Scholarship fund</option>
              <option value="youth-support">Youth support</option>
            </select>
            {f.designation !== "general" && (
              <>
                <select style={s.fin} value={f.scholarship_fund_id} onChange={(e) => set("scholarship_fund_id", e.target.value)}>
                  <option value="">Fund…</option>
                  {funds.map((fu) => <option key={fu.id} value={fu.id}>{fu.name}</option>)}
                </select>
                <select style={s.fin} value={f.program_model} onChange={(e) => set("program_model", e.target.value)}>
                  <option value="">Model…</option>
                  <option value="pooled">Pooled</option>
                  <option value="anonymized">Sponsor-a-youth (anonymized)</option>
                  <option value="named">Sponsor-a-youth (named)</option>
                </select>
              </>
            )}
          </div>
          {f.program_model === "named" && (
            <p style={s.deductNote}>⚠ Gifts earmarked to a specific named youth are generally <strong>not tax-deductible</strong>. Confirm with your accountant.</p>
          )}
          <div style={s.formActions}>
            <button style={s.cancelSm} onClick={() => setAdding(false)}>Cancel</button>
            <button style={s.saveSm} onClick={add}>Add contribution</button>
          </div>
        </div>
      ) : <button style={s.addBtn} onClick={() => setAdding(true)}><Plus size={14} /> Add contribution</button>)}
    </div>
  );
}

// ── Deliverables ───────────────────────────────────────────────────────────
function Deliverables({ sp, canManage, reload }: { sp: Sponsor; canManage: boolean; reload: () => Promise<void> }) {
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState("");
  async function add() { if (!desc.trim()) return; await sponsorsApi.addDeliverable(sp.id, { description: desc, due_date: due }); setDesc(""); setDue(""); reload(); }
  async function cycle(did: number, status: string) { await sponsorsApi.updateDeliverable(did, { status }); reload(); }
  async function del(did: number) { if (confirm("Delete this deliverable?")) { await sponsorsApi.deleteDeliverable(did); reload(); } }
  return (
    <div>
      {sp.deliverables.map((d) => (
        <div key={d.id} style={s.row}>
          <div style={{ flex: 1 }}>
            <div style={s.rowTitle}>{d.description}
              <span style={{ ...s.statusChip, background: d.status === "complete" ? "#e8f5e9" : "#eef2f7", color: d.status === "complete" ? "#2e7d32" : "#556" }}>{d.status}</span>
            </div>
            <div style={s.rowMeta}>{d.due_date ? `Due ${d.due_date}` : "No due date"}{d.assigned_to_name ? ` · ${d.assigned_to_name}` : ""}</div>
          </div>
          {canManage && (
            <div style={s.rowActions}>
              {d.status !== "complete" && <button style={s.smallBtn} onClick={() => cycle(d.id, "complete")}>Complete</button>}
              <button style={s.iconBtnSm} onClick={() => del(d.id)}><Trash2 size={13} /></button>
            </div>
          )}
        </div>
      ))}
      {sp.deliverables.length === 0 && <p style={s.muted}>No deliverables.</p>}
      {canManage && (
        <div style={s.addForm}>
          <div style={s.formRow}>
            <input style={{ ...s.fin, flex: 2 }} placeholder="Deliverable (e.g. logo on banner)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <input style={s.fin} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            <button style={s.saveSm} onClick={add}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Events sponsored ───────────────────────────────────────────────────────
function Events({ sp, navigate }: { sp: Sponsor; navigate: (to: string) => void }) {
  return (
    <div>
      {sp.events.map((e) => (
        <div key={e.id} style={s.row} onClick={() => navigate(`/events/${e.event_id}`)} role="button">
          <div style={{ flex: 1 }}>
            <div style={s.rowTitle}>{e.event_name}
              <span style={{ ...s.statusChip, background: e.stage === "fulfilled" ? "#e8f5e9" : "#eef2f7", color: e.stage === "fulfilled" ? "#2e7d32" : "#556" }}>{e.stage}</span>
              {e.package_name && <span style={{ ...s.statusChip, background: "#eef4fb", color: "#1565c0" }}>{e.package_name}</span>}
            </div>
            <div style={s.rowMeta}>
              {e.event_date ?? ""}
              {e.pledged_amount != null && ` · pledged ${money(e.pledged_amount)}`}
              {e.received_amount != null && ` · received ${money(e.received_amount)}`}
              {e.in_kind_description && ` · in-kind: ${e.in_kind_description}`}
            </div>
          </div>
        </div>
      ))}
      {sp.events.length === 0 && <p style={s.muted}>Not sponsoring any events yet. Add this sponsor from an event's sponsorship pane.</p>}
    </div>
  );
}

// ── Outreach (guardrail-gated) ─────────────────────────────────────────────
function Outreach({ sp, reload, canManage }: { sp: Sponsor; reload: () => Promise<void>; canManage: boolean }) {
  const [method, setMethod] = useState("email");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  async function log() {
    setErr("");
    try { await sponsorsApi.addContact(sp.id, { method, notes }); setNotes(""); reload(); }
    catch { setErr("You may not contact this sponsor."); }
  }
  return (
    <div>
      {!sp.can_contact && (
        <div style={s.guardNote}>You can view this {sp.scope} sponsor, but only members of an owning team may log outreach.</div>
      )}
      {sp.contacts.map((k) => (
        <div key={k.id} style={s.row}>
          <div style={{ flex: 1 }}>
            <div style={s.rowTitle}>{k.method ?? "contact"}{k.outcome ? ` — ${k.outcome}` : ""}</div>
            <div style={s.rowMeta}>{k.contacted_at}{k.member_name ? ` · ${k.member_name}` : ""}{k.notes ? ` · ${k.notes}` : ""}</div>
          </div>
          {canManage && <button style={s.iconBtnSm} onClick={async () => { await sponsorsApi.deleteContact(k.id); reload(); }}><Trash2 size={13} /></button>}
        </div>
      ))}
      {sp.contacts.length === 0 && <p style={s.muted}>No outreach logged.</p>}
      {sp.can_contact && (
        <div style={s.addForm}>
          <div style={s.formRow}>
            <select style={s.fin} value={method} onChange={(e) => setMethod(e.target.value)}>
              {["email", "phone", "in_person", "event", "other"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <input style={{ ...s.fin, flex: 2 }} placeholder="Notes / outcome" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button style={s.saveSm} onClick={log}>Log outreach</button>
          </div>
          {err && <p style={s.error}>{err}</p>}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 860, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  header: { display: "flex", gap: 14, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", padding: 0 },
  tierStripe: { width: 8, flexShrink: 0 },
  titleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 0 0" },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  safetyFlag: { display: "inline-flex", alignItems: "center", gap: 4, background: "#ffebee", color: "#c62828", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px" },
  badges: { display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 0" },
  scopeBadge: { color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "2px 9px" },
  tierChip: { color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "2px 9px" },
  stateChip: { background: "#eef2f7", color: "#556", fontSize: 11.5, fontWeight: 600, borderRadius: 6, padding: "2px 9px", textTransform: "capitalize" },
  season: { background: "#f1f5f9", color: "#667", fontSize: 11.5, fontWeight: 600, borderRadius: 6, padding: "2px 9px" },
  owned: { fontSize: 12.5, color: "#667", margin: "8px 0 14px" },
  headActions: { display: "flex", gap: 6, padding: "14px 14px 0 0" },
  iconBtn: { background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#556" },
  overview: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginTop: 12 },
  info: { display: "flex", flexDirection: "column", gap: 2 },
  infoLabel: { fontSize: 11, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 },
  infoValue: { fontSize: 14, color: "#1a3a5c" },
  link: { display: "inline-flex", alignItems: "center", gap: 4, color: "#1565c0", fontSize: 13, textDecoration: "none" },
  safetyNote: { background: "#fff8e1", border: "1px solid #ffe0a3", color: "#8a5a00", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginTop: 10 },
  tabs: { display: "flex", gap: 4, borderBottom: "1px solid #e2e8f0", margin: "18px 0 12px" },
  tab: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", borderBottom: "2px solid transparent", padding: "8px 14px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#889" },
  tabActive: { color: "#1a3a5c", borderBottomColor: "#1a3a5c" },
  tabCount: { fontSize: 11, fontWeight: 700, background: "#eef4fb", color: "#1565c0", borderRadius: 9, padding: "0 7px" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 7 },
  rowTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "#1a3a5c", flexWrap: "wrap" },
  rowMeta: { fontSize: 12, color: "#778", marginTop: 3 },
  statusChip: { fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: "1px 7px", textTransform: "capitalize" },
  rowActions: { display: "flex", alignItems: "center", gap: 6 },
  smallBtn: { background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  iconBtnSm: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 3 },
  addForm: { background: "#f8fafc", border: "1px dashed #cdd7e3", borderRadius: 8, padding: 12, marginTop: 8 },
  formRow: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  fin: { flex: 1, minWidth: 120, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#1565c0", cursor: "pointer", marginTop: 6 },
  saveSm: { background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  cancelSm: { background: "#fff", border: "1px solid #ccc", borderRadius: 6, padding: "7px 12px", fontSize: 13, cursor: "pointer" },
  guardNote: { background: "#f1f5f9", color: "#556", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 10 },
  deductNote: { background: "#fff8e1", color: "#8a5a00", borderRadius: 6, padding: "7px 10px", fontSize: 12, margin: "0 0 8px" },
  muted: { color: "#889", fontSize: 14, padding: "8px 0" },
  error: { color: "#c0392b", fontSize: 12.5, margin: "4px 0 0" },
};
