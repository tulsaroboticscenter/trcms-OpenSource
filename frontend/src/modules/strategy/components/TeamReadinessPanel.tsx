/**
 * TeamReadinessPanel — Inspire/Impact Readiness tab (Phase 4). Scores the team on the
 * "Six Separators" from real data (goals, portfolio, captures, mission, certifications),
 * with a heat view + plain-language "what would move this up." Admins can tune the
 * weights. Gated by strategy.readiness.view.
 */
import { useEffect, useState, useCallback } from "react";
import { readinessApi, type Readiness, type ReadinessCriteriaRow } from "../api";
import { useAuth } from "../../../core/AuthContext";
import { Gauge, Sliders, Save } from "lucide-react";

const BAND: Record<string, { label: string; color: string }> = {
  early: { label: "Early", color: "#c62828" },
  developing: { label: "Developing", color: "#e65100" },
  strong: { label: "Strong", color: "#2e7d32" },
};
const scoreColor = (s: number) => (s >= 75 ? "#2e7d32" : s >= 45 ? "#e65100" : "#c62828");

export default function TeamReadinessPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { isAdmin, hasRole } = useAuth();
  const canTune = isAdmin || hasRole("Admin", "System Administrator");
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [tuning, setTuning] = useState(false);
  const [rows, setRows] = useState<ReadinessCriteriaRow[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    readinessApi.get(teamSeasonId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);

  async function openTune() { setRows(await readinessApi.criteria()); setTuning(true); }
  async function saveTune() {
    await readinessApi.saveCriteria(rows.map((r) => ({ id: r.id, weight: r.weight, is_active: r.is_active })));
    setTuning(false); load();
  }

  if (loading) return <div style={{ color: "#889", padding: "1rem" }}>Scoring readiness…</div>;
  if (!data) return <div style={{ color: "#c62828", padding: "1rem" }}>Couldn't load readiness.</div>;
  const band = BAND[data.band];

  return (
    <div>
      <div style={s.head}>
        <div style={s.overall}>
          <div style={{ ...s.ring, borderColor: scoreColor(data.overall) }}>
            <span style={{ ...s.ringNum, color: scoreColor(data.overall) }}>{data.overall}</span>
            <span style={s.ringOf}>/100</span>
          </div>
          <div>
            <div style={s.title}><Gauge size={16} style={{ verticalAlign: -3 }} /> Inspire / Impact Readiness</div>
            <span style={{ ...s.band, background: band.color }}>{band.label}</span>
            <div style={s.ctx}>{data.context.goals} goals · {data.context.pieces} pieces · {data.context.captures} captures · {data.context.youth_with_certs}/{data.context.roster} youth certified</div>
          </div>
        </div>
        {canTune && <button style={s.tune} onClick={openTune}><Sliders size={13} /> Tune weights</button>}
      </div>

      <div style={s.list}>
        {data.criteria.map((c) => (
          <div key={c.key} style={s.row}>
            <div style={s.rowTop}>
              <span style={s.label}>{c.label}{c.weight !== 1 && <span style={s.wt}>×{c.weight}</span>}</span>
              <span style={{ ...s.score, color: scoreColor(c.score) }}>{c.score}</span>
            </div>
            <div style={s.track}><div style={{ ...s.fill, width: `${c.score}%`, background: scoreColor(c.score) }} /></div>
            {c.guidance && <div style={s.guide}>{c.guidance}</div>}
          </div>
        ))}
      </div>
      <p style={s.note}>Scores are computed live from your goals, portfolio, captures, mission, and certifications — improve those and the numbers move.</p>

      {tuning && (
        <div style={s.overlay} onClick={() => setTuning(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>Tune Readiness Weights</h3>
            <p style={s.modalSub}>Higher weight = more influence on the overall score. Uncheck to hide a separator.</p>
            {rows.map((r, i) => (
              <div key={r.id} style={s.tuneRow}>
                <label style={s.tuneChk}><input type="checkbox" checked={r.is_active} onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, is_active: e.target.checked } : x))} /> {r.label}</label>
                <input style={s.tuneWt} type="number" min={0} max={10} value={r.weight} onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) } : x))} />
              </div>
            ))}
            <div style={s.modalActions}>
              <button style={s.cancel} onClick={() => setTuning(false)}>Cancel</button>
              <button style={s.save} onClick={saveTune}><Save size={13} /> Save weights</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  overall: { display: "flex", alignItems: "center", gap: 14 },
  ring: { width: 66, height: 66, borderRadius: "50%", border: "5px solid", display: "flex", alignItems: "baseline", justifyContent: "center", flexShrink: 0 },
  ringNum: { fontSize: 24, fontWeight: 800 },
  ringOf: { fontSize: 11, color: "#98a3b0" },
  title: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  band: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "#fff", borderRadius: 5, padding: "2px 8px", marginTop: 4 },
  ctx: { fontSize: 11.5, color: "#889", marginTop: 5 },
  tune: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#455" },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  row: { },
  rowTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  label: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  wt: { fontSize: 10.5, fontWeight: 700, color: "#00695c", background: "#e0f2f1", borderRadius: 4, padding: "0 5px", marginLeft: 6 },
  score: { fontSize: 15, fontWeight: 800 },
  track: { height: 9, background: "#eef2f7", borderRadius: 6, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6 },
  guide: { fontSize: 12, color: "#667", marginTop: 4, lineHeight: 1.4 },
  note: { fontSize: 11.5, color: "#98a3b0", marginTop: 16, fontStyle: "italic" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "6vh 16px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: "18px 20px", width: "100%", maxWidth: 460, boxShadow: "0 12px 40px rgba(0,0,0,0.2)" },
  modalH: { margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a5c" },
  modalSub: { fontSize: 12.5, color: "#667", margin: "4px 0 14px" },
  tuneRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid #f4f7fa" },
  tuneChk: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#334" },
  tuneWt: { width: 60, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, textAlign: "center" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancel: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  save: { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "#00695c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
};
