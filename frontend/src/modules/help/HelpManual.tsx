import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, ArrowLeft, BookOpen } from "lucide-react";
import { helpApi, type HelpArticle } from "./api";
import { renderMarkdown } from "./markdown";

/**
 * The complete user manual — every published help article the member can see,
 * grouped by category, generated from the same content as the ? panel. Printable
 * / savable to PDF via the browser's print dialog.
 */
export default function HelpManual() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<HelpArticle[] | null>(null);
  const [full, setFull] = useState<Record<string, string>>({});

  useEffect(() => {
    helpApi.list().then(async (list) => {
      setArticles(list);
      // Fetch bodies for each (list endpoint omits body).
      const bodies: Record<string, string> = {};
      await Promise.all(list.map((a) => helpApi.get(a.slug).then((x) => { bodies[a.slug] = x.body ?? ""; }).catch(() => {})));
      setFull(bodies);
    }).catch(() => setArticles([]));
  }, []);

  if (articles === null) return <p style={{ padding: 20, color: "#889" }}>Loading manual…</p>;

  const groups: { category: string; items: HelpArticle[] }[] = [];
  for (const a of articles) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) { g = { category: a.category, items: [] }; groups.push(g); }
    g.items.push(a);
  }

  return (
    <div style={s.page}>
      <div style={s.toolbar} className="no-print">
        <button style={s.back} onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back</button>
        <button style={s.print} onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
      </div>

      <div style={s.doc}>
        <h1 style={s.docTitle}><BookOpen size={24} style={{ verticalAlign: -4, marginRight: 8 }} />TRC Member Manual</h1>
        <p style={s.docSub}>Tulsa Robotics Center Management System — user guide</p>

        {/* Table of contents */}
        <div style={s.toc}>
          {groups.map((g) => (
            <div key={g.category} style={s.tocGroup}>
              <div style={s.tocCat}>{g.category}</div>
              {g.items.map((a) => <a key={a.id} href={`#a-${a.slug}`} style={s.tocLink}>{a.title}</a>)}
            </div>
          ))}
        </div>

        {groups.map((g) => (
          <section key={g.category}>
            <h2 style={s.catH}>{g.category}</h2>
            {g.items.map((a) => (
              <article key={a.id} id={`a-${a.slug}`} style={s.article}>
                <div style={s.body} dangerouslySetInnerHTML={{ __html: renderMarkdown(full[a.slug] ?? "") }} />
              </article>
            ))}
          </section>
        ))}

        {articles.length === 0 && <p style={{ color: "#889" }}>No published help articles yet.</p>}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  toolbar: { display: "flex", justifyContent: "space-between", marginBottom: 14 },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5 },
  print: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  doc: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "28px 32px" },
  docTitle: { fontSize: 26, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  docSub: { fontSize: 14, color: "#667", margin: "4px 0 20px" },
  toc: { borderTop: "1px solid #eef2f6", borderBottom: "1px solid #eef2f6", padding: "14px 0", marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 20 },
  tocGroup: { minWidth: 200 },
  tocCat: { fontSize: 11.5, fontWeight: 700, color: "#00838f", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  tocLink: { display: "block", fontSize: 13, color: "#1565c0", textDecoration: "none", padding: "2px 0" },
  catH: { fontSize: 20, fontWeight: 800, color: "#00695c", borderBottom: "2px solid #e0f2f1", paddingBottom: 6, margin: "26px 0 12px" },
  article: { marginBottom: 20 },
  body: { fontSize: 14.5, color: "#243", lineHeight: 1.65 },
};
