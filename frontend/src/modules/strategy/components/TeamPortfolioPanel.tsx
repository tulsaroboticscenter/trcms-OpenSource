/**
 * TeamPortfolioPanel — the Portfolio tab on a team-season page (Phase 2). Tracks each
 * portfolio PIECE (owner/status/due) toward the FTC Inspire / FRC Impact award; the
 * finished asset is a Canva link stored in the team's Resources section. Also logs
 * all-season captures. Gated by portfolio.view (render) / .contribute / .manage.
 */
import { useEffect, useState, useCallback } from "react";
import { portfolioApi, goalsApi, downloadFile, type TeamPortfolio, type PortfolioPiece, type PieceStatus, type ContentPack,
  SECTION_LABELS, PIECE_STATUS_LABELS, CAPTURE_LABELS } from "../api";
import { Plus, Trash2, ExternalLink, Link2, FileText, Sparkles, NotebookPen, Download, ClipboardCopy, X, ChevronUp, ChevronDown, CalendarClock } from "lucide-react";

const AWARD_OPTS = [{ v: "inspire", l: "FTC Inspire" }, { v: "impact", l: "FRC Impact" }, { v: "other", l: "Other" }];
const PORTFOLIO_STATUS = [{ v: "planning", l: "Planning" }, { v: "drafting", l: "Drafting" }, { v: "review", l: "Review" }, { v: "submission_ready", l: "Submission ready" }];
const STATUS_COLOR: Record<PieceStatus, string> = { not_started: "#90a4ae", in_progress: "#1565c0", review: "#e65100", done: "#2e7d32" };

export default function TeamPortfolioPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const [data, setData] = useState<TeamPortfolio | null>(null);
  const [roster, setRoster] = useState<{ member_id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkFor, setLinkFor] = useState<number | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [cap, setCap] = useState({ type: "reflection", title: "", body: "", piece_id: "", evidence: "" });
  const [pack, setPack] = useState<ContentPack | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    portfolioApi.getTeam(teamSeasonId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [teamSeasonId]);
  useEffect(() => { load(); goalsApi.teamMembers(teamSeasonId).then(setRoster).catch(() => setRoster([])); }, [load, teamSeasonId]);

  if (loading) return <div style={{ color: "#889", padding: "1rem" }}>Loading portfolio…</div>;
  if (!data) return <div style={{ color: "#c62828", padding: "1rem" }}>Couldn't load the portfolio.</div>;
  const { portfolio, pieces, captures, can_manage, can_contribute } = data;

  const setPortfolio = async (patch: Record<string, string>) => { await portfolioApi.updatePortfolio(portfolio.id, patch); load(); };
  const seed = async () => { await portfolioApi.seedTemplate(portfolio.id); load(); };
  const addPiece = async () => { const t = window.prompt("Piece title?"); if (t) { await portfolioApi.createPiece(portfolio.id, { title: t }); load(); } };
  const setPiece = async (id: number, patch: Record<string, unknown>) => { await portfolioApi.updatePiece(id, patch); load(); };
  const delPiece = async (p: PortfolioPiece) => { if (window.confirm(`Delete piece "${p.title}"?`)) { await portfolioApi.deletePiece(p.id); load(); } };
  const linkCanva = async (pieceId: number) => { if (!linkUrl.trim()) return; await portfolioApi.linkResource(pieceId, { canva_url: linkUrl.trim() }); setLinkFor(null); setLinkUrl(""); load(); };
  const pickExisting = async (pieceId: number, resourceId: number) => { await portfolioApi.linkResource(pieceId, { resource_id: resourceId }); load(); };
  const movePiece = async (index: number, dir: -1 | 1) => {
    const ids = pieces.map((p) => p.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await portfolioApi.reorderPieces(portfolio.id, ids); load();
  };
  const addCapture = async () => {
    if (!cap.title.trim() && !cap.body.trim()) return;
    const evidence = cap.evidence.trim() ? { external_url: cap.evidence.trim(), label: cap.evidence.trim() } : undefined;
    await portfolioApi.createCapture(portfolio.id, { capture_type: cap.type, title: cap.title, body: cap.body, piece_id: cap.piece_id ? Number(cap.piece_id) : null, evidence });
    setCap({ type: "reflection", title: "", body: "", piece_id: "", evidence: "" }); load();
  };

  return (
    <div>
      {/* Header */}
      <div style={s.header}>
        <div style={s.progWrap}>
          <div style={s.progTrack}><div style={{ ...s.progFill, width: `${data.progress_pct}%` }} /></div>
          <span style={s.progText}>{data.done_count}/{data.piece_count} pieces done · {data.progress_pct}%</span>
        </div>
        <div style={s.hdrControls}>
          {can_manage ? (
            <>
              <select style={s.sel} value={portfolio.award_target} onChange={(e) => setPortfolio({ award_target: e.target.value })}>
                {AWARD_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              <select style={s.sel} value={portfolio.status} onChange={(e) => setPortfolio({ status: e.target.value })}>
                {PORTFOLIO_STATUS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </>
          ) : <span style={s.badge}>{AWARD_OPTS.find((o) => o.v === portfolio.award_target)?.l} · {portfolio.status}</span>}
          {data.pieces.length > 0 && <>
            <button style={s.exportBtn} onClick={() => downloadFile(portfolioApi.manifestCsvUrl(teamSeasonId), "portfolio-manifest.csv")}><Download size={13} /> Manifest</button>
            <button style={s.exportBtn} onClick={async () => setPack(await portfolioApi.contentPack(teamSeasonId))}><ClipboardCopy size={13} /> Content pack</button>
          </>}
        </div>
      </div>

      {pieces.length === 0 ? (
        <div style={s.empty}>
          <FileText size={22} color="#90a4ae" />
          <p>No pieces yet. {can_manage ? "Start from the award template or add your own." : ""}</p>
          {can_manage && <div style={{ display: "flex", gap: 8 }}>
            <button style={s.primary} onClick={seed}><Sparkles size={14} /> Seed {AWARD_OPTS.find((o) => o.v === portfolio.award_target)?.l} template</button>
            <button style={s.ghost} onClick={addPiece}><Plus size={14} /> Add piece</button>
          </div>}
        </div>
      ) : (
        <>
          <div style={s.piecesHead}>
            <h3 style={s.h}>Pieces</h3>
            {can_manage && <button style={s.ghost} onClick={addPiece}><Plus size={13} /> Add piece</button>}
          </div>
          {pieces.map((p, idx) => (
            <div key={p.id} style={s.piece}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.pTitle}>{p.title} <span style={s.section}>{SECTION_LABELS[p.section_type]}</span></div>
                <div style={s.pMeta}>
                  <select style={{ ...s.statusSel, color: STATUS_COLOR[p.status], borderColor: STATUS_COLOR[p.status] }} value={p.status}
                    disabled={!can_contribute} onChange={(e) => setPiece(p.id, { status: e.target.value })}>
                    {(Object.keys(PIECE_STATUS_LABELS) as PieceStatus[]).map((st) => <option key={st} value={st}>{PIECE_STATUS_LABELS[st]}</option>)}
                  </select>
                  <select style={s.ownerSel} value={p.owner_member_id ?? ""} disabled={!can_contribute} onChange={(e) => setPiece(p.id, { owner_member_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Owner…</option>
                    {roster.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
                  </select>
                  {p.resource?.canva_url
                    ? <a style={s.canva} href={p.resource.canva_url} target="_blank" rel="noopener noreferrer">Open in Canva <ExternalLink size={11} /></a>
                    : can_contribute && (linkFor === p.id
                      ? <span style={s.linkBox}>
                          <input style={s.linkInput} placeholder="Paste Canva link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                          <button style={s.linkGo} onClick={() => linkCanva(p.id)}>Link</button>
                          {data.existing_assets.length > 0 && <select style={s.ownerSel} defaultValue="" onChange={(e) => e.target.value && pickExisting(p.id, Number(e.target.value))}>
                            <option value="">or pick existing…</option>
                            {data.existing_assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>}
                          <button style={s.linkCancel} onClick={() => { setLinkFor(null); setLinkUrl(""); }}>×</button>
                        </span>
                      : <button style={s.attach} onClick={() => setLinkFor(p.id)}><Link2 size={12} /> Attach Canva</button>)}
                </div>
              </div>
              {can_manage && <div style={s.pieceActions}>
                <button style={s.reorder} disabled={idx === 0} onClick={() => movePiece(idx, -1)} title="Move up"><ChevronUp size={13} /></button>
                <button style={s.reorder} disabled={idx === pieces.length - 1} onClick={() => movePiece(idx, 1)} title="Move down"><ChevronDown size={13} /></button>
                <button style={s.del} onClick={() => delPiece(p)}><Trash2 size={13} /></button>
              </div>}
            </div>
          ))}
        </>
      )}

      {/* Captures */}
      {(() => {
        // Cadence (FR-P6): weekly capture counts + a gap warning so documentation lapses show early.
        if (data.pieces.length === 0) return null;
        const now = Date.now(), wk = 7 * 864e5;
        const dateOf = (c: typeof captures[number]) => new Date((c.occurred_on || c.created_at || "") as string).getTime();
        const weeks = [0, 1, 2, 3].map((w) => captures.filter((c) => { const t = dateOf(c); return t <= now - w * wk && t > now - (w + 1) * wk; }).length).reverse();
        const last = captures.length ? Math.max(...captures.map(dateOf)) : 0;
        const daysSince = last ? Math.floor((now - last) / 864e5) : null;
        const max = Math.max(1, ...weeks);
        return (
          <div style={s.cadence}>
            <span style={s.cadenceLbl}><CalendarClock size={13} /> Documentation cadence</span>
            <div style={s.spark}>{weeks.map((n, i) => <div key={i} title={`${n} this week`} style={{ ...s.sparkBar, height: `${6 + (n / max) * 22}px`, background: n === 0 ? "#e0e4e8" : "#00695c" }} />)}</div>
            <span style={s.cadenceText}>{captures.length} captures · {weeks[weeks.length - 1]} this week
              {daysSince !== null && daysSince > 10 && <span style={s.cadenceWarn}> · {daysSince} days since the last one</span>}</span>
          </div>
        );
      })()}

      {can_contribute && (
        <div style={s.capCard}>
          <div style={s.capHead}><NotebookPen size={13} /> Log a capture</div>
          <div style={s.capRow}>
            <select style={s.sel} value={cap.type} onChange={(e) => setCap({ ...cap, type: e.target.value })}>
              {Object.entries(CAPTURE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input style={s.capTitle} placeholder="Title" value={cap.title} onChange={(e) => setCap({ ...cap, title: e.target.value })} />
            <select style={s.sel} value={cap.piece_id} onChange={(e) => setCap({ ...cap, piece_id: e.target.value })}>
              <option value="">Unfiled</option>
              {pieces.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div style={s.capRow}>
            <input style={s.capBody} placeholder="What happened? (a sentence is fine)" value={cap.body} onChange={(e) => setCap({ ...cap, body: e.target.value })} />
            <input style={s.capTitle} placeholder="Evidence link (optional)" value={cap.evidence} onChange={(e) => setCap({ ...cap, evidence: e.target.value })} />
            <button style={s.primary} onClick={addCapture}><Plus size={13} /> Log</button>
          </div>
        </div>
      )}
      {captures.length > 0 && <div style={s.capList}>
        <div style={s.capListHead}>Recent captures ({captures.length})</div>
        {captures.slice(0, 15).map((c) => (
          <div key={c.id} style={s.capItem}>
            <span style={s.capType}>{CAPTURE_LABELS[c.capture_type]}</span>
            <span style={{ flex: 1 }}><b>{c.title}</b>{c.body ? ` — ${c.body}` : ""}</span>
            <span style={s.capMeta}>{c.member?.name}{c.occurred_on ? ` · ${new Date(c.occurred_on + "T00:00:00").toLocaleDateString()}` : ""}</span>
            {can_contribute && <button style={s.del} onClick={async () => { await portfolioApi.deleteCapture(c.id); load(); }}><Trash2 size={12} /></button>}
          </div>
        ))}
      </div>}

      {pack && (
        <div style={s.overlay} onClick={() => setPack(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHead}>
              <h3 style={s.modalH}>Content Pack — copy into Canva</h3>
              <button style={s.del} onClick={() => setPack(null)}><X size={18} /></button>
            </div>
            <p style={s.modalSub}>Every capture grouped by piece — the raw material to paste into each section.</p>
            {pack.sections.filter((sec) => sec.captures.length > 0).length === 0 && pack.unfiled.length === 0
              && <p style={{ color: "#889", fontSize: 13 }}>No captures logged yet.</p>}
            {pack.sections.filter((sec) => sec.captures.length > 0).map((sec) => (
              <div key={sec.piece_id} style={s.packSection}>
                <div style={s.packTitle}>{sec.title} <span style={s.packSectionType}>{SECTION_LABELS[sec.section_type]}</span></div>
                {sec.captures.map((c, i) => <div key={i} style={s.packCap}><b>{c.title}</b>{c.body ? ` — ${c.body}` : ""}{c.occurred_on ? ` (${new Date(c.occurred_on + "T00:00:00").toLocaleDateString()})` : ""}</div>)}
              </div>
            ))}
            {pack.unfiled.length > 0 && (
              <div style={s.packSection}>
                <div style={s.packTitle}>Unfiled captures</div>
                {pack.unfiled.map((c, i) => <div key={i} style={s.packCap}><b>{c.title}</b>{c.body ? ` — ${c.body}` : ""}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 },
  progWrap: { flex: 1, minWidth: 220 },
  progTrack: { height: 10, background: "#eef2f7", borderRadius: 6, overflow: "hidden" },
  progFill: { height: "100%", background: "#00695c", borderRadius: 6 },
  progText: { fontSize: 12.5, color: "#455", marginTop: 4, display: "inline-block" },
  hdrControls: { display: "flex", gap: 8 },
  sel: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  badge: { fontSize: 12.5, fontWeight: 600, color: "#33506b", background: "#eef2f7", borderRadius: 6, padding: "6px 10px" },
  empty: { textAlign: "center", padding: "2rem 1rem", color: "#667", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#00695c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  ghost: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#455" },
  piecesHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  h: { margin: 0, fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  piece: { display: "flex", alignItems: "flex-start", gap: 8, border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: "#fff" },
  pTitle: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  section: { fontSize: 10, fontWeight: 700, color: "#546e7a", background: "#eceff1", borderRadius: 4, padding: "1px 6px", marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.3 },
  pMeta: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 },
  statusSel: { padding: "4px 8px", border: "1px solid", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "#fff" },
  ownerSel: { padding: "4px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12 },
  canva: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#00838f", textDecoration: "none", background: "#e0f7fa", borderRadius: 6, padding: "4px 9px" },
  attach: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", border: "1px dashed #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#556" },
  linkBox: { display: "inline-flex", gap: 5, alignItems: "center", flexWrap: "wrap" },
  linkInput: { padding: "4px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, width: 170 },
  linkGo: { padding: "4px 10px", background: "#00695c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 },
  linkCancel: { background: "none", border: "none", cursor: "pointer", color: "#889", fontSize: 16, lineHeight: 1 },
  del: { background: "none", border: "none", cursor: "pointer", color: "#c62828", display: "flex", padding: 4 },
  pieceActions: { display: "flex", alignItems: "center", gap: 2 },
  reorder: { width: 24, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e2e8f0", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#667" },
  cadence: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#f0f7f5", border: "1px solid #cfe6df", borderRadius: 10, padding: "9px 14px", marginTop: 16 },
  cadenceLbl: { fontSize: 11.5, fontWeight: 800, color: "#00695c", textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 5 },
  spark: { display: "flex", alignItems: "flex-end", gap: 3, height: 28 },
  sparkBar: { width: 8, borderRadius: 2 },
  cadenceText: { fontSize: 12, color: "#456" },
  cadenceWarn: { color: "#c62828", fontWeight: 600 },
  capCard: { background: "#f5f8fc", border: "1px solid #dde7f0", borderRadius: 10, padding: "12px 14px", marginTop: 16 },
  capHead: { fontSize: 11.5, fontWeight: 800, color: "#546e7a", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 },
  capRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" },
  capTitle: { flex: 1, minWidth: 140, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  capBody: { flex: 1, minWidth: 180, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  capList: { marginTop: 14 },
  capListHead: { fontSize: 11.5, fontWeight: 700, color: "#8494a6", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  capItem: { display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f0f4f8", fontSize: 12.5, color: "#445" },
  capType: { fontSize: 9.5, fontWeight: 700, color: "#00695c", background: "#e0f2f1", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" },
  capMeta: { fontSize: 11, color: "#98a3b0", whiteSpace: "nowrap" },
  exportBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#455" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "5vh 16px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: "18px 20px", width: "100%", maxWidth: 620, boxShadow: "0 12px 40px rgba(0,0,0,0.2)" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  modalH: { margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a5c" },
  modalSub: { fontSize: 12.5, color: "#667", margin: "4px 0 14px" },
  packSection: { marginBottom: 14 },
  packTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 5 },
  packSectionType: { fontSize: 10, fontWeight: 700, color: "#546e7a", background: "#eceff1", borderRadius: 4, padding: "1px 6px", marginLeft: 6, textTransform: "uppercase" },
  packCap: { fontSize: 13, color: "#334", lineHeight: 1.5, padding: "3px 0", borderBottom: "1px solid #f4f7fa" },
};
