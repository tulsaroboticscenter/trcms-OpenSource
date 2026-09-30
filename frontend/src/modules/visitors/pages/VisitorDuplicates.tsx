/**
 * VisitorDuplicates — cleanup for import duplicates. Lists unconverted visitors that
 * appear to already be a member (matched on email, or name + birthday) and lets you
 * merge each into the existing member in one click: the visitor is linked (hidden but
 * kept for conversion tracking), their night preference + waitlist follow, and any blank
 * member fields are filled from the visitor.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { visitorsApi, type VisitorMemberMatch, type VisitorPair } from "../api";
import { ArrowLeft, RefreshCw, GitMerge, CheckCircle } from "lucide-react";

export default function VisitorDuplicates() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<VisitorMemberMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairs, setPairs] = useState<VisitorPair[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [merged, setMerged] = useState(0);

  function load() {
    setLoading(true);
    Promise.all([
      visitorsApi.duplicateMembers().then((d) => setMatches(d.matches)).catch(() => setMatches([])),
      visitorsApi.duplicateVisitors().then((d) => setPairs(d.pairs)).catch(() => setPairs([])),
    ]).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function mergePair(p: VisitorPair) {
    if (!window.confirm(`Merge duplicate visitor ${p.dup_name} (#${p.dup_number}) into ${p.keep_name} (#${p.keep_number})?\n\nThe duplicate's interactions, waitlist entry and night preference move to the kept visitor, blank fields are filled in, and the duplicate record is removed.`)) return;
    setBusy(p.dup_id);
    try {
      await visitorsApi.mergeVisitor(p.dup_id, p.keep_id);
      setPairs((xs) => xs.filter((x) => x.dup_id !== p.dup_id && x.keep_id !== p.dup_id));
      setMerged((n) => n + 1);
    } catch {
      alert("Could not merge. Please try again.");
    } finally { setBusy(null); }
  }

  async function merge(m: VisitorMemberMatch) {
    if (!window.confirm(`Merge visitor ${m.visitor_name} into member ${m.member_name} (#${m.member_number})?\n\nThe visitor is linked and hidden (kept for conversion tracking); their night preference and any waitlist entry move to the member, and blank member fields are filled from the visitor. No new member is created.`)) return;
    setBusy(m.visitor_id);
    try {
      await visitorsApi.markConverted(m.visitor_id, m.member_id);
      // Drop every row for this visitor (a visitor can match more than one member).
      setMatches((xs) => xs.filter((x) => x.visitor_id !== m.visitor_id));
      setMerged((n) => n + 1);
    } catch {
      alert("Could not merge. Please try again.");
    } finally { setBusy(null); }
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => navigate("/visitors")} style={s.back}><ArrowLeft size={14} /> Visitors</button>
        <button onClick={load} style={s.refresh}><RefreshCw size={13} /> Refresh</button>
      </div>
      <h1 style={s.h1}>Possible Duplicate Visitors</h1>
      <p style={s.sub}>
        Cleanup for import duplicates. <strong>Same person entered twice</strong> merges one visitor into the other.
        <strong> Already a member</strong> merges a visitor into the existing member (kept for conversion tracking).
        Matched by email, or name + birthday.
      </p>
      {merged > 0 && <div style={s.mergedNote}><CheckCircle size={14} /> {merged} merged this session.</div>}

      {loading ? <p style={s.muted}>Loading…</p> : matches.length === 0 && pairs.length === 0 ? (
        <div style={s.empty}>🎉 No duplicates found.</div>
      ) : (<>

        {pairs.length > 0 && (
          <>
            <h2 style={s.h2}>Same person entered twice ({pairs.length})</h2>
            <div style={s.list}>
              {pairs.map((p) => (
                <div key={`${p.keep_id}-${p.dup_id}`} style={s.row}>
                  <div style={{ flex: 1 }}>
                    <div><strong>Keep:</strong> {p.keep_name} <span style={s.tag}>#{p.keep_number}</span></div>
                    <div style={s.small}>{p.keep_email || "no email"}</div>
                  </div>
                  <div style={s.arrow}>⟵</div>
                  <div style={{ flex: 1 }}>
                    <div><strong>Duplicate:</strong> {p.dup_name} <span style={s.tag}>#{p.dup_number}</span></div>
                    <div style={s.small}>matched on {p.matched_on}</div>
                  </div>
                  <button style={s.mergeBtn} disabled={busy === p.dup_id} onClick={() => mergePair(p)}>
                    <GitMerge size={13} /> {busy === p.dup_id ? "Merging…" : "Merge"}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {matches.length > 0 && <h2 style={s.h2}>Already a member ({matches.length})</h2>}
        <div style={s.list}>
          {matches.map((m) => (
            <div key={`${m.visitor_id}-${m.member_id}`} style={s.row}>
              <div style={{ flex: 1 }}>
                <div><strong>{m.visitor_name}</strong> <span style={s.tag}>Visitor #{m.visitor_number}</span></div>
                <div style={s.small}>{m.visitor_email || "no email"}</div>
              </div>
              <div style={s.arrow}>→</div>
              <div style={{ flex: 1 }}>
                <div>
                  <button style={s.link} onClick={() => navigate(`/members/${m.member_id}`)}>{m.member_name}</button>
                  <span style={s.tag}>#{m.member_number} · {m.member_type}</span>
                </div>
                <div style={s.small}>matched on {m.matched_on}</div>
              </div>
              <button style={s.mergeBtn} disabled={busy === m.visitor_id} onClick={() => merge(m)}>
                <GitMerge size={13} /> {busy === m.visitor_id ? "Merging…" : "Merge"}
              </button>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, padding: 0 },
  refresh: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  h1: { margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  h2: { margin: "18px 0 8px", fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 13.5, margin: "0 0 14px", lineHeight: 1.5 },
  mergedNote: { display: "flex", alignItems: "center", gap: 6, background: "#e6f4ea", border: "1px solid #a5d6a7", borderRadius: 8, padding: "8px 12px", color: "#1b5e20", fontSize: 13, marginBottom: 12 },
  muted: { color: "#94a3b8", fontSize: 14 },
  empty: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "2rem", textAlign: "center", color: "#556", fontSize: 15 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  arrow: { color: "#94a3b8", fontSize: 18, flexShrink: 0 },
  tag: { fontSize: 11, color: "#64748b", marginLeft: 6 },
  small: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  link: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0 },
  mergeBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 },
};
