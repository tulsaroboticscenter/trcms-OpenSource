/**
 * HelpTip — contextual help tooltip.
 * Usage: <HelpTip text="Explain what this field does" />
 * Shows a (?) icon; hover or click reveals the explanation.
 */
import { useState } from "react";
import { HelpCircle } from "lucide-react";

interface Props {
  text: string;
  width?: number;
  position?: "top" | "right" | "bottom" | "left";
}

export default function HelpTip({ text, width = 220, position = "top" }: Props) {
  const [visible, setVisible] = useState(false);

  const offsets: Record<string, React.CSSProperties> = {
    top:    { bottom: "130%", left: "50%", transform: "translateX(-50%)" },
    right:  { left: "130%",   top:  "50%", transform: "translateY(-50%)" },
    bottom: { top:  "130%",   left: "50%", transform: "translateX(-50%)" },
    left:   { right: "130%",  top:  "50%", transform: "translateY(-50%)" },
  };

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", cursor: "default" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(!visible)}
    >
      <HelpCircle size={14} color="#90caf9" />
      {visible && (
        <div style={{
          position: "absolute",
          ...offsets[position],
          background: "#1a3a5c",
          color: "#fff",
          fontSize: 12,
          lineHeight: 1.6,
          padding: "8px 10px",
          borderRadius: 7,
          width,
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          pointerEvents: "none",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}
