import { useEffect, useState } from "react";
import { incidentsApi } from "../api";
import { useNavigate } from "react-router-dom";
import { Plus, ArrowUpRight } from "lucide-react";

interface FA { id: number; person_name: string | null; occurred_at: string; treatment: string; supplies_used: string | null; notes: string | null; promoted_incident_id: number | null; }

export default function FirstAidLog() {
  const nav = useNavigate();
  const [rows, setRows] = useState<FA[]>([]);
  const [person, setPerson] = useState("");
  const [treatment, setTreatment] = useState("");
  const [supplies, setSupplies] = useState("");
  const [msg, setMsg] = useState("");

  function load() { incidentsApi.firstAidList().then((r) => setRows(r as FA[])).catch(() => {}); }
  useEffect(load, []);

  async function save() {
    if (!treatment.trim()) { setMsg("What was done?"); return; }
    await incidentsApi.firstAidSave({ person_name: person || null, treatment, supplies_used: supplies || null });
    setPerson(""); setTreatment(""); setSupplies(""); setMsg("Logged.");
    load(); setTimeout(() => setMsg(""), 2000);
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 14px 40px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: "6px 0" }}>First Aid Log</h1>
      <div style={{ background: "#fff7e6", border: "1px solid #f0d6a8", color: "#8a4b00", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
        Ice packs, bandages, cleaning a scrape — quick log only. <strong>Giving any medication (even OTC) is never a log entry — it's a Medical report</strong>, because it needs permission on file.
      </div>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <input style={inp} placeholder="Who (name, optional)" value={person} onChange={(e) => setPerson(e.target.value)} />
          <input style={inp} placeholder="What was done * (ice pack, bandage, cleaned a scrape…)" value={treatment} onChange={(e) => setTreatment(e.target.value)} />
          <input style={inp} placeholder="Supplies used (feeds restocking)" value={supplies} onChange={(e) => setSupplies(e.target.value)} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={{ padding: "10px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={save}><Plus size={15} /> Log it</button>
            {msg && <span style={{ color: "#2e7d32", fontSize: 13 }}>{msg}</span>}
          </div>
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{r.treatment}</div>
            <div style={{ fontSize: 12.5, color: "#888" }}>{r.person_name ?? "—"} · {r.occurred_at}{r.supplies_used ? ` · ${r.supplies_used}` : ""}</div>
          </div>
          {r.promoted_incident_id ? <span style={{ fontSize: 12, color: "#2e7d32" }}>→ incident #{r.promoted_incident_id}</span>
            : <button style={{ background: "none", border: "1px solid #cdd7e3", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}
                onClick={async () => { const inc = await incidentsApi.firstAidPromote(r.id); nav(`/incidents/${inc.id}`); }}><ArrowUpRight size={13} /> Promote to incident</button>}
        </div>
      ))}
    </div>
  );
}
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #cdd7e3", borderRadius: 9, fontSize: 15 };
