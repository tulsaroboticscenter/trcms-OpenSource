/**
 * ConsentSections — renders a list of admin-configured consent sections for a
 * signing screen and collects the signer's responses. Acknowledge sections show a
 * required checkbox; grant/decline sections show a required choice. The Handbook
 * section additionally shows the live Handbook link.
 *
 * The parent owns the `responses` map (section key → true | "grant" | "decline").
 */
import { BookOpen, ExternalLink } from "lucide-react";
import type { ConsentSection, ConsentResponses, HandbookLink } from "../api";

export default function ConsentSections({ sections, responses, onChange, handbook }: {
  sections: ConsentSection[];
  responses: ConsentResponses;
  onChange: (key: string, value: boolean | "grant" | "decline") => void;
  handbook?: HandbookLink | null;
}) {
  return (
    <div>
      {sections.map((s) => (
        <div key={s.key} style={st.section}>
          <div style={st.title}>{s.title}{s.required && <span style={st.req}> *</span>}</div>

          {s.key === "handbook" && handbook?.url?.trim() && (
            <a href={handbook.url.trim()} target="_blank" rel="noopener noreferrer" style={st.hbLink}>
              <BookOpen size={14} /> Open the {handbook.title?.trim() || "TRC Handbook"} <ExternalLink size={11} style={{ verticalAlign: -1 }} />
            </a>
          )}

          {s.body && <div style={st.body}>{s.body}</div>}

          {s.response_type === "grant_decline" ? (
            <div style={st.choices}>
              <label style={{ ...st.choice, ...(responses[s.key] === "grant" ? st.choiceOn : {}) }}>
                <input type="radio" name={`resp_${s.key}`} checked={responses[s.key] === "grant"} onChange={() => onChange(s.key, "grant")} />
                <span><strong>I consent</strong></span>
              </label>
              <label style={{ ...st.choice, ...(responses[s.key] === "decline" ? st.choiceOn : {}) }}>
                <input type="radio" name={`resp_${s.key}`} checked={responses[s.key] === "decline"} onChange={() => onChange(s.key, "decline")} />
                <span><strong>I do not consent</strong></span>
              </label>
            </div>
          ) : (
            <label style={st.ack}>
              <input type="checkbox" checked={responses[s.key] === true} onChange={(e) => onChange(s.key, e.target.checked)} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 13.5, color: "#333", lineHeight: 1.5 }}>I have read and agree to the {s.title} above.</span>
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

/** True when every required section has a valid answer. */
export function consentComplete(sections: ConsentSection[], responses: ConsentResponses): boolean {
  return sections.every((s) => {
    if (!s.required) return true;
    return s.response_type === "grant_decline"
      ? responses[s.key] === "grant" || responses[s.key] === "decline"
      : responses[s.key] === true;
  });
}

const st: Record<string, React.CSSProperties> = {
  section: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", marginBottom: 12 },
  title: { fontSize: 13.5, fontWeight: 800, color: "#1a3a5c", marginBottom: 6 },
  req: { color: "#c62828" },
  hbLink: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1565c0", fontWeight: 600, textDecoration: "none", marginBottom: 8 },
  body: { fontSize: 12.5, color: "#455", lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 6, padding: "8px 10px", marginBottom: 10 },
  ack: { display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" },
  choices: { display: "flex", flexDirection: "column", gap: 8 },
  choice: { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5, color: "#333", cursor: "pointer" },
  choiceOn: { borderColor: "#1565c0", background: "#eef4fb" },
};
