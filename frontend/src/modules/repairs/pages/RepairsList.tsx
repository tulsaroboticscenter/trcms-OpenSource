import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { repairsApi, KIND_META, STATUS_META, PRIORITY_META, STATUS_ORDER, type RepairTicket } from "../api";
import { Wrench, Plus, Hammer } from "lucide-react";

const fmtDate = (d?: string | null) =>
  d ? new Date((d.length > 10 ? d : d + "T00:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export default function RepairsList() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canManage = canWrite("repairs.manage");
  const canSubmit = canWrite("repairs.submit");

  const [items, setItems] = useState<RepairTicket[] | null>(null);
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("");

  function load() {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    repairsApi.list(params).then(setItems).catch(() => setItems([]));
  }
  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = (items ?? []).filter((t) => !kind || t.kind === kind);

  return (
    <div style={st.page}>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}><Wrench size={22} /> Repair &amp; Maintenance</h1>
          <p style={st.sub}>Report broken equipment and track repairs through to completion.</p>
        </div>
        {canSubmit && (
          <button style={st.addBtn} onClick={() => navigate("/repairs/new")}><Plus size={15} /> New Ticket</button>
        )}
      </div>

      <div style={st.filters}>
        <select style={st.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open tickets</option>
          <option value="">All statuses</option>
          {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
        </select>
        <select style={st.select} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Repairs &amp; maintenance</option>
          {Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {items === null ? <p style={st.muted}>Loading…</p> : visible.length === 0 ? (
        <div style={st.empty}>
          <Wrench size={48} color="#cdd7e3" />
          <p style={st.muted}>
            {status === "open" ? "No open tickets. " : "No tickets match. "}
            {canSubmit && "Click “New Ticket” to report something that needs fixing."}
          </p>
        </div>
      ) : (
        <div style={st.list}>
          {visible.map((t) => {
            const km = KIND_META[t.kind]; const sm = STATUS_META[t.status]; const pm = PRIORITY_META[t.priority];
            return (
              <div key={t.id} style={st.row} onClick={() => navigate(`/repairs/${t.id}`)}>
                <span style={{ ...st.kindIcon, color: km.color, background: km.color + "18" }}>
                  {t.kind === "maintenance" ? <Hammer size={15} /> : <Wrench size={15} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={st.title}><span style={st.idTag}>#{t.id}</span> {t.title}</div>
                  <div style={st.metaRow}>
                    <span>{km.label}</span>
                    {(t.inv_item_name || t.equipment_name) && <span>· {t.inv_item_name || t.equipment_name}</span>}
                    {t.location_name && <span>· {t.location_name}</span>}
                    {t.assigned_to_name && <span>· 🔧 {t.assigned_to_name}</span>}
                    <span>· reported {fmtDate(t.reported_date || t.created_at)}</span>
                  </div>
                </div>
                {t.priority !== "normal" && t.priority !== "low" && (
                  <span style={{ ...st.badge, color: pm.color, background: pm.color + "1a" }}>{pm.label}</span>
                )}
                <span style={{ ...st.badge, color: sm.color, background: sm.color + "1a" }}>{sm.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {!canManage && visible.length > 0 && (
        <p style={st.footNote}>Only repair coordinators can change status or assign tickets, but anyone can add a progress note.</p>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  sub: { color: "#666", fontSize: 14, marginTop: 4 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  filters: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  select: { padding: "8px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, cursor: "pointer" },
  kindIcon: { width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { fontSize: 15, fontWeight: 600, color: "#1a3a5c" },
  idTag: { fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#94a3b8", fontWeight: 700 },
  metaRow: { display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, color: "#888", marginTop: 2 },
  badge: { padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700, flexShrink: 0 },
  empty: { textAlign: "center", padding: "3rem 1rem" },
  muted: { color: "#888", textAlign: "center", padding: "1rem", fontSize: 14 },
  footNote: { color: "#9aa7b4", fontSize: 12, textAlign: "center", marginTop: 16 },
};
