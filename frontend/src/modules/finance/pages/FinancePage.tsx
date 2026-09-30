/**
 * FinancePage (#89) — Team Financials from QuickBooks
 * ===================================================
 * Shows imported QuickBooks actuals rolled up per team (income / expense / net),
 * plus an org-wide line and any segments that still need to be mapped to a team.
 * Treasurers (finance.manage) can import a new export and map segment→team here.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { financeApi, money, type ByTeamResponse, type FinanceImport, type FinanceSegment, type TeamOption } from "../api";
import ImportWizard from "../components/ImportWizard";
import { DollarSign, Upload, Trash2, Save, Link2 } from "lucide-react";

export default function FinancePage() {
  const { canWrite } = useAuth();
  const canManage = canWrite("finance.manage");

  const [imports, setImports] = useState<FinanceImport[]>([]);
  const [importId, setImportId] = useState<number | null>(null);
  const [byTeam, setByTeam] = useState<ByTeamResponse | null>(null);
  const [segments, setSegments] = useState<FinanceSegment[]>([]);
  const [teamOpts, setTeamOpts] = useState<TeamOption[]>([]);
  const [wizard, setWizard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const loadImports = useCallback(async () => {
    const list = await financeApi.listImports().catch(() => []);
    setImports(list);
    setImportId((cur) => cur ?? (list[0]?.id ?? null));
  }, []);
  useEffect(() => { loadImports(); }, [loadImports]);

  const loadData = useCallback(async () => {
    if (!importId) { setByTeam(null); setSegments([]); return; }
    const [bt, seg] = await Promise.all([
      financeApi.byTeam(importId).catch(() => null),
      canManage ? financeApi.segments(importId).catch(() => null) : Promise.resolve(null),
    ]);
    setByTeam(bt);
    if (seg) { setSegments(seg.segments); setTeamOpts(seg.teams); }
    setDirty(false);
  }, [importId, canManage]);
  useEffect(() => { loadData(); }, [loadData]);

  function setSeg(label: string, patch: Partial<FinanceSegment>) {
    setSegments((segs) => segs.map((s) => s.segment_label === label ? { ...s, ...patch } : s));
    setDirty(true);
  }
  async function saveMap() {
    await financeApi.setSegmentMap(segments.map((s) => ({ segment_label: s.segment_label, team_season_id: s.scope === "team" ? s.team_season_id : null, scope: s.scope })));
    flash("Mapping saved.");
    loadData();
  }
  async function delImport(id: number) {
    if (!confirm("Delete this import and its data? Mappings you've set are kept for next time.")) return;
    await financeApi.deleteImport(id);
    setImportId(null);
    await loadImports();
    flash("Import deleted.");
  }

  const unmappedCount = segments.filter((s) => s.scope === "team" && !s.team_season_id).length;

  return (
    <div style={st.page}>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}><DollarSign size={22} /> Team Financials</h1>
          <p style={st.sub}>Actuals imported from QuickBooks, rolled up per team.</p>
        </div>
        {canManage && <button style={st.importBtn} onClick={() => setWizard(true)}><Upload size={15} /> Import from QuickBooks</button>}
      </div>

      {msg && <div style={st.flash}>{msg}</div>}

      {imports.length === 0 ? (
        <div style={st.empty}>
          <DollarSign size={46} color="#cdd7e3" />
          <p style={st.muted}>No financials imported yet.{canManage ? " Click “Import from QuickBooks” to upload a report." : " A treasurer can import a QuickBooks report to populate this."}</p>
        </div>
      ) : (
        <>
          <div style={st.toolbar}>
            <label style={st.tbLabel}>Showing:</label>
            <select style={st.select} value={importId ?? ""} onChange={(e) => setImportId(Number(e.target.value))}>
              {imports.map((im) => <option key={im.id} value={im.id}>{im.label || im.filename || `Import #${im.id}`}{im.as_of_date ? ` — as of ${im.as_of_date}` : ""}</option>)}
            </select>
            {canManage && importId && <button style={st.delBtn} onClick={() => delImport(importId)} title="Delete this import"><Trash2 size={14} /></button>}
          </div>

          {/* Roll-up by team */}
          {byTeam && (
            <div style={st.card}>
              <table style={st.table}>
                <thead><tr><th style={st.th}>Team</th><th style={st.thR}>Income</th><th style={st.thR}>Expense</th><th style={st.thR}>Net</th></tr></thead>
                <tbody>
                  {byTeam.teams.length === 0 && byTeam.org === null && (
                    <tr><td style={st.td} colSpan={4}><span style={st.muted}>Nothing mapped to a team yet{canManage ? " — use the mapping below." : "."}</span></td></tr>
                  )}
                  {byTeam.teams.map((t) => (
                    <tr key={t.team_season_id}>
                      <td style={st.td}><strong>{t.team_name}</strong> <span style={st.season}>{t.season}</span></td>
                      <td style={st.tdR}>{money(t.income)}</td>
                      <td style={st.tdR}>{money(t.expense)}</td>
                      <td style={{ ...st.tdR, ...netStyle(t.net) }}>{money(t.net)}</td>
                    </tr>
                  ))}
                  {byTeam.org && (
                    <tr style={st.orgRow}>
                      <td style={st.td}><strong>TRC (organization-wide)</strong></td>
                      <td style={st.tdR}>{money(byTeam.org.income)}</td>
                      <td style={st.tdR}>{money(byTeam.org.expense)}</td>
                      <td style={{ ...st.tdR, ...netStyle(byTeam.org.net) }}>{money(byTeam.org.net)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {byTeam.unmapped.length > 0 && (
                <p style={st.unmappedNote}>
                  <Link2 size={13} /> {byTeam.unmapped.length} segment{byTeam.unmapped.length === 1 ? "" : "s"} not yet mapped to a team
                  {canManage ? " (see Segment mapping below)." : "."}
                </p>
              )}
            </div>
          )}

          {/* Segment mapping (treasurers) */}
          {canManage && segments.length > 0 && (
            <div style={st.card}>
              <div style={st.mapHead}>
                <strong>Segment mapping</strong>
                <span style={st.mapHint}>{unmappedCount > 0 ? `${unmappedCount} unmapped` : "all mapped"} · remembered for future imports</span>
                <button style={{ ...st.saveBtn, opacity: dirty ? 1 : 0.55 }} disabled={!dirty} onClick={saveMap}><Save size={14} /> Save mapping</button>
              </div>
              <table style={st.table}>
                <thead><tr><th style={st.th}>QuickBooks label</th><th style={st.thR}>Net</th><th style={st.th}>Maps to</th></tr></thead>
                <tbody>
                  {segments.map((s) => (
                    <tr key={s.segment_label} style={s.scope === "team" && !s.team_season_id ? st.unmappedRow : undefined}>
                      <td style={st.td}>{s.segment_label}</td>
                      <td style={{ ...st.tdR, ...netStyle(s.net) }}>{money(s.net)}</td>
                      <td style={st.td}>
                        <div style={st.mapControls}>
                          <select style={st.scopeSel} value={s.scope} onChange={(e) => setSeg(s.segment_label, { scope: e.target.value as FinanceSegment["scope"] })}>
                            <option value="team">A team</option>
                            <option value="org">TRC org-wide</option>
                            <option value="ignore">Ignore</option>
                          </select>
                          {s.scope === "team" && (
                            <select style={st.teamSel} value={s.team_season_id ?? ""} onChange={(e) => setSeg(s.segment_label, { team_season_id: e.target.value ? Number(e.target.value) : null })}>
                              <option value="">{s.suggested_team_season_id ? "— pick a team —" : "— pick a team —"}</option>
                              {teamOpts.map((t) => <option key={t.team_season_id} value={t.team_season_id}>{t.label}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {wizard && (
        <ImportWizard
          onClose={() => setWizard(false)}
          onImported={async (id) => { setWizard(false); await loadImports(); setImportId(id); flash("Imported. Map any new segments to teams below."); }}
        />
      )}
    </div>
  );
}

function netStyle(n: number): React.CSSProperties {
  return { color: n < 0 ? "#c62828" : n > 0 ? "#2e7d32" : "#445", fontWeight: 700 };
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  sub: { color: "#666", fontSize: 14, marginTop: 4 },
  importBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  empty: { textAlign: "center", padding: "3rem 1rem" },
  muted: { color: "#888", fontSize: 14 },
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  tbLabel: { fontSize: 13, color: "#667", fontWeight: 600 },
  select: { padding: "8px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, background: "#fff", maxWidth: 460 },
  delBtn: { background: "#fff", border: "1px solid #f1d4d4", color: "#c62828", borderRadius: 8, padding: 8, cursor: "pointer" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 14 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  thR: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "8px", borderBottom: "1px solid #f4f6fa", verticalAlign: "middle" },
  tdR: { padding: "8px", borderBottom: "1px solid #f4f6fa", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  season: { fontSize: 11, color: "#99a" },
  orgRow: { background: "#f8fafc" },
  unmappedNote: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#b45309", marginTop: 10, marginBottom: 0 },
  mapHead: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" },
  mapHint: { fontSize: 12, color: "#888" },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13, marginLeft: "auto" },
  unmappedRow: { background: "#fffbeb" },
  mapControls: { display: "flex", gap: 6, flexWrap: "wrap" },
  scopeSel: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, background: "#fff" },
  teamSel: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, background: "#fff", maxWidth: 240 },
};
