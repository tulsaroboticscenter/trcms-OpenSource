// Curated team-page themes. Keys must match TeamsController::THEME_PRESETS /
// THEME_FONTS. All backgrounds are light so the existing (dark) text on the hero
// stays readable; the accent is what carries each team's color identity, and can
// be overridden with a custom accent color. No external fonts (CSP-safe stacks).

export interface ThemePreset {
  key: string;
  label: string;
  pageBg: string;      // CSS background for the whole team page
  heading: string;     // team-name / heading text color
  accent: string;      // default accent (tabs, badges, borders)
}

export const THEME_PRESETS: ThemePreset[] = [
  { key: "classic",  label: "Classic",  pageBg: "#f4f7fa", heading: "#1a3a5c", accent: "#1a3a5c" },
  { key: "bold",     label: "Bold",     pageBg: "#fff7ed", heading: "#7c2d12", accent: "#ea580c" },
  { key: "midnight", label: "Midnight", pageBg: "linear-gradient(135deg,#eef2ff,#e0e7ff)", heading: "#1e3a8a", accent: "#4f46e5" },
  { key: "forest",   label: "Forest",   pageBg: "#f0fdf4", heading: "#14532d", accent: "#16a34a" },
  { key: "sunset",   label: "Sunset",   pageBg: "linear-gradient(135deg,#fff1f2,#ffe4e6)", heading: "#9f1239", accent: "#e11d48" },
  { key: "pink",     label: "Pink",     pageBg: "linear-gradient(135deg,#fdf2f8,#fce7f3)", heading: "#9d174d", accent: "#db2777" },
  { key: "purple",   label: "Purple",   pageBg: "linear-gradient(135deg,#faf5ff,#f3e8ff)", heading: "#6b21a8", accent: "#9333ea" },
  { key: "retro",    label: "Retro",    pageBg: "#fefce8", heading: "#713f12", accent: "#ca8a04" },
  { key: "mono",     label: "Mono",     pageBg: "#f8fafc", heading: "#0f172a", accent: "#475569" },
];

/**
 * Readable text color for a solid background: light text on dark colors, dark
 * text on light ones. Uses perceived luminance (sRGB) so a custom accent (e.g.
 * a pale pink or yellow) doesn't get unreadable white text.
 */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1a3a5c" : "#ffffff";
}

export interface FontOption { key: string; label: string; family: string; }

export const THEME_FONTS: FontOption[] = [
  { key: "sans",    label: "Sans",    family: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  { key: "serif",   label: "Serif",   family: 'Georgia, "Times New Roman", serif' },
  { key: "rounded", label: "Rounded", family: '"Trebuchet MS", Verdana, sans-serif' },
  { key: "slab",    label: "Slab",    family: '"Rockwell", "Courier New", Georgia, serif' },
  { key: "display", label: "Display", family: '"Arial Black", Impact, sans-serif' },
];

export interface ResolvedTheme {
  pageBg: string;
  heading: string;
  accent: string;
  accentText: string;   // readable text color to sit on the accent (e.g. active tab)
  fontFamily: string;
}

export function resolveTheme(
  preset?: string | null, font?: string | null, accent?: string | null,
): ResolvedTheme {
  const p = THEME_PRESETS.find((x) => x.key === preset) ?? THEME_PRESETS[0];
  const f = THEME_FONTS.find((x) => x.key === font) ?? THEME_FONTS[0];
  const custom = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null;
  const acc = custom ?? p.accent;
  return { pageBg: p.pageBg, heading: p.heading, accent: acc, accentText: textOn(acc), fontFamily: f.family };
}
