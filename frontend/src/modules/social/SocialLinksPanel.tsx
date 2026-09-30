import { useEffect, useState } from "react";
import { socialApi, type SocialLink } from "./api";
import { Globe } from "lucide-react";

/**
 * Read-only display of the TRC social-media links. Used on the Dashboard
 * (compact, top-right) and on member profiles (a pane). Renders nothing when
 * no links are configured, so it never adds clutter.
 */
// lucide-react no longer ships brand glyphs, so we use one generic icon and lean
// on each platform's brand color (plus the label) to tell them apart.
const COLORS: Record<string, string> = {
  instagram: "#e1306c", facebook: "#1877f2", youtube: "#ff0000",
  x: "#000000", twitter: "#1da1f2", tiktok: "#000000",
};

function colorFor(platform: string): string {
  return COLORS[platform.trim().toLowerCase()] ?? "#1a3a5c";
}

export default function SocialLinksPanel({ variant = "panel" }: { variant?: "panel" | "compact" }) {
  const [links, setLinks] = useState<SocialLink[]>([]);
  useEffect(() => { socialApi.list().then(setLinks).catch(() => {}); }, []);

  if (links.length === 0) return null;

  return (
    <div style={variant === "compact" ? st.compact : st.panel}>
      {variant === "panel" && <div style={st.title}>Follow TRC</div>}
      <div style={st.row}>
        {links.map((l, i) => {
          const color = colorFor(l.platform);
          return (
            <a key={i} href={l.url} target="_blank" rel="noreferrer"
              style={{ ...st.link, color }}
              title={`${l.platform}${l.label ? " — " + l.label : ""}`}>
              <Globe size={variant === "compact" ? 18 : 20} />
              <span style={variant === "compact" ? st.compactLabel : st.label}>{variant === "compact" ? l.platform : (l.label || l.platform)}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  panel: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "0.9rem 1.1rem" },
  compact: { display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "5px 12px" },
  title: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  row: { display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" },
  link: { display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", fontSize: 13, fontWeight: 600 },
  label: { color: "#445" },
  compactLabel: { fontSize: 12 },
};
