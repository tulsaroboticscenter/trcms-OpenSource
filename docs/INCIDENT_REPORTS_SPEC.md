# Incident Reports Module — Build Specification

**Status:** Approved for build, Phase 1.
**Written:** 2026-09-27, for handoff to the designated TRCMS-PHP development session.
**Requirements owner:** Christopher (TRC). The decisions in §3 are his and are settled — build to them, don't re-open them.
**Migration numbers claimed:** `0230` (schema), `0231` (permission seeds). Next free after this work: `0232`.

---

## 1. Why this exists

A student had a minor medical issue at TRC. There is currently no way for a member, mentor, or parent to file an incident report in TRCMS, and no defined process for handling one. This module adds both: a report intake, and a triage-to-closure workflow with configurable notification routing.

Design principle throughout: **if reporting is slow or feels risky, people stop reporting.** One-tap entry, few required fields, and real anonymity matter more than field completeness.

## 2. Scope

**Phase 1 (this build)**

- Incident types: **Medical**, **Injury/Accident**, **Behavior/Conduct (youth)**, **Near Miss / Unsafe Condition**
- **First Aid Log** — a separate lightweight log, not an incident report
- Full workflow: report → triage → notify → corrective action → close
- Anonymous reporting with the sealed identity vault (§7)
- Configurable email routing + an admin console area (§8)
- Reporter's own-reports view; admin incident queue

**Phase 2 (design for it, do not build yet)**

The restricted-tier types: Adult Conduct / Youth Protection, Abuse or Neglect Suspicion, Mental Health / Self-Harm, Financial-Ethics (whistleblower), plus the remaining types in §4. These need an access model that does **not** rely on permission keys alone — see the super-role problem in §7.4. Ship Phase 1 first; the schema in §6 already accommodates Phase 2, so no migration rework is needed.

## 3. Decisions already made (do not re-litigate)

1. **One incident object** with a `type` + `severity`, not separate modules per type. The type drives which extra field block renders and which routing rules fire.
2. **Anonymous reporting is supported but is never the default.** Checkbox, off.
3. **The system records who submitted anonymously, but no user may ever see it** — not Admin, not System Administrator. A developer with server shell access can recover it out-of-band as a safety back door (a reporter may be in danger). See §7.
4. **Youth may file anonymously**, same as adults.
5. **Youth can file their own reports**, and anyone with `incidents.report` can file **on behalf of** another person (including non-members: visitors, guests, parents).
6. **A configurable inbox address** (e.g. `incidentreport@tulsaroboticscenter.org`) receives reports, plus **an admin console area** for the admin team — role-gated.
7. **Routing is configurable in system settings**, not hardcoded: which types and severities go to which addresses and roles, and what escalates to the board.
8. **Severity scale:** Minor / Moderate / Serious / Critical.
9. **Retention: no auto-purge, ever.** Incident records are never deleted by season rollover or any cleanup job. A minor's injury claim clock generally does not start until they turn 18, so records must outlive the youth's time in the program. Store `retention_hold` (default 1) and `retention_review_on` so a real retention number can be applied later without schema changes.
10. **`incident_notes` are append-only.** The original narrative is never rewritten; corrections are addenda with an author and timestamp.

## 4. Type taxonomy

Slug values for `incident_reports.type`. Build the Phase 1 types only, but put the **full list in a code catalog** so Phase 2 is a UI-and-routing change, not a schema change.

| Slug | Label | Phase | Tier |
|---|---|---|---|
| `medical` | Medical / Health Event | 1 | standard |
| `injury` | Injury / Accident | 1 | standard |
| `behavior` | Behavior / Conduct (youth) | 1 | sensitive |
| `near_miss` | Near Miss / Unsafe Condition | 1 | standard |
| `adult_conduct` | Adult Conduct / Youth Protection | 2 | restricted |
| `abuse` | Abuse or Neglect Suspicion | 2 | restricted |
| `mental_health` | Mental Health / Self-Harm | 2 | restricted |
| `bullying` | Bullying / Harassment / Discrimination | 2 | sensitive |
| `missing_youth` | Missing Youth / Unauthorized Pickup | 2 | restricted |
| `security` | Security / Threat | 2 | sensitive |
| `emergency` | Emergency Activation (weather, fire, evacuation, drill) | 2 | standard |
| `transportation` | Transportation / Vehicle | 2 | standard |
| `property` | Property Damage / Loss / Theft | 2 | standard |
| `facility` | Facility Issue | 2 | standard |
| `substance` | Substance Use | 2 | sensitive |
| `data_privacy` | Data / Privacy Incident | 2 | sensitive |
| `complaint` | Complaint / Grievance | 2 | sensitive |
| `ethics` | Financial / Ethics Concern (whistleblower) | 2 | restricted |

**Tiers** drive `is_sensitive` / `is_restricted` and the default routing:

- **standard** — reporter + mentors on the involved team + safety officer + admin
- **sensitive** — reporter + safety officer + admin/ED. Mentors get "action needed," not the narrative.
- **restricted** — a named short list only, **and the subject of the report is excluded even if they hold admin**. Phase 2.

Types `abuse`, `mental_health`, `missing_youth`, `security`, `ethics` are **escalate-now-document-second**: their forms open with the phone number to call, not with field one. The form must state plainly that filing in TRCMS **does not** satisfy a mandatory-reporting duty. Oklahoma is an all-persons mandatory-reporting state; the DHS hotline is **1-800-522-3511**.

## 5. Handling process

Six stages, mirrored by `incident_reports.status`:

1. **Report** (`submitted`) — mobile-first form; auto-attaches event, team, and who was checked in. Anonymous optional.
2. **Immediate action** — captured on the form itself (what was done, who was called, whether the parent was reached and when).
3. **Triage** (`triaged`, target: same day) — safety officer confirms type + severity, assigns a handler, fires the routing rules. The queue surfaces age so nothing sits.
4. **Review** (`in_review`) — addenda and witness statements. Witness statements are entered separately and are **not visible to other witnesses**.
5. **Corrective action** (`awaiting_action`) — real tasks in the existing Planning module via `incident_tasks`. An incident may not close with open linked tasks.
6. **Close** (`closed`) — closure summary + sign-off **by someone other than the reporter**. Feeds a monthly summary and a quarterly board roll-up: counts by type and severity, trend, and incidents per 1,000 member-hours (denominator comes from the existing time-entry data).

**Guardians are notified, not granted a view.** They get a same-day notification of an incident involving their youth; the notification itself is timestamped in `incident_notifications`. That timestamp is the record that matters later.

**External sharing** is a triage checklist (`external_notified`), not automation: parent/guardian (mandatory, same day) · EMS/police · DHS hotline · insurance carrier · FIRST or event organizer · facility owner · school partner · board.

**Narrative discipline**, enforced by helper text on the form: facts only, no diagnoses, no speculation, no conclusions. Describe what you saw and heard.

## 6. Field specification

Reporter-facing unless marked **[triage]**. ✱ = required. Required fields are deliberately few — a partial report filed at 7:40pm on a build night is worth more than a complete one that never gets filed.

### 6.1 Common core — every report

1. ✱ **Report type** (picker with plain-language descriptions)
2. **Submit anonymously?** — default OFF. Warning text: a narrative can identify you even without your name.
3. **Filing on behalf of someone else?** → their name (member picker or free text) + your relationship to them
4. ✱ **When did it happen** — date + time, defaults to now, "approximate" checkbox
5. ✱ **Where** — TRC (area: main shop / build bays / classroom / kitchen / restrooms / storage / parking lot / outside) · off-site (event picker) · other (free text)
6. **Related event / meeting** — auto-suggested from the calendar and check-in data
7. **Related team**
8. **People involved** — repeatable rows: name (member picker or free text), role (`affected` / `witness` / `involved` / `responder`), youth or adult
9. ✱ **What happened** — narrative, with the facts-not-conclusions helper text
10. **What was done right away**
11. **Who was notified at the time** — mentor on duty / parent-guardian / 911-EMS / police / facility / nobody yet, each with a time
12. **Parent or guardian contacted?** — by whom, when, how (call / text / in person), reached or left a message
13. ✱ **Severity as you saw it** — Minor / Moderate / Serious / Critical, with anchors ("Minor = no treatment beyond basic first aid")
14. ✱ **Is anyone still at risk right now?** — yes surfaces a red call-these-numbers banner before any other field
15. **Attachments** — photos or documents
16. **Best way to follow up with you** — hidden when anonymous

**[triage] on every report:** confirmed type, confirmed severity, assigned handler, external-notification checklist, linked corrective-action tasks, board-reportable flag, closure summary + closer, retention hold.

### 6.2 Medical / health event (`medical`)

- ✱ Affected person
- ✱ Nature — allergic reaction · asthma/breathing · seizure · diabetic · fainting or dizziness · heat illness · nausea/vomiting · headache · flare-up of a known condition · unknown · other
- Symptoms observed (checklist + free text)
- Onset — sudden or gradual; time
- **Is this a known condition? Was it already on the member's medical form?** — a "no" spawns a follow-up task to update it
- **Medication given?** — what, dose, time, by whom, self-administered or given, and whether permission was on file
- **Rescue medication used** — epi-pen / inhaler / glucagon → auto-escalates severity and expects EMS
- Food or substance involved — what, and where it came from
- Outcome — resolved on site · sent home · parent picked up · urgent care · ER · EMS transport · care refused
- Returned to the activity? Any restriction on return?
- Doctor's note or clearance expected?
- First-aid supplies used (feeds restocking)

**PII rule:** the form **links** to `member_medical`, it never copies it. Allergy and medication context is rendered only for handlers holding `members.view_medical` — a youth reporter must not see it.

### 6.3 Injury / accident (`injury`)

- ✱ Injured person(s)
- ✱ Body part(s) — multi-select
- ✱ Nature — cut/laceration · puncture · burn · bruise · sprain/strain · suspected fracture · eye injury · crush/pinch · electrical shock · chemical exposure · inhalation · head injury · dental · other
- ✱ How it happened — power tool · hand tool · robot/mechanism · battery or charger · slip/trip/fall · struck by or against · sharp edge · lifting/carrying · heat/soldering · chemical · vehicle · horseplay · unknown
- Tool or equipment involved — inventory item picker; can tag the item out of service and open a repair ticket (existing Repairs module, `inv_item_id`)
- **Was PPE required? Was it worn?** — eyes / gloves / hearing / face shield
- **Was the person trained or certified for that task?** — certification picker, ties to the 500-series certs
- Was a mentor supervising? Who?
- First aid given — what, by whom, were they trained
- Treatment level — none · first aid on site · sent to parent or doctor · urgent care · ER · EMS transport · refused
- **Head-injury block** (renders only for head injuries) — loss of consciousness, confusion or memory gap, vomiting, concussion protocol applied, cleared to return
- Blood or bodily-fluid exposure — cleaned up per protocol?
- Returned to activity? Restricted?
- **Was the hazard corrected before anyone else used that area?** — how
- Witness statements (separate entries, not cross-visible)
- Adults/volunteers: any time away from work?
- **[triage]** Likely insurance claim? Carrier notified?

### 6.4 Behavior / conduct — youth (`behavior`)

- ✱ Youth involved — who did what, stated factually
- **Who was affected** — a separate list, so targets are not mixed in with subjects
- ✱ Category — disruption · disrespect/defiance · unsafe behavior or horseplay · property damage · language · teasing/exclusion · **bullying (repeated, targeted)** · harassment · physical altercation · threat · theft · dishonesty · tool misuse · left the area without permission · phone or social media · substance · other
- What was said or done — quotes if known
- **Has this happened before?** — link to a prior report
- Immediate response — redirect · conversation · break from the activity · removed from the meeting · sent home · parent called
- **Was anyone hurt or frightened? Do they feel safe now?**
- Does this involve bullying or harassment based on who someone is (race, sex, religion, disability, orientation)? → auto-sets `is_sensitive` and routes separately
- Does a youth who was targeted need follow-up or support?
- Recommended follow-up — none · mentor conversation · parent conference · behavior plan · time away from the program
- Who should follow up
- Who may be told about this

### 6.5 Near miss / unsafe condition (`near_miss`)

- ✱ What is the hazard, or what nearly happened
- ✱ Type — tool or equipment defect · missing guard · electrical · battery/LiPo · chemicals · trip hazard · clutter/housekeeping · blocked exit or extinguisher · working at height · lifting · lighting · ventilation/fumes · stored material · unsafe practice · PPE unavailable · facility/structural · other
- ✱ **Is it still there right now?** — yes makes it urgent regardless of severity
- **What is the worst thing that realistically could have happened?** — this, not the actual outcome, is the severity driver for a near miss
- Was anyone nearly hurt? — naming them is optional
- Immediate action — tagged out of service · cleaned up · barricaded · told a mentor · none yet
- Equipment involved — inventory picker
- **What do you think would fix it?**
- Photo — encouraged here, no privacy concern
- "Good catch — okay to recognize me for reporting this?" (opt-in)

### 6.6 First Aid Log — not an incident report

Six fields, target 15 seconds: who · when · what was done (ice pack, bandage, cleaned a scrape, rest) · who provided it · supplies used · **Promote to incident report**.

**Hard rule:** administering *any* medication, including OTC, is never a log entry. It is a Medical report, because it requires permission on file.

### 6.7 Phase 2 types — distinguishing questions (keep in the catalog, build later)

- **`adult_conduct`** — which policy (two-deep, one-on-one contact, transportation, private communication with a youth, boundary, other) · youth involved · was the adult's access paused pending review · has FIRST or another organization been notified · is the subject aware (default no; only leadership decides that)
- **`abuse`** — opens with **"Have you called the Oklahoma hotline, 1-800-522-3511?"** · date/time of that call, who called, reference number · law enforcement called? · what the child said in their exact words and what you asked · who else knows · has the child been separated from the alleged person · ED notified at
- **`mental_health`** — what was said or observed, verbatim · imminent risk? · were means mentioned · did someone stay with them · who was contacted (parent / 988 / 911) · safety plan · who owns follow-up · does the youth know you are reporting
- **`missing_youth`** — last seen where/when/by whom · search started at · areas searched · parent called at · police called at · found at, condition · pickup authorization or custody issue
- **`property`** — item + asset ID · value · who had it last · police report number · recovered?
- **`data_privacy`** — what data, whose, roughly how many people · youth PII involved? · how it was exposed · contained? · credentials rotated? · notification required?
- **`security`** — description of the person or threat · weapon involved? · lockdown? · police · trespass notice · camera footage
- **`transportation`** — driver · vehicle · number of youth aboard · other party + insurance exchanged · police report · trailer or equipment damage
- **`facility`** — what and where · is the area safe to use · landlord notified · work order number
- **`substance`** — what, who, found where · confiscated? · is the youth impaired right now (escalates to Medical) · parent/police
- **`complaint`** — who is raising it · about what · what outcome they want · prior attempts to resolve · who should respond
- **`ethics`** — the concern · amounts · who is involved · supporting documents · board chair notified
- **`emergency`** — what happened; shelter / evacuate / lockdown; drill or actual; time to account for everyone; anyone unaccounted for; what to fix next time
- **`bullying`** — as `behavior`, plus: protected characteristic involved, repeated over what period, prior reports, support offered to the target

### 6.8 Form behavior

- Only the selected type's block renders.
- **Auto-escalation triggers** bump severity and fire the urgent route immediately: rescue medication used · loss of consciousness · EMS transport · weapon · threat · "someone is still at risk."
- Save-and-continue-later is supported; a draft is not a filed report and does not notify.
- The whole form must be usable one-handed on a phone.

## 7. Anonymity — the sealed identity vault

### 7.1 The requirement

Christopher's words: keep track of who submitted "deep in the bowels of the system"; no user can see it; a developer/programmer can determine it as a back door "in the case where we find out that someone may be in serious danger."

### 7.2 Why a permission key cannot do this

`Permissions::resolve()` (src/Core/Permissions.php, ~line 66–72) grants **super roles write on every key automatically**. Admin and System Administrator are super roles. Therefore *no* permission key can hide anything from them. Anonymity must be enforced by **the absence of any read path**, not by authorization.

### 7.3 Design

| Layer | Behavior |
|---|---|
| `incident_reports.reporter_id` | **NULL** when anonymous — the main row has no author |
| `incident_identity_vault` | `incident_id`, `sealed` (ciphertext), `created_at` |
| Ciphertext | AES-256-GCM over JSON `{member_id, name, email, ip, user_agent, submitted_at}`; stored as base64 of `iv‖tag‖ciphertext` |
| Key | `INCIDENT_VAULT_KEY` in `.env` (hex), **never in the database**. A DB dump alone is useless. |
| Read paths | **Zero.** No controller, route, report, export, or Report Engine dataset touches this table. |
| Back door | `bin/unseal_incident.php <ref_no>` — requires Plesk shell access **and** the `.env` key. Prints the identity, appends to `incident_vault_access_log`, and prints a reminder to inform the board. |

**Hard rule for the implementer:** put `IncidentVault::seal()` in `src/Core/IncidentVault.php`, and implement the **decrypt logic inside `bin/unseal_incident.php` itself**. Do not add an `unseal()` method to any class the web app autoloads — that is the whole guarantee. A code reviewer must be able to grep the `src/` tree and find no decryption.

If the key is lost, identities are permanently unrecoverable. Tell Christopher to store a copy in his password manager at deploy time.

### 7.4 Three leaks that must be plugged, or the design is theater

1. **Audit log** — `Audit::write()` stamps `actor_id`. An anonymous submit must be audited with `actor_id = NULL` and action `incident.submit_anonymous`. A normal audit row would name the reporter.
2. **Usage telemetry** — `UsageController::track` records page views (`usage_events`). Timestamp correlation could identify the submitter. Suppress tracking on the report route, and render anonymous submissions with a **date only, no clock time**, everywhere in the UI.
3. **The narrative itself** — if three people were in the room, the text identifies the writer. The form says so before the checkbox. Nothing technical fixes this; honesty does.

Also: no "My Reports" entry for anonymous submissions (that list is keyed on `reporter_id`, which is NULL — verify it can't leak via any other join), and no email receipt to the reporter.

## 8. Routing configuration

`system_config` category **`incident_routing`**, following the existing single-object-in-an-array convention used by other settings categories:

```json
[{
  "default_to": ["incidentreport@tulsaroboticscenter.org"],
  "reply_to": "",
  "digest_enabled": true,
  "rules": [
    { "id": 1, "label": "All reports to the inbox", "types": ["*"], "min_severity": "minor",
      "to": ["incidentreport@tulsaroboticscenter.org"], "cc": [], "notify_roles": [], "board_notify": false },
    { "id": 2, "label": "Serious and above to the ED", "types": ["*"], "min_severity": "serious",
      "to": [], "cc": [], "notify_roles": ["Admin"], "board_notify": true }
  ]
}]
```

- Rules are evaluated in order; every matching rule fires (union of recipients, de-duplicated).
- `types: ["*"]` matches all; otherwise a list of slugs from §4.
- `min_severity` gates on the **triage-confirmed** severity, falling back to the reporter's if triage hasn't happened yet.
- `notify_roles` resolves to the email addresses of members holding that role — reuse whatever the Communications module already does for role-based recipient resolution rather than writing a new resolver.
- Every dispatch is logged to `incident_notifications` (to, reason, rule id, sent_at, ok, error). Use `Core\Mailer::send()`.
- Admin console page **Incident Settings** (`incidents.settings`) edits this, with a test-send button.
- Seed rule 1 in migration 0231 so the module works the moment it's deployed.

## 9. Data model — migration `0230_incident_reports.sql`

Style: follow the existing migrations (`AUTO_INCREMENT`, `ENGINE=InnoDB`, `utf8mb4`, mirror the `inv_*` tables) and end with the `INSERT IGNORE INTO schema_migrations` line keyed `0230_incident_reports`.

**Flat vs JSON:** the cross-type facts that get *reported on* are flat columns (severity, status, treatment level, body part, tool, PPE, training, behavior category). The long tail of type-specific answers lives in a `detail` JSON column. This is a deliberate split — 18 types cannot be flattened into one table without ~200 columns, and JSON columns are already used in this schema (see `0003_hall_of_fame.sql`). Don't "fix" it either direction.

**Tables (10):**

1. **`incident_reports`** — `id`, `ref_no` VARCHAR(20) UNIQUE (`INC-2026-0001`, assigned post-insert), `type` VARCHAR(40), `severity` ENUM('minor','moderate','serious','critical'), `reporter_severity` ENUM(same) NULL (what the reporter chose; `severity` belongs to triage), `status` ENUM('submitted','triaged','in_review','awaiting_action','closed'), `is_anonymous`, `reporter_id` NULL, `filed_for_member_id` NULL, `filed_for_name`, `filed_for_relationship`, `occurred_at`, `occurred_approx`, `location_kind` ENUM('trc','offsite','other'), `location_area`, `location_other`, `event_id` NULL, `team_id` NULL, `description` TEXT, `immediate_actions` TEXT, `notified_at_time` JSON, `ems_called`, `police_called`, `parent_notified`, `parent_notified_at`, `parent_notified_by_id`, `parent_notify_method`, `parent_notify_result`, `ongoing_risk`, `is_sensitive`, `is_restricted`, `detail` JSON, `assigned_to_id`, `triaged_at`, `triaged_by_id`, `closed_at`, `closed_by_id`, `closure_summary` TEXT, `board_reportable`, `external_notified` JSON, `retention_hold` DEFAULT 1, `retention_review_on` DATE NULL, `follow_up_due` DATE NULL, `created_at`, `updated_at`. Index `type`, `status`, `severity`, `occurred_at`, `assigned_to_id`.
2. **`incident_people`** — `incident_id`, `member_id` NULL, `name` VARCHAR(120) NULL, `person_role` ENUM('affected','witness','involved','responder'), `is_youth`, `notes`.
3. **`incident_injury`** — 1:1 optional, the flat medical/injury facts used by reports: `body_parts` (JSON or CSV), `injury_nature`, `mechanism`, `inv_item_id` NULL, `ppe_required`, `ppe_worn`, `trained_certified`, `certification_id` NULL, `supervised_by_id` NULL, `treatment_level` ENUM, `loss_of_consciousness`, `concussion_protocol`, `returned_to_activity`, `restriction`, `medication_given`, `rescue_med`, `outcome`, `claim_likely`.
4. **`incident_notes`** — `incident_id`, `author_id` NULL, `body` TEXT, `note_kind` ENUM('addendum','witness_statement','triage','closure'), `visibility` ENUM('standard','restricted'), `created_at`. **Append-only: no UPDATE or DELETE code path.**
5. **`incident_attachments`** — `incident_id`, `stored_name`, `original_name`, `mime`, `size_bytes`, `uploaded_by_id` NULL, `is_restricted`, `created_at`.
6. **`incident_notifications`** — `incident_id`, `channel`, `recipient`, `reason`, `rule_id` NULL, `sent_at`, `ok`, `error`.
7. **`incident_tasks`** — `incident_id`, `task_id` (existing Planning task), `created_by_id`, `created_at`.
8. **`incident_identity_vault`** — `incident_id` UNIQUE, `sealed` TEXT (base64), `created_at`. No FK cascade that would silently drop it.
9. **`incident_vault_access_log`** — `incident_id`, `unsealed_at`, `os_user`, `reason` (prompted by the CLI), `host`.
10. **`first_aid_log`** — `member_id` NULL, `person_name` NULL, `occurred_at`, `treatment`, `provided_by_id`, `supplies_used`, `notes`, `promoted_incident_id` NULL, `created_at`.

`ref_no`: insert, then `UPDATE … SET ref_no = CONCAT('INC-', YEAR(created_at), '-', LPAD(id, 4, '0'))`. Unique and readable; strict per-year sequencing is not worth a lock.

## 10. Permissions — migration `0231_incident_permissions.sql`

Add an **"Incidents"** group to `PERMISSION_CATALOG` in `config/permissions.json` plus a `RESOURCE_DEFAULTS` entry for each key (all `none`), then seed by role **name** with `NOT EXISTS` guards (re-runnable; `role_permissions` has no unique key on `(role_id, resource_key)`).

| Key | Label | Default | Seed |
|---|---|---|---|
| `incidents.report` | File an Incident Report | none | write → every real role incl. Youth Member (not Default, not Station) |
| `incidents.view_own` | View My Own Reports | none | read → same set |
| `incidents.queue` | Incident Queue (all reports) | none | read → Admin, System Administrator |
| `incidents.triage` | Triage & Assign Incidents | none | write → Admin, System Administrator |
| `incidents.close` | Close Incidents | none | write → Admin, System Administrator |
| `incidents.settings` | Incident Routing Settings | none | write → System Administrator |
| `incidents.first_aid_log` | First Aid Log | none | write → Mentor, Admin, System Administrator |
| `incidents.view_restricted` | View Restricted Incidents | none | **no seed** (Phase 2) |

Gate everything with `Permissions::memberCan($pdo, $m, 'key', 'read'|'write')`. **Never** gate on `member_type` or a role name — that is a standing hard rule on this project. Relationship-based access (self, a youth's guardian, a mentor on the involved team) is fine and expected, and is separate from the permission check.

## 11. Backend

**`src/Controllers/IncidentsController.php`**

| Method | Route (under `/api/v1`) |
|---|---|
| `submit` | `POST /incidents` |
| `list` | `GET /incidents` (queue; filters: status, type, severity, assigned, date range, age) |
| `mine` | `GET /incidents/mine` |
| `get` | `GET /incidents/{id}` |
| `addNote` | `POST /incidents/{id}/notes` |
| `triage` | `POST /incidents/{id}/triage` |
| `assign` | `POST /incidents/{id}/assign` |
| `notifyParent` | `POST /incidents/{id}/notify-parent` |
| `linkTask` / `unlinkTask` | `POST` / `DELETE /incidents/{id}/tasks` |
| `close` | `POST /incidents/{id}/close` |
| `upload` | `POST /incidents/{id}/attachments` |
| `serveAttachment` | `GET /incidents/{id}/attachments/{attachment_id}` — **authenticated stream**, not `/public/upload/{name}` |
| `stats` | `GET /incidents/stats` |
| `firstAidList` / `firstAidSave` / `firstAidPromote` | `GET`/`POST /first-aid`, `POST /first-aid/{id}/promote` |

**`src/Controllers/IncidentSettingsController.php`** — `GET`/`POST /admin/incident-settings`, `POST /admin/incident-settings/test`.

Notes for the implementer:

- Attachments must **not** be served from static `/uploads/` — the production host returns 403 for that path, and injury photos must not be reachable by URL guess. Stream through the authenticated endpoint with the same permission check as the parent incident.
- `Audit::write` on every write method, with the anonymous carve-out in §7.4.
- Closing must reject if any linked Planning task is still open, and must reject if the closer is the reporter.
- Server-side validation mirrors §6 required fields; don't rely on the client.
- Auto-escalation triggers (§6.8) are computed **server-side** on submit.

## 12. Frontend

New module `modules/incidents` in `C:\TRCPMS\frontend\src`, registered in `moduleRegistry.ts` (import + add to `MODULES`), following the shape of an existing module such as `raffles`.

| Page | Path | Gate |
|---|---|---|
| Report an Incident | `/incidents/new` | `incidents.report` |
| My Reports | `/incidents/mine` | `incidents.view_own` |
| Incident Queue | `/incidents` | `incidents.queue` |
| Incident detail | `/incidents/:id` | `incidents.queue`, or reporter-self |
| First Aid Log | `/first-aid` | `incidents.first_aid_log` |
| Incident Settings | `/admin/incident-settings` | `incidents.settings` |

Add an **Incident Reports** tile to `modules/admin/pages/AdminDashboard.tsx` (group `access` or a new `safety` group, `perm: "incidents.queue"`) and a nav item for the report form so filing is never more than one tap from anywhere.

The report form is the priority surface: phone-first layout, type picker up top, red banner when "someone is still at risk," and the anonymity checkbox with its warning copy.

## 13. Build order

1. Migrations 0230 + 0231; run on dev.
2. `src/Core/IncidentVault.php` (`seal()` only) + `bin/unseal_incident.php` + generate `INCIDENT_VAULT_KEY` for dev `.env`.
3. `IncidentsController` + routes + audit wiring.
4. Routing config, `IncidentSettingsController`, mailer dispatch, `incident_notifications`.
5. Report form → queue → triage → close; First Aid Log last.
6. Verify (§14).

## 14. Verification checklist

- `php -l` clean on every new/changed PHP file.
- `tsc -b` in the frontend (**`tsc --noEmit` is a no-op in this project and `vite build` skips type checks**). Roughly 22 pre-existing errors are expected; add none.
- End-to-end in the browser: file each of the four types, triage, add an addendum, link a task, attempt to close with the task open (must fail), close properly.
- **Anonymity tests — do these explicitly:**
  - Submit anonymously, then confirm `incident_reports.reporter_id IS NULL`.
  - Confirm `audit_logs` has **no** row naming the submitter for that report.
  - Confirm the API response for that incident contains no reporter identity, as Admin **and** as System Administrator.
  - Confirm the UI shows a date with no clock time for it.
  - Confirm `bin/unseal_incident.php` recovers the identity and writes `incident_vault_access_log`.
  - `grep -rn "unseal\|openssl_decrypt" src/` must return nothing.
- Routing: a Minor near-miss reaches only the inbox; a Serious injury also fires the escalation rule; both appear in `incident_notifications`.
- Permission matrix: a Youth Member can file and see their own, and gets 403 on the queue; a Mentor can use the First Aid Log; role toggles in Admin → Role Management take effect.

## 15. Deploy notes

Deploys are **manual** on this project: Plesk **Pull Updates**, clear OPcache, then run new migrations with PHP 8.x.

1. Pull both repos.
2. **Add `INCIDENT_VAULT_KEY` to the production `.env`** — before the first anonymous report is filed. Generate with `bin/unseal_incident.php --genkey` (or `openssl rand -hex 32`). Have Christopher store a copy in his password manager; if it's lost, sealed identities are gone forever.
3. Run migrations `0230` then `0231`.
4. Set the inbox address and confirm rule 1 in Admin → Incident Settings, then use the test-send button.
5. Smoke-test one report of each Phase 1 type on production, then delete the test rows.

Release accounting: highlights accrue toward **Release 4.12** (4.11 was cut 2026-09-24). Keep them **out of `src/core/version.ts`** until Christopher cuts 4.12 — no "Pending" top entry.

## 16. Project conventions this build must follow

- **Permission keys, never `member_type` or role names**, for any role-based gate (§10).
- Migrations: numbered, re-runnable, self-registering in `schema_migrations`, role seeds keyed by role **name** with `NOT EXISTS`.
- `Audit::write` on every write endpoint (with the §7.4 exception).
- Git: the designated development session owns all `git add` / `commit` / `push`. **Stage by path, never `git add -A`** — other sessions may have untracked work in the same tree.
- Claim any further migration numbers in the shared coordination ledger before creating them.
- One-off SQL (cleanup, seeds, fixes) belongs in `deploy/`, committed — not loose in a Downloads folder.

## 17. Open items — Christopher's call, not the implementer's

1. **Who is the Safety Officer, and who is the named backup?** Until this is set, `assigned_to_id` has no default owner and reports will sit. Ask at deploy time.
2. **The real retention number** — pending his insurer and counsel. Build the fields, apply no purge.
3. **Insurance carrier notice deadlines** — get them in writing; they may justify an automatic escalation rule later.
4. **Phase 2 restricted-tier access model** — needs an explicit handler allow-list that excludes the subject of a report, because super roles bypass permission keys (§7.2). Design and get approval before building any restricted type.
5. Board notification threshold is configurable per §8; confirm his intended default beyond "critical."
