/**
 * usePanelLayout
 * ==============
 * Loads and saves a panel order for the current logged-in user.
 * Layout is stored in the user's ui_preferences on the server so it persists
 * across computers and sessions.
 *
 * Pass a unique `prefKey` so different pages can have independent layouts.
 * Defaults to "member_profile_panels" for backward compatibility.
 *
 * Returns:
 *   order    — current panel ID array (ordered from first to last)
 *   setOrder — update order locally + debounce-save to server
 *   loading  — true while fetching initial preferences
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../../core/api";

const SAVE_DEBOUNCE_MS = 800;

export function usePanelLayout(
  defaultOrder: string[],
  prefKey = "member_profile_panels",
) {
  const [order, setOrderState] = useState<string[]>(defaultOrder);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get("/api/v1/auth/me/preferences")
      .then(({ data }) => {
        const saved = data[prefKey];
        if (Array.isArray(saved) && saved.length > 0) {
          const merged = [
            ...saved.filter((id: string) => defaultOrder.includes(id)),
            ...defaultOrder.filter((id) => !saved.includes(id)),
          ];
          setOrderState(merged);
        }
      })
      .catch(() => { /* use default if fetch fails */ })
      .finally(() => setLoading(false));
  }, [prefKey]);

  const setOrder = useCallback((newOrder: string[]) => {
    setOrderState(newOrder);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch("/api/v1/auth/me/preferences", { [prefKey]: newOrder })
        .catch(() => { /* silently ignore save errors */ });
    }, SAVE_DEBOUNCE_MS);
  }, [prefKey]);

  return { order, setOrder, loading };
}

/**
 * usePanelHidden
 * ==============
 * Companion to usePanelLayout: the set of panel IDs this user has hidden.
 * Stored in the same ui_preferences bag under its own `prefKey`.
 *
 * Deliberately does NOT merge in unknown defaults the way usePanelLayout does —
 * a saved hidden list is exhaustive, and anything not in it is visible. That's
 * what makes a newly-added pane show up for everyone instead of inheriting
 * someone's old hidden state.
 */
export function usePanelHidden(prefKey: string) {
  const [hidden, setHiddenState] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get("/api/v1/auth/me/preferences")
      .then(({ data }) => {
        const saved = data[prefKey];
        if (Array.isArray(saved)) setHiddenState(saved.filter((id: unknown) => typeof id === "string"));
      })
      .catch(() => { /* nothing hidden if the fetch fails — fail visible, not blank */ })
      .finally(() => setLoading(false));
  }, [prefKey]);

  const setHidden = useCallback((next: string[]) => {
    setHiddenState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch("/api/v1/auth/me/preferences", { [prefKey]: next })
        .catch(() => { /* silently ignore save errors */ });
    }, SAVE_DEBOUNCE_MS);
  }, [prefKey]);

  return { hidden, setHidden, loading };
}
