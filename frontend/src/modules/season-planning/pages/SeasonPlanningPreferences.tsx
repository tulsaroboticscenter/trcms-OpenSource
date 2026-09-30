/**
 * SeasonPlanningPreferences — one read-only listing of every FLL visitor, youth
 * member, and mentor with the night(s) they prefer / can also do / can't, for a
 * chosen program + season. Same source the planning board uses (intake canonical
 * prefs overlaid by the availability form). Built for review + print.
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSeasons, seasonOptions } from "../../../core/useSeasons";
import { currentSeasonLabel } from "../../../core/dateUtils";
import { seasonPlanningApi, type PrefsData, type PrefRow } from "../api";
import { ArrowLeft, RefreshCw, Printer, UserRound, GraduationCap } from "lucide-react";

const PROGRAMS = [{ id: 2, label: "FLL Challenge" }, { id: 1, label: "FLL Explore" }];

function Nights({ names, tone }: { names: string[]; tone: "pref" | "ok" | "no" }) {
  if (!names.length) return <span style={{ color: "#aab" }}>—</span>;
  const st =
    tone === "pref" ? { background: "#e6f4ea", color: "#1b7a3d", border: "1px solid #bfe3c9" }
    : tone === "ok" ? { background: "#eef2f7", color: "#4a5a6a", border: "1px solid #d9e2ec" }
    : { background: "#fdecea", color: "#b5372a", border: "1px solid #f3cdc7", textDecoration: "line-through" as const };
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
      {names.map((n) => (
        <span key={n} style={{ ...st, padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{n}</span>
      ))}
    </span>
  );
}

function Table({ title, icon, rows, extra }: { title: string; icon: React.ReactNode; rows: PrefRow[]; extra?: "status" | "willing" }) {
  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{icon} {title}</span>
        <span style={s.count}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div style={s.empty}>No recorded preferences.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                {extra === "status" && <th style={s.th}>Status</th>}
                {extra === "willing" && <th style={s.th}>Willing to help</th>}
                <th style={s.th}>Prefers</th>
                <th style={s.th}>Can also do</th>
                <th style={s.th}>Can't do</th>
                <th style={s.th}>Flexible</th>
                <th style={s.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${title}-${r.kind || "m"}-${r.id}`} style={s.tr}>
                  <td style={{ ...s.td, fontWeight: 700, color: "#1a3a5c", whiteSpace: "nowrap" }}>{r.name}</td>
                  {extra === "status" && <td style={s.td}><span style={s.pill}>{r.status || "—"}</span></td>}
                  {extra === "willing" && <td style={s.td}><span style={s.pill}>{r.mentor_willing || "—"}</span></td>}
                  <td style={s.td}><Nights names={r.preferred} tone="pref" /></td>
                  <td style={s.td}><Nights names={r.ok} tone="ok" /></td>
                  <td style={s.td}><Nights names={r.no} tone="no" /></td>
                  <td style={s.td}>{r.flexible ? "Yes" : "—"}</td>
                  <td style={{ ...s.td, color: "#556", maxWidth: 240 }}>{r.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SeasonPlanningPreferences() {
  const navigate = useNavigate();
  const seasons = useSeasons();
  const [season, setSeason] = useState(currentSeasonLabel());
  const [programId, setProgramId] = useState(2);
  const [data, setData] = useState<PrefsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true); setErr("");
    seasonPlanningApi.preferences(season, programId)
      .then(setData)
      .catch(() => setErr("Could not load night preferences."))
      .finally(() => setLoading(false));
  }, [season, programId]);

  useEffect(() => { load(); }, [load]);

  const progLabel = PROGRAMS.find((p) => p.id === programId)?.label || "FLL";
  const total = data ? data.counts.youth + data.counts.mentors : 0;

  return (
    <div style={s.wrap}>
      <div className="no-print">
        <button style={s.back} onClick={() => navigate("/season-planning")}><ArrowLeft size={14} /> Season Planning</button>
        <div style={s.headRow}>
          <div>
            <h1 style={s.heading}>Night Preferences</h1>
            <p style={s.sub}>Every {progLabel} visitor, member, and mentor and the nights they prefer — {season}.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={s.ghost} onClick={load}><RefreshCw size={14} /> Refresh</button>
            <button style={s.primary} onClick={() => window.print()}><Printer size={14} /> Print</button>
          </div>
        </div>

        <div style={s.pickers}>
          <label style={s.pick}>Season
            <select style={s.select} value={season} onChange={(e) => setSeason(e.target.value)}>
              {seasonOptions(seasons, season).map((sea) => <option key={sea} value={sea}>{sea}</option>)}
            </select>
          </label>
          <label style={s.pick}>Program
            <select style={s.select} value={programId} onChange={(e) => setProgramId(Number(e.target.value))}>
              {PROGRAMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {err && <div style={s.errBox}>{err}</div>}
      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : data ? (
        <>
          <div style={s.printTitle} className="print-only">{progLabel} Night Preferences — {season}</div>

          <div style={s.tally}>
            {data.nights.length === 0 ? (
              <span style={{ color: "#889" }}>No meeting nights are set for {progLabel} this season. Add them in Season Planning.</span>
            ) : (
              data.tally.map((t) => (
                <div key={t.night_id} style={s.tallyCard}>
                  <div style={s.tallyNight}>{t.name}</div>
                  <div style={s.tallyNums}>
                    <span style={s.tallyPref}>{t.preferred} prefer</span>
                    <span style={s.tallyOk}>{t.ok} can also</span>
                  </div>
                </div>
              ))
            )}
            <div style={{ ...s.tallyCard, background: "#1a3a5c", color: "#fff" }}>
              <div style={{ ...s.tallyNight, color: "#cfe0f0" }}>Total listed</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{total}</div>
            </div>
          </div>

          <Table title="Youth & Prospects" icon={<GraduationCap size={16} color="#1b7a3d" />} rows={data.youth} extra="status" />
          <Table title="Mentors" icon={<UserRound size={16} color="#a1571c" />} rows={data.mentors} extra="willing" />
        </>
      ) : null}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
        @media screen { .print-only { display: none; } }
      `}</style>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1100, margin: "0 auto", padding: "18px 20px 60px" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 8, padding: 0 },
  headRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, margin: "6px 0 16px" },
  ghost: { display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  primary: { display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", border: "1px solid #1a3a5c", background: "#1a3a5c", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  pickers: { display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 },
  pick: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 700, color: "#455" },
  select: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, fontWeight: 400 },
  printTitle: { fontSize: 18, fontWeight: 800, color: "#1a3a5c", marginBottom: 12 },
  tally: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 },
  tallyCard: { minWidth: 130, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" },
  tallyNight: { fontSize: 12, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.4 },
  tallyNums: { display: "flex", flexDirection: "column", gap: 2, marginTop: 4 },
  tallyPref: { fontSize: 15, fontWeight: 800, color: "#1b7a3d" },
  tallyOk: { fontSize: 12.5, color: "#64748b" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 16 },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontWeight: 800, color: "#1a3a5c", fontSize: 16, marginBottom: 10 },
  count: { background: "#eef2f7", color: "#455", borderRadius: 20, padding: "2px 12px", fontSize: 13, fontWeight: 700 },
  empty: { color: "#889", fontSize: 14, padding: "8px 2px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  th: { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f4f7fa" },
  td: { padding: "9px 10px", verticalAlign: "top" },
  pill: { display: "inline-block", background: "#eef2f7", color: "#4a5a6a", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 600, textTransform: "capitalize" },
  errBox: { background: "#fdecea", color: "#b5372a", border: "1px solid #f3cdc7", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13.5 },
};
