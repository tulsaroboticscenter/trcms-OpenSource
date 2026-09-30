import { Link } from "react-router-dom";
import type { Highlight } from "../../../core/version";

/**
 * Renders a release's changelog lines. A line tagged with `fb` shows a
 * hyperlinked "#id" to its left that links straight to the feedback ticket.
 */
export default function ReleaseHighlights({ highlights }: { highlights: Highlight[] }) {
  // Show feedback-tagged lines first in ascending ticket-number order, with any
  // untagged lines after them (keeping their original relative order).
  const ordered = highlights
    .map((h, i) => ({ h, i, fb: typeof h === "object" ? h.fb : undefined }))
    .sort((a, b) => {
      if (a.fb != null && b.fb != null) return a.fb - b.fb;
      if (a.fb != null) return -1;
      if (b.fb != null) return 1;
      return a.i - b.i;
    });
  return (
    <ul style={st.ul}>
      {ordered.map(({ h, i }) => {
        const fb = typeof h === "object" ? h.fb : undefined;
        const text = typeof h === "object" ? h.text : h;
        return (
          <li key={i} style={st.li}>
            {fb != null && (
              <Link to={`/feedback/${fb}`} style={st.fb} title={`Feedback #${fb}`}>#{fb}</Link>
            )}
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

const st: Record<string, React.CSSProperties> = {
  ul: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 },
  li: { fontSize: 14, color: "#2a2418", lineHeight: 1.5, display: "flex", gap: 8, alignItems: "baseline" },
  fb: {
    flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#1565c0", textDecoration: "none",
    background: "#eaf2fb", border: "1px solid #cfe0f3", borderRadius: 6, padding: "0 6px",
    minWidth: 34, textAlign: "center", lineHeight: "20px",
  },
};
