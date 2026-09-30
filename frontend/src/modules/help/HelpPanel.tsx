import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X, Search, ChevronLeft, BookOpen, Compass } from "lucide-react";
import { helpApi, type HelpArticle } from "./api";
import { tourApi, type GuidedTour } from "./tourApi";
import { useTour } from "./TourContext";
import { renderMarkdown } from "./markdown";

/**
 * Slide-over Help Center: search + browse articles, read them rendered from
 * Markdown. Opened from the ? button in the top bar. Pass initialHelpKey to
 * open contextual help for the current screen.
 */
export default function HelpPanel({ open, onClose, initialHelpKey }: { open: boolean; onClose: () => void; initialHelpKey?: string }) {
  const navigate = useNavigate();
  const { startTour } = useTour();
  const [search, setSearch] = useState("");
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [tours, setTours] = useState<GuidedTour[]>([]);
  const [active, setActive] = useState<HelpArticle | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((q: string, helpKey?: string) => {
    setLoading(true);
    helpApi.list({ search: q || undefined, help_key: helpKey || undefined })
      .then(setArticles).catch(() => setArticles([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    tourApi.list().then(setTours).catch(() => setTours([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(null); setSearch("");
    // If a screen supplied a help key, try contextual articles first; fall back to all.
    if (initialHelpKey) {
      helpApi.list({ help_key: initialHelpKey }).then((r) => {
        if (r.length === 1) { helpApi.get(r[0].slug).then(setActive); setArticles(r); }
        else if (r.length) setArticles(r);
        else load("");
      }).catch(() => load(""));
    } else { load(""); }
  }, [open, initialHelpKey, load]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (!open) return null;

  function openArticle(a: HelpArticle) {
    helpApi.get(a.slug).then(setActive).catch(() => {});
  }

  // Group by category for browsing.
  const groups: { category: string; items: HelpArticle[] }[] = [];
  for (const a of articles) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) { g = { category: a.category, items: [] }; groups.push(g); }
    g.items.push(a);
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.panel} onClick={(e) => e.stopPropagation()}>
        <div style={st.head}>
          <span style={st.title}><BookOpen size={17} /> Help</span>
          <button style={st.close} onClick={onClose}><X size={18} /></button>
        </div>

        {active ? (
          <div style={st.article}>
            <button style={st.back} onClick={() => setActive(null)}><ChevronLeft size={15} /> All help</button>
            <h1 style={st.aTitle}>{active.title}</h1>
            <div style={st.aCat}>{active.category}</div>
            <div style={st.body} dangerouslySetInnerHTML={{ __html: renderMarkdown(active.body ?? "") }} />
          </div>
        ) : (
          <>
            <div style={st.searchRow}>
              <Search size={15} color="#888" />
              <input style={st.search} placeholder="Search help…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
            <div style={st.list}>
              {!search && tours.length > 0 && (
                <div style={st.group}>
                  <div style={st.groupH}><Compass size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Guided tours</div>
                  {tours.map((t) => (
                    <button key={t.id} style={{ ...st.item, borderColor: "#e6e0f2", background: "#faf8fe" }}
                      onClick={() => { onClose(); startTour(t.tour_key); }}>
                      <div style={st.itemTitle}>▶ {t.title}</div>
                      {t.description && <div style={st.itemSummary}>{t.description}</div>}
                    </button>
                  ))}
                </div>
              )}
              {loading && <p style={st.muted}>Loading…</p>}
              {!loading && articles.length === 0 && <p style={st.muted}>No help articles found{search ? " for that search" : " yet"}.</p>}
              {groups.map((g) => (
                <div key={g.category} style={st.group}>
                  <div style={st.groupH}>{g.category}</div>
                  {g.items.map((a) => (
                    <button key={a.id} style={st.item} onClick={() => openArticle(a)}>
                      <div style={st.itemTitle}>{a.title}</div>
                      {a.summary && <div style={st.itemSummary}>{a.summary}</div>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <div style={st.footer}>
          <button style={st.manualBtn} onClick={() => { onClose(); navigate("/help/manual"); }}>
            <BookOpen size={14} /> Open the full manual
          </button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1200, display: "flex", justifyContent: "flex-end" },
  panel: { width: 440, maxWidth: "100vw", height: "100%", background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #e2e8f0" },
  title: { display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  close: { background: "none", border: "none", cursor: "pointer", color: "#888" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #cdd7e3", borderRadius: 8, padding: "9px 12px", margin: 16 },
  search: { flex: 1, border: "none", outline: "none", fontSize: 14 },
  list: { flex: 1, overflowY: "auto", padding: "0 12px 16px" },
  muted: { color: "#889", fontSize: 13.5, padding: "8px 4px" },
  group: { marginBottom: 12 },
  groupH: { fontSize: 11.5, fontWeight: 700, color: "#00838f", textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 4px" },
  item: { display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #eef2f6", borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer" },
  itemTitle: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  itemSummary: { fontSize: 12.5, color: "#778", marginTop: 2 },
  article: { flex: 1, overflowY: "auto", padding: 16 },
  back: { display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  aTitle: { fontSize: 20, fontWeight: 800, color: "#1a3a5c", margin: "4px 0 2px" },
  aCat: { fontSize: 11.5, fontWeight: 700, color: "#00838f", textTransform: "uppercase", marginBottom: 12 },
  body: { fontSize: 14, color: "#243", lineHeight: 1.6 },
  footer: { borderTop: "1px solid #e2e8f0", padding: 12 },
  manualBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "9px 12px", background: "#f0f4f8", color: "#1a3a5c", border: "1px solid #dbe3ec", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
};
