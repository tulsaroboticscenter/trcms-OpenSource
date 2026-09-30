import { useState, useEffect } from "react";

/**
 * Reactively reports whether the viewport is at/under `breakpoint` px wide.
 * Used to switch between desktop and mobile layouts. Inline styles can't carry
 * media queries, so we branch in JS off this hook.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}
