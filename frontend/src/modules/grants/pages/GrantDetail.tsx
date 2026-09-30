import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { useGoBack } from "../../../core/useGoBack";
import { formatDate } from "../../../core/dateUtils";
import { grantsApi, STATUSES, SCOPES, RECURRENCES, DISTRIBUTION_METHODS, OUTCOMES, type Grant, type GrantTeamRow } from "../api";
import { Edit2, Trash2, Plus, ExternalLink, Mail, ListChecks, Users, Save, X, Lock } from "lucide-react";

const lbl = (arr: { value: string; label: string }[], v: string | null) => arr.find((x) => x.value === v)?.label ?? v ?? "—";

export default function GrantDetail() {
  const { id } = useParams<{ id: string }>();
  const gid = parseInt(id!);
  const navigate = useNavigate();
  const goBack = useGoBack("/grants");
  const { canWrite } = useAuth();
  const canManage = canWrite("grants.manage");
  const [g, setG] = useState<Grant | null>(null);

  const load = useCallback(() => { grantsApi.get(gid).then(setG).catch(() => setG(null)); }, [gid]);
  useEffect(() => { load(); }, [load]);

  if (!g) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;
  const sm = STATUSES.find((s) => s.value === g.status) ?? { label: g.status, color: "#888" };

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}>← Back to Grants</button>
      <div style={st.headRow}>
        <div>
          <span style={{ ...st.badge, color: sm.color, background: sm.color + "22" }}>{sm.label}</span>
          <h1 style={st.heading}>{g.name}</h1>
          <div style={st.metaRow}>
            {g.funder_name && <span>{g.funder_name}</span>}
            <span>· {lbl(SCOPES, g.scope)}</span>
            <span>· {lbl(RECURRENCES, g.recurrence)}</span>
            {g.restricted_funds && <span style={st.restricted}><Lock size={11} /> Restricted{g.restriction_note ? `: ${g.restriction_note}` : ""}</span>}
          </div>
        </div>
        {canManage && (
          <div style={st.headBtns}>
            <button style={st.editBtn} onClick={() => navigate(`/grants/${gid}/edit`)}><Edit2 size={13} /> Edit</button>
            <button style={st.delBtn} onClick={async () => { if (confirm(`Delete "${g.name}"? This also removes the grant budget lines it created.`)) { await grantsApi.remove(gid); navigate("/grants"); } }}><Trash2 size={13} /> Delete</button>
          </div>
        )}
      </div>

      {/* Overview facts */}
      <div style={st.card}>
        <div style={st.factGrid}>
          <Fact label="Submitted by" value={g.submitted_by_name ?? "—"} />
          <Fact label="Submitted date" value={g.submitted_date ?? "—"} />
          <Fact label="Expected response" value={g.expected_response_date ?? "—"} />
          <Fact label="Rounds" value={g.num_rounds ? `${g.current_round ?? "?"} of ${g.num_rounds}` : "—"} />
          <Fact label="Available / opens" value={g.available_date ?? "—"} />
          <Fact label="Reminder" value={g.remind_date ? `${g.remind_date}${g.remind_note ? ` — ${g.remind_note}` : ""}` : "—"} />
        </div>
        {g.links.length > 0 && (
          <div style={st.links}>
            {g.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" style={st.link}><ExternalLink size={12} /> {l.label || l.url}</a>)}
          </div>
        )}
        {g.description && <p style={st.desc}>{g.description}</p>}
      </div>

      {/* Teams */}
      <TeamsSection grant={g} canManage={canManage} onChanged={load} />

      {/* Correspondence */}
      <CorrespondenceSection grant={g} canManage={canManage} onChanged={load} />

      {/* Custom fields */}
      <CustomFieldsSection grant={g} canManage={canManage} onChanged={load} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><div style={st.factLabel}>{label}</div><div style={st.factValue}>{value}</div></div>;
}

// ── Teams ───────────────────────────────────────────────────────────────────
interface TeamOpt { id: number; label: string; }
function TeamsSection({ grant, canManage, onChanged }: { grant: Grant; canManage: boolean; onChanged: () => void }) {
  const [picking, setPicking] = useState(false);
  const [teamOpts, setTeamOpts] = useState<TeamOpt[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [trc, setTrc] = useState(false);

  function openPicker() {
    api.get("/api/v1/teams/").then((r) => {
      const opts: TeamOpt[] = (r.data as { team_number: string; current_season?: { id: number; season: string; team_name?: string } }[])
        .filter((t) => t.current_season?.id)
        .map((t) => ({ id: t.current_season!.id, label: `#${t.team_number} ${t.current_season!.team_name ?? ""} · ${t.current_season!.season}` }));
      setTeamOpts(opts);
      setPicked((grant.teams ?? []).filter((x) => x.team_season_id).map((x) => x.team_season_id!));
      setTrc((grant.teams ?? []).some((x) => x.is_trc));
      setPicking(true);
    });
  }
  async function savePicks() {
    await grantsApi.setTeams(grant.id, picked, trc);
    setPicking(false); onChanged();
  }

  const rows = grant.teams ?? [];
  return (
    <div style={st.card}>
      <div style={st.cardHead}>
        <span style={st.cardTitle}><Users size={14} /> Teams ({rows.length})</span>
        {canManage && <button style={st.smallBtn} onClick={openPicker}><Edit2 size={12} /> Set eligible teams</button>}
      </div>

      {picking && (
        <div style={st.picker}>
          <label style={st.pickRow}><input type="checkbox" checked={trc} onChange={(e) => setTrc(e.target.checked)} /> <strong>TRC (organization)</strong></label>
          {teamOpts.map((t) => (
            <label key={t.id} style={st.pickRow}>
              <input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id))} /> {t.label}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={st.save} onClick={savePicks}>Save teams</button>
            <button style={st.cancel} onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? <p style={st.muted}>No teams added yet.{canManage && " Use “Set eligible teams”."}</p> : (
        <div style={st.tWrap}>
          <table style={st.table}>
            <thead><tr>
              <th style={st.th}>Team</th><th style={st.thC}>Submitted</th><th style={st.thN}>Requested</th>
              <th style={st.thC}>Outcome</th><th style={st.thN}>Received</th><th style={st.th}>Distribution</th>{canManage && <th style={st.th}></th>}
            </tr></thead>
            <tbody>{rows.map((t) => <TeamRow key={t.id} t={t} canManage={canManage} onChanged={onChanged} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamRow({ t, canManage, onChanged }: { t: GrantTeamRow; canManage: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  function start() {
    setD({ submitted: t.submitted, submitted_date: t.submitted_date ?? "", amount_requested: t.amount_requested != null ? String(t.amount_requested) : "",
      outcome: t.outcome, amount_received: t.amount_received != null ? String(t.amount_received) : "",
      restricted_amount: t.restricted_amount != null ? String(t.restricted_amount) : "",
      distribution_method: t.distribution_method ?? "", received_date: t.received_date ?? "", notes: t.notes ?? "" });
    setEdit(true);
  }
  async function save() {
    setBusy(true);
    try { await grantsApi.updateTeam(t.id, d); setEdit(false); onChanged(); } finally { setBusy(false); }
  }
  const om = OUTCOMES.find((o) => o.value === t.outcome)!;
  if (!edit) {
    return (
      <tr style={t.outcome === "awarded" ? { background: "#f0fdf4" } : undefined}>
        <td style={st.td}>{t.team_label}{!t.eligible && <span style={st.tag}>not eligible</span>}</td>
        <td style={st.tdC}>{t.submitted ? (t.submitted_date ? `✓ ${formatDate(t.submitted_date)}` : "✓") : "—"}</td>
        <td style={st.tdN}>{t.amount_requested != null ? `$${t.amount_requested.toLocaleString()}` : "—"}</td>
        <td style={st.tdC}><span style={{ ...st.obadge, color: om.color, background: om.color + "22" }}>{om.label}</span></td>
        <td style={{ ...st.tdN, fontWeight: 700, color: t.amount_received ? "#2e7d32" : "#999" }}>
          {t.amount_received != null ? `$${t.amount_received.toLocaleString()}` : "—"}
          {t.restricted_amount != null && t.restricted_amount > 0 && (
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "#b45309" }}>🔒 ${t.restricted_amount.toLocaleString()} restricted</div>
          )}
        </td>
        <td style={st.td}>{t.distribution_method ? lbl(DISTRIBUTION_METHODS, t.distribution_method) : "—"}</td>
        {canManage && <td style={st.tdC}><button style={st.rowEdit} onClick={start}><Edit2 size={12} /></button></td>}
      </tr>
    );
  }
  return (
    <tr>
      <td style={st.td} colSpan={canManage ? 7 : 6}>
        <div style={st.editGrid}>
          <strong style={{ gridColumn: "1 / -1" }}>{t.team_label}</strong>
          <label style={st.ec}><input type="checkbox" checked={!!d.submitted} onChange={(e) => setD((x) => ({ ...x, submitted: e.target.checked }))} /> Submitted</label>
          <Lbl l="Submitted date"><input type="date" style={st.cell} value={d.submitted_date as string} onChange={(e) => setD((x) => ({ ...x, submitted_date: e.target.value }))} /></Lbl>
          <Lbl l="Requested $"><input type="number" style={st.cell} value={d.amount_requested as string} onChange={(e) => setD((x) => ({ ...x, amount_requested: e.target.value }))} /></Lbl>
          <Lbl l="Outcome"><select style={st.cell} value={d.outcome as string} onChange={(e) => setD((x) => ({ ...x, outcome: e.target.value }))}>{OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Lbl>
          <Lbl l="Received $"><input type="number" style={st.cell} value={d.amount_received as string} onChange={(e) => setD((x) => ({ ...x, amount_received: e.target.value }))} /></Lbl>
          <Lbl l="Restricted $ (of award)"><input type="number" style={st.cell} placeholder="0 = all unrestricted" value={d.restricted_amount as string} onChange={(e) => setD((x) => ({ ...x, restricted_amount: e.target.value }))} /></Lbl>
          <Lbl l="Distribution"><select style={st.cell} value={d.distribution_method as string} onChange={(e) => setD((x) => ({ ...x, distribution_method: e.target.value }))}><option value="">—</option>{DISTRIBUTION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Lbl>
          <Lbl l="Received date"><input type="date" style={st.cell} value={d.received_date as string} onChange={(e) => setD((x) => ({ ...x, received_date: e.target.value }))} /></Lbl>
          <Lbl l="Notes"><input style={st.cell} value={d.notes as string} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} /></Lbl>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button style={st.save} disabled={busy} onClick={save}><Save size={13} /> Save</button>
            <button style={st.cancel} onClick={() => setEdit(false)}><X size={13} /> Cancel</button>
          </div>
        </div>
      </td>
    </tr>
  );
}
function Lbl({ l, children }: { l: string; children: React.ReactNode }) {
  return <div><div style={st.cellLabel}>{l}</div>{children}</div>;
}

// ── Correspondence ───────────────────────────────────────────────────────────
function CorrespondenceSection({ grant, canManage, onChanged }: { grant: Grant; canManage: boolean; onChanged: () => void }) {
  const [add, setAdd] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const list = grant.correspondence ?? [];
  async function save() { await grantsApi.addCorrespondence(grant.id, f); setF({}); setAdd(false); onChanged(); }
  return (
    <div style={st.card}>
      <div style={st.cardHead}>
        <span style={st.cardTitle}><Mail size={14} /> Correspondence ({list.length})</span>
        {canManage && <button style={st.smallBtn} onClick={() => setAdd(!add)}><Plus size={12} /> Add</button>}
      </div>
      {add && (
        <div style={st.addBox}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <input style={st.cell} placeholder="Subject" value={f.subject ?? ""} onChange={(e) => setF((x) => ({ ...x, subject: e.target.value }))} />
            <input style={st.cell} placeholder="From / sender" value={f.sender ?? ""} onChange={(e) => setF((x) => ({ ...x, sender: e.target.value }))} />
            <input type="date" style={st.cell} value={f.correspondence_date ?? ""} onChange={(e) => setF((x) => ({ ...x, correspondence_date: e.target.value }))} />
          </div>
          <textarea style={{ ...st.cell, minHeight: 70, marginTop: 8 }} placeholder="Paste the email / guidance here…" value={f.body ?? ""} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button style={st.save} onClick={save}>Save</button><button style={st.cancel} onClick={() => setAdd(false)}>Cancel</button></div>
        </div>
      )}
      {list.length === 0 ? <p style={st.muted}>No correspondence stored.</p> : list.map((c) => (
        <div key={c.id} style={st.corr}>
          <div style={st.corrHead}>
            <strong>{c.subject || "(no subject)"}</strong>
            <span style={st.corrMeta}>{c.sender ? `${c.sender} · ` : ""}{c.correspondence_date ?? c.created_at?.slice(0, 10)}</span>
            {canManage && <button style={st.delMini} onClick={async () => { await grantsApi.deleteCorrespondence(c.id); onChanged(); }}><Trash2 size={12} /></button>}
          </div>
          {c.body && <div style={st.corrBody}>{c.body}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Custom fields ─────────────────────────────────────────────────────────────
function CustomFieldsSection({ grant, canManage, onChanged }: { grant: Grant; canManage: boolean; onChanged: () => void }) {
  const [add, setAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [response, setResponse] = useState("");
  const list = grant.custom_fields ?? [];
  async function save() { if (!label.trim()) return; await grantsApi.addField(grant.id, { label, response }); setLabel(""); setResponse(""); setAdd(false); onChanged(); }
  return (
    <div style={st.card}>
      <div style={st.cardHead}>
        <span style={st.cardTitle}><ListChecks size={14} /> Custom Fields ({list.length})</span>
        {canManage && <button style={st.smallBtn} onClick={() => setAdd(!add)}><Plus size={12} /> Add field</button>}
      </div>
      {add && (
        <div style={st.addBox}>
          <input style={st.cell} placeholder="Question / label (e.g. How will you use these funds?)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <textarea style={{ ...st.cell, minHeight: 60, marginTop: 8 }} placeholder="Your response" value={response} onChange={(e) => setResponse(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button style={st.save} onClick={save}>Save</button><button style={st.cancel} onClick={() => setAdd(false)}>Cancel</button></div>
        </div>
      )}
      {list.length === 0 ? <p style={st.muted}>No custom fields.</p> : list.map((fld) => (
        <CustomFieldRow key={fld.id} field={fld} canManage={canManage} onChanged={onChanged} />
      ))}
    </div>
  );
}
function CustomFieldRow({ field, canManage, onChanged }: { field: { id: number; label: string; response: string | null }; canManage: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [resp, setResp] = useState(field.response ?? "");
  return (
    <div style={st.field}>
      <div style={st.fieldLabel}>{field.label}
        {canManage && !edit && <button style={st.delMini} onClick={() => setEdit(true)}><Edit2 size={11} /></button>}
        {canManage && <button style={st.delMini} onClick={async () => { await grantsApi.deleteField(field.id); onChanged(); }}><Trash2 size={11} /></button>}
      </div>
      {edit ? (
        <div>
          <textarea style={{ ...st.cell, minHeight: 56 }} value={resp} onChange={(e) => setResp(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button style={st.save} onClick={async () => { await grantsApi.updateField(field.id, { response: resp }); setEdit(false); onChanged(); }}>Save</button>
            <button style={st.cancel} onClick={() => { setResp(field.response ?? ""); setEdit(false); }}>Cancel</button>
          </div>
        </div>
      ) : <div style={st.fieldResp}>{field.response || <span style={{ color: "#bbb" }}>No response yet</span>}</div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 960, margin: "0 auto" },
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  badge: { display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700, marginBottom: 6 },
  heading: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  metaRow: { display: "flex", gap: 8, marginTop: 6, fontSize: 13, color: "#555", alignItems: "center", flexWrap: "wrap" },
  restricted: { display: "inline-flex", alignItems: "center", gap: 4, color: "#8a4b00", background: "#fff3e0", borderRadius: 8, padding: "1px 8px", fontSize: 12, fontWeight: 600 },
  headBtns: { display: "flex", gap: 8 },
  editBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  delBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 14 },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  smallBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  factGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px" },
  factLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  factValue: { fontSize: 14, color: "#1a3a5c", marginTop: 2 },
  links: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f4f8" },
  link: { display: "inline-flex", alignItems: "center", gap: 4, color: "#1565c0", fontSize: 13, textDecoration: "none" },
  desc: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f4f8", fontSize: 14, color: "#444", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  picker: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 12, maxHeight: 280, overflowY: "auto" },
  pickRow: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, color: "#333" },
  tWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "5px 8px", borderBottom: "1px solid #e2e8f0" },
  thC: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "5px 8px", borderBottom: "1px solid #e2e8f0" },
  thN: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "5px 8px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "8px", borderBottom: "1px solid #f4f6fa", color: "#333", verticalAlign: "top" },
  tdC: { padding: "8px", borderBottom: "1px solid #f4f6fa", textAlign: "center" },
  tdN: { padding: "8px", borderBottom: "1px solid #f4f6fa", textAlign: "right", whiteSpace: "nowrap" },
  tag: { marginLeft: 6, fontSize: 10, color: "#c62828", background: "#ffebee", borderRadius: 8, padding: "1px 6px" },
  obadge: { padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 },
  rowEdit: { background: "none", border: "1px solid #cdd7e3", borderRadius: 5, padding: "3px 7px", cursor: "pointer", color: "#1565c0" },
  editGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 12px", padding: "6px 0" },
  ec: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, alignSelf: "end" },
  cellLabel: { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 2 },
  cell: { width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, boxSizing: "border-box" },
  save: { display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  cancel: { display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#fff", color: "#666", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  addBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 12 },
  corr: { borderTop: "1px solid #f0f4f8", padding: "10px 0" },
  corrHead: { display: "flex", alignItems: "center", gap: 8 },
  corrMeta: { fontSize: 12, color: "#888", flex: 1 },
  corrBody: { fontSize: 13, color: "#444", marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 },
  delMini: { background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: 2 },
  field: { borderTop: "1px solid #f0f4f8", padding: "10px 0" },
  fieldLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  fieldResp: { fontSize: 13, color: "#444", marginTop: 3, whiteSpace: "pre-wrap" },
  muted: { color: "#aaa", fontSize: 13, padding: "6px 0" },
};
