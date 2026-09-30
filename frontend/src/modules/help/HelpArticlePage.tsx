/**
 * HelpArticlePage — a single Help Center article at its own URL (/help/:slug).
 *
 * The searchable ? panel and the printable manual already render articles, but neither
 * has a shareable address. Onboarding items and emails link people straight to an
 * article, so it needs one.
 */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen } from "lucide-react";
import { helpApi, type HelpArticle } from "./api";
import { renderMarkdown } from "./markdown";

export default function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    setLoading(true); setError("");
    helpApi.get(slug)
      .then(setArticle)
      .catch(() => setError("That help article isn't available — it may have been renamed, or your role may not have access to it."))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div style={s.wrap}>
      <button style={s.back} onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
      {loading && <div style={s.muted}>Loading…</div>}
      {error && <div style={s.muted}>{error}</div>}
      {article && (
        <article style={s.card}>
          <div style={s.cat}><BookOpen size={12} /> {article.category}</div>
          <h1 style={s.h1}>{article.title}</h1>
          {article.summary && <p style={s.summary}>{article.summary}</p>}
          <div style={s.body} dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body ?? "") }} />
        </article>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 820, margin: "0 auto", padding: "16px 18px 40px", display: "flex", flexDirection: "column", gap: 12 },
  back: { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, padding: "5px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer" },
  card: { background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "20px 22px" },
  cat: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4 },
  h1: { fontSize: 22, color: "#1a3a5c", margin: "6px 0 4px" },
  summary: { fontSize: 13.5, color: "#5b6b7c", margin: "0 0 14px" },
  body: { fontSize: 14, lineHeight: 1.65, color: "#31414f" },
  muted: { fontSize: 13, color: "#90a4ae" },
};
