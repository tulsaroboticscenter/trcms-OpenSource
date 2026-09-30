/**
 * DashboardPane
 * =============
 * Wraps a dashboard pane with the per-user layout controls: a hide button and a
 * drag handle for reordering. The controls are an overlay in the top-right rather
 * than a header of their own, so each pane keeps rendering its own card exactly as
 * before — nothing inside has to know it's arrangeable.
 *
 * At rest the controls only appear on hover (and are always visible in arrange
 * mode), so the dashboard doesn't gain a row of chrome for people who never
 * rearrange anything.
 *
 * Panes that render nothing (DonationBox with payments off, MyYouthPanel for a
 * non-parent) must not leave an empty wrapper behind — see `useRendersSomething`.
 */
import { useRef, useState, useEffect, type ReactNode } from "react";
import { GripVertical, EyeOff } from "lucide-react";

interface Props {
  id: string;
  label: string;
  arranging: boolean;
  dragging: string | null;
  onHide: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  children: ReactNode;
}

export default function DashboardPane({
  id, label, arranging, dragging, onHide, onDragStart, onDragOver, onDrop, onDragEnd, children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [empty, setEmpty] = useState(false);

  // Several panes self-hide (return null) depending on config or role. Detect that
  // so we don't render a bare wrapper with floating controls and no content.
  useEffect(() => {
    const check = () => setEmpty(!ref.current || ref.current.childElementCount === 0);
    check();
    if (!ref.current) return;
    const mo = new MutationObserver(check);
    mo.observe(ref.current, { childList: true });
    return () => mo.disconnect();
  }, [children]);

  const show = arranging || hover;
  const isDragged = dragging === id;

  return (
    <div
      style={{
        ...styles.wrap,
        ...(arranging ? styles.arrangeWrap : {}),
        ...(isDragged ? styles.dragged : {}),
        ...(empty ? styles.collapsed : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={arranging}
      onDragStart={() => onDragStart(id)}
      onDragOver={(e) => onDragOver(e, id)}
      onDrop={(e) => onDrop(e, id)}
      onDragEnd={onDragEnd}
    >
      {!empty && show && (
        <div style={styles.controls}>
          {arranging && (
            <span style={styles.handle} title="Drag to reorder">
              <GripVertical size={13} /> {label}
            </span>
          )}
          <button
            style={styles.hideBtn}
            onClick={() => onHide(id)}
            title={`Hide "${label}" from my dashboard`}
            aria-label={`Hide ${label}`}
          >
            <EyeOff size={12} /> Hide
          </button>
        </div>
      )}
      <div ref={ref}>{children}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: "relative" },
  arrangeWrap: { outline: "1px dashed #b9c6d4", outlineOffset: 3, borderRadius: 10, cursor: "grab" },
  dragged: { opacity: 0.45 },
  collapsed: { display: "none" },
  controls: {
    position: "absolute", top: 6, right: 8, zIndex: 5,
    display: "flex", alignItems: "center", gap: 6,
  },
  handle: {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
    background: "#eef3f8", border: "1px solid #cdd7e3", borderRadius: 6,
    fontSize: 11, fontWeight: 700, color: "#4a5b6d", cursor: "grab",
  },
  hideBtn: {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
    background: "rgba(255,255,255,0.94)", border: "1px solid #cdd7e3", borderRadius: 6,
    fontSize: 11, fontWeight: 600, color: "#5a6b7d", cursor: "pointer",
  },
};
