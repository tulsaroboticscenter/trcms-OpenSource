/**
 * Module Manager — turn TRCMS modules on or off for the whole organization
 * (open-source Phase 2). The full schema is always installed; this controls
 * which features appear in nav, tiles, the command palette and routing, and
 * (for self-contained modules) whether their API responds.
 *
 * Stored server-side in system_config 'enabled_modules' as the disabled set, so
 * it applies to everyone. Core modules can't be turned off. Dependencies cascade:
 * turning a module off also turns off everything that needs it; turning one on
 * turns its prerequisites back on. The server re-resolves on save, so the UI
 * cascade is just for immediate feedback.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, RotateCcw, Save, Lock } from "lucide-react";

interface Mod {
  key: string; label: string; group: string;
  core: boolean; deps: string[]; enabled: boolean;
}

export default function ModuleManager() {
  const goBack = useGoBack("/admin");
  const { refreshUser } = useAuth();
  const [mods, setMods] = useState<Mod[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    api.get("/api/v1/modules").then((r) => {
      const list: Mod[] = r.data?.modules ?? [];
      setMods(list);
      setDisabled(new Set(list.filter((m) => !m.enabled).map((m) => m.key)));
    }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const byKey = useMemo(() => new Map(mods.map((m) => [m.key, m])), [mods]);
  // reverse edges: dependents[key] = modules that depend on key
  const dependents = useMemo(() => {
    const rev = new Map<string, string[]>();
    for (const m of mods) for (const d of m.deps) rev.set(d, [...(rev.get(d) ?? []), m.key]);
    return rev;
  }, [mods]);

  const isCore = (k: string) => !!byKey.get(k)?.core;

  function toggle(key: string) {
    if (isCore(key)) return;
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Enabling: clear this + pull every prerequisite back on (transitively).
        const stack = [key];
        while (stack.length) {
          const k = stack.pop()!;
          next.delete(k);
          for (const dep of byKey.get(k)?.deps ?? []) if (next.has(dep)) stack.push(dep);
        }
      } else {
        // Disabling: set this + cascade to everything that needs it (transitively).
        const stack = [key];
        while (stack.length) {
          const k = stack.pop()!;
          if (isCore(k)) continue;
          next.add(k);
          for (const dep of dependents.get(k) ?? []) if (!next.has(dep)) stack.push(dep);
        }
      }
      return next;
    });
  }

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    try {
      await api.put("/api/v1/modules", { disabled: [...disabled] });
      await refreshUser(); // update this admin's own nav/routes immediately
      setMsg("Saved — these modules are now set for everyone.");
      load();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }
  async function reset() {
    if (!confirm("Turn every module back on? This removes any module customization.")) return;
    setSaving(true); setErr(""); setMsg("");
    try {
      await api.post("/api/v1/modules/reset");
      await refreshUser();
      setMsg("All modules enabled.");
      load();
    } finally { setSaving(false); }
  }

  const enabledCount = mods.filter((m) => !disabled.has(m.key)).length;

  // Group for display, preserving catalog order of first appearance.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, Mod[]>();
    for (const m of mods) {
      if (!byGroup.has(m.group)) { byGroup.set(m.group, []); order.push(m.group); }
      byGroup.get(m.group)!.push(m);
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [mods]);

  // Why is a module off? (a disabled prerequisite) — for a helpful hint.
  const offBecauseOf = (m: Mod) =>
    m.deps.filter((d) => disabled.has(d)).map((d) => byKey.get(d)?.label ?? d);

  if (loading) return <div style={s.wrap}><p style={s.muted}>Loading…</p></div>;

  return (
    <div style={s.wrap}>
      <button onClick={goBack} style={s.back}><ArrowLeft size={14} /> Admin</button>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}>Modules</h1>
          <p style={s.sub}>
            Turn features on or off for your whole organization. Everything is installed;
            this only controls what appears and works. {enabledCount} of {mods.length} enabled.
          </p>
        </div>
        <div style={s.headBtns}>
          <button style={s.ghost} onClick={reset} disabled={saving}><RotateCcw size={14} /> Enable all</button>
          <button style={s.primary} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {msg && <div style={s.ok}>{msg}</div>}
      {err && <div style={s.err}>{err}</div>}

      {groups.map(({ group, items }) => (
        <div key={group} style={s.section}>
          <div style={s.groupLbl}>{group}</div>
          <div style={s.items}>
            {items.map((m) => {
              const on = !disabled.has(m.key);
              const reasons = !on ? offBecauseOf(m) : [];
              return (
                <label key={m.key} style={{ ...s.itemRow, opacity: m.core ? 0.85 : 1 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={m.core || saving}
                    onChange={() => toggle(m.key)}
                    style={s.cb}
                  />
                  <span style={s.itemLabel}>{m.label}</span>
                  {m.core && <span style={s.badge}><Lock size={11} /> Always on</span>}
                  {reasons.length > 0 && (
                    <span style={s.dep}>needs {reasons.join(", ")}</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#5a6b7d", cursor: "pointer", fontSize: 13, padding: "8px 0" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  headBtns: { display: "flex", gap: 8 },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a2634", margin: 0 },
  sub: { fontSize: 13, color: "#7a8899", margin: "4px 0 0", maxWidth: 560, lineHeight: 1.5 },
  section: { border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 12, background: "#fff" },
  groupLbl: { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#7a8899", marginBottom: 8 },
  items: { display: "flex", flexDirection: "column", gap: 5 },
  itemRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", background: "#f7fafc", border: "1px solid #eef2f6", borderRadius: 7, cursor: "pointer" },
  cb: { width: 16, height: 16, cursor: "pointer" },
  itemLabel: { flex: 1, fontSize: 13.5, color: "#33475b", fontWeight: 600 },
  badge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#7a8899", background: "#eef2f6", borderRadius: 5, padding: "2px 7px" },
  dep: { fontSize: 11.5, color: "#b06a00", background: "#fff4e3", border: "1px solid #f3dcae", borderRadius: 5, padding: "2px 7px" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ghost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, color: "#33475b", cursor: "pointer" },
  ok: { fontSize: 13, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  err: { fontSize: 13, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6c2", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  muted: { fontSize: 13, color: "#8b98a6" },
};
