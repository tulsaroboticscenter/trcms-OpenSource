import { useState, useEffect, useCallback } from "react";
import { eventsApi, type FundraisingConfig, type FundraisingRosterRow } from "../api";
import { DollarSign, Calculator, CheckCircle, AlertTriangle, RefreshCw, Users, Pencil } from "lucide-react";
import ApplyEarningsModal from "./ApplyEarningsModal";

/**
 * Team Fundraising pane (event logistics). Lets a fundraising manager mark
 * eligible teams + each team's expected amount, enter the pot available, run
 * Calculate Hourly, and Finalize Contributions (idempotent — re-runnable).
 */
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  auto:       { label: "Auto", color: "#1565c0", bg: "#e3f2fd" },
  chosen:     { label: "Chosen", color: "#2e7d32", bg: "#e8f5e9" },
  locked:     { label: "Locked to team", color: "#2e7d32", bg: "#e8f5e9" },
  held:       { label: "Needs team choice", color: "#c62828", bg: "#ffebee" },
  unassigned: { label: "Needs a team", color: "#8a6d00", bg: "#fff8e1" },
  none:       { label: "Not on eligible team", color: "#888", bg: "#f1f3f5" },
};

export default function EventFundraisingPanel({ eventId }: { eventId: number }) {
  const [cfg, setCfg] = useState<FundraisingConfig | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [editRow, setEditRow] = useState<FundraisingRosterRow | null>(null);

  const load = useCallback(async () => {
    const c = await eventsApi.getFundraising(eventId);
    setCfg(c);
    setAmount(c.total_amount_available != null ? String(c.total_amount_available) : "");
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  if (!cfg) return <div style={st.card}><div style={st.title}>Team Fundraising</div><p style={st.muted}>Loading…</p></div>;

  const eligibleIds = new Set(cfg.eligible_teams.map((t) => t.team_season_id));
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };

  async function toggleTeam(teamSeasonId: number, on: boolean) {
    const next = on
      ? [...eligibleIds, teamSeasonId]
      : [...eligibleIds].filter((id) => id !== teamSeasonId);
    setBusy("teams");
    try { setCfg(await eventsApi.setFundraisingTeams(eventId, next)); }
    finally { setBusy(""); }
  }
  async function saveAmount() {
    setBusy("amount");
    try { await eventsApi.setFundraisingAmount(eventId, amount === "" ? null : parseFloat(amount)); await load(); flash("Amount saved."); }
    finally { setBusy(""); }
  }
  async function saveExpected(teamSeasonId: number, v: string) {
    await eventsApi.setTeamExpected(eventId, teamSeasonId, v === "" ? null : parseFloat(v));
  }
  async function calculate() {
    setBusy("calc");
    try { setCfg(await eventsApi.calculateFundraising(eventId)); flash("Hourly rate calculated."); }
    finally { setBusy(""); }
  }
  async function finalize() {
    if (!confirm("Finalize contributions? This posts each youth's earnings to their team budgets. You can run it again later.")) return;
    setBusy("final");
    try { setCfg(await eventsApi.finalizeFundraising(eventId)); flash("Contributions finalized and posted to team budgets."); }
    catch (e: unknown) { flash((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Finalize failed."); }
    finally { setBusy(""); }
  }

  return (
    <div style={st.card}>
      <div style={st.head}>
        <div style={st.title}>
          <DollarSign size={15} style={{ verticalAlign: -2 }} /> Team Fundraising
          {cfg.benefits_season && <span style={st.benefitsBadge}>Benefits {cfg.benefits_season}</span>}
        </div>
        <button style={st.refresh} onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>
      {cfg.benefits_season && (
        <div style={st.benefitsNote}>
          This is a summer/off-season fundraiser — earnings post into <strong>{cfg.benefits_season}</strong> team
          budgets, and only that season's teams are listed below.
        </div>
      )}
      {msg && <div style={st.flash}>{msg}</div>}

      {/* Amount available */}
      <div style={st.section}>
        <div style={st.sectionLabel}>Amount available for the event</div>
        <div style={st.amountRow}>
          <span style={st.dollar}>$</span>
          <input style={st.amountInput} type="number" step="0.01" value={amount}
            placeholder="Enter after the event" onChange={(e) => setAmount(e.target.value)} />
          <button style={st.btnPrimary} disabled={busy === "amount"} onClick={saveAmount}>Save</button>
        </div>
      </div>

      {/* Eligible teams */}
      <div style={st.section}>
        <div style={st.sectionLabel}>Eligible teams <span style={st.hint}>— checking a team adds a "TRC Fundraising Opportunities" line to its budget</span></div>
        <div style={st.teamList}>
          {cfg.all_teams.map((t) => {
            const on = eligibleIds.has(t.team_season_id);
            const exp = cfg.eligible_teams.find((e) => e.team_season_id === t.team_season_id)?.expected_amount;
            return (
              <div key={t.team_season_id} style={st.teamRow}>
                <label style={st.teamCheck}>
                  <input type="checkbox" checked={on} disabled={busy === "teams"}
                    onChange={(e) => toggleTeam(t.team_season_id, e.target.checked)} />
                  <span>{t.label}</span>
                </label>
                {on && (
                  <span style={st.expWrap}>
                    <span style={st.expLabel}>Expected $</span>
                    <input style={st.expInput} type="number" step="0.01" defaultValue={exp ?? ""}
                      onBlur={(e) => saveExpected(t.team_season_id, e.target.value)} />
                  </span>
                )}
              </div>
            );
          })}
          {cfg.all_teams.length === 0 && <p style={st.muted}>No active teams found.</p>}
        </div>
      </div>

      {/* Calculate + Finalize */}
      <div style={st.actions}>
        <button style={st.btnCalc} disabled={busy === "calc"} onClick={calculate}>
          <Calculator size={14} /> Calculate Hourly
        </button>
        <button style={st.btnFinal} disabled={busy === "final"} onClick={finalize}>
          <CheckCircle size={14} /> Finalize Contributions
        </button>
        <div style={st.rateBox}>
          <div><strong>${cfg.hourly_rate.toFixed(2)}</strong>/youth-hr</div>
          <div style={st.rateSub}>{cfg.total_youth_hours} youth hrs{cfg.finalized_at ? " · finalized" : ""}</div>
        </div>
      </div>

      {cfg.held_count > 0 && (
        <div style={st.heldWarn}>
          <AlertTriangle size={14} /> {cfg.held_count} youth {cfg.held_count === 1 ? "is" : "are"} on multiple eligible teams and
          must choose where their earnings go (they'll see an "Apply Earnings" prompt). Their funds are held until they choose.
        </div>
      )}
      {(cfg.unassigned_count ?? 0) > 0 && (
        <div style={st.heldWarn}>
          <AlertTriangle size={14} /> {cfg.unassigned_count} youth earned hours but {cfg.unassigned_count === 1 ? "is" : "are"} not on
          any eligible team (e.g. a graduating senior). Their money isn't lost — use <strong>Assign</strong> on their row to credit
          it to the team they earned it for. Once assigned, it stays with that team.
        </div>
      )}

      {/* Roster */}
      <div style={st.section}>
        <div style={st.sectionLabel}><Users size={13} style={{ verticalAlign: -2 }} /> Youth earnings ({cfg.roster.length})</div>
        {cfg.roster.length === 0 ? <p style={st.muted}>No youth check-in hours recorded yet.</p> : (
          <table style={st.table}>
            <thead><tr>
              <th style={st.th}>Youth</th><th style={st.thNum}>Hours</th><th style={st.thNum}>Earned</th>
              <th style={st.th}>Goes to</th>
            </tr></thead>
            <tbody>
              {cfg.roster.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.member_id}>
                    <td style={st.td}>{r.name}</td>
                    <td style={st.tdNum}>{r.hours}</td>
                    <td style={st.tdNum}>{r.status === "held" ? "TBD" : `$${r.earned.toFixed(2)}`}</td>
                    <td style={st.td}>
                      <span style={{ ...st.badge, color: meta?.color ?? "#888", background: meta?.bg ?? "#f1f3f5" }}>{meta?.label ?? r.status}</span>
                      {r.team_labels.length > 0 && <span style={st.teamNames}> {r.team_labels.join(", ")}</span>}
                      {(r.status === "held" || r.status === "chosen" || r.status === "unassigned" || r.status === "locked") && (
                        <button style={st.changeBtn} onClick={() => setEditRow(r)}
                          title="Choose / change which team(s) this youth's earnings go to">
                          <Pencil size={11} /> {r.status === "held" || r.status === "unassigned" ? "Assign" : "Change"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editRow && (
        <ApplyEarningsModal
          eventId={eventId}
          eventName={cfg.event_name}
          memberId={editRow.member_id}
          subjectName={editRow.name}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); load(); }}
        />
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 16, borderTop: "3px solid #2e7d32" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  refresh: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#555" },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "7px 12px", color: "#2e7d32", fontSize: 13, marginBottom: 10 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8 },
  hint: { fontWeight: 400, color: "#aaa" },
  amountRow: { display: "flex", alignItems: "center", gap: 8 },
  dollar: { fontSize: 16, color: "#888", fontWeight: 700 },
  amountInput: { width: 160, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  teamList: { display: "flex", flexDirection: "column", gap: 6 },
  teamRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 10px", border: "1px solid #eef2f6", borderRadius: 7 },
  teamCheck: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#333", cursor: "pointer" },
  expWrap: { display: "flex", alignItems: "center", gap: 5, flexShrink: 0 },
  expLabel: { fontSize: 12, color: "#888" },
  expInput: { width: 90, padding: "5px 7px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, textAlign: "right" },
  actions: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  btnPrimary: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  btnCalc: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  btnFinal: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  rateBox: { marginLeft: "auto", textAlign: "right", fontSize: 14, color: "#1a3a5c" },
  rateSub: { fontSize: 11, color: "#888" },
  heldWarn: { display: "flex", alignItems: "flex-start", gap: 8, background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 7, padding: "9px 12px", color: "#8a6d00", fontSize: 13, marginBottom: 14, lineHeight: 1.5 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "5px 8px", borderBottom: "1px solid #e2e8f0" },
  thNum: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "5px 8px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "6px 8px", borderBottom: "1px solid #f4f6fa", color: "#333" },
  tdNum: { padding: "6px 8px", borderBottom: "1px solid #f4f6fa", textAlign: "right", color: "#333", whiteSpace: "nowrap" },
  badge: { padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
  teamNames: { fontSize: 12, color: "#666", marginLeft: 6 },
  changeBtn: { display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 8, padding: "2px 8px", background: "#fff", color: "#1565c0", border: "1px solid #c5cae9", borderRadius: 10, cursor: "pointer", fontSize: 11, fontWeight: 600 },
  muted: { fontSize: 13, color: "#aaa", margin: "6px 0" },
  benefitsBadge: { marginLeft: 10, padding: "2px 9px", borderRadius: 10, fontSize: 10.5, fontWeight: 700, color: "#00695c", background: "#e0f2f1", textTransform: "none", letterSpacing: 0 },
  benefitsNote: { background: "#e0f2f1", border: "1px solid #80cbc4", borderRadius: 7, padding: "8px 12px", color: "#00695c", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 },
};
