import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { tourApi, type GuidedTour, type TourStep } from "./tourApi";
import { renderMarkdown } from "./markdown";
import { useAuth } from "../../core/AuthContext";

interface TourCtx {
  startTour: (key: string) => void;
  activeKey: string | null;
}
const Ctx = createContext<TourCtx>({ startTour: () => {}, activeKey: null });
export const useTour = () => useContext(Ctx);

const AUTO_SEEN_PREFIX = "trc_tour_seen_";  // localStorage key for auto-offer dismissal

export function TourProvider({ children }: { children: ReactNode }) {
  const [tour, setTour] = useState<GuidedTour | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Guided tours are disabled for outside volunteers — a tour navigates between routes and
  // would expose parts of the system outside their restricted interface. The API also
  // serves them no tours (defense in depth); this stops the client from ever launching one.
  const toursDisabled = user?.member_type === "volunteer";

  const startTour = useCallback((key: string) => {
    if (toursDisabled) return;
    tourApi.get(key)
      .then((t) => { if (t.steps && t.steps.length) { setTour(t); setIdx(0); } })
      .catch(() => {});
  }, [toursDisabled]);

  const close = useCallback(() => { setTour(null); setIdx(0); setRect(null); }, []);

  const step: TourStep | null = tour?.steps?.[idx] ?? null;

  // When the step changes: navigate if needed, then locate the spotlight target.
  useEffect(() => {
    if (!step) return;
    if (step.route && step.route !== location.pathname) navigate(step.route);
    let tries = 0;
    setRect(null);
    const locate = () => {
      if (!step.selector) { setRect(null); return; }
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 10) {
        timer = window.setTimeout(locate, 150);  // element may not be mounted yet
      }
    };
    let timer = window.setTimeout(locate, step.route && step.route !== location.pathname ? 350 : 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, idx]);

  // Keep the spotlight aligned on scroll/resize while a targeted step is showing.
  useEffect(() => {
    if (!step?.selector) return;
    const reflow = () => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => { window.removeEventListener("scroll", reflow, true); window.removeEventListener("resize", reflow); };
  }, [step]);

  const total = tour?.steps?.length ?? 0;
  const isLast = idx >= total - 1;
  const next = () => (isLast ? close() : setIdx((i) => i + 1));
  const back = () => setIdx((i) => Math.max(0, i - 1));

  return (
    <Ctx.Provider value={{ startTour, activeKey: tour?.tour_key ?? null }}>
      {children}
      {!toursDisabled && <AutoOffer onStart={startTour} />}
      {tour && step && (
        <TourOverlay
          step={step} rect={rect} index={idx} total={total} isLast={isLast}
          onNext={next} onBack={back} onClose={close} title={tour.title}
        />
      )}
    </Ctx.Provider>
  );
}

// Map a member_type to the role its members implicitly hold, so a role-targeted tour can
// be matched even if the type role isn't listed explicitly on the account.
const TYPE_ROLE: Record<string, string> = { youth: "Youth Member", parent: "Parent", mentor: "Mentor", volunteer: "Volunteer" };
function userHoldsRole(user: { roles?: string[]; member_type?: string } | null, role: string): boolean {
  if (!user) return false;
  if (user.roles?.includes(role)) return true;
  if (TYPE_ROLE[user.member_type ?? ""] === role) return true;
  if (role === "Mentor" && user.member_type === "mentor") return true; // Mentor covers the mentor family
  return false;
}

/** Offers the tour whose auto_key matches the current screen, once per browser. */
function AutoOffer({ onStart }: { onStart: (key: string) => void }) {
  const location = useLocation();
  const { user } = useAuth();
  const [offer, setOffer] = useState<GuidedTour | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    // Only auto-offer on the dashboard/home, once per session load, once per browser.
    if (checked.current) return;
    if (location.pathname !== "/") return;
    checked.current = true;
    tourApi.list().then((tours) => {
      // Among the not-yet-dismissed dashboard auto-offer tours, prefer one whose roles the
      // user ACTUALLY holds (a Youth/Parent getting-started tour), else the generic everyone
      // tour. The role match is deliberately NOT super-bypassed, so an admin isn't offered a
      // youth-only tour just because admins can see every tour.
      const dash = tours.filter((x) => x.auto_key === "dashboard" && !localStorage.getItem(AUTO_SEEN_PREFIX + x.tour_key));
      if (!dash.length) return;
      const roleTargeted = dash.find((x) => {
        const need = (x.roles ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        return need.length > 0 && need.some((r) => userHoldsRole(user, r));
      });
      const generic = dash.find((x) => (x.roles ?? "").trim() === "");
      setOffer(roleTargeted ?? generic ?? dash[0]);
    }).catch(() => {});
  }, [location.pathname, user]);

  if (!offer) return null;
  const dismiss = () => { localStorage.setItem(AUTO_SEEN_PREFIX + offer.tour_key, "1"); setOffer(null); };
  return (
    <div style={ao.card}>
      <div style={ao.title}>👋 New here?</div>
      <div style={ao.body}>{offer.description || "Take a quick tour to learn your way around."}</div>
      <div style={ao.row}>
        <button style={ao.skip} onClick={dismiss}>No thanks</button>
        <button style={ao.go} onClick={() => { localStorage.setItem(AUTO_SEEN_PREFIX + offer.tour_key, "1"); const k = offer.tour_key; setOffer(null); onStart(k); }}>
          Take the tour →
        </button>
      </div>
    </div>
  );
}

function TourOverlay({ step, rect, index, total, isLast, onNext, onBack, onClose, title }: {
  step: TourStep; rect: DOMRect | null; index: number; total: number; isLast: boolean;
  onNext: () => void; onBack: () => void; onClose: () => void; title: string;
}) {
  const pad = 6;
  const spotlight = rect
    ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Position the card: under the target if there's room below, else above; centered when untargeted.
  let card: React.CSSProperties;
  if (spotlight) {
    const below = spotlight.top + spotlight.height + 12;
    const preferBelow = below < window.innerHeight - 220;
    const left = Math.min(Math.max(12, spotlight.left), window.innerWidth - 372);
    card = preferBelow
      ? { top: below, left }
      : { top: Math.max(12, spotlight.top - 12), left, transform: "translateY(-100%)" };
  } else {
    card = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <div style={ov.root}>
      {/* Dimmer: a big box-shadow around the spotlight cuts a hole; full dim when untargeted. */}
      {spotlight ? (
        <div style={{ position: "fixed", ...spotlight, borderRadius: 8, boxShadow: "0 0 0 9999px rgba(15,23,42,0.66)", pointerEvents: "none", transition: "all 0.2s ease" }} />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.66)" }} onClick={onClose} />
      )}
      <div style={{ ...ov.card, ...card }}>
        <button style={ov.close} onClick={onClose} aria-label="End tour"><X size={16} /></button>
        <div style={ov.kicker}>{title}</div>
        <h3 style={ov.title}>{step.title}</h3>
        <div style={ov.body} dangerouslySetInnerHTML={{ __html: renderMarkdown(step.body) }} />
        <div style={ov.foot}>
          <span style={ov.progress}>{index + 1} / {total}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {index > 0 && <button style={ov.btnGhost} onClick={onBack}><ChevronLeft size={14} /> Back</button>}
            <button style={ov.btnPrimary} onClick={onNext}>
              {isLast ? <><Check size={14} /> Done</> : <>Next <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ov: Record<string, React.CSSProperties> = {
  root: { position: "fixed", inset: 0, zIndex: 2000 },
  card: { position: "fixed", width: 360, maxWidth: "92vw", background: "#fff", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.3)", padding: 18, zIndex: 2001 },
  close: { position: "absolute", top: 10, right: 10, background: "none", border: "none", color: "#99a", cursor: "pointer" },
  kicker: { fontSize: 11, fontWeight: 700, color: "#7e57c2", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontSize: 17, fontWeight: 800, color: "#1a3a5c", margin: "4px 0 8px" },
  body: { fontSize: 13.5, color: "#334", lineHeight: 1.55 },
  foot: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  progress: { fontSize: 12, color: "#889", fontWeight: 600 },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "1px solid #d6dde6", color: "#556", borderRadius: 7, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 4, background: "#5e35b1", border: "none", color: "#fff", borderRadius: 7, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
};

const ao: Record<string, React.CSSProperties> = {
  card: { position: "fixed", right: 20, bottom: 88, width: 300, background: "#fff", borderRadius: 12, boxShadow: "0 10px 34px rgba(0,0,0,0.22)", padding: 16, zIndex: 1400, border: "1px solid #e6e0f2" },
  title: { fontSize: 15, fontWeight: 800, color: "#1a3a5c" },
  body: { fontSize: 13, color: "#556", lineHeight: 1.5, margin: "6px 0 12px" },
  row: { display: "flex", justifyContent: "flex-end", gap: 8 },
  skip: { background: "none", border: "none", color: "#889", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  go: { background: "#5e35b1", border: "none", color: "#fff", borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
};
