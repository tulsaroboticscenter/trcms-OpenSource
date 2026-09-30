/**
 * EnrollmentRolloverModal — the "Create {to} youth enrollments (reviewed)" step of
 * the Season Transition. Loads every prospective new-season enrollment (returning
 * youth carry their program forward; youth with no prior enrollment appear with an
 * empty program), lets an admin promote divisions (FLLe→FLLc, FLLc→FTC…), drop
 * anyone leaving, and set a program for newcomers — then creates them all as
 * "pending" in one pass. Fees preview with the same sibling-discount tiers the
 * server applies; the commit is authoritative.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../core/api";
import { X, UserPlus, Loader2 } from "lucide-react";

interface Program { id: number; name: string; full_name: string | null }
interface Fees { base: number; additional_program: number; second_youth_base: number; third_plus_youth_base: number }
interface PreviewRow {
  member_id: number; name: string; family_id: number | null;
  prior_program_id: number | null; prior_program_name: string | null;
  suggested_program_id: number | null; sibling_rank: number;
  already_enrolled: boolean; needs_program: boolean;
}
interface Preview { to_year: number; from_year: number; to_label: string; from_label: string; fees: Fees; programs: Program[]; rows: PreviewRow[] }

interface RowState extends PreviewRow { programId: number | null; include: boolean }

export default function EnrollmentRolloverModal({ toSeason, onClose, onCommitted }: {
  toSeason: string; onClose: () => void; onCommitted: (msg: string) => void;
}) {
  const toYear = parseInt((toSeason || "").split("-")[0]);
  const [pv, setPv] = useState<Preview | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.post("/api/v1/enrollment/rollover/preview", { to_year: toYear })
      .then((r) => {
        const p: Preview = r.data;
        setPv(p);
        setRows(p.rows.map((x) => ({
          ...x,
          programId: x.suggested_program_id,
          // Default-include returning youth; newcomers (no program) start unchecked.
          include: !x.needs_program && !x.already_enrolled,
        })));
      })
      .catch((e) => setLoadErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not load the roster."));
  }, [toYear]);

  const tier = (fees: Fees, rank: number) =>
    rank >= 3 ? fees.third_plus_youth_base : rank === 2 ? fees.second_youth_base : fees.base;

  // Client-side fee preview mirroring the server: within a family, distinct youth
  // (by member_id) are ranked in id order; each youth's first program is charged the
  // rank-tiered base, any additional program the flat additional-program fee.
  const fees = useMemo(() => {
    if (!pv) return new Map<number, number>();
    const included = rows.filter((r) => r.include && r.programId);
    const famYouth = new Map<string, number[]>();   // family key -> distinct member_ids in id order
    for (const r of included) {
      const key = r.family_id != null ? `f${r.family_id}` : `m${r.member_id}`;
      const arr = famYouth.get(key) ?? [];
      if (!arr.includes(r.member_id)) { arr.push(r.member_id); arr.sort((a, b) => a - b); famYouth.set(key, arr); }
    }
    const firstSeen = new Set<number>();
    const out = new Map<number, number>();
    for (const r of included) {
      const key = r.family_id != null ? `f${r.family_id}` : `m${r.member_id}`;
      const rank = (famYouth.get(key)?.indexOf(r.member_id) ?? 0) + 1;
      const isFirstProgram = !firstSeen.has(r.member_id);
      firstSeen.add(r.member_id);
      out.set(rowKey(r), isFirstProgram ? tier(pv.fees, rank) : pv.fees.additional_program);
    }
    return out;
  }, [rows, pv]);

  const includedCount = rows.filter((r) => r.include && r.programId).length;
  const total = useMemo(() => {
    let t = 0; for (const r of rows) if (r.include && r.programId) t += fees.get(rowKey(r)) ?? 0; return t;
  }, [rows, fees]);

  function setRow(i: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function commit() {
    if (!pv) return;
    setBusy(true);
    try {
      const payload = rows.filter((r) => r.include && r.programId).map((r) => ({ member_id: r.member_id, program_id: r.programId }));
      const { data } = await api.post("/api/v1/enrollment/rollover/commit", { to_year: toYear, rows: payload });
      onCommitted(data.message ?? `Created ${data.created} enrollment(s).`);
    } catch (e) {
      setLoadErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Commit failed.");
      setBusy(false);
    }
  }

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.modal} onClick={(e) => e.stopPropagation()}>
        <div style={m.head}>
          <div>
            <div style={m.title}>Create {pv?.to_label ?? toSeason} youth enrollments</div>
            <div style={m.subtitle}>Review each youth, promote divisions, drop anyone leaving, then create them all as pending.</div>
          </div>
          <button style={m.x} onClick={onClose}><X size={18} /></button>
        </div>

        {loadErr && <div style={m.err}>{loadErr}</div>}
        {!pv && !loadErr && <div style={m.loading}><Loader2 size={18} className="spin" /> Loading roster…</div>}

        {pv && (
          <>
            <div style={m.tableWrap}>
              <table style={m.table}>
                <thead>
                  <tr>
                    <th style={m.th}>Include</th>
                    <th style={m.thL}>Youth</th>
                    <th style={m.thL}>Last season</th>
                    <th style={m.thL}>{pv.to_label} program</th>
                    <th style={m.thR}>Fee (est.)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.member_id}-${r.prior_program_id ?? "x"}`} style={r.include ? undefined : m.trOff}>
                      <td style={m.tdC}>
                        <input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} />
                      </td>
                      <td style={m.td}>
                        {r.name}
                        {r.needs_program && <span style={m.newTag}><UserPlus size={11} /> new</span>}
                        {r.already_enrolled && <span style={m.dupTag}>already enrolled</span>}
                      </td>
                      <td style={m.tdMuted}>{r.prior_program_name ?? "—"}</td>
                      <td style={m.td}>
                        <select style={m.select} value={r.programId ?? ""} onChange={(e) => setRow(i, { programId: e.target.value ? parseInt(e.target.value) : null })}>
                          <option value="">— pick a program —</option>
                          {pv.programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.full_name ? ` · ${p.full_name}` : ""}</option>)}
                        </select>
                      </td>
                      <td style={m.tdR}>{r.include && r.programId ? `$${(fees.get(rowKey(r)) ?? 0).toFixed(0)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={m.footer}>
              <div style={m.summary}><strong>{includedCount}</strong> to create · est. total <strong>${total.toFixed(0)}</strong></div>
              <div style={m.actions}>
                <button style={m.cancel} onClick={onClose} disabled={busy}>Cancel</button>
                <button style={m.create} onClick={commit} disabled={busy || includedCount === 0}>
                  {busy ? <><Loader2 size={14} className="spin" /> Creating…</> : `Create ${includedCount} pending enrollment${includedCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const rowKey = (r: { member_id: number; prior_program_id: number | null }) => r.member_id * 1000 + (r.prior_program_id ?? 0);

const m: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(20,30,45,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, width: "min(760px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 18px", borderBottom: "1px solid #eef2f6" },
  title: { fontSize: 17, fontWeight: 800, color: "#1a3a5c" },
  subtitle: { fontSize: 12.5, color: "#667", marginTop: 3 },
  x: { background: "none", border: "none", cursor: "pointer", color: "#889", padding: 4 },
  err: { margin: "12px 18px 0", padding: "9px 12px", background: "#fdecea", color: "#c62828", borderRadius: 8, fontSize: 13 },
  loading: { display: "flex", alignItems: "center", gap: 8, padding: 24, color: "#667", fontSize: 14 },
  tableWrap: { overflow: "auto", padding: "8px 18px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "center", padding: "7px 8px", color: "#778", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", borderBottom: "1px solid #eef2f6", whiteSpace: "nowrap" },
  thL: { textAlign: "left", padding: "7px 8px", color: "#778", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", borderBottom: "1px solid #eef2f6", whiteSpace: "nowrap" },
  thR: { textAlign: "right", padding: "7px 8px", color: "#778", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", borderBottom: "1px solid #eef2f6", whiteSpace: "nowrap" },
  td: { padding: "7px 8px", borderBottom: "1px solid #f3f6f9", color: "#2a3f55", verticalAlign: "middle" },
  tdC: { padding: "7px 8px", borderBottom: "1px solid #f3f6f9", textAlign: "center" },
  tdMuted: { padding: "7px 8px", borderBottom: "1px solid #f3f6f9", color: "#889" },
  tdR: { padding: "7px 8px", borderBottom: "1px solid #f3f6f9", textAlign: "right", fontWeight: 700, color: "#1a3a5c", whiteSpace: "nowrap" },
  trOff: { opacity: 0.45 },
  select: { padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, maxWidth: 240 },
  newTag: { display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6, padding: "1px 6px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 6, fontSize: 10.5, fontWeight: 700 },
  dupTag: { marginLeft: 6, padding: "1px 6px", background: "#eef1f4", color: "#889", borderRadius: 6, fontSize: 10.5, fontWeight: 700 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: "1px solid #eef2f6", flexWrap: "wrap" },
  summary: { fontSize: 13, color: "#556" },
  actions: { display: "flex", gap: 8 },
  cancel: { padding: "8px 14px", background: "#eef1f4", color: "#445", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  create: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#8e24aa", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
};
