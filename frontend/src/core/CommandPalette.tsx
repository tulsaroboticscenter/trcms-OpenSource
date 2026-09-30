/**
 * CommandPalette — press Ctrl/Cmd-K (or "/" outside a text field) to open a
 * searchable jump-to for every feature the current user can reach. Type a few
 * letters of a destination, arrow to it, Enter to go. Powered by useDestinations
 * so it always matches what the user actually has access to.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { Search } from "lucide-react";
import { useDestinations, type Destination } from "./useDestinations";

const ICONS = Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;

function score(d: Destination, q: string): number {
  const hay = `${d.label} ${d.area} ${d.description ?? ""} ${d.keywords ?? ""}`.toLowerCase();
  const label = d.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  if (hay.includes(q)) return 2;
  // subsequence match (fuzzy): all query chars appear in order somewhere in label
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length ? 3 : 99;
}

export default function CommandPalette() {
  const destinations = useDestinations();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global open shortcut: Ctrl/Cmd-K, or "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "")
        || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); setOpen((v) => !v);
      } else if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const openEvt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("trc:open-command", openEvt);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("trc:open-command", openEvt);
    };
  }, []);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations.slice().sort((a, b) => a.label.localeCompare(b.label));
    return destinations
      .map((d) => ({ d, s: score(d, q) }))
      .filter((x) => x.s < 99)
      .sort((a, b) => a.s - b.s || a.d.label.localeCompare(b.d.label))
      .map((x) => x.d);
  }, [query, destinations]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function go(d?: Destination) {
    if (!d) return;
    setOpen(false);
    navigate(d.to);
  }

  return (
    <div style={st.overlay} onClick={() => setOpen(false)}>
      <div style={st.panel} onClick={(e) => e.stopPropagation()}>
        <div style={st.searchRow}>
          <Search size={18} style={{ color: "#90a4ae", flexShrink: 0 }} />
          <input
            ref={inputRef} style={st.input} placeholder="Jump to… (try “wish”, “sponsor”, “check in”)"
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
            }}
          />
          <kbd style={st.kbd}>esc</kbd>
        </div>
        <div style={st.list} ref={listRef}>
          {results.length === 0 && <div style={st.empty}>No matches for “{query}”.</div>}
          {results.map((d, i) => {
            const Icon = ICONS[d.iconName] ?? Icons.Circle;
            return (
              <div key={d.to} data-i={i} style={{ ...st.row, ...(i === active ? st.rowActive : {}) }}
                onMouseEnter={() => setActive(i)} onClick={() => go(d)}>
                <Icon size={16} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={st.rowLabel}>{d.label}</div>
                  {d.description && <div style={st.rowDesc}>{d.description}</div>}
                </div>
                <span style={st.rowArea}>{d.area}</span>
              </div>
            );
          })}
        </div>
        <div style={st.footer}>
          <span><kbd style={st.kbd}>↑</kbd><kbd style={st.kbd}>↓</kbd> navigate</span>
          <span><kbd style={st.kbd}>↵</kbd> open</span>
          <span style={{ marginLeft: "auto" }}><kbd style={st.kbd}>Ctrl</kbd>+<kbd style={st.kbd}>K</kbd> anytime</span>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px", zIndex: 3000 },
  panel: { width: "100%", maxWidth: 560, background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.35)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "72vh" },
  searchRow: { display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #eceff1" },
  input: { flex: 1, border: "none", outline: "none", fontSize: 16, color: "#263238" },
  kbd: { fontSize: 10, fontFamily: "inherit", background: "#f0f4f8", color: "#78909c", borderRadius: 4, padding: "2px 5px", border: "1px solid #e0e6eb" },
  list: { overflowY: "auto", padding: 6 },
  empty: { padding: "24px 16px", color: "#90a4ae", fontSize: 14, textAlign: "center" },
  row: { display: "flex", alignItems: "center", gap: 11, padding: "9px 11px", borderRadius: 8, cursor: "pointer", color: "#455a64" },
  rowActive: { background: "#e8eef6", color: "#1a237e" },
  rowLabel: { fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowDesc: { fontSize: 12, color: "#90a4ae", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowArea: { fontSize: 10.5, color: "#b0bec5", flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 },
  footer: { display: "flex", gap: 14, alignItems: "center", padding: "9px 14px", borderTop: "1px solid #eceff1", fontSize: 11, color: "#90a4ae" },
};
