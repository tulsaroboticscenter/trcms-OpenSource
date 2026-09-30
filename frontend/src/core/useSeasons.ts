/**
 * The FIRST seasons defined in Season Manager, newest first.
 *
 * Season is a free-text column in several tables, so any field that captures one
 * must offer THIS list rather than a text box — otherwise "2026-27" and
 * "2026-2027" both get stored and silently split a season's data in two.
 */
import { useEffect, useState } from "react";
import { api } from "./api";

export function useSeasons(): string[] {
  const [seasons, setSeasons] = useState<string[]>([]);
  useEffect(() => {
    api.get("/api/v1/seasons/")
      .then((r) => setSeasons((r.data as { season: string }[]).map((s) => s.season)))
      .catch(() => setSeasons([]));
  }, []);
  return seasons;
}

/**
 * Options for a season <select>. Keeps a value that isn't in Season Manager
 * (legacy rows, or a season not created yet) selectable so nothing is silently
 * blanked on save.
 */
export function seasonOptions(seasons: string[], current?: string | null): string[] {
  return current && !seasons.includes(current) ? [...seasons, current] : seasons;
}
