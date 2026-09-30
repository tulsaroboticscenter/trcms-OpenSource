/**
 * DraggablePanel
 * ==============
 * A panel wrapper that supports HTML5 drag-and-drop reordering.
 * Shows a grip handle on hover. The drag-over target shows a blue
 * highlight border so the user knows where it will land.
 *
 * Usage:
 *   <DraggablePanel
 *     id="contact"
 *     title="Contact Information"
 *     icon={<Phone size={15} />}
 *     dragging={draggingId}
 *     dragOver={dragOverId}
 *     onDragStart={handleDragStart}
 *     onDragOver={handleDragOver}
 *     onDrop={handleDrop}
 *     onDragEnd={handleDragEnd}
 *   >
 *     {content}
 *   </DraggablePanel>
 */
import { useState, type ReactNode } from "react";
import { GripVertical, ChevronUp, ChevronDown } from "lucide-react";

interface Props {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  dragging: string | null;      // ID currently being dragged
  dragOver: string | null;      // ID currently being hovered over
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  style?: React.CSSProperties;
  /** Distinguishes this panel's collapse state from same-id panels elsewhere. */
  collapseScope?: string;
}

export default function DraggablePanel({
  id, title, icon, children,
  dragging, dragOver,
  onDragStart, onDragOver, onDrop, onDragEnd,
  style, collapseScope = "",
}: Props) {
  const isDragging  = dragging === id;
  const isDragOver  = dragOver === id && dragging !== id;

  const storageKey = `pane_${collapseScope}${id}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v === null ? true : v === "1"; }
    catch { return true; }
  });
  function toggle() {
    setOpen((o) => {
      const n = !o;
      try { localStorage.setItem(storageKey, n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(id)}
      onDragOver={(e) => onDragOver(e, id)}
      onDrop={(e) => onDrop(e, id)}
      onDragEnd={onDragEnd}
      style={{
        background: "#fff",
        borderRadius: 10,
        padding: "1.25rem",
        border: isDragOver
          ? "2px solid #4dabf7"
          : "1px solid #e2e8f0",
        boxShadow: isDragOver ? "0 0 0 3px rgba(77,171,247,0.15)" : "none",
        opacity: isDragging ? 0.45 : 1,
        cursor: isDragging ? "grabbing" : "default",
        transition: "border-color 0.12s, box-shadow 0.12s, opacity 0.12s",
        position: "relative",
        ...style,
      }}
    >
      {/* Panel title row with minimize + drag handle */}
      <div style={{ ...styles.titleRow, ...(open ? {} : styles.titleRowCollapsed) }}>
        <h3 style={styles.title}>
          {icon && <span style={styles.icon}>{icon}</span>}
          {title}
        </h3>
        <div style={styles.controls}>
          {/* Minimize / expand */}
          <button
            type="button"
            style={styles.chevronBtn}
            title={open ? "Minimize" : "Expand"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); toggle(); }}
          >
            {open ? <ChevronUp size={16} color="#888" /> : <ChevronDown size={16} color="#888" />}
          </button>
          {/* Grip handle — visible on hover */}
          <div
            style={styles.grip}
            title="Drag to rearrange"
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
          >
            <GripVertical size={16} color="#aaa" />
          </div>
        </div>
      </div>

      {open && children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    borderBottom: "1px solid #f0f4f8",
    paddingBottom: 8,
  },
  titleRowCollapsed: {
    marginBottom: 0,
    borderBottom: "none",
    paddingBottom: 0,
  },
  controls: { display: "flex", alignItems: "center", gap: 2 },
  chevronBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 12,
    fontWeight: 700,
    color: "#1a3a5c",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    display: "flex",
    alignItems: "center",
  },
  icon: { marginRight: 6, opacity: 0.7 },
  grip: {
    cursor: "grab",
    padding: "2px 4px",
    borderRadius: 4,
    opacity: 0,               // hidden by default, shown on hover via onMouseEnter
    transition: "opacity 0.15s",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
};
