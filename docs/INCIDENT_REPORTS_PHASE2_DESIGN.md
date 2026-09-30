# Incident Reports — Phase 2 Restricted-Access Design

**Status:** Access model DECISIONS LOCKED with Christopher 2026-09-27 (§9); still nothing built. Phase 2 build is not authorized yet — the exact restricted type list (§9-D) is confirmed at build kickoff first.
**Written:** 2026-09-27, as the follow-on to `INCIDENT_REPORTS_SPEC.md` (Phase 1 built + pushed, dev only).
**Scope of this doc:** the *access model* only — the one thing §7.2 / §17.4 said must be designed and approved before any restricted type is built. It does not re-specify each restricted type's form (that's a later, smaller doc once the access model is locked).

---

## 1. The problem this solves

Phase 1 gates everything on permission keys. That is deliberately **not enough** for the restricted tier, because of the super-role rule (`Permissions::resolve()`): **System Administrator gets write on every key, and Admin is seeded most keys.** So a permission key can never mean "only these three people, and not the person the report is about."

The restricted tier's two hard requirements (spec §4, §17.4):

1. **Named short list only** — a restricted incident is visible to an explicit, small allow-list of handlers, *not* to a role.
2. **The subject is excluded even if they hold admin** — the person a report is *about* cannot read it, regardless of their roles, up to and including System Administrator.

Neither can be met with RBAC. Both are met the same way the vault is: **enforcement by an explicit membership check in the code path, with super-role status deliberately never consulted.**

## 2. Principles (carried from Phase 1)

- **No implicit access.** Super-role grants nothing on a restricted incident. Access is an explicit yes, computed per member per incident.
- **Enforce by absence + explicit check, not by authorization level.** Like the vault's "no read path," restricted access is "no path except the allow-list function."
- **Belt and suspenders.** A coarse permission key (`incidents.view_restricted`) gates the *nav/page*, but the API always independently runs the allow-list + subject check. The key is necessary, never sufficient.
- **Anonymity is unchanged.** A restricted report can still be anonymous; the sealed vault and all three §7.4 leak-plugs apply exactly as in Phase 1.

## 3. The access model

### 3.1 The one function that decides everything

```
canAccessRestricted(pdo, member, incident): bool
    = isRestrictedHandler(pdo, member)        // on the explicit allow-list
      AND NOT isSubjectOf(pdo, member, incident)   // never the person it's about
```

- **Super-role is not part of this expression.** A System Administrator who is not on the allow-list gets `false`. A System Administrator who *is* on the list but is a subject of *this* incident gets `false`.
- Every restricted code path calls it: restricted list, get, notes, attachments (stream), triage, assign, notify, close, and routing. There is no other way in.
- The Phase-1 standard paths already exclude restricted (`WHERE is_restricted = 0` in the queue; `get` would 403 a non-handler). Phase 2 keeps that: **restricted incidents never appear in the standard queue or the standard detail path.** They live only behind `canAccessRestricted`.

### 3.2 The allow-list ("Restricted Incident Handlers")

A small, explicitly-managed roster of the people permitted to handle restricted incidents — e.g. the Executive Director, the Safety Officer, one named board member. **Not a system role** (a role would re-introduce the super-role problem and would sweep in anyone later granted it).

Two options for where the roster lives — **pick one (Open Decision A):**

- **Option 1 — DB table, managed by System Administrator through an audited screen (RECOMMENDED).** `incident_restricted_handlers (member_id, added_by_id, added_at, active)`. A dedicated Admin page lists/adds/removes handlers; every change writes an audit row and is surfaced on the roster page itself ("added by X on Y"). Practical, visible, and the subject-exclusion below still protects the highest-stakes case (a report about the admin) absolutely.
- **Option 2 — Server config only (`.env` / a config file), changed via Plesk shell.** Maximum tamper-resistance (mirrors the vault key): no UI can alter who handles restricted incidents. Inconvenient; every roster change needs a developer. Offer this for orgs that want zero-UI-tamper.

**Recommendation:** Option 1 as the default, with the code written so Option 2 is a small switch if you ever want it. Rationale: the genuinely dangerous scenario is "the subject reads the report about themselves," and **subject-exclusion handles that no matter what the roster says.** The residual risk under Option 1 (a rogue System Administrator adds themselves to snoop on restricted incidents that aren't about them) is inherent to having a super-admin at all, and is mitigated by: the roster being tiny and visible, every change audited, and — optionally — a two-person rule (Open Decision C).

### 3.3 Subject exclusion — how "subject" is captured

A **subject** is the person a restricted report is *about* (the adult in an adult-conduct report, the person named in an abuse concern, etc.), as distinct from the reporter, witnesses, or the affected youth.

- The restricted forms capture subjects explicitly and **link them to a member record when the subject is a member** (member picker), because exclusion is by `member_id`. A free-text-only subject can't be excluded by id (they usually aren't a system user anyway, so there's nothing to exclude).
- Storage: add `is_subject TINYINT(1)` to `incident_people` (already exists from Phase 1) — no new table needed. `isSubjectOf(member, incident)` = there is an `incident_people` row for this incident with `member_id = member.id AND is_subject = 1`.
- Subject-exclusion is **absolute and independent of the allow-list**: even a handler who is a subject of a specific incident is denied that one incident (they still handle others).

### 3.4 What each actor sees

| Actor | Restricted incident |
|---|---|
| On allow-list, not a subject | Full handler access to that incident |
| On allow-list, **is a subject** of it | **No access to that one** (handles others) |
| System Administrator, not on allow-list | **No access** (super-role grants nothing here) |
| Admin, not on allow-list | No access |
| Reporter (non-handler) | Their own "My Reports" row shows it exists + its status, but **not the handler notes, witness statements, or subject details** — same limited self-view as Phase 1 |
| Everyone else | Nothing; it never appears in any list or search |

## 4. Routing for restricted incidents

The Phase-1 role-based routing (`notify_roles`) is **unsafe for restricted incidents** — a role could resolve to an address belonging to the subject. So:

- Restricted incidents use a **separate routing path** that sends only to (a) the explicit restricted-handler emails and (b) any hard-coded addresses in a `restricted` block of the config — **minus any address belonging to a subject.**
- No `notify_roles` expansion for restricted incidents.
- Still logged to `incident_notifications`, still delivered by the same deferred cron (`bin/send_incident_notifications.php`), so a restricted submit is just as fast and unblockable as Phase 1.
- **Escalate-now types** (`abuse`, `mental_health`, `missing_youth`, `security`, `ethics`, per §4) open the form with the phone number to call, not field one, and state plainly that filing in TRCMS **does not** satisfy a mandatory-reporting duty (Oklahoma is an all-persons mandatory-reporting state; DHS hotline **1‑800‑522‑3511**). The form leads with action, then documentation.

## 5. Data model (Phase 2 migration — claim the next free number, ~0232+)

Minimal — Phase 1's schema was built to accommodate this (§2 of the spec):

1. `incident_restricted_handlers` — `id`, `member_id`, `added_by_id`, `confirmed_by_id` NULL, `status` ENUM('pending','active','removing','removed'), `proposed_at`, `confirmed_at` NULL (the two-person roster, §3.2). `isRestrictedHandler` counts only `status='active'`.
2. `incident_people.is_subject TINYINT(1) NOT NULL DEFAULT 0` — flags the subject(s) of a report.
3. Optional `incident_routing` gains a `restricted` block (handler-only recipients + hard-coded addresses). No new table.
4. Permission seed: `incidents.view_restricted` (already in the catalog, unseeded) becomes the coarse page-gate. It is seeded to the handler-list members as a convenience, **but the API never trusts it alone** — `canAccessRestricted` is the real gate.

No change to `incident_reports`, the vault, or the audit design.

## 6. Enforcement checklist (where `canAccessRestricted` must be called)

Every one of these, for any incident with `is_restricted = 1`, replaces the Phase-1 `incidents.queue`/reporter-self check with `canAccessRestricted`:

- Restricted queue list · restricted get · add note · triage · assign · notify-parent · link/unlink task · close · attachment upload · **attachment stream** · any stats that could reveal restricted rows.

Plus the standing guarantee: the **standard** queue/list/get continue to filter `is_restricted = 0` so a restricted incident can never leak through the Phase-1 surfaces.

## 7. Build order (once approved)

1. Migration: `is_subject` + `incident_restricted_handlers` (+ routing block).
2. `canAccessRestricted` + `isRestrictedHandler` + `isSubjectOf` in the controller (no autoloaded "who can see restricted" that RBAC could shortcut).
3. Restricted routing path.
4. Restricted queue + detail pages, gated by the allow-list; roster-management admin screen (Option 1).
5. The five escalate-now forms + the remaining sensitive/standard Phase-2 forms.
6. Verification (below).

## 8. Verification (the tests that must pass before it ships)

- A **System Administrator not on the allow-list gets 403** on a restricted incident — list, get, and attachment stream. (The whole point.)
- A handler who **is a subject** of an incident gets 403 on *that* incident but 200 on another restricted incident.
- A restricted incident **never appears** in the standard queue, standard get, My Reports (beyond the reporter's own limited row), search, or the Report Engine.
- Restricted routing sends only to handlers/hard-coded addresses and **omits a subject's address**.
- Anonymity tests from Phase 1 §14 still pass for a restricted anonymous report.
- Roster changes are audited; (if adopted) the two-person rule is enforced.

## 9. Decisions — RESOLVED with Christopher 2026-09-27

- **A. Roster storage → DB table, managed by System Administrator through an audited screen (Option 1).** No server-config-only path.
- **B. The list is configurable — no hardcoded names.** The roster is expected to change over time, so it is edited entirely through the Admin screen (the DB table backs it). No names are baked into code or config. Christopher populates it in the UI at deploy time.
- **C. Two-person rule → YES.** A roster change (add or remove a handler) is *proposed* by one System Administrator and does not take effect until a *second, different* System Administrator confirms it. Both actions are audited. A pending, unconfirmed change grants no access. (See §3.2 below, updated.)
- **D. Tiering → lean restrictive.** Apply the allow-list model to the `restricted` tier per §4; when a type is borderline, put it in `restricted` rather than `sensitive`. ⚠️ The exact restricted-vs-sensitive type list is **confirmed at Phase 2 build kickoff**, not assumed from this draft.
- **E. Additional restricted routing recipients → YES.** Beyond the handler list, the restricted routing block may carry hard-coded confidential addresses (e.g. a dedicated address; board chair for `ethics`), always minus any subject's address.
- **F. Admin on the allow-list → NO, System-Administrator-curated only for now.** Being Admin grants nothing automatically; only an explicit roster entry (added under the two-person rule) does. Revisit later if needed.

### 3.2 (updated) Roster + two-person rule

`incident_restricted_handlers (id, member_id, added_by_id, confirmed_by_id NULL, status ENUM('pending','active','removing','removed'), proposed_at, confirmed_at)`.

- A System Administrator **proposes** an add → row `status='pending'`, `added_by_id` set. It grants **no access** yet.
- A **different** System Administrator **confirms** → `status='active'`, `confirmed_by_id` set. Only now is the member a handler. `isRestrictedHandler` counts `status='active'` rows only.
- Removal is the same two-step (`removing` → confirmed → `removed`); a member proposed for removal keeps access until the second SysAdmin confirms, so one person can't unilaterally strip a handler either.
- The proposer and confirmer must be different member ids; every step is audited; the roster screen shows who proposed/confirmed each entry and when.
- Managing the roster is gated on a new key `incidents.manage_handlers` (seed: System Administrator), but — as everywhere here — the key is the coarse gate and the two-person + audited flow is the real control.
