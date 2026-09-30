/**
 * SeasonParticipationPanel
 * ========================
 * Embedded in MemberProfile for both youth and mentors.
 *
 * Shows every FIRST season as a row. For each season that has game names defined,
 * checkboxes appear for FLL Explore, FLL Challenge, FTC, FRC, and FDP.
 * Members (or admins) can check/uncheck which games they participated in.
 *
 * The "Years of Experience" count at the top is automatically calculated as the
 * number of seasons where at least one checkbox is checked.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { seasonsApi, type SeasonParticipation, type MemberParticipationResponse } from "../api";
import { Trophy, Pencil, Check } from "lucide-react";

interface Props { memberId: number; canEdit?: boolean; }

const GAME_FIELDS = [
  { key: "participated_fll_explore",   gameKey: "fll_explore_game",   label: "FLL Explore",   color: "#e65100" },
  { key: "participated_fll_challenge", gameKey: "fll_challenge_game", label: "FLL Challenge",  color: "#1565c0" },
  { key: "participated_ftc",           gameKey: "ftc_game",           label: "FTC",            color: "#2e7d32" },
  { key: "participated_frc",           gameKey: "frc_game",           label: "FRC",            color: "#c62828" },
  { key: "participated_fdp",           gameKey: "fdp_game",           label: "FDP",            color: "#6a1b9a" },
] as const;

export default function SeasonParticipationPanel({ memberId, canEdit: canEditOverride }: Props) {
  const { user, isAdmin, hasRole } = useAuth();
  // An explicit canEdit prop wins (e.g. the parent youth-edit page); otherwise
  // derive it: admins, mentors, or the member viewing their own record.
  const canEdit = canEditOverride ?? (isAdmin || hasRole("Admin", "System Administrator", "Mentor") || user?.id === memberId);

  const [data, setData] = useState<MemberParticipationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);  // season_id being saved
  const [editing, setEditing] = useState(false);  // edit mode reveals all game options
  // Track pending changes per season before sending to server
  const [pending, setPending] = useState<Record<number, Record<string, boolean>>>({});

  const load = useCallback(() => {
    seasonsApi.getMemberParticipation(memberId)
      .then(setData).finally(() => setLoading(false));
  }, [memberId]);

  useEffect(() => { load(); }, [load]);

  async function toggleGame(season: SeasonParticipation, fieldKey: string, currentValue: boolean) {
    if (!canEdit) return;

    // Optimistically update pending state
    const newVal = !currentValue;
    setPending(prev => ({
      ...prev,
      [season.season_id]: {
        ...(prev[season.season_id] ?? {}),
        [fieldKey]: newVal,
      },
    }));

    // Build full participation object with this change applied
    const merged = {
      participated_fll_explore:   getVal(season, "participated_fll_explore",   fieldKey, newVal),
      participated_fll_challenge: getVal(season, "participated_fll_challenge",  fieldKey, newVal),
      participated_ftc:           getVal(season, "participated_ftc",            fieldKey, newVal),
      participated_frc:           getVal(season, "participated_frc",            fieldKey, newVal),
      participated_fdp:           getVal(season, "participated_fdp",            fieldKey, newVal),
      notes: season.notes ?? undefined,
    };

    setSaving(season.season_id);
    try {
      const result = await seasonsApi.saveParticipation(memberId, season.season_id, merged);
      // Update data with authoritative server response
      setData(prev => {
        if (!prev) return prev;
        return {
          experience_years: result.experience_years,
          seasons: prev.seasons.map(s =>
            s.season_id === season.season_id
              ? { ...s, ...result.participation }
              : s
          ),
        };
      });
      // Clear pending for this season
      setPending(prev => {
        const next = { ...prev };
        delete next[season.season_id];
        return next;
      });
    } catch {
      // Revert on error
      setPending(prev => {
        const next = { ...prev };
        delete next[season.season_id];
        return next;
      });
    } finally {
      setSaving(null);
    }
  }

  function getVal(
    season: SeasonParticipation,
    field: string,
    changedField: string,
    newVal: boolean
  ): boolean {
    if (field === changedField) return newVal;
    // Check pending state first, then existing season data
    const pendingForSeason = pending[season.season_id];
    if (pendingForSeason && field in pendingForSeason) return pendingForSeason[field];
    return (season as unknown as Record<string, boolean>)[field];
  }

  function getDisplayVal(season: SeasonParticipation, field: string): boolean {
    const p = pending[season.season_id];
    if (p && field in p) return p[field];
    return (season as unknown as Record<string, boolean>)[field];
  }

  if (loading) return <p style={styles.muted}>Loading participation…</p>;
  if (!data) return null;

  // Seasons that have at least one game defined, most recent first.
  const activeSeasonsAll = data.seasons
    .filter(s => s.fll_explore_game || s.fll_challenge_game || s.ftc_game || s.frc_game || s.fdp_game)
    .sort((a, b) => (b.season ?? "").localeCompare(a.season ?? ""));

  const participatedIn = (s: SeasonParticipation) =>
    s.has_participation || Object.values(pending[s.season_id] ?? {}).some(Boolean);
  const withParticipation = activeSeasonsAll.filter(participatedIn);

  // View mode shows only seasons (and games) actually participated in — compact.
  // Edit mode reveals every season + every game option so records can be updated.
  const displaySeasons = editing ? activeSeasonsAll : withParticipation;

  return (
    <div>
      {/* Years of experience header */}
      <div style={styles.experienceHeader}>
        <Trophy size={16} color="#f57c00" />
        <span style={styles.experienceNum}>{data.experience_years}</span>
        <span style={styles.experienceLabel}>
          year{data.experience_years !== 1 ? "s" : ""} of FIRST experience
        </span>
        {canEdit && (
          <button style={styles.editBtn} onClick={() => setEditing(v => !v)}>
            {editing ? <><Check size={13} /> Done</> : <><Pencil size={12} /> Edit</>}
          </button>
        )}
      </div>

      {displaySeasons.length === 0 && (
        <p style={styles.muted}>No FIRST participation recorded yet.{canEdit && !editing ? " Click Edit to add it." : ""}</p>
      )}

      <div style={styles.seasonList}>
        {displaySeasons.map(s => {
          const isSaving = saving === s.season_id;
          const availableGames = GAME_FIELDS.filter(g => (s as unknown as Record<string, string>)[g.gameKey]);
          const playedGames = availableGames.filter(g => getDisplayVal(s, g.key));

          // ── Condensed (view) mode: show only the games participated in ──
          if (!editing) {
            return (
              <div key={s.season_id} style={styles.viewRow}>
                <span style={styles.seasonYear}>{s.season}</span>
                {s.theme && <span style={styles.seasonTheme}>{s.theme}</span>}
                <div style={styles.playedGames}>
                  {playedGames.map(game => (
                    <span key={game.key} style={{ ...styles.playedBadge, color: game.color, borderColor: `${game.color}55`, background: `${game.color}12` }}>
                      {game.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          }

          // ── Edit mode: full checkbox grid for every available game ──
          return (
            <div key={s.season_id} style={{ ...styles.seasonRow, opacity: isSaving ? 0.7 : 1 }}>
              <div style={styles.seasonLabel}>
                <span style={styles.seasonYear}>{s.season}</span>
                {s.theme && <span style={styles.seasonTheme}>{s.theme}</span>}
                {s.notes && <span style={styles.seasonNotes}>{s.notes}</span>}
              </div>
              <div style={styles.gameGrid}>
                {availableGames.map(game => {
                  const checked = getDisplayVal(s, game.key);
                  const gameName = (s as unknown as Record<string, string>)[game.gameKey];
                  return (
                    <label
                      key={game.key}
                      style={{
                        ...styles.gameCheckbox,
                        ...(checked ? { ...styles.gameChecked, borderColor: game.color, background: `${game.color}15` } : {}),
                        cursor: !isSaving ? "pointer" : "default",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSaving}
                        onChange={() => toggleGame(s, game.key, checked)}
                        style={{ display: "none" }}
                      />
                      <div style={{ ...styles.gameCheckIndicator, borderColor: checked ? game.color : "#ccc", background: checked ? game.color : "#fff" }}>
                        {checked && <span style={styles.checkMark}>✓</span>}
                      </div>
                      <div>
                        <div style={{ ...styles.gameProgramLabel, color: game.color }}>{game.label}</div>
                        <div style={styles.gameNameLabel}>{gameName}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {!canEdit && (
        <p style={styles.readOnlyNote}>Contact your admin or mentor to update participation records.</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  experienceHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 12px", background: "#fff8e1", borderRadius: 8, border: "1px solid #ffd54f" },
  experienceNum: { fontSize: 24, fontWeight: 900, color: "#f57c00", lineHeight: 1 },
  experienceLabel: { fontSize: 14, fontWeight: 600, color: "#795548" },
  experienceNote: { fontSize: 11, color: "#aaa", marginLeft: 4 },
  editBtn: { display: "flex", alignItems: "center", gap: 5, marginLeft: "auto", padding: "5px 12px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  seasonList: { display: "flex", flexDirection: "column", gap: 6 },
  viewRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: "1px solid #f0f4f8", flexWrap: "wrap" as const },
  playedGames: { display: "flex", flexWrap: "wrap" as const, gap: 6, marginLeft: "auto" },
  playedBadge: { fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 10, border: "1px solid", textTransform: "uppercase" as const, letterSpacing: 0.3 },
  seasonRow: { border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", transition: "opacity 0.15s" },
  seasonLabel: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f0f4f8", borderBottom: "1px solid #e2e8f0" },
  seasonYear: { fontWeight: 800, fontSize: 13, color: "#1a3a5c", minWidth: 75 },
  seasonTheme: { fontSize: 12, fontWeight: 600, color: "#555" },
  seasonNotes: { fontSize: 11, color: "#999", fontStyle: "italic" },
  gameGrid: { display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px" },
  gameCheckbox: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 7, background: "#fafafa", userSelect: "none" as const, minWidth: 150 },
  gameChecked: {},
  gameCheckIndicator: { width: 18, height: 18, borderRadius: 4, border: "2px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" },
  checkMark: { fontSize: 11, color: "#fff", fontWeight: 900 },
  gameProgramLabel: { fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  gameNameLabel: { fontSize: 12, color: "#333", fontWeight: 500, marginTop: 1 },
  toggleBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, padding: "8px 0", marginTop: 4 },
  readOnlyNote: { fontSize: 11, color: "#aaa", fontStyle: "italic", marginTop: 8 },
};
