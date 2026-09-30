/**
 * MemberCertificationsPanel — embedded on a member's profile.
 * Shows earned certifications (count + by section) and in-progress; managers
 * (certifications.award) can mark a member complete or remove a record.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { certApi, type MemberCertsResponse, type CatalogResponse, type MemberBadges } from "../api";
import CertClassroomLink from "./CertClassroomLink";
import * as Icons from "lucide-react";
import { Award, Wrench, PlusCircle, X, Check, Medal } from "lucide-react";

function BadgeIcon({ name, size = 18, color }: { name?: string; size?: number; color?: string }) {
  const Cmp = (name && (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[name]) || Medal;
  return <Cmp size={size} color={color} />;
}

const LEVEL_COLORS: Record<number, string> = { 1: "#2e7d32", 2: "#1565c0", 3: "#6a1b9a" };

export default function MemberCertificationsPanel({ memberId }: { memberId: number }) {
  const { canWrite } = useAuth();
  const canAward = canWrite("certifications.award");
  const [data, setData] = useState<MemberCertsResponse | null>(null);
  const [badges, setBadges] = useState<MemberBadges | null>(null);
  const [adding, setAdding] = useState(false);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);

  const load = useCallback(() => {
    certApi.memberCerts(memberId).then(setData).catch(() => {});
    certApi.memberBadges(memberId).then(setBadges).catch(() => {});
  }, [memberId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canAward) certApi.catalog({ status: "active" }).then(setCatalog).catch(() => {}); }, [canAward]);

  if (!data) return <p style={st.muted}>Loading…</p>;

  // Group completed by section
  const bySection: Record<string, typeof data.completed> = {};
  for (const c of data.completed) (bySection[c.section ?? "Other"] = bySection[c.section ?? "Other"] ?? []).push(c);
  const earnedIds = new Set([...data.completed, ...data.in_progress].map((c) => c.certification_id));

  return (
    <div>
      <CertClassroomLink />
      <div style={st.summary}>
        <Award size={18} color="#6a1b9a" />
        <span style={st.count}>{data.completed_count}</span>
        <span style={st.countLabel}>certification{data.completed_count !== 1 ? "s" : ""} earned</span>
        {data.in_progress.length > 0 && <span style={st.inProgressBadge}>{data.in_progress.length} in progress</span>}
        {canAward && !adding && <button style={st.addBtn} onClick={() => setAdding(true)}><PlusCircle size={13} /> Mark Certification</button>}
      </div>

      {/* Badges */}
      {badges && (badges.earned.length > 0 || badges.progress.length > 0) && (
        <div style={st.badgeWrap}>
          {badges.earned.length > 0 && (
            <div style={st.badgeRow}>
              {badges.earned.map((b) => (
                <div key={b.id} style={st.badge} title={`${b.name}${b.earned_date ? ` — earned ${b.earned_date}` : ""}${b.description ? `\n${b.description}` : ""}`}>
                  <div style={{ ...st.badgeCoin, background: b.color }}><BadgeIcon name={b.icon_name} color="#fff" /></div>
                  <span style={st.badgeName}>{b.name}</span>
                </div>
              ))}
            </div>
          )}
          {badges.progress.length > 0 && (
            <div style={st.nextRow}>
              <span style={st.nextLabel}>Next up:</span>
              {badges.progress.map((b) => (
                <div key={b.id} style={st.nextBadge} title={b.description}>
                  <div style={{ ...st.badgeCoinSm, borderColor: b.color, color: b.color }}><BadgeIcon name={b.icon_name} size={12} color={b.color} /></div>
                  <span style={st.nextName}>{b.name}</span>
                  <span style={st.nextProg}>{b.have}/{b.need}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {adding && canAward && catalog && (
        <AddCert catalog={catalog} earnedIds={earnedIds}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }}
          award={(d) => certApi.award(memberId, d)} />
      )}

      {data.completed_count === 0 && data.in_progress.length === 0 ? (
        <p style={st.muted}>No certifications yet.</p>
      ) : (
        <>
          {Object.entries(bySection).map(([sec, certs]) => (
            <div key={sec} style={st.secGroup}>
              <div style={st.secLabel}>{sec}</div>
              <div style={st.chips}>
                {certs.map((c) => (
                  <span key={c.id} style={st.chip} title={[c.completed_date ? `Completed ${c.completed_date}` : "", c.notes ?? ""].filter(Boolean).join(" · ") || undefined}>
                    {c.level && <span style={{ ...st.dot, background: LEVEL_COLORS[c.level] ?? "#888" }} />}
                    {c.is_tool_gate && <Wrench size={10} color="#c62828" />}
                    {c.name}
                    {canAward && <button style={st.chipDel} onClick={() => certApi.removeAward(memberId, c.certification_id).then(load)} title="Remove"><X size={11} /></button>}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {data.in_progress.length > 0 && (
            <div style={st.secGroup}>
              <div style={st.secLabel}>In Progress</div>
              <div style={st.chips}>
                {data.in_progress.map((c) => <span key={c.id} style={{ ...st.chip, ...st.chipProgress }}>{c.name}</span>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AddCert({ catalog, earnedIds, onClose, onSaved, award }: {
  catalog: CatalogResponse; earnedIds: Set<number>;
  onClose: () => void; onSaved: () => void; award: (d: Record<string, unknown>) => Promise<unknown>;
}) {
  const [certId, setCertId] = useState("");
  const [d, setD] = useState(new Date().toISOString().slice(0, 10));
  const [score, setScore] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!certId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { certification_id: parseInt(certId), status: "completed", completed_date: d };
      if (score.trim() !== "") payload.score = parseFloat(score);
      await award(payload);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={st.addForm}>
      <select style={st.input} value={certId} onChange={(e) => setCertId(e.target.value)} autoFocus>
        <option value="">Select certification…</option>
        {catalog.sections.map((s) => (
          <optgroup key={s.section} label={s.section}>
            {s.certifications.filter((c) => !earnedIds.has(c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <input type="date" style={{ ...st.input, maxWidth: 160 }} value={d} onChange={(e) => setD(e.target.value)} title="Date passed" />
      <input type="number" min={0} max={100} step="1" style={{ ...st.input, maxWidth: 120 }} value={score}
        onChange={(e) => setScore(e.target.value)} placeholder="Score % (opt.)" title="Score % (optional) — recorded on the certification" />
      <button style={st.saveBtn} onClick={save} disabled={saving || !certId}><Check size={14} /> {saving ? "Saving…" : "Mark Earned"}</button>
      <button style={st.cancelBtn} onClick={onClose}><X size={14} /></button>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  summary: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "10px 12px", background: "#f3e8fb", border: "1px solid #d9c2ec", borderRadius: 8, flexWrap: "wrap" },
  count: { fontSize: 22, fontWeight: 900, color: "#6a1b9a", lineHeight: 1 },
  countLabel: { fontSize: 13, fontWeight: 600, color: "#5d4070" },
  inProgressBadge: { fontSize: 11, fontWeight: 700, color: "#1565c0", background: "#e3f2fd", borderRadius: 10, padding: "2px 8px" },
  addBtn: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  addForm: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, flex: 1, minWidth: 180, boxSizing: "border-box" },
  saveBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancelBtn: { background: "#fff", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: "8px 10px", color: "#888", display: "flex" },
  badgeWrap: { marginBottom: 14 },
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  badge: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 72, textAlign: "center" },
  badgeCoin: { width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" },
  badgeName: { fontSize: 10, fontWeight: 700, color: "#1a3a5c", lineHeight: 1.2 },
  nextRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px dashed #e2e8f0" },
  nextLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const },
  nextBadge: { display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 14 },
  badgeCoinSm: { width: 20, height: 20, borderRadius: "50%", border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center" },
  nextName: { fontSize: 11.5, color: "#1a3a5c", fontWeight: 600 },
  nextProg: { fontSize: 11, color: "#888", fontWeight: 700 },
  secGroup: { marginBottom: 10 },
  secLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 16, fontSize: 12.5, color: "#1a3a5c", fontWeight: 500 },
  chipProgress: { background: "#e3f2fd", borderColor: "#bbdefb", color: "#1565c0" },
  dot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  chipDel: { background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 0, display: "flex" },
};
