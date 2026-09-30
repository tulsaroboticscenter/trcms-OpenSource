/**
 * EventSponsorshipPane — on the event detail page. Shows sponsorship packages and
 * the sponsor pipeline (interest → commitment → fulfilment) with totals vs. goal.
 * Managers (sponsors.manage) can open the event, define packages, and manage the
 * pipeline; everyone else sees it read-only when the event is sponsorable.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { eventSponsorshipApi, type EventSponsorship, type EsStage } from "../eventSponsorshipApi";
import { sponsorsApi, money, type SponsorSummary } from "../../sponsors/api";
import { Handshake, Plus, Trash2, Check } from "lucide-react";

const STAGES: { key: EsStage; label: string; color: string }[] = [
  { key: "prospect", label: "Prospect", color: "#90a4ae" },
  { key: "invited", label: "Invited", color: "#7986cb" },
  { key: "interested", label: "Interested", color: "#1565c0" },
  { key: "committed", label: "Committed", color: "#00897b" },
  { key: "fulfilled", label: "Fulfilled", color: "#2e7d32" },
  { key: "declined", label: "Declined", color: "#b0bcc9" },
];
const stageMeta = (k: EsStage) => STAGES.find((x) => x.key === k) ?? STAGES[2];

export default function EventSponsorshipPane({ eventId }: { eventId: number }) {
  const { canWrite } = useAuth();
  const canManage = canWrite("sponsors.manage");
  const [d, setD] = useState<EventSponsorship | null>(null);
  const [sponsors, setSponsors] = useState<SponsorSummary[]>([]);
  const [addingPkg, setAddingPkg] = useState(false);
  const [pkg, setPkg] = useState({ name: "", price: "", quantity_available: "", benefits: "" });
  const [addingSponsor, setAddingSponsor] = useState(false);
  const [newEntry, setNewEntry] = useState({ sponsor_id: "", package_id: "", pledged_amount: "", stage: "interested" as EsStage });

  const load = useCallback(() => { eventSponsorshipApi.get(eventId).then(setD).catch(() => setD(null)); }, [eventId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canManage) sponsorsApi.list().then(setSponsors).catch(() => {}); }, [canManage]);

  if (!d) return null;
  if (!d.settings.is_sponsorable && !canManage) return null;

  const t = d.totals;
  const pct = t.goal && t.goal > 0 ? Math.min(100, Math.round((t.received / t.goal) * 100)) : null;
  const available = sponsors.filter((sp) => !d.pipeline.some((e) => e.sponsor_id === sp.id));

  async function saveSettings(patch: Record<string, unknown>) { setD(await eventSponsorshipApi.updateSettings(eventId, patch)); }
  async function addPackage() {
    if (!pkg.name.trim()) return;
    setD(await eventSponsorshipApi.addPackage(eventId, pkg));
    setPkg({ name: "", price: "", quantity_available: "", benefits: "" }); setAddingPkg(false);
  }
  async function addEntry() {
    if (!newEntry.sponsor_id) return;
    setD(await eventSponsorshipApi.addEntry(eventId, { ...newEntry, package_id: newEntry.package_id || null }));
    setNewEntry({ sponsor_id: "", package_id: "", pledged_amount: "", stage: "interested" }); setAddingSponsor(false);
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span style={s.title}><Handshake size={17} /> Event Sponsorship</span>
        {canManage && (
          <label style={s.toggle}>
            <input type="checkbox" checked={d.settings.is_sponsorable} onChange={(e) => saveSettings({ is_sponsorable: e.target.checked })} />
            <span>Open for sponsorship</span>
          </label>
        )}
      </div>

      {!d.settings.is_sponsorable ? (
        <p style={s.muted}>This event isn't open for sponsorship yet.</p>
      ) : (
        <>
          {/* Totals */}
          <div style={s.totals}>
            <Stat label="Interested" value={String(t.interested_count)} />
            <Stat label="Committed" value={String(t.committed_count)} />
            <Stat label="Pledged" value={money(t.pledged)} />
            <Stat label="Received" value={money(t.received)} color="#2e7d32" />
            {t.goal != null && <Stat label="Goal" value={money(t.goal)} />}
          </div>
          {pct != null && (
            <div style={s.progressTrack}><div style={{ ...s.progressFill, width: `${pct}%` }} /><span style={s.progressPct}>{pct}% of goal</span></div>
          )}
          {canManage && (
            <div style={s.settingsRow}>
              <label style={s.setLabel}>Goal $<input style={s.setIn} defaultValue={d.settings.sponsorship_goal ?? ""} onBlur={(e) => saveSettings({ sponsorship_goal: e.target.value })} /></label>
              <label style={s.setLabel}>Deadline <input type="date" style={s.setIn} defaultValue={d.settings.sponsorship_deadline ?? ""} onChange={(e) => saveSettings({ sponsorship_deadline: e.target.value })} /></label>
            </div>
          )}

          {/* Packages */}
          <div style={s.subhead}>Packages</div>
          <div style={s.pkgGrid}>
            {d.packages.map((p) => (
              <div key={p.id} style={s.pkgCard}>
                <div style={s.pkgTop}>
                  <span style={s.pkgName}>{p.name}</span>
                  {canManage && <button style={s.iconX} onClick={async () => { if (confirm("Delete package?")) setD(await eventSponsorshipApi.deletePackage(p.id)); }}><Trash2 size={12} /></button>}
                </div>
                <div style={s.pkgPrice}>{money(p.price)}</div>
                {p.benefits && <div style={s.pkgBenefits}>{p.benefits}</div>}
                {p.quantity_available != null && <div style={s.pkgSlots}>{p.slots_remaining} of {p.quantity_available} left</div>}
              </div>
            ))}
            {d.packages.length === 0 && <p style={s.muted}>No packages defined.</p>}
          </div>
          {canManage && (addingPkg ? (
            <div style={s.addForm}>
              <div style={s.formRow}>
                <input style={{ ...s.fin, flex: 2 }} placeholder="Package name (e.g. Hole Sponsor)" value={pkg.name} onChange={(e) => setPkg({ ...pkg, name: e.target.value })} />
                <input style={s.fin} placeholder="Price" value={pkg.price} onChange={(e) => setPkg({ ...pkg, price: e.target.value })} />
                <input style={s.fin} placeholder="Qty (blank=∞)" value={pkg.quantity_available} onChange={(e) => setPkg({ ...pkg, quantity_available: e.target.value })} />
              </div>
              <div style={s.formRow}>
                <input style={{ ...s.fin, flex: 3 }} placeholder="Benefits" value={pkg.benefits} onChange={(e) => setPkg({ ...pkg, benefits: e.target.value })} />
                <button style={s.cancelSm} onClick={() => setAddingPkg(false)}>Cancel</button>
                <button style={s.saveSm} onClick={addPackage}>Add</button>
              </div>
            </div>
          ) : <button style={s.addBtn} onClick={() => setAddingPkg(true)}><Plus size={13} /> Add package</button>)}

          {/* Pipeline */}
          <div style={s.subhead}>Sponsors</div>
          {d.pipeline.map((e) => (
            <div key={e.id} style={s.entry}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.entryTop}>
                  <span style={{ ...s.stageDot, background: stageMeta(e.stage).color }} />
                  <span style={s.entryName}>{e.sponsor_name}</span>
                  {e.package_name && <span style={s.pkgTag}>{e.package_name}</span>}
                </div>
                <div style={s.entryMeta}>
                  {e.pledged_amount != null && <>pledged {money(e.pledged_amount)} · </>}
                  {e.received_amount != null && <>received {money(e.received_amount)} · </>}
                  {stageMeta(e.stage).label}
                </div>
              </div>
              {canManage && (
                <div style={s.entryActions}>
                  <select style={s.stageSel} value={e.stage} onChange={async (ev) => setD(await eventSponsorshipApi.updateEntry(e.id, { stage: ev.target.value }))}>
                    {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                  {e.received_amount == null && (
                    <button style={s.markBtn} title="Mark received (uses pledged amount)"
                      onClick={async () => setD(await eventSponsorshipApi.updateEntry(e.id, { stage: "fulfilled", received_amount: e.pledged_amount ?? 0, received_date: new Date().toISOString().slice(0, 10) }))}>
                      <Check size={12} /> Received
                    </button>
                  )}
                  <button style={s.iconX} onClick={async () => { if (confirm("Remove sponsor from event?")) setD(await eventSponsorshipApi.deleteEntry(e.id)); }}><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
          {d.pipeline.length === 0 && <p style={s.muted}>No sponsors on this event yet.</p>}

          {canManage && (addingSponsor ? (
            <div style={s.addForm}>
              <div style={s.formRow}>
                <select style={{ ...s.fin, flex: 2 }} value={newEntry.sponsor_id} onChange={(e) => setNewEntry({ ...newEntry, sponsor_id: e.target.value })}>
                  <option value="">Select sponsor…</option>
                  {available.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </select>
                <select style={s.fin} value={newEntry.package_id} onChange={(e) => setNewEntry({ ...newEntry, package_id: e.target.value })}>
                  <option value="">No package</option>
                  {d.packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={s.formRow}>
                <select style={s.fin} value={newEntry.stage} onChange={(e) => setNewEntry({ ...newEntry, stage: e.target.value as EsStage })}>
                  {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <input style={s.fin} placeholder="Pledged amount" value={newEntry.pledged_amount} onChange={(e) => setNewEntry({ ...newEntry, pledged_amount: e.target.value })} />
                <button style={s.cancelSm} onClick={() => setAddingSponsor(false)}>Cancel</button>
                <button style={s.saveSm} onClick={addEntry}>Add</button>
              </div>
              {available.length === 0 && <p style={s.muted}>All sponsors are already on this event. Create more in the Sponsors module.</p>}
            </div>
          ) : <button style={s.addBtn} onClick={() => setAddingSponsor(true)}><Plus size={13} /> Add sponsor</button>)}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div style={s.stat}><div style={s.statLabel}>{label}</div><div style={{ ...s.statVal, ...(color ? { color } : {}) }}>{value}</div></div>;
}

const s: Record<string, React.CSSProperties> = {
  wrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginTop: 16 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  toggle: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#556", cursor: "pointer" },
  muted: { color: "#889", fontSize: 13, margin: "8px 0" },
  totals: { display: "flex", flexWrap: "wrap", gap: 18, margin: "12px 0" },
  stat: { minWidth: 70 },
  statLabel: { fontSize: 11, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 },
  statVal: { fontSize: 18, fontWeight: 800, color: "#1a3a5c", marginTop: 2 },
  progressTrack: { position: "relative", height: 18, background: "#eef2f7", borderRadius: 9, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", background: "#2e7d32", borderRadius: 9 },
  progressPct: { position: "absolute", right: 8, top: 1, fontSize: 11, fontWeight: 700, color: "#334155" },
  settingsRow: { display: "flex", gap: 14, flexWrap: "wrap", margin: "6px 0 4px" },
  setLabel: { fontSize: 12, color: "#556", display: "flex", alignItems: "center", gap: 6 },
  setIn: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, width: 130 },
  subhead: { fontSize: 12, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, margin: "16px 0 8px", borderTop: "1px solid #eef2f7", paddingTop: 12 },
  pkgGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 },
  pkgCard: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, background: "#f8fafc" },
  pkgTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  pkgName: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  pkgPrice: { fontSize: 15, fontWeight: 800, color: "#00695c", marginTop: 2 },
  pkgBenefits: { fontSize: 12, color: "#667", marginTop: 4 },
  pkgSlots: { fontSize: 11, color: "#889", marginTop: 5, fontWeight: 600 },
  addForm: { background: "#f8fafc", border: "1px dashed #cdd7e3", borderRadius: 8, padding: 10, marginTop: 8 },
  formRow: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" },
  fin: { flex: 1, minWidth: 110, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, padding: "7px 13px", fontSize: 13, fontWeight: 600, color: "#1565c0", cursor: "pointer", marginTop: 8 },
  saveSm: { background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  cancelSm: { background: "#fff", border: "1px solid #ccc", borderRadius: 6, padding: "7px 12px", fontSize: 13, cursor: "pointer" },
  entry: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #f0f4f8" },
  entryTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  stageDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  entryName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  pkgTag: { fontSize: 11, fontWeight: 600, background: "#eef4fb", color: "#1565c0", borderRadius: 5, padding: "1px 7px" },
  entryMeta: { fontSize: 12, color: "#778", marginTop: 3 },
  entryActions: { display: "flex", alignItems: "center", gap: 6 },
  stageSel: { padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, background: "#fff" },
  markBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7", borderRadius: 6, padding: "5px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  iconX: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 3 },
};
