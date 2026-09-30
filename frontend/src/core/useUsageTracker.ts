import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api } from "./api";

/**
 * Emits the in-app usage stream powering the User Activity report: a 'pageview'
 * on each route change and a 'heartbeat' every 60s while the tab is visible.
 * Events are queued and flushed in small batches so we're not chatty.
 *
 * Paths are normalized here (query/hash dropped, numeric ids -> :id) so no
 * record ids or query params ever leave the browser — the log stays privacy-safe
 * and top-pages aggregate cleanly. The backend re-sanitizes as defense in depth.
 */
function normalize(p: string): string {
  let path = p.split("?")[0].split("#")[0];
  path = path.replace(/\/\d+/g, "/:id");
  return path.slice(0, 200);
}

// Incident Reports §7.4: never emit usage events for the incident report form — a page-view
// timestamp could correlate to an anonymous submission. The backend also drops this path.
function suppressed(path: string): boolean {
  return path.startsWith("/incidents/new");
}

export function useUsageTracker(enabled: boolean) {
  const location = useLocation();
  const queue = useRef<{ type: string; path: string }[]>([]);
  const pathRef = useRef(normalize(location.pathname));

  const flush = () => {
    if (!queue.current.length) return;
    const events = queue.current.splice(0, queue.current.length);
    api.post("/api/v1/usage/track", { events }).catch(() => { /* fire-and-forget */ });
  };

  // Record a page view whenever the route changes.
  useEffect(() => {
    if (!enabled) return;
    pathRef.current = normalize(location.pathname);
    if (suppressed(pathRef.current)) return;
    queue.current.push({ type: "pageview", path: pathRef.current });
  }, [location.pathname, enabled]);

  // Heartbeats + periodic flush + flush-on-hide.
  useEffect(() => {
    if (!enabled) return;
    const hb = setInterval(() => {
      if (document.visibilityState === "visible" && !suppressed(pathRef.current)) queue.current.push({ type: "heartbeat", path: pathRef.current });
    }, 60000);
    const fl = setInterval(flush, 30000);
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(hb);
      clearInterval(fl);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
