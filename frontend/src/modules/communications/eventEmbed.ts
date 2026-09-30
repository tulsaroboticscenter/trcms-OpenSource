/**
 * Event embed for emails (#96)
 * ============================
 * Builds an HTML "event card" appended to an email body, with the event name
 * linking to the event page and three RSVP buttons whose hrefs are the
 * placeholders {{rsvp_attending}} / {{rsvp_not_attending}} / {{rsvp_maybe}} —
 * the backend swaps these for each recipient's tokenised no-login link at send
 * time. Built as inline-styled tables so it survives email clients.
 */
export interface EmbeddedEvent {
  id: number;
  name: string;
  event_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  details?: string | null;
  bring_enabled?: boolean;
}

function fmtDate(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d.length > 10 ? d : d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(t?: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** When + (location). */
export function eventWhen(ev: EmbeddedEvent): string {
  let when = fmtDate(ev.event_date);
  if (ev.end_date && ev.end_date !== ev.event_date) when += ` – ${fmtDate(ev.end_date)}`;
  const t = [fmtTime(ev.start_time), fmtTime(ev.end_time)].filter(Boolean).join(" – ");
  if (t) when += ` · ${t}`;
  return when;
}

/** The HTML block appended to the email body. `eventUrl` links the event name. */
export function eventCardHtml(ev: EmbeddedEvent, eventUrl: string): string {
  const when = eventWhen(ev);
  // Placeholders are per-event ({{rsvp_attending_<id>}}) so several event cards
  // can live in one email, each with its own buttons (resolved per recipient).
  const btn = (label: string, ph: string, color: string) =>
    `<a href="{{${ph}_${ev.id}}}" style="display:inline-block;margin:4px 4px;padding:11px 22px;border-radius:7px;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px">${label}</a>`;
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-collapse:collapse">
  <tr><td style="border:1px solid #d8e0ea;border-left:4px solid #1a3a5c;border-radius:8px;background:#ffffff;padding:18px 20px">
    <div style="font-size:18px;font-weight:800;margin-bottom:6px">
      <a href="${esc(eventUrl)}" style="color:#1a3a5c;text-decoration:none">${esc(ev.name)}</a>
    </div>
    ${when ? `<div style="font-size:13px;color:#475569;margin-bottom:4px">📅 ${esc(when)}</div>` : ""}
    ${ev.location ? `<div style="font-size:13px;color:#475569;margin-bottom:4px">📍 ${esc(ev.location)}</div>` : ""}
    ${ev.details ? `<div style="font-size:13px;color:#334155;margin:8px 0 0;line-height:1.5">${esc(ev.details)}</div>` : ""}
    <div style="margin-top:14px;text-align:center">
      <div style="font-size:12px;color:#64748b;margin-bottom:6px">Can you make it?</div>
      ${btn("Attending", "rsvp_attending", "#2e7d32")}
      ${btn("Not Attending", "rsvp_not_attending", "#c62828")}
      ${btn("Maybe", "rsvp_maybe", "#f57f17")}
    </div>
    ${ev.bring_enabled ? `<div style="margin-top:12px;text-align:center;border-top:1px solid #eef2f7;padding-top:12px">
      <div style="font-size:13px;color:#7b341e;font-weight:700;margin-bottom:6px">🍽️ Coming? Let us know what you can bring.</div>
      <a href="${esc(eventUrl)}" style="display:inline-block;padding:9px 18px;border-radius:7px;background:#00695c;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px">Sign up to bring something →</a>
    </div>` : ""}
  </td></tr>
</table>`;
}
