/**
 * TeamBudgetPanel — embeddable budget manager scoped to a single team-season.
 * No team picker; the team is fixed by the teamSeasonId prop.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, type TeamBudget, type BudgetCategoryRec, type Donation, type AdhocExpense } from "../api";
import { PlusCircle, Trash2, Edit2, PiggyBank, ChevronRight, ChevronDown, Check, X } from "lucide-react";

const SUGGESTED = [
  "FIRST Registration", "OK Registration", "Early Season Robot", "Late Season Robot",
  "Pit Expenses", "Travel — State", "Travel — Worlds", "Travel — Off-Season",
];
const SUB_SUGGESTED = [
  "Drive Train", "Climbing System", "Shooting System", "Intake", "Bumpers",
  "Electronics", "Pneumatics", "Arm / Manipulator", "Chassis / Frame",
];

export default function TeamBudgetPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { canWrite } = useAuth();
  const canManage = canWrite("inventory.budgets");
  // Prior-year carryover is admin-only (own permission), separate from general budget editing.
  const canCarryover = canWrite("inventory.carryover");
  const [budget, setBudget] = useState<TeamBudget | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingFund, setAddingFund] = useState(false);
  const [editing, setEditing] = useState<BudgetCategoryRec | null>(null);
  const [subParent, setSubParent] = useState<number | null>(null);
  const [editCarry, setEditCarry] = useState(false);
  const [carryVal, setCarryVal] = useState("");

  const load = useCallback(() => {
    inventoryApi.getTeamBudget(teamSeasonId).then(setBudget).catch(() => {});
  }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);

  if (!budget) return <p style={st.muted}>Loading budget…</p>;

  const spend = budget.categories.filter((c) => !c.is_fundraising);
  const fund = budget.categories.filter((c) => c.is_fundraising);
  const parents = spend.filter((c) => c.parent_id == null);
  const kidsOf = (id: number) => spend.filter((c) => c.parent_id === id);
  const delCat = (c: BudgetCategoryRec) =>
    inventoryApi.deleteBudgetCategory(c.id).then(load).catch((e) =>
      alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not delete."));

  // One spending category's row (progress bar + figures). Children render with
  // rolled-up spend already folded in by the backend; a parent also shows how
  // much of its budget is carved out to sub-systems vs. still unallocated.
  const catCard = (c: BudgetCategoryRec, isChild: boolean) => {
    const budgeted = c.budgeted_amount ?? 0;
    const spent = c.actual_amount ?? 0;
    const pending = c.pending_amount ?? 0;
    const spentPct = budgeted ? Math.min(100, (spent / budgeted) * 100) : 0;
    const pendingPct = budgeted ? Math.min(100 - spentPct, (pending / budgeted) * 100) : 0;
    const over = spent + pending > budgeted && budgeted > 0;
    return (
      <div style={{ ...st.catRow, ...(isChild ? st.childRow : {}) }}>
        <div style={st.catTop}>
          <span style={st.catName}>{c.name}</span>
          <span style={st.catFig}>
            ${spent.toFixed(0)}{pending > 0 && <span style={st.pendingFig}> +${pending.toFixed(0)} pending</span>} / ${budgeted.toFixed(0)}
            {over && <span style={st.overFig}> over</span>}
          </span>
          {canManage && (
            <span style={st.catActions}>
              <button style={st.iconBtn} onClick={() => { setEditing(c); setAdding(false); setSubParent(null); }}><Edit2 size={12} /></button>
              <button style={st.iconBtn} onClick={() => delCat(c)}><Trash2 size={12} color="#c62828" /></button>
            </span>
          )}
        </div>
        {c.has_children && (
          <div style={st.allocLine}>
            Allocated to sub-systems ${(c.child_budget_total ?? 0).toFixed(0)} ·{" "}
            <span style={{ color: (c.unallocated ?? 0) < 0 ? "#c62828" : "#1565c0" }}>
              Unallocated ${(c.unallocated ?? 0).toFixed(0)}
            </span>
          </div>
        )}
        <div style={st.bar}>
          <div style={{ ...st.barFill, width: `${spentPct}%`, background: over ? "#c62828" : "#2e7d32" }} />
          <div style={{ ...st.barFill, width: `${pendingPct}%`, background: "#e65100" }} />
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={st.totals}>
        <Tot label="Budgeted" value={budget.totals.budgeted} color="#1a3a5c" />
        <Tot label="Spent" value={budget.totals.actual} color="#2e7d32" />
        <Tot label="Pending" value={budget.totals.pending ?? 0} color="#e65100" />
        <Tot label="Remaining" value={budget.totals.budgeted - budget.totals.actual - (budget.totals.pending ?? 0)} color="#1a3a5c" />
      </div>

      {(() => {
        const t = budget.totals;
        const raised = t.fundraising_raised;
        const expected = t.fundraising_expected ?? 0;
        const carryover = t.carryover ?? 0;
        const raisedRestricted = t.fundraising_raised_restricted ?? 0;
        const expectedRestricted = t.fundraising_expected_restricted ?? 0;
        const netAvailable = carryover + raised - t.actual;
        // Restricted money stays reserved for its purpose; spending (and carryover)
        // draw from unrestricted funds first, so restricted Net Available = restricted
        // received, and unrestricted = the rest of the pool minus spend.
        const netRestricted = raisedRestricted;
        const netUnrestricted = netAvailable - netRestricted;
        return (
          <div style={st.fundTotals}>
            <Tot label="Fundraising Target" value={t.fundraising_goal} color="#1565c0" />
            <Tot label="Received" value={raised} color="#2e7d32"
              sub={<SplitNote restricted={raisedRestricted} unrestricted={raised - raisedRestricted} />} />
            <Tot label="Expected" value={expected} color="#6a1b9a"
              sub={<SplitNote restricted={expectedRestricted} unrestricted={expected - expectedRestricted} />} />
            <Tot label="Net Available" value={netAvailable} color={netAvailable < 0 ? "#c62828" : "#2e7d32"}
              sub={<SplitNote restricted={netRestricted} unrestricted={netUnrestricted} />} />
          </div>
        );
      })()}

      {/* Prior-year carryover (surplus or deficit) — admin editable */}
      <div style={st.carryRow}>
        <span style={st.carryLabel}>
          <PiggyBank size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          Prior-Year Carryover
          <span style={st.carryHint}> — surplus or deficit brought forward; included in Net Available</span>
        </span>
        {editCarry ? (
          <span style={st.carryEdit}>
            <span style={{ color: "#888" }}>$</span>
            <input style={st.carryInput} type="number" step="0.01" value={carryVal} autoFocus
              placeholder="e.g. 250 or -150" onChange={(e) => setCarryVal(e.target.value)} />
            <button style={st.carrySave} onClick={async () => {
              await inventoryApi.setCarryover(teamSeasonId, carryVal === "" ? 0 : parseFloat(carryVal));
              setEditCarry(false); load();
            }}><Check size={14} /></button>
            <button style={st.carryCancel} onClick={() => setEditCarry(false)}><X size={14} /></button>
          </span>
        ) : (
          <span style={st.carryView}>
            <span style={{ ...st.carryAmt, color: (budget.totals.carryover ?? 0) < 0 ? "#c62828" : "#2e7d32" }}>
              {(budget.totals.carryover ?? 0) < 0 ? "-$" : "$"}{Math.abs(budget.totals.carryover ?? 0).toFixed(2)}
            </span>
            {canCarryover && (
              <button style={st.carryEditBtn} onClick={() => { setCarryVal(String(budget.totals.carryover ?? 0)); setEditCarry(true); }}>
                <Edit2 size={11} /> Edit
              </button>
            )}
          </span>
        )}
      </div>

      <div style={st.head}>
        <span style={st.subTitle}>Spending Categories</span>
        {canManage && <button style={st.addBtn} onClick={() => { setAdding(true); setAddingFund(false); setEditing(null); setSubParent(null); }}><PlusCircle size={13} /> Add</button>}
      </div>

      {adding && canManage && (
        <CategoryForm seasonId={teamSeasonId} category={null} defaultFundraising={false}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }} />
      )}

      {parents.length === 0 ? <p style={st.muted}>No spending categories yet.</p> : parents.map((c) => (
        <div key={c.id}>
          {catCard(c, false)}
          {editing?.id === c.id && !editing.is_fundraising && canManage && (
            <CategoryForm seasonId={teamSeasonId} category={editing} parentId={editing.parent_id ?? null}
              onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
          )}
          <div style={st.childWrap}>
            {kidsOf(c.id).map((ch) => (
              <div key={ch.id}>
                {catCard(ch, true)}
                {editing?.id === ch.id && canManage && (
                  <CategoryForm seasonId={teamSeasonId} category={editing} parentId={c.id} parentName={c.name}
                    onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
                )}
              </div>
            ))}
            {subParent === c.id && canManage && (
              <CategoryForm seasonId={teamSeasonId} category={null} parentId={c.id} parentName={c.name}
                onClose={() => setSubParent(null)} onSaved={() => { setSubParent(null); load(); }} />
            )}
            {canManage && subParent !== c.id && (
              <button style={st.addSubBtn} onClick={() => { setSubParent(c.id); setEditing(null); setAdding(false); }}>
                <PlusCircle size={12} /> Add sub-system
              </button>
            )}
          </div>
        </div>
      ))}

      {(fund.length > 0 || canManage) && (
        <div style={{ marginTop: 14 }}>
          <div style={st.head}>
            <span style={st.subTitle}><PiggyBank size={12} style={{ verticalAlign: "-2px" }} /> Fundraising</span>
            {canManage && <button style={{ ...st.addBtn, background: "#1565c0" }} onClick={() => { setAddingFund(true); setAdding(false); setEditing(null); }}><PlusCircle size={13} /> Add Goal</button>}
          </div>

          {(addingFund || (editing && editing.is_fundraising)) && canManage && (
            <CategoryForm seasonId={teamSeasonId} category={editing} defaultFundraising
              onClose={() => { setAddingFund(false); setEditing(null); }}
              onSaved={() => { setAddingFund(false); setEditing(null); load(); }} />
          )}

          {fund.length === 0 ? <p style={st.muted}>No fundraising goals yet — click <strong>Add Goal</strong> to start a plan.</p> : fund.map((c) => (
            <FundraisingCategory key={c.id} cat={c} canManage={canManage} onChange={load}
              onEdit={() => { setEditing(c); setAdding(false); }}
              onDelete={() => inventoryApi.deleteBudgetCategory(c.id).then(load)} />
          ))}
        </div>
      )}

      {((budget.adhoc_expenses?.length ?? 0) > 0 || canManage) && (
        <AdHocExpensesSection teamSeasonId={teamSeasonId} expenses={budget.adhoc_expenses ?? []}
          categories={spend} canManage={canManage} onChange={load} />
      )}
    </div>
  );
}

function AdHocExpensesSection({ teamSeasonId, expenses, categories, canManage, onChange }: {
  teamSeasonId: number; expenses: AdhocExpense[]; categories: BudgetCategoryRec[]; canManage: boolean; onChange: () => void;
}) {
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ vendor: "", description: "", amount: "", budget_category_id: "", expense_date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const fmt = (n?: number) => `$${(n ?? 0).toFixed(2)}`;

  async function save() {
    if (!f.description.trim()) return;
    setBusy(true);
    try {
      await inventoryApi.createAdhocExpense(teamSeasonId, {
        vendor: f.vendor.trim() || null, description: f.description.trim(),
        amount: parseFloat(f.amount) || 0,
        budget_category_id: f.budget_category_id || null,
        expense_date: f.expense_date || null,
      });
      setF({ vendor: "", description: "", amount: "", budget_category_id: "", expense_date: new Date().toISOString().slice(0, 10) });
      setAdding(false); onChange();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={st.head}>
        <span style={st.subTitle}>Ad-hoc Expenses</span>
        {canManage && <button style={st.addBtn} onClick={() => setAdding((a) => !a)}><PlusCircle size={13} /> Add</button>}
      </div>
      {adding && canManage && (
        <div style={st.adhocForm}>
          <input style={st.adhocIn} placeholder="Vendor (e.g. Home Depot)" value={f.vendor} onChange={(e) => set("vendor", e.target.value)} />
          <input style={{ ...st.adhocIn, flex: 2 }} placeholder="What was purchased *" value={f.description} onChange={(e) => set("description", e.target.value)} />
          <input style={{ ...st.adhocIn, maxWidth: 90 }} type="number" step="0.01" placeholder="$ Total" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
          <select style={st.adhocIn} value={f.budget_category_id} onChange={(e) => set("budget_category_id", e.target.value)}>
            <option value="">No budget item</option>
            {categories.filter((c) => c.parent_id == null).map((p) => [
              <option key={p.id} value={p.id}>{p.name}</option>,
              ...categories.filter((c) => c.parent_id === p.id).map((ch) => (
                <option key={ch.id} value={ch.id}>&nbsp;&nbsp;— {ch.name}</option>
              )),
            ])}
          </select>
          <input style={{ ...st.adhocIn, maxWidth: 130 }} type="date" value={f.expense_date} onChange={(e) => set("expense_date", e.target.value)} />
          <button style={st.adhocSave} disabled={busy || !f.description.trim()} onClick={save}><Check size={14} /></button>
          <button style={st.adhocCancel} onClick={() => setAdding(false)}><X size={14} /></button>
        </div>
      )}
      {expenses.length === 0 ? <p style={st.muted}>No ad-hoc expenses logged.</p> : (
        <div style={st.adhocList}>
          {expenses.map((e) => (
            <div key={e.id} style={st.adhocRow}>
              <div style={{ flex: 1 }}>
                <div style={st.adhocDesc}>{e.description} <span style={st.adhocAmt}>{fmt(e.amount)}</span></div>
                <div style={st.adhocSub}>
                  {[e.vendor, e.category_name, e.expense_date, e.purchaser_name ? `by ${e.purchaser_name}` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              {(canManage || e.purchaser_id === user?.id) && (
                <button style={st.iconBtn} onClick={() => inventoryApi.deleteAdhocExpense(e.id).then(onChange)} title="Delete"><Trash2 size={12} color="#c62828" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FundraisingCategory({ cat, canManage, onChange, onEdit, onDelete }: {
  cat: BudgetCategoryRec; canManage: boolean; onChange: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const donations = cat.donations ?? [];
  const hasSub = donations.length > 0;
  const [open, setOpen] = useState(hasSub);
  const [addingDon, setAddingDon] = useState(false);

  const goal = cat.fundraising_goal ?? 0;
  const raised = cat.fundraising_raised ?? 0;
  const pct = goal ? Math.min(100, (raised / goal) * 100) : 0;

  return (
    <div style={st.catRow}>
      <div style={st.catTop}>
        <button style={st.chevBtn} onClick={() => setOpen((o) => !o)} title={open ? "Hide donations" : "Show donations"}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span style={st.catName}>{cat.name}</span>
        <span style={st.catFig}>
          ${raised.toFixed(0)} / ${goal.toFixed(0)} goal
          {hasSub && <span style={st.subCount}> · {donations.length} source{donations.length === 1 ? "" : "s"}</span>}
        </span>
        {canManage && (
          <span style={st.catActions}>
            <button style={st.iconBtn} onClick={onEdit} title="Edit goal"><Edit2 size={12} /></button>
            <button style={st.iconBtn} onClick={onDelete} title="Delete"><Trash2 size={12} color="#c62828" /></button>
          </span>
        )}
      </div>
      <div style={st.bar}><div style={{ ...st.barFill, width: `${pct}%`, background: "#1565c0" }} /></div>

      {open && (() => {
        // Event-posted earnings (have event_id) are grouped by event with member
        // sub-lines; manually-added donation sources render as editable rows.
        const eventDons = donations.filter((d) => d.event_id);
        const grantDons = donations.filter((d) => !d.event_id && d.grant_id);
        const sponsorDons = donations.filter((d) => !d.event_id && !d.grant_id && d.sponsor_id);
        const plainDons = donations.filter((d) => !d.event_id && !d.grant_id && !d.sponsor_id);
        const groups = new Map<number, typeof donations>();
        for (const d of eventDons) {
          const arr = groups.get(d.event_id!) ?? [];
          arr.push(d); groups.set(d.event_id!, arr);
        }
        return (
          <div style={st.subWrap}>
            {donations.length === 0 && !addingDon && (
              <div style={st.subEmpty}>No donation sources tracked yet.</div>
            )}
            {[...groups.entries()].map(([eid, members]) => {
              const finalized = members.reduce((s, m) => s + (m.received_amount ?? 0), 0);
              const expected = members[0]?.event_expected ?? null;
              return (
                <div key={`evt-${eid}`} style={st.evtGroup}>
                  <div style={st.evtHead}>
                    <span style={st.evtName}>{members[0]?.event_name ?? "Event"}</span>
                    <span style={st.evtFigs}>
                      {expected != null && <span style={st.evtExpected}>Expected ${expected.toFixed(0)}</span>}
                      <span style={st.evtFinal}>Finalized ${finalized.toFixed(2)}</span>
                    </span>
                  </div>
                  {members.map((m) => (
                    <div key={m.id} style={st.evtMember}>
                      <span style={st.evtMemberName}>{m.name}</span>
                      {m.is_tbd
                        ? <span style={st.evtMemberTbd} title="Youth needs to provide distribution guidance">TBD</span>
                        : <span style={st.evtMemberAmt}>${(m.received_amount ?? 0).toFixed(2)}</span>}
                    </div>
                  ))}
                </div>
              );
            })}
            {grantDons.map((d) => (
              <div key={d.id}
                style={{ ...st.evtMember, ...(d.is_declined ? st.grantDeclined : d.is_awarded ? st.grantAwarded : st.grantPending) }}
                title={d.is_declined ? "Grant declined — this team is not receiving it" : d.is_awarded ? "Grant awarded" : "Grant submitted — awaiting decision"}>
                <span style={{ ...st.evtMemberName, ...(d.is_declined ? { textDecoration: "line-through", color: "#a13b30" } : {}) }}>🏆 {d.name}</span>
                {d.is_declined
                  ? <span style={st.grantDeclinedAmt}>Declined</span>
                  : d.is_awarded
                  ? <span style={st.evtMemberAmt}>${(d.received_amount ?? 0).toFixed(2)} awarded</span>
                  : <span style={st.grantPendingAmt}>${(d.expected_amount ?? 0).toFixed(2)} requested</span>}
              </div>
            ))}
            {sponsorDons.map((d) => (
              <div key={d.id} style={{ ...st.evtMember, ...(d.is_sponsor_received ? st.grantAwarded : st.grantPending) }} title={d.is_sponsor_received ? "Sponsor contribution received" : "Sponsor pledge — awaiting receipt"}>
                <span style={st.evtMemberName}>🤝 {d.name}</span>
                {d.is_sponsor_received
                  ? <span style={st.evtMemberAmt}>${(d.received_amount ?? 0).toFixed(2)} received</span>
                  : <span style={st.grantPendingAmt}>${(d.expected_amount ?? 0).toFixed(2)} pledged</span>}
              </div>
            ))}
            {plainDons.map((d) => (
              <DonationRow key={d.id} donation={d} canManage={canManage} onChange={onChange} />
            ))}
            {addingDon && canManage && (
              <DonationRow donation={null} categoryId={cat.id} canManage onChange={onChange} onDone={() => setAddingDon(false)} />
            )}
            {canManage && !addingDon && (
              <button style={st.addSubBtn} onClick={() => setAddingDon(true)}><PlusCircle size={12} /> Add donation source</button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function DonationRow({ donation, categoryId, canManage, onChange, onDone }: {
  donation: Donation | null; categoryId?: number; canManage: boolean; onChange: () => void; onDone?: () => void;
}) {
  const isNew = !donation;
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState(donation?.name ?? "");
  const [expected, setExpected] = useState(donation?.expected_amount != null ? String(donation.expected_amount) : "");
  const [received, setReceived] = useState(donation?.received_amount != null ? String(donation.received_amount) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      expected_amount: expected === "" ? 0 : parseFloat(expected),
      received_amount: received === "" ? 0 : parseFloat(received),
    };
    try {
      if (isNew) await inventoryApi.addDonation(categoryId!, payload);
      else await inventoryApi.updateDonation(donation!.id, payload);
      onChange();
      onDone?.();
      if (!isNew) setEditing(false);
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div style={st.subEdit}>
        <input style={{ ...st.subInput, flex: 2 }} placeholder="Donor / source *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input style={st.subInput} type="number" step="0.01" placeholder="Expected $" value={expected} onChange={(e) => setExpected(e.target.value)} />
        <input style={st.subInput} type="number" step="0.01" placeholder="Received $" value={received} onChange={(e) => setReceived(e.target.value)} />
        <button style={st.iconBtn} onClick={save} disabled={saving || !name.trim()} title="Save"><Check size={14} color="#2e7d32" /></button>
        <button style={st.iconBtn} onClick={() => { if (isNew) onDone?.(); else setEditing(false); }} title="Cancel"><X size={14} color="#888" /></button>
      </div>
    );
  }

  return (
    <div style={st.subRow}>
      <span style={st.subName}>{donation!.name}</span>
      <span style={st.subFig}>
        ${(donation!.received_amount ?? 0).toFixed(0)} received
        <span style={st.subExp}> / ${(donation!.expected_amount ?? 0).toFixed(0)} expected</span>
      </span>
      {canManage && (
        <span style={st.catActions}>
          <button style={st.iconBtn} onClick={() => setEditing(true)} title="Edit"><Edit2 size={11} /></button>
          <button style={st.iconBtn} onClick={() => inventoryApi.deleteDonation(donation!.id).then(onChange)} title="Delete"><Trash2 size={11} color="#c62828" /></button>
        </span>
      )}
    </div>
  );
}

function Tot({ label, value, color, sub }: { label: string; value: number; color: string; sub?: React.ReactNode }) {
  return <div style={st.totBox}><div style={{ ...st.totNum, color }}>${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div><div style={st.totLabel}>{label}</div>{sub}</div>;
}

/** Restricted/unrestricted split line under a fundraising total. Hidden when nothing is restricted. */
function SplitNote({ restricted, unrestricted }: { restricted: number; unrestricted: number }) {
  if (Math.round(restricted) === 0) return null;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return (
    <div style={st.splitNote}>
      <span style={st.splitRestricted} title="Earmarked for a specific purpose">🔒 {fmt(restricted)} restricted</span>
      <span style={st.splitUnrestricted} title="Free to spend on anything">{fmt(unrestricted)} unrestricted</span>
    </div>
  );
}

function CategoryForm({ seasonId, category, defaultFundraising = false, parentId = null, parentName, onClose, onSaved }: {
  seasonId: number; category: BudgetCategoryRec | null; defaultFundraising?: boolean;
  parentId?: number | null; parentName?: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [budgeted, setBudgeted] = useState(category?.budgeted_amount != null ? String(category.budgeted_amount) : "");
  const isFund = category ? !!category.is_fundraising : defaultFundraising;
  const isSub = parentId != null || (category?.parent_id != null);
  const [goal, setGoal] = useState(category?.fundraising_goal != null ? String(category.fundraising_goal) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const payload: Record<string, unknown> = {
      name: name.trim(), is_fundraising: isFund,
    };
    if (isFund) {
      // Raised total is driven by donation sublines; only the target is set here.
      payload.fundraising_goal = goal === "" ? null : parseFloat(goal);
    } else {
      // Actual spent is driven by receiving; only the budget is set here.
      payload.budgeted_amount = budgeted === "" ? 0 : parseFloat(budgeted);
      // New sub-system: nest it under its parent. (Existing rows keep their parent.)
      if (parentId != null && !category) payload.parent_id = parentId;
    }
    try {
      if (category) await inventoryApi.updateBudgetCategory(category.id, payload);
      else await inventoryApi.createBudgetCategory(seasonId, payload);
      onSaved();
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }

  return (
    <div style={st.form}>
      <div style={st.formTitle}>
        {category ? "Edit " : "New "}{isFund ? "Fundraising Goal" : isSub ? `Sub-system${parentName ? ` under ${parentName}` : ""}` : "Spending Category"}
      </div>
      <div style={st.formGrid}>
        {!isFund ? (
          <>
            <input style={st.input} placeholder={isSub ? "Sub-system name * (e.g. Drive Train)" : "Category name *"} value={name} onChange={(e) => setName(e.target.value)} list={isSub ? "tbp-suggest-sub" : "tbp-suggest"} />
            <datalist id="tbp-suggest">{SUGGESTED.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="tbp-suggest-sub">{SUB_SUGGESTED.map((s) => <option key={s} value={s} />)}</datalist>
            <input style={st.input} type="number" step="0.01" placeholder="Budgeted $" value={budgeted} onChange={(e) => setBudgeted(e.target.value)} />
          </>
        ) : (
          <>
            <input style={st.input} placeholder="Fundraising source name * (e.g. Corporate Sponsorship)" value={name} onChange={(e) => setName(e.target.value)} />
            <input style={st.input} type="number" step="0.01" placeholder="Target amount $" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </>
        )}
      </div>
      {isFund && (
        <p style={st.formHint}>After saving, expand this goal to add individual donation sources — the amount raised totals up automatically.</p>
      )}
      {isSub && !isFund && (
        <p style={st.formHint}>Sub-system budgets are carved out of the parent category's budget and can't exceed it.</p>
      )}
      {error && <p style={st.formError}>{error}</p>}
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  totals: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 },
  fundTotals: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 },
  carryRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 14 },
  carryLabel: { fontSize: 12.5, fontWeight: 600, color: "#1a3a5c" },
  carryHint: { fontWeight: 400, color: "#aaa", fontSize: 11.5 },
  carryView: { display: "flex", alignItems: "center", gap: 10 },
  carryAmt: { fontSize: 15, fontWeight: 800 },
  carryEditBtn: { display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", background: "#fff", color: "#1565c0", border: "1px solid #c5cae9", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 },
  carryEdit: { display: "flex", alignItems: "center", gap: 5 },
  carryInput: { width: 110, padding: "5px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, textAlign: "right" as const },
  carrySave: { display: "inline-flex", padding: "5px 8px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" },
  carryCancel: { display: "inline-flex", padding: "5px 8px", background: "#fff", color: "#888", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer" },
  totBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", textAlign: "center" },
  totNum: { fontSize: 18, fontWeight: 800 },
  totLabel: { fontSize: 11, color: "#888", marginTop: 2 },
  splitNote: { display: "flex", flexDirection: "column", gap: 1, marginTop: 5, fontSize: 10.5, lineHeight: 1.35 },
  splitRestricted: { color: "#b45309", fontWeight: 600 },
  splitUnrestricted: { color: "#64748b" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  subTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  catRow: { background: "#fff", border: "1px solid #eef1f5", borderRadius: 7, padding: "8px 12px", marginBottom: 6 },
  childRow: { background: "#f9fbfd", borderColor: "#e6eef6" },
  childWrap: { paddingLeft: 18, borderLeft: "2px solid #e3edf7", marginLeft: 6, marginBottom: 6 },
  allocLine: { fontSize: 11, color: "#889", margin: "0 0 5px", fontVariantNumeric: "tabular-nums" as const },
  formError: { fontSize: 12, color: "#c62828", background: "#ffebee", border: "1px solid #ffcdd2", borderRadius: 6, padding: "6px 10px", margin: "8px 0 0" },
  catTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  catName: { fontWeight: 600, fontSize: 13, color: "#1a3a5c", flex: 1 },
  catFig: { fontSize: 12, color: "#555", fontVariantNumeric: "tabular-nums" as const },
  pendingFig: { color: "#e65100", fontWeight: 600 },
  overFig: { color: "#c62828", fontWeight: 700 },
  catActions: { display: "flex", gap: 4 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", padding: 2, display: "flex" },
  bar: { height: 8, background: "#eef2f7", borderRadius: 5, overflow: "hidden", display: "flex" },
  barFill: { height: "100%" },
  chevBtn: { background: "none", border: "none", cursor: "pointer", color: "#1a3a5c", padding: 0, display: "flex", marginRight: 2 },
  subCount: { color: "#888", fontWeight: 500 },
  subWrap: { marginTop: 8, paddingLeft: 18, borderLeft: "2px solid #e3edf7", display: "flex", flexDirection: "column" as const, gap: 4 },
  subEmpty: { fontSize: 12, color: "#aaa", fontStyle: "italic" as const },
  evtGroup: { background: "#f0fdf4", border: "1px solid #c8e6c9", borderRadius: 7, padding: "6px 10px", marginBottom: 4 },
  evtHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 },
  evtName: { fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  evtFigs: { display: "flex", gap: 10, fontSize: 12 },
  evtExpected: { color: "#888" },
  evtFinal: { color: "#2e7d32", fontWeight: 700 },
  evtMember: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0 2px 12px", fontSize: 12.5, color: "#444" },
  evtMemberName: { color: "#333" },
  evtMemberAmt: { fontWeight: 600, color: "#2e7d32" },
  grantAwarded: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 7, padding: "6px 10px", marginBottom: 4 },
  grantPending: { background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 7, padding: "6px 10px", marginBottom: 4 },
  grantPendingAmt: { fontWeight: 600, color: "#8a6d00" },
  grantDeclined: { background: "#fdecea", border: "1px solid #f3b0a8", borderRadius: 7, padding: "6px 10px", marginBottom: 4 },
  grantDeclinedAmt: { fontWeight: 700, color: "#c0392b" },
  evtMemberTbd: { fontWeight: 700, color: "#c62828", fontSize: 11, background: "#ffebee", borderRadius: 8, padding: "1px 8px", cursor: "help" },
  subRow: { display: "flex", alignItems: "center", gap: 8, padding: "3px 0" },
  subName: { fontSize: 12.5, color: "#333", flex: 1, fontWeight: 500 },
  subFig: { fontSize: 12, color: "#1565c0", fontWeight: 600, fontVariantNumeric: "tabular-nums" as const },
  subExp: { color: "#999", fontWeight: 400 },
  subEdit: { display: "flex", alignItems: "center", gap: 5, padding: "2px 0" },
  subInput: { flex: 1, minWidth: 0, padding: "5px 7px", border: "1px solid #ccc", borderRadius: 5, fontSize: 12.5, boxSizing: "border-box" as const },
  addSubBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "2px 0", marginTop: 2, alignSelf: "flex-start" },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 10 },
  formTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", marginBottom: 8 },
  formHint: { fontSize: 11, color: "#888", margin: "8px 0 0", lineHeight: 1.5 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" },
  fundLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  cancelBtn: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "7px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#aaa", fontSize: 13, margin: "4px 0" },
  adhocForm: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, marginBottom: 8 },
  adhocIn: { flex: 1, minWidth: 90, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12 },
  adhocSave: { background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "6px 9px", cursor: "pointer", display: "flex" },
  adhocCancel: { background: "#fff", color: "#888", border: "1px solid #cdd7e3", borderRadius: 6, padding: "6px 9px", cursor: "pointer", display: "flex" },
  adhocList: { display: "flex", flexDirection: "column", gap: 5 },
  adhocRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid #f4f6fa" },
  adhocDesc: { fontSize: 13, color: "#1a3a5c", fontWeight: 600 },
  adhocAmt: { color: "#c62828", fontWeight: 700, marginLeft: 6 },
  adhocSub: { fontSize: 11, color: "#99a", marginTop: 1 },
};
