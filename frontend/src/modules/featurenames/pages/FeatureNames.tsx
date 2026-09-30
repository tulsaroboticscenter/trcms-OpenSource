import { useEffect, useState } from "react";
import { featureNamesApi, type FeatureName } from "../api";

/**
 * "Feature Names" — the in-app glossary of the nicknames we give new TRCMS features.
 * Any signed-in member can view it. Each feature shows the profile photo of the member
 * it's named after (falling back to the first letter of the nickname).
 */
const AVATAR_COLORS = ["#1a3a5c", "#b5651d", "#2e6e5a", "#6a3f86"];

export default function FeatureNames() {
  const [features, setFeatures] = useState<FeatureName[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { featureNamesApi.list().then(setFeatures).catch(() => setFailed(true)); }, []);

  const currentRelease = features?.[0]?.release?.replace("Release ", "") ?? "";

  return (
    <div style={st.wrap}>
      <div style={st.eyebrow}>Tulsa Robotics Center</div>
      <h1 style={st.h1}>Feature Names <span style={{ color: "#c9761f" }}>&amp;</span> Enhancements</h1>
      <p style={st.lede}>The friendly names we give new things in TRCMS — what each one does, and which release it landed in.</p>

      {features && features.length > 0 && (
        <div style={st.meta}>
          <span><b>{features.length}</b> named features</span>
          <span>Current release <b>{currentRelease}</b></span>
        </div>
      )}
      <div style={st.rule} />

      {failed ? (
        <p style={st.muted}>We couldn't load the feature list right now. Please try again later.</p>
      ) : !features ? (
        <p style={st.muted}>Loading…</p>
      ) : (
        <div style={st.grid}>
          {features.map((f, i) => (
            <article key={f.nickname} style={st.card}>
              <div style={st.top}>
                <Avatar feature={f} color={AVATAR_COLORS[i % AVATAR_COLORS.length]} />
                <div style={st.name}>
                  <span style={st.label}>The Feature</span>
                  <h2 style={st.h2}>{f.nickname}</h2>
                  {f.member && <span style={st.person}>named for {f.member.name}</span>}
                </div>
              </div>
              <p style={st.desc}>{f.description}</p>
              <div style={st.foot}>
                <span style={st.pill}>{f.release}</span>
                <span style={st.date}>{f.date}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <div style={st.note}><span style={st.dot} /> Named features are added here with each software release. More to come.</div>
    </div>
  );
}

function Avatar({ feature, color }: { feature: FeatureName; color: string }) {
  const [broken, setBroken] = useState(false);
  const photo = feature.member?.photo_url;
  const letter = feature.nickname.replace(/^The\s+/i, "").charAt(0).toUpperCase() || "?";
  if (photo && !broken) {
    return <img src={photo} alt={feature.member?.name ?? ""} style={{ ...st.avatar, objectFit: "cover" }} onError={() => setBroken(true)} />;
  }
  return <div style={{ ...st.avatar, background: color, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 19 }} aria-hidden="true">{letter}</div>;
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 940, margin: "0 auto" },
  eyebrow: { font: "600 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace", letterSpacing: "0.18em", textTransform: "uppercase", color: "#c9761f", marginBottom: 10 },
  h1: { fontSize: 28, lineHeight: 1.05, letterSpacing: "-0.02em", fontWeight: 800, color: "#1a3a5c", margin: "0 0 8px" },
  lede: { fontSize: 15, color: "#5f6c79", maxWidth: "60ch", margin: 0, lineHeight: 1.6 },
  meta: { display: "flex", flexWrap: "wrap", gap: "6px 22px", marginTop: 16, font: "500 12.5px/1 ui-monospace, SFMono-Regular, Consolas, monospace", color: "#8a95a1", letterSpacing: "0.02em" },
  rule: { height: 1, background: "#e5e0d5", margin: "20px 0 22px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 14 },
  card: { position: "relative", background: "#fff", border: "1px solid #e5e0d5", borderRadius: 16, padding: "20px 22px 18px", boxShadow: "0 1px 4px rgba(20,30,45,0.05)", display: "flex", flexDirection: "column", gap: 14 },
  top: { display: "flex", alignItems: "center", gap: 14 },
  avatar: { flex: "0 0 auto", width: 46, height: 46, borderRadius: "50%", boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.22)" },
  name: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  label: { font: "600 10.5px/1 ui-monospace, SFMono-Regular, Consolas, monospace", letterSpacing: "0.16em", textTransform: "uppercase", color: "#8a95a1" },
  h2: { margin: 0, fontSize: 18, fontWeight: 750, letterSpacing: "-0.01em", color: "#1a2733", lineHeight: 1.2 },
  person: { fontSize: 12, color: "#8a95a1", marginTop: 1 },
  desc: { margin: 0, color: "#5f6c79", fontSize: 14.5, lineHeight: 1.6 },
  foot: { marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 14, borderTop: "1px dashed #e5e0d5" },
  pill: { font: "600 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace", color: "#c9761f", background: "#f3e3cf", border: "1px solid rgba(201,118,31,0.3)", padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap" },
  date: { font: "500 12.5px/1 ui-monospace, SFMono-Regular, Consolas, monospace", color: "#8a95a1", fontVariantNumeric: "tabular-nums" },
  note: { marginTop: 26, color: "#8a95a1", fontSize: 13, display: "flex", alignItems: "center", gap: 9 },
  dot: { width: 6, height: 6, borderRadius: "50%", background: "#c9761f", display: "inline-block", flexShrink: 0 },
  muted: { color: "#889", fontSize: 14 },
};
