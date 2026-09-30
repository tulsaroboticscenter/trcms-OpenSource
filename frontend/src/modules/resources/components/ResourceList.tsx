import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { resourcesApi, type Resource, type ResourceType, type ResourceAttr } from "../api";
import {
  Search, Plus, Pencil, Trash2, ExternalLink, X, Check, Hand,
  Clock, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, Copy,
} from "lucide-react";

export default function ResourceList({ scope, teamSeasonId }: { scope: "team" | "trc"; teamSeasonId?: number }) {
  const { canWrite } = useAuth();
  const canManage = canWrite("resources.manage");
  const canGrant = canWrite("resources.grant");
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [types, setTypes] = useState<ResourceType[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    const p = scope === "team" ? resourcesApi.listTeam(teamSeasonId!) : resourcesApi.listTrc();
    p.then(setResources).catch(() => setResources([]));
  }, [scope, teamSeasonId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { resourcesApi.listTypes().then(setTypes).catch(() => setTypes([])); }, []);

  if (resources === null) return <p style={st.muted}>Loading…</p>;

  const ql = q.toLowerCase();
  const filtered = resources.filter((r) =>
    !ql || r.name.toLowerCase().includes(ql) ||
    (r.resource_type?.name ?? "").toLowerCase().includes(ql) ||
    Object.values(r.values || {}).some((v) => String(v).toLowerCase().includes(ql)) ||
    (r.notes ?? "").toLowerCase().includes(ql)
  );
  // Group by type name.
  const groups: Record<string, Resource[]> = {};
  for (const r of filtered) {
    const k = r.resource_type?.name ?? "Other";
    (groups[k] = groups[k] || []).push(r);
  }

  return (
    <div>
      <div style={st.toolbar}>
        <div style={st.searchRow}>
          <Search size={15} color="#888" />
          <input style={st.search} placeholder="Search resources…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canManage && (
          <button style={st.addBtn} onClick={() => setEditing("new")}><Plus size={15} /> Add Resource</button>
        )}
      </div>

      {filtered.length === 0 && <p style={st.muted}>No resources{q ? " match your search" : " yet"}.</p>}

      {Object.entries(groups).map(([typeName, items]) => (
        <div key={typeName} style={st.group}>
          <div style={st.groupHead}>{typeName}<span style={st.groupCount}>{items.length}</span></div>
          {items.map((r) => (
            <ResourceCard key={r.id} r={r} canManage={canManage} canGrant={canGrant}
              expanded={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              onEdit={() => setEditing(r)} onChanged={load} />
          ))}
        </div>
      ))}

      {editing && (
        <ResourceEditor
          scope={scope} teamSeasonId={teamSeasonId} types={types}
          resource={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function renderValue(attr: ResourceAttr, val?: string) {
  if (!val) return <span style={{ color: "#bbb" }}>—</span>;
  if (attr.type === "url" || attr.type === "file") {
    return <UrlValue url={val} />;
  }
  return <span>{val}</span>;
}

/** Shows the full web address as a clickable link, with a copy-to-clipboard button. */
function UrlValue({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <span style={st.urlWrap}>
      <a href={url} target="_blank" rel="noreferrer" style={st.link}>
        {url} <ExternalLink size={11} style={{ flexShrink: 0 }} />
      </a>
      <button type="button" style={st.copyBtn} title={copied ? "Copied!" : "Copy link"} onClick={copy}>
        {copied ? <Check size={13} color="#2e7d32" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

function ResourceCard({ r, canManage, canGrant, expanded, onToggle, onEdit, onChanged }: {
  r: Resource; canManage: boolean; canGrant: boolean; expanded: boolean; onToggle: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const attrs = r.resource_type?.attributes ?? [];
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    try { await resourcesApi.request(r.id); onChanged(); } finally { setBusy(false); }
  }

  return (
    <div style={st.card}>
      <div style={st.cardMain}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.name}>
            {r.name}
            {r.resets_each_season && <span style={st.resetTag}><RefreshCw size={10} /> resets yearly</span>}
            {r.needs_update && <span style={st.needsTag}><AlertTriangle size={10} /> needs update</span>}
          </div>
          <div style={st.attrs}>
            {attrs.map((a) => (
              <div key={a.key} style={st.attrRow}><span style={st.attrLabel}>{a.label}:</span> {renderValue(a, r.values?.[a.key])}</div>
            ))}
            {r.notes && <div style={st.notes}>{r.notes}</div>}
          </div>
        </div>
        <div style={st.cardActions}>
          {/* Access status / request */}
          {r.my_status === "granted" ? <span style={st.granted}><Check size={12} /> You have access</span>
            : r.my_status === "requested" ? <span style={st.requested}><Clock size={12} /> Requested</span>
            : <button style={st.reqBtn} disabled={busy} onClick={request}><Hand size={13} /> Request access</button>}
          {canManage && (
            <>
              <button style={st.iconBtn} title="Edit" onClick={onEdit}><Pencil size={13} /></button>
              <button style={{ ...st.iconBtn, color: "#c62828" }} title="Delete" onClick={async () => {
                if (confirm(`Delete "${r.name}"?`)) { await resourcesApi.remove(r.id); onChanged(); }
              }}><Trash2 size={13} /></button>
            </>
          )}
        </div>
      </div>

      {canGrant && (
        <div>
          <button style={st.accessToggle} onClick={onToggle}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Access — {r.granted_count} granted{r.pending_count ? `, ${r.pending_count} pending` : ""}
          </button>
          {expanded && (
            <div style={st.accessBox}>
              {(r.access ?? []).length === 0 && <p style={st.muted}>No access records yet.</p>}
              {(r.access ?? []).map((a) => (
                <div key={a.member_id} style={st.accessRow}>
                  <span style={{ flex: 1 }}>{a.member_name}</span>
                  <span style={{ ...st.statusPill, ...(a.status === "granted" ? st.pillGranted : a.status === "requested" ? st.pillReq : st.pillRevoked) }}>{a.status}</span>
                  {a.status !== "granted" && <button style={st.grantBtn} onClick={async () => { await resourcesApi.grant(r.id, a.member_id); onChanged(); }}>Grant</button>}
                  {a.status === "granted" && <button style={st.revokeBtn} onClick={async () => { await resourcesApi.revoke(r.id, a.member_id); onChanged(); }}>Revoke</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResourceEditor({ scope, teamSeasonId, types, resource, onClose, onSaved }: {
  scope: "team" | "trc"; teamSeasonId?: number; types: ResourceType[];
  resource: Resource | null; onClose: () => void; onSaved: () => void;
}) {
  const editing = !!resource;
  const [name, setName] = useState(resource?.name ?? "");
  const [typeId, setTypeId] = useState<number | "">(resource?.resource_type?.id ?? (types[0]?.id ?? ""));
  const [values, setValues] = useState<Record<string, string>>(resource?.values ?? {});
  const [notes, setNotes] = useState(resource?.notes ?? "");
  const [resets, setResets] = useState(resource?.resets_each_season ?? false);
  const [busy, setBusy] = useState(false);

  const type = types.find((t) => t.id === typeId);
  const attrs = type?.attributes ?? [];

  async function save() {
    if (!name.trim() || !typeId) return;
    setBusy(true);
    const payload = {
      scope, team_season_id: scope === "team" ? teamSeasonId : undefined,
      resource_type_id: typeId, name: name.trim(), values, notes: notes || undefined,
      resets_each_season: scope === "team" ? resets : false,
    };
    try {
      if (editing) await resourcesApi.update(resource!.id, payload);
      else await resourcesApi.create(payload);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}>
          <span style={st.modalTitle}>{editing ? "Edit Resource" : "Add Resource"}</span>
          <button style={st.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <label style={st.l}>Type</label>
        <select style={st.input} value={typeId} onChange={(e) => setTypeId(e.target.value ? parseInt(e.target.value) : "")}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label style={st.l}>Name</label>
        <input style={st.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drivetrain Videos" autoFocus />
        {attrs.map((a) => (
          <div key={a.key}>
            <label style={st.l}>{a.label}{a.required ? " *" : ""}</label>
            {a.type === "longtext"
              ? <textarea style={st.textarea} value={values[a.key] ?? ""} onChange={(e) => setValues({ ...values, [a.key]: e.target.value })} />
              : a.type === "select"
                ? <select style={st.input} value={values[a.key] ?? ""} onChange={(e) => setValues({ ...values, [a.key]: e.target.value })}>
                    <option value="">Select…</option>
                    {(a.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                : <input style={st.input} value={values[a.key] ?? ""} onChange={(e) => setValues({ ...values, [a.key]: e.target.value })}
                    placeholder={a.type === "url" || a.type === "file" ? "https://…" : ""} />}
          </div>
        ))}
        <label style={st.l}>Notes</label>
        <input style={st.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {scope === "team" && (
          <label style={st.checkRow}>
            <input type="checkbox" checked={resets} onChange={(e) => setResets(e.target.checked)} />
            <span>Reset each season (cleared at rollover — e.g. a new GitHub repo each year)</span>
          </label>
        )}
        <div style={st.modalActions}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={save} disabled={busy || !name.trim() || !typeId}>Save</button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: "8px 0" },
  toolbar: { display: "flex", gap: 10, marginBottom: 14, alignItems: "center" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #cdd7e3", borderRadius: 8, padding: "7px 12px", flex: 1 },
  search: { flex: 1, border: "none", outline: "none", fontSize: 14 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  group: { marginBottom: 16 },
  groupHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  groupCount: { background: "#f0f4f8", color: "#555", borderRadius: 10, padding: "0 7px", fontSize: 11 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 8 },
  cardMain: { display: "flex", gap: 12, alignItems: "flex-start" },
  name: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  resetTag: { display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#1565c0", background: "#e3f2fd", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" },
  needsTag: { display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#e65100", background: "#fff3e0", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" },
  attrs: { marginTop: 5, display: "flex", flexDirection: "column", gap: 2 },
  attrRow: { fontSize: 13, color: "#444" },
  attrLabel: { color: "#888", fontWeight: 600 },
  notes: { fontSize: 12, color: "#888", marginTop: 3, fontStyle: "italic" },
  link: { color: "#1565c0", textDecoration: "none", wordBreak: "break-all", display: "inline-flex", alignItems: "center", gap: 4 },
  urlWrap: { display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" },
  copyBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 3, background: "none", border: "1px solid #d6deea", borderRadius: 5, color: "#1565c0", cursor: "pointer" },
  cardActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  granted: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#2e7d32", background: "#e8f5e9", borderRadius: 14, padding: "4px 10px" },
  requested: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#e65100", background: "#fff3e0", borderRadius: 14, padding: "4px 10px" },
  reqBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  iconBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 7, padding: 6, cursor: "pointer", color: "#888" },
  accessToggle: { display: "flex", alignItems: "center", gap: 4, marginTop: 10, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 },
  accessBox: { marginTop: 8, paddingTop: 8, borderTop: "1px solid #f0f3f7", display: "flex", flexDirection: "column", gap: 6 },
  accessRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },
  statusPill: { fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "1px 8px", textTransform: "uppercase" },
  pillGranted: { background: "#e8f5e9", color: "#2e7d32" },
  pillReq: { background: "#fff3e0", color: "#e65100" },
  pillRevoked: { background: "#f0f0f0", color: "#999" },
  grantBtn: { padding: "4px 10px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  revokeBtn: { padding: "4px 10px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 12 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: "20px 22px", width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 800, color: "#1a3a5c" },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", margin: "10px 0 3px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: "#fff" },
  textarea: { width: "100%", minHeight: 60, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", resize: "vertical" },
  checkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#444", marginTop: 12, cursor: "pointer" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  cancelBtn: { padding: "8px 14px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
  saveBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
};
