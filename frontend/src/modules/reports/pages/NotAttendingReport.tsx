import { useEffect, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Download, UserX } from "lucide-react";
import { reportsApi, type NotCheckedInResult } from "../api";

/** Re-engagement report: active members with NO check-in over the window. */
export default function NotAttendingReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [youthOnly, setYouthOnly] = useState(true);
  const [data, setData] = useState<NotCheckedInResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true); setErr("");
    reportsApi.getNotCheckedIn({ fromDate: from, toDate: to, includeMentors: !youthOnly })
      .then(setData)
      .catch(() => setErr("Could not load the report."))
      .finally(() => setLoading(false));
  }, [from, to, youthOnly]);

  function exportCsv() {
    if (!data) return;
    const head = ["Last", "First", "Type", "Last check-in", "Days since", "Email", "Phone", "Guardian", "Guardian email", "Guardian phone"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const m of data.members) {
      lines.push([m.last_name, m.first_name, m.member_type, m.last_checkin ?? "Never", m.days_since ?? "", m.email, m.phone, m.guardian1_name, m.guardian1_email, m.guardian1_phone].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "not_attending.csv"; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Reports</button>
      <div style={st.head}>
        <div>
          <h1 style={st.heading}><UserX size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Not Attending</h1>
          <p style={st.sub}>Active members who did <strong>not</strong> check in at all during the period — for “we've been missing you” follow‑ups. Sorted by longest absent (never‑attended at the top).</p>
        </div>
        {data && data.members.length > 0 && canRead("reports.export") && <button style={st.csvBtn} onClick={exportCsv}><Download size={14} /> CSV</button>}
      </div>

      <div style={st.controls}>
        <label style={st.field}><span style={st.lbl}>From</span>
          <input type="date" style={st.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={st.field}><span style={st.lbl}>To</span>
          <input type="date" style={st.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label style={st.check}>
          <input type="checkbox" checked={youthOnly} onChange={(e) => setYouthOnly(e.target.checked)} /> Youth only
        </label>
      </div>

      {err && <p style={st.err}>{err}</p>}
      {loading && <p style={st.muted}>Loading…</p>}

      {!loading && data && (
        <>
          <p style={st.count}>{data.members.length} member{data.members.length !== 1 ? "s" : ""} not seen {data.from} → {data.to}</p>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead><tr>
                <th style={st.thL}>Member</th><th style={st.thL}>Type</th>
                <th style={st.thL}>Last check-in</th><th style={st.thR}>Days since</th>
                <th style={st.thL}>Contact</th>
              </tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.member_id}>
                    <td style={st.tdL}>{m.last_name}, {m.first_name}</td>
                    <td style={st.tdMuted}>{m.member_type}</td>
                    <td style={m.last_checkin ? st.tdL : st.tdNever}>{m.last_checkin ?? "Never"}</td>
                    <td style={st.tdR}>{m.days_since ?? "—"}</td>
                    <td style={st.tdContact}>
                      {m.email || m.phone || m.guardian1_email || m.guardian1_phone
                        ? [m.email, m.phone, m.guardian1_name && `${m.guardian1_name} (${m.guardian1_email || m.guardian1_phone || "—"})`].filter(Boolean).join(" · ")
                        : <span style={{ color: "#bbb" }}>—</span>}
                    </td>
                  </tr>
                ))}
                {data.members.length === 0 && <tr><td colSpan={5} style={st.empty}>Everyone checked in during this period. 🎉</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 940, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 16 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#888", maxWidth: 660, lineHeight: 1.5 },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  controls: { display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  check: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#444", paddingBottom: 8 },
  count: { fontSize: 13, color: "#888", margin: "0 0 8px" },
  err: { color: "#c62828", fontSize: 14 },
  muted: { color: "#aaa", fontSize: 14 },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 640 },
  thL: { textAlign: "left", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc", whiteSpace: "nowrap" },
  thR: { textAlign: "right", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc", whiteSpace: "nowrap" },
  tdL: { padding: "9px 14px", fontSize: 14, color: "#1a3a5c", borderBottom: "1px solid #f2f5f8", whiteSpace: "nowrap" },
  tdMuted: { padding: "9px 14px", fontSize: 13, color: "#888", borderBottom: "1px solid #f2f5f8", textTransform: "capitalize", whiteSpace: "nowrap" },
  tdNever: { padding: "9px 14px", fontSize: 13, color: "#c62828", fontWeight: 600, borderBottom: "1px solid #f2f5f8" },
  tdR: { padding: "9px 14px", fontSize: 14, color: "#444", textAlign: "right", borderBottom: "1px solid #f2f5f8", fontVariantNumeric: "tabular-nums" },
  tdContact: { padding: "9px 14px", fontSize: 12, color: "#666", borderBottom: "1px solid #f2f5f8" },
  empty: { padding: 20, textAlign: "center", color: "#888", fontSize: 14 },
};
