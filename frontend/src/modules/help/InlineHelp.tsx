import { HelpCircle } from "lucide-react";
import { useHelp } from "./HelpContext";

/** Small inline "?" that opens the Help panel to the article for `helpKey`. */
export default function InlineHelp({ helpKey, label }: { helpKey: string; label?: string }) {
  const { openHelp } = useHelp();
  return (
    <button onClick={() => openHelp(helpKey)} title={label ?? "Help"} aria-label={label ?? "Help"} style={st.btn}>
      <HelpCircle size={15} />
      {label && <span>{label}</span>}
    </button>
  );
}

const st: Record<string, React.CSSProperties> = {
  btn: { display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, padding: 2 },
};
