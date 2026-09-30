import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, MailX, MailCheck, ArrowLeft } from "lucide-react";
import { commsApi, type Subscriber } from "../api";

/**
 * Staff view of the mailing list — the volunteers and newsletter contacts who signed up
 * without creating an account (from the public volunteer form). Members are managed on the
 * roster, so they aren't listed here. Email the list from Communications → Compose by
 * ticking "Mailing list" in the recipient builder.
 */
export default function MailingList() {
  const [rows, setRows] = useState<Subscriber[]>([]);
  const [active, setActive] = useState(0);
  const [unsub, setUnsub] = useState(0);
  const [search, setSearch] = useState("");
  const [includeUnsub, setIncludeUnsub] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await commsApi.listSubscribers({ search: search || undefined, include_unsubscribed: includeUnsub ? 1 : 0 });
      setRows(r.subscribers); setActive(r.active); setUnsub(r.unsubscribed);
    } finally { setLoading(false); }
  }, [search, includeUnsub]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function toggle(s: Subscriber) {
    await commsApi.setSubscribed(s.id, !s.subscribed);
    load();
  }

  return (
    <div style={st.wrap}>
      <Link to="/communications" style={st.back}><ArrowLeft size={15} /> Communications</Link>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}>Mailing List</h1>
          <p style={st.sub}>Volunteers &amp; newsletter contacts who signed up without an account.</p>
        </div>
        <div style={st.stats}>
          <div style={st.stat}><div style={st.statNum}>{active}</div><div style={st.statLbl}>Subscribed</div></div>
          <div style={st.stat}><div style={{ ...st.statNum, color: "#888" }}>{unsub}</div><div style={st.statLbl}>Unsubscribed</div></div>
        </div>
      </div>

      <div style={st.tip}>To email this list, go to <Link to="/communications/compose" style={st.tipLink}>Compose</Link> and tick <strong>Mailing list</strong> under recipients.</div>

      <div style={st.controls}>
        <div style={st.searchBox}>
          <Search size={15} color="#889" />
          <input style={st.searchIn} placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label style={st.tog}><input type="checkbox" checked={includeUnsub} onChange={(e) => setIncludeUnsub(e.target.checked)} /> Show unsubscribed</label>
      </div>

      {loading ? <p style={st.muted}>Loading…</p> : rows.length === 0 ? (
        <p style={st.muted}>No subscribers{search ? " match your search" : " yet"}.</p>
      ) : (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Name</th><th style={st.th}>Email</th><th style={st.th}>Phone</th>
                <th style={st.th}>Interests</th><th style={st.th}>Signed up</th><th style={st.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} style={{ opacity: s.subscribed ? 1 : 0.55 }}>
                  <td style={st.td}>{s.name}</td>
                  <td style={st.td}>{s.email}</td>
                  <td style={st.td}>{s.phone || "—"}</td>
                  <td style={st.td}>{s.interests.length ? s.interests.join(", ") : "—"}</td>
                  <td style={st.td}>{s.created_at ? s.created_at.slice(0, 10) : "—"}</td>
                  <td style={st.td}>
                    <button type="button" style={s.subscribed ? st.unsubBtn : st.resubBtn} onClick={() => toggle(s)}>
                      {s.subscribed ? <><MailX size={13} /> Unsubscribe</> : <><MailCheck size={13} /> Resubscribe</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1000, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 5, color: "#1565c0", textDecoration: "none", fontSize: 13, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 12 },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#889" },
  stats: { display: "flex", gap: 20 },
  stat: { textAlign: "center" as const },
  statNum: { fontSize: 24, fontWeight: 800, color: "#1a3a5c", lineHeight: 1 },
  statLbl: { fontSize: 11, color: "#889", fontWeight: 600, marginTop: 3 },
  tip: { background: "#f3f8ff", border: "1px solid #cfe0f3", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#33475b", marginBottom: 14 },
  tipLink: { color: "#1565c0", fontWeight: 600, textDecoration: "none" },
  controls: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
  searchBox: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #cdd7e3", borderRadius: 8, padding: "6px 10px", background: "#fff", flex: 1, minWidth: 220 },
  searchIn: { border: "none", outline: "none", fontSize: 13.5, flex: 1, background: "transparent" },
  tog: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334", cursor: "pointer" },
  muted: { color: "#889", fontSize: 14, padding: "12px 2px" },
  tableWrap: { overflowX: "auto" as const, border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { textAlign: "left" as const, padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", whiteSpace: "nowrap" as const },
  td: { padding: "10px 12px", color: "#33475b", borderBottom: "1px solid #f4f6fa", verticalAlign: "top" as const },
  unsubBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #f0c2c2", color: "#c62828", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" as const },
  resubBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #b6d7c0", color: "#2e7d32", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" as const },
};
