import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Users, Download, AlertTriangle } from "lucide-react";
import { reportsApi, type ActiveMembersReport as Data, type Bucket } from "../api";

const PALETTE = ["#1a3a5c", "#2e7d32", "#e65100", "#6a1b9a", "#00838f", "#c62828", "#f9a825", "#455a64", "#ad1457", "#5d4037"];

export default function ActiveMembersReport() {
  const goBack = useGoBack("/reports");
  const navigate = useNavigate();
  const { canRead } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    reportsApi.getActiveMembers()
      .then(setData)
      .catch(() => setErr("Failed to load the active-members report."))
      .finally(() => setLoading(false));
  }, []);

  function exportCsv() {
    if (!data) return;
    const rows: string[] = ["Category,Group,Count"];
    const add = (cat: string, b: Bucket[]) => b.forEach(x => rows.push(`"${cat}","${x.label}",${x.count}`));
    rows.push(`"Total","Active members (youth & mentors)",${data.total_active}`);
    rows.push(`"Total","Inactive members",${data.inactive_count}`);
    rows.push(`"Total","Archived members",${data.archived_count}`);
    if (data.alumni_count !== undefined) rows.push(`"Total","Alumni (excluded)",${data.alumni_count}`);
    add("Member type", data.by_member_type);
    add("Supporting (not counted)", data.supporting);
    add("Program", data.by_program);
    add("Gender", data.by_sex);
    add("Race / ethnicity", data.by_race);
    add("Age band", data.by_age_band);
    add("Free/reduced lunch (youth)", data.by_frl_youth);
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "active-members-report.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function exportMissingCsv() {
    const list = data?.missing_demographics ?? [];
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const rows = ["Name,Member #,Type,Missing Gender,Missing Race,Missing Birthday"];
    list.forEach(m => rows.push([esc(m.name), esc(m.member_number ?? ""), esc(m.member_type),
      m.missing_sex ? "Yes" : "", m.missing_race ? "Yes" : "", m.missing_birthday ? "Yes" : ""].join(",")));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "missing-gender-race.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <button onClick={goBack} style={S.back}><ArrowLeft size={15} /> Back to Reports</button>

      <div style={S.header}>
        <div>
          <h1 style={S.h1}><Users size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Active Members</h1>
          <p style={S.sub}>Active <strong>Youth &amp; Mentors</strong> — headcount and demographics for the business plan. Parents, volunteers, and others are shown separately below and are not counted as members. Excludes inactive, archived, and alumni.</p>
        </div>
        {data && canRead("reports.export") && <button onClick={exportCsv} style={S.csv}><Download size={15} /> Export CSV</button>}
      </div>

      {loading && <p style={S.muted}>Loading…</p>}
      {err && <p style={{ ...S.muted, color: "#c62828" }}>{err}</p>}

      {data && (
        <>
          <div style={S.heroRow}>
            <div style={S.hero}>
              <div style={S.heroNum}>{data.total_active}</div>
              <div style={S.heroLabel}>Active members (Youth &amp; Mentors)</div>
            </div>
            {data.by_member_type.map((b, i) => (
              <div key={b.label} style={S.stat}>
                <div style={{ ...S.statNum, color: PALETTE[i % PALETTE.length] }}>{b.count}</div>
                <div style={S.statLabel}>{cap(b.label)}{b.label === "youth" ? "" : "s"}</div>
              </div>
            ))}
            <div style={S.stat}>
              <div style={{ ...S.statNum, color: "#757575" }}>{data.inactive_count}</div>
              <div style={S.statLabel}>Inactive</div>
            </div>
            <div style={S.stat}>
              <div style={{ ...S.statNum, color: "#757575" }}>{data.archived_count}</div>
              <div style={S.statLabel}>Archived</div>
            </div>
            {data.alumni_count !== undefined && (
              <div style={S.stat}>
                <div style={{ ...S.statNum, color: "#757575" }}>{data.alumni_count}</div>
                <div style={S.statLabel}>Alumni</div>
              </div>
            )}
          </div>

          {data.supporting.length > 0 && (
            <div style={S.supportBox}>
              <span style={S.supportTitle}>Supporting participants (not counted as members):</span>
              {data.supporting.map((b) => (
                <span key={b.label} style={S.supportChip}><strong>{b.count}</strong> {b.label}{b.label.toLowerCase().endsWith("s") ? "" : "s"}</span>
              ))}
            </div>
          )}

          <div style={S.grid}>
            <ChartCard title="Gender" data={data.by_sex} donut />
            <ChartCard title="Race / Ethnicity" data={data.by_race} donut />
            <ChartCard title="Age" data={data.by_age_band} />
            <ChartCard title="Program" data={data.by_program} />
            <ChartCard title="Member Type" data={data.by_member_type} />
            <ChartCard title="Free / Reduced Lunch (youth)" data={data.by_frl_youth} donut
              empty="No economic-eligibility data recorded yet." />
          </div>

          {/* Work list: who still needs Gender / Race filled in */}
          {(() => {
            const missing = data.missing_demographics ?? [];
            return (
              <div style={S.missingCard}>
                <div style={S.missingHead}>
                  <h3 style={S.cardTitle}>
                    <AlertTriangle size={16} color="#e65100" style={{ verticalAlign: -3, marginRight: 6 }} />
                    Missing Gender / Race / Birthday {missing.length > 0 && <span style={S.missingCount}>{missing.length}</span>}
                  </h3>
                  {missing.length > 0 && canRead("reports.export") && (
                    <button onClick={exportMissingCsv} style={S.miniCsv}><Download size={13} /> Export list</button>
                  )}
                </div>
                {missing.length === 0 ? (
                  <p style={S.emptyNote}>Every active member has gender, race, and birthday on file. 🎉</p>
                ) : (
                  <>
                    <p style={S.missingSub}>Active members still missing this info — click a name to update their profile.</p>
                    <div style={S.missingList}>
                      {missing.map(m => (
                        <div key={m.member_id} style={S.missingRow} onClick={() => navigate(`/members/${m.member_id}`)}>
                          <span style={S.missingName}>{m.name}<span style={S.missingType}>{m.member_type}</span></span>
                          <span style={S.missingTags}>
                            {m.missing_sex && <span style={S.missingTag}>Gender</span>}
                            {m.missing_race && <span style={S.missingTag}>Race</span>}
                            {m.missing_birthday && <span style={S.missingTag}>Birthday</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <p style={S.note}>
            Charts reflect the data on file. Blank fields show as “Not specified” — fill them in on member
            profiles to sharpen these breakdowns. Generated {new Date(data.generated_at).toLocaleString()}.
          </p>
        </>
      )}
    </div>
  );
}

function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function ChartCard({ title, data, donut, empty }: { title: string; data: Bucket[]; donut?: boolean; empty?: string }) {
  const total = data.reduce((s, b) => s + b.count, 0);
  const meaningful = data.filter(b => b.label !== "Not specified" && b.label !== "Unknown");
  return (
    <div style={S.card}>
      <h3 style={S.cardTitle}>{title}</h3>
      {total === 0 || meaningful.length === 0
        ? <p style={S.emptyNote}>{empty ?? "No data recorded yet."}</p>
        : donut ? <Donut data={data} total={total} /> : <Bars data={data} total={total} />}
    </div>
  );
}

function Bars({ data, total }: { data: Bucket[]; total: number }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {data.map((b, i) => (
        <div key={b.label}>
          <div style={S.barRow}>
            <span style={S.barLabel}>{b.label}</span>
            <span style={S.barVal}>{b.count} <span style={S.pct}>({pct(b.count, total)})</span></span>
          </div>
          <div style={S.track}>
            <div style={{ ...S.fill, width: `${(b.count / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Donut({ data, total }: { data: Bucket[]; total: number }) {
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = data.map((b, i) => {
    const frac = b.count / total;
    const seg = { color: PALETTE[i % PALETTE.length], dash: frac * C, offset: -offset * C, label: b.label, count: b.count, frac };
    offset += frac;
    return seg;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <svg width={130} height={130} viewBox="0 0 130 130">
        <g transform="rotate(-90 65 65)">
          {segs.map((s) => (
            <circle key={s.label} cx={65} cy={65} r={R} fill="none" stroke={s.color} strokeWidth={20}
              strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={s.offset} />
          ))}
        </g>
        <text x={65} y={62} textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "#1a3a5c" }}>{total}</text>
        <text x={65} y={80} textAnchor="middle" style={{ fontSize: 10, fill: "#889" }}>total</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 130 }}>
        {segs.map((s) => (
          <div key={s.label} style={S.legend}>
            <span style={{ ...S.dot, background: s.color }} />
            <span style={S.legendLabel}>{s.label}</span>
            <span style={S.legendVal}>{s.count} <span style={S.pct}>({pct(s.count, total)})</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function pct(n: number, total: number) { return total ? `${Math.round((n / total) * 100)}%` : "0%"; }

const S: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, marginBottom: 14, padding: 0 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 },
  h1: { fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 0", maxWidth: 640 },
  csv: { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  muted: { color: "#889", fontSize: 14 },
  heroRow: { display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 },
  hero: { flex: "1 1 200px", background: "linear-gradient(135deg,#1a3a5c,#2c5680)", color: "#fff", borderRadius: 12, padding: "18px 22px" },
  heroNum: { fontSize: 44, fontWeight: 800, lineHeight: 1 },
  heroLabel: { fontSize: 13, opacity: 0.9, marginTop: 4 },
  stat: { flex: "1 1 120px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" },
  statNum: { fontSize: 34, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 12.5, color: "#667", marginTop: 5 },
  supportBox: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: "#f7f9fc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", margin: "14px 0 4px" },
  supportTitle: { fontSize: 12.5, fontWeight: 700, color: "#556" },
  supportChip: { fontSize: 13, color: "#37474f", background: "#fff", border: "1px solid #dce4ee", borderRadius: 14, padding: "3px 11px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18 },
  cardTitle: { fontSize: 14.5, fontWeight: 700, color: "#1a3a5c", margin: "0 0 14px" },
  emptyNote: { color: "#99a", fontSize: 13, fontStyle: "italic", margin: 0 },
  barRow: { display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 },
  barLabel: { color: "#334155" },
  barVal: { color: "#1a3a5c", fontWeight: 600 },
  pct: { color: "#99a", fontWeight: 400 },
  track: { height: 9, background: "#eef2f7", borderRadius: 5, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5, transition: "width .3s" },
  legend: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  legendLabel: { color: "#334155", flex: 1 },
  legendVal: { color: "#1a3a5c", fontWeight: 600 },
  note: { color: "#99a", fontSize: 12, marginTop: 18, lineHeight: 1.5 },
  missingCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginTop: 16 },
  missingHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  missingCount: { fontSize: 12, fontWeight: 700, color: "#fff", background: "#e65100", borderRadius: 12, padding: "1px 9px", marginLeft: 4 },
  miniCsv: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#1a3a5c", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  missingSub: { color: "#667", fontSize: 12.5, margin: "6px 0 12px" },
  missingList: { display: "flex", flexDirection: "column", gap: 2 },
  missingRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "7px 10px", borderRadius: 7, cursor: "pointer", fontSize: 13.5 },
  missingName: { color: "#1a3a5c", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 },
  missingType: { fontSize: 10.5, color: "#8b98a6", textTransform: "capitalize", fontWeight: 500 },
  missingTags: { display: "flex", gap: 5 },
  missingTag: { fontSize: 11, fontWeight: 700, color: "#e65100", background: "#fff3e6", borderRadius: 5, padding: "2px 8px" },
};
