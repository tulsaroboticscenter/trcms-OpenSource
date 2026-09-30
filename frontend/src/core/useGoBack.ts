import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/**
 * History-aware "Back" navigation. Returns a handler that goes to the previous
 * page the user actually came from (browser in-app history). If there is no
 * in-app history (e.g. the page was opened via a direct link or a fresh tab),
 * it falls back to the given path so the button always does something sensible.
 *
 * Usage:
 *   const goBack = useGoBack("/teams");
 *   <button onClick={goBack}>Back</button>
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback);
  }, [navigate, fallback]);
}
