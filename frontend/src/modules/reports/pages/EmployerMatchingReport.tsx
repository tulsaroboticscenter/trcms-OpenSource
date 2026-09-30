/**
 * EmployerMatchingReport — adults (parents/mentors/volunteers) grouped by employer, showing
 * which employers offer corporate philanthropy TRC can tap: donation matching, volunteer
 * grants ("Dollars for Doers"), or grants a nonprofit can apply for. This is what turns the
 * employer info collected on profiles into actual fundraising leads. Gated on
 * members.view_employer (the page shows an access-denied state otherwise).
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { reportsApi, type EmployerMatchingRow } from "../api";
import { Building2, HandCoins, Clock, FileText, Check } from "lucide-react";

const OFFER: Record<string, { label: string; color: string }> = {
  yes: { label: "Yes", color: "#2e7d32" },
  no: { label: "No", color: "#b0b7c0" },
  unsure: { label: "Not sure", color: "#a86a00" },
};
const offer = (v: string | null) => (v ? OFFER[v] ?? { label: v, color: "#667" } : { label: "—", color: "#b0b7c0" });

export default function EmployerMatchingReport() {
  const [rows, setRows] = useState<EmployerMatchingRow[] | null>(null);
  const [onlyOffers, setOnlyOffers] = useState(true);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setDenied(false);
    reportsApi.getEmployerMatching(onlyOffers)
      .then((d) => setRows(d.people))
      .catch((e) => { if ((e as { response?: { status?: number } })?.response?.status === 403) setDenied(true); setRows([]); })
      .finally(() => setLoading(false));
  }, [onlyOffers]);
  useEffect(() => { load(); }, [load]);

  // Group people under their employer so a company with several TRC families reads as one lead.
  const groups = useMemo(() => {
    const m = new Map<string, EmployerMatchingRow[]>();
    for (const r of rows ?? []) {
      const key = r.employer_name.trim();
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  // Count employers offering each program type, across the (deduped) employer groups.
  const stats = useMemo(() => {
    let match = 0, vol = 0, grant = 0;
    for (const [, people] of groups) {
      if (people.some((p) => p.matches_donations === "yes")) match++;
      if (people.some((p) => p.volunteer_grants === "yes")) vol++;
      if (people.some((p) => p.offers_grants === "yes")) grant++;
    }
    return { employers: groups.length, match, vol, grant };
  }, [groups]);

  if (denied) return <div style={s.wrap}><h1 style={s.h1}>Employer Matching & Grants</h1><div style={s.denied}>You don't have permission to view employer information. Ask an administrator for the “View Employer &amp; Matching-Gift Info” permission.</div></div>;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}><Building2 size={22} style={{ verticalAlign: -4 }} /> Employer Matching &amp; Grants</h1>
          <p style={s.sub}>Parents, mentors, and volunteers whose employers may match donations, give volunteer grants, or fund grants — your warm list for corporate giving.</p>
        </div>
        <label style={s.toggle}><input type="checkbox" checked={onlyOffers} onChange={(e) => setOnlyOffers(e.target.checked)} /> Only employers that offer something</label>
      </div>

      <div style={s.stats}>
        <Stat icon={<Building2 size={18} />} n={stats.employers} label="Employers" color="#1a3a5c" />
        <Stat icon={<HandCoins size={18} />} n={stats.match} label="Match donations" color="#2e7d32" />
        <Stat icon={<Clock size={18} />} n={stats.vol} label="Volunteer grants" color="#1565c0" />
        <Stat icon={<FileText size={18} />} n={stats.grant} label="Offer grants" color="#6a1b9a" />
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : groups.length === 0 ? (
        <p style={s.muted}>
          {onlyOffers
            ? "No employers are marked “Yes” for matching, volunteer grants, or grants yet — but people may have shared where they work without knowing the answer. Uncheck “Only employers that offer something” above to see everyone who's added an employer."
            : "No employer information recorded yet. Parents and mentors can add it on their profile under “Employer & Matching Gifts.”"}
        </p>
      ) : (
        <div style={s.list}>
          {groups.map(([employer, people]) => {
            const rep = people[0]; // program info/flags are per-person; show the group's first as the summary
            return (
              <div key={employer} style={s.card}>
                <div style={s.cardHead}>
                  <span style={s.employer}>{employer}</span>
                  <span style={s.people}>{people.length} {people.length === 1 ? "person" : "people"}</span>
                </div>
                <div style={s.flags}>
                  <Flag label="Donation match" v={rep.matches_donations} />
                  <Flag label="Volunteer grants" v={rep.volunteer_grants} />
                  <Flag label="Grants" v={rep.offers_grants} />
                  {people.some((p) => p.matching_help) && <span style={s.help}><Check size={12} /> Someone will help</span>}
                </div>
                {rep.program_info && <div style={s.program}>{rep.program_info}</div>}
                <div style={s.names}>
                  {people.map((p) => (
                    <span key={p.member_id} style={s.name}>
                      {p.first_name} {p.last_name}
                      <span style={s.type}>{p.member_type}</span>
                      {p.employer_job_title ? <span style={s.title}> · {p.employer_job_title}</span> : null}
                    </span>
                  ))}
                </div>
                {people.some((p) => p.notes) && (
                  <div style={s.notes}>{people.filter((p) => p.notes).map((p) => `${p.first_name}: ${p.notes}`).join(" · ")}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, n, label, color }: { icon: React.ReactNode; n: number; label: string; color: string }) {
  return <div style={s.stat}><div style={{ color }}>{icon}</div><div style={{ ...s.statN, color }}>{n}</div><div style={s.statL}>{label}</div></div>;
}
function Flag({ label, v }: { label: string; v: string | null }) {
  const o = offer(v);
  return <span style={{ ...s.flag, color: o.color, borderColor: o.color + "55" }}>{label}: <strong>{o.label}</strong></span>;
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto", padding: "16px 18px" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { fontSize: 13, color: "#778", margin: "6px 0 0", maxWidth: 620, lineHeight: 1.5 },
  toggle: { fontSize: 13, color: "#445", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", marginTop: 6 },
  stats: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, margin: "16px 0" },
  stat: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", textAlign: "center" },
  statN: { fontSize: 24, fontWeight: 800 },
  statL: { fontSize: 11.5, color: "#778", marginTop: 2 },
  muted: { color: "#889", fontSize: 14 },
  denied: { background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 8, padding: "14px 16px", color: "#8a5a00", fontSize: 14, marginTop: 12 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 },
  cardHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  employer: { fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  people: { fontSize: 12, color: "#889" },
  flags: { display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" },
  flag: { fontSize: 12, border: "1px solid", borderRadius: 12, padding: "2px 9px" },
  help: { fontSize: 12, color: "#2e7d32", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 },
  program: { fontSize: 12.5, color: "#334", background: "#f7fafc", borderRadius: 7, padding: "7px 10px", margin: "2px 0 8px", wordBreak: "break-word" },
  names: { display: "flex", flexWrap: "wrap", gap: "4px 14px" },
  name: { fontSize: 13, color: "#334" },
  type: { fontSize: 10.5, color: "#8a97a5", textTransform: "uppercase", marginLeft: 5, letterSpacing: 0.3 },
  title: { color: "#889" },
  notes: { fontSize: 12, color: "#667", marginTop: 8, fontStyle: "italic" },
};
