# Le Yard OS — Phase 1 deep role user testing

Date: August 19, 2026

Status: Handoff complete; no production mutation or deployment

Verdict: Not owner-ready or service-ready yet

## Executive judgment

Le Yard OS already has a strong visual system and several unusually good technical foundations: exact-cent closeout math, tenant scoping, append-only inventory evidence, audited service events, independent count and waste review, conservative reservation availability logic, and Toast as the attendance authority.

The failure is the distance between those foundations and what each user is told in the interface. The playground can grant the wrong role controls, report actions that never happened, hide the content a user is acknowledging, and let consequential financial, layout, inventory, and reservation changes happen without an adequate review or correction path. In connected mode, several server-side capability boundaries are also too broad or bypassed.

The current build should remain a controlled playground until the P0 items below are closed. Phase 2 should not begin with a redesign. It should begin with role fidelity, truthfulness, and one consistent confirmation/undo grammar.

## Scope and evidence

I tested the Operations and Host surfaces as:

- Donald: owner
- Maris: Host-surface owner
- Irini: employee/server
- Mateo: manager with executive-chef identity
- Source-level chef, manager, and restricted-role capability paths

I exercised owner Today, reservations, waitlist, table assignment, walk-in and booking forms, closeout/tips, service control, kitchen, inventory, schedule, time clock, earnings, settings, security, data/audit, and reservation setup.

Important evidence boundary: the Saturday service and day-book values are explicitly synthetic playground data. The production Operations alias correctly stopped at connected sign-in, and no credentials or tenant records were used. For connected BOH mockups I used the repository’s checked-in state—20 active recipes, 142 ingredient lines, 79 ingredient items, and zero vendors, prices, pars, stock movements, or purchase records—instead of inventing service values.

## Role health summary

| Persona | What survived | What failed | Phase 1 health |
|---|---|---|---|
| FOH / host | Day book is scannable; floor is legible; cancellation has a strong confirmation | Demo bookings do not persist, actions lack real Undo, waitlist contact state is premature, guest actions fall away from the floor | Fail |
| Server / employee | Earnings is clearly private; Toast remains read-only | Owner sales and manager decisions leak into Today; manager Service controls and Management messages are exposed in demo; shift state contradicts itself | Fail |
| Chef / BOH | Inventory ledger and approval primitives are promising | No prep workflow, incomplete Chef Today, free-text 86, unsafe receiving, incorrect recipe-cost semantics, PO approval bypass | Fail |
| Manager | Scheduling, closeout, inventory, and reporting are broad | Broad role checks bypass precise capabilities; several publish/approve actions lack review; stale data looks current | Fail |
| Owner / admin | Closeout reconciliation is exact and visually clear | Financial exports can cross capability boundaries; closeout approval and reservation reset are one-click; settings and audit readiness overclaim | Fail |

## Numbered test flow and visual evidence

1. **Owner Today — partial.** The dashboard is calm and legible, but the same owner sales and decision cards render for Irini and Mateo. “Review” has no behavior and “Resolve” silently removes a decision.

![Owner Today](<../output/product-audit/2026-08-19/01-owner-today-desktop.png>)

2. **Host day book — partial.** The day book, floor, and pacing work together visually. Selecting a guest pushes the operational actions below the floor instead of keeping them in a persistent service drawer.

![Guest actions below the fold](<../output/product-audit/2026-08-19/05-host-guest-actions-below-fold.png>)

3. **Cancellation — pass as a pattern.** It names the party, date, table, delivery consequence, and requires a reason. This is the confirmation pattern to reuse.

![Reservation cancellation confirmation](<../output/product-audit/2026-08-19/06-host-cancel-confirmation.png>)

4. **Table assignment — fail.** Assignment mode begins while the floor is elsewhere on the page, then clicking a table commits immediately with no review or Undo.

![Table assignment separated from guest context](<../output/product-audit/2026-08-19/09-host-assignment-floor.png>)

5. **Walk-in and booking — fail.** Forms do not preview the selected table, exact overlap result, pacing effect, or alternatives before save. The walk-in time presentation also conflicts with the rest of the 12-hour interface.

![Walk-in form](<../output/product-audit/2026-08-19/11-host-walk-in-form.png>)

6. **Closeout calculation and submission — partial.** Exact reconciliation survives. Submission can return to draft, but the sticky copy remains stale after calculation.

![Submitted closeout](<../output/product-audit/2026-08-19/16-owner-closeout-submitted.png>)

7. **Owner approval — fail.** “Owner approve” immediately creates an immutable lock. There is no final financial summary or confirmation.

![Closeout approved without confirmation](<../output/product-audit/2026-08-19/17-owner-closeout-approved.png>)

8. **Service control — fail.** Availability is free text, portions has no accessible name, publish is mixed into generic save, and acknowledgers cannot see the complete published brief.

![Service Control](<../output/product-audit/2026-08-19/18-chef-service-control.png>)

9. **Kitchen archive — fail.** Archive is immediate. After archival the heading says two active recipes while all three remain visible and the archived selection remains editable without an archived state label.

![Recipe archive inconsistent result](<../output/product-audit/2026-08-19/20-chef-recipe-archive-confirmation.png>)

10. **Owner settings and audit — fail.** The playground claims synthetic data is off and operational records are empty while synthetic records populate the app. It also claims Supabase-managed backups are available without a connected project.

![Data and audit readiness](<../output/product-audit/2026-08-19/23-owner-data-audit-settings.png>)

11. **Employee role — fail.** Irini receives net sales, projected close, average check, five-month comparisons, and manager resolution decisions.

![Employee Today leak](<../output/product-audit/2026-08-19/24-foh-server-today.png>)

12. **Employee service permissions — fail.** Irini can edit availability, manager log, and pre-shift publishing in the playground.

![Employee Service Control](<../output/product-audit/2026-08-19/25-foh-server-service-control.png>)

13. **Employee labor truth — fail.** Today says Irini is on shift while Time Clock says the current user is off the clock; Schedule is anchored to stale dates.

![Employee time-clock contradiction](<../output/product-audit/2026-08-19/27-foh-server-time-clock.png>)

![Stale schedule dates](<../output/product-audit/2026-08-19/29-foh-server-schedule.png>)

14. **Chef-manager inventory — partial.** The inventory layout is strong, but Mateo is represented as a generic Manager and receives broad purchasing/count/waste controls; the demo has only four synthetic items and cannot prove the connected workflow.

![Chef-manager inventory](<../output/product-audit/2026-08-19/31-chef-manager-inventory.png>)

15. **Standalone Host — partial.** The focused navigation is good, but the host loses read-only service brief, 86, team, and message context. Reservation reset remains one click.

![Standalone Host](<../output/product-audit/2026-08-19/32-host-surface-reservations.png>)

![Reservation controls](<../output/product-audit/2026-08-19/33-host-reservation-controls.png>)

16. **Mobile visual pass — blocked.** The in-app viewport override did not change the actual page dimensions, so the attempted mobile capture was rejected and removed. Source tests cover some responsive behavior, but 320px phone and tablet-landscape acceptance is still required.

## P0 — Go-live blockers

### P0-01 — Demo role testing is not trustworthy

**Evidence.** Guests, Settings, and Assistant render demo workspaces before the same route guard used by live mode: [Guests page](<../src/app/(workspace)/guests/page.tsx>), [Settings page](<../src/app/(workspace)/settings/page.tsx>), [Assistant page](<../src/app/(workspace)/assistant/page.tsx>), and [route guard](../src/lib/permissions/route-access.server.ts). Browser testing showed Irini receiving owner Today metrics and manager Service controls. The Today fixture explicitly says every owner workflow is available: [today-workspace.tsx:112](../src/components/today/today-workspace.tsx).

**Why it fails.** A demo intended to validate personas can falsely pass a forbidden workflow and teach staff the wrong mental model. It also masks whether the connected permission model is working.

**Surgical fix.** Resolve the workspace principal and route access before choosing demo or live data. Feed demo pages through the same capability resolver as connected mode. Add dedicated least-privilege host, bartender, cook, chef, manager, owner, and denied/read-only principals generated from one fixture source.

**Acceptance.** Direct URL tests for every persona; denied routes never render protected data; screenshots and action palettes match effective capabilities.

### P0-02 — Management messages are exposed to ordinary employees in demo

**Evidence.** Demo messages are persisted under an organization-only key, visible channels are not filtered by visibility or participant access, and any demo role can post: [messages-workspace.tsx:46](../src/components/messages/messages-workspace.tsx), [messages-workspace.tsx:355](../src/components/messages/messages-workspace.tsx), [messages-workspace.tsx:417](../src/components/messages/messages-workspace.tsx). The management fixture includes a flagged invoice: [demo/index.ts:241](../src/lib/demo/index.ts).

**Why it fails.** It is both a privacy failure and a false role-acceptance signal.

**Surgical fix.** Create one authoritative canAccessChannel predicate and use it for enumeration, selection, history, posting, unread counts, and search. Scope any persisted playground state by organization, principal, and app surface.

**Acceptance.** Irini cannot enumerate, open, search, receive unread counts for, or post to Management; a manager can.

### P0-03 — Financial and payroll reports can cross capability boundaries

**Evidence.** The Reports route accepts either reporting capability, then every report kind is available. The live report loader rejects only employees, export routes do not run exact report authorization, and the RPC accepts every type with general manager authority: [reports page](<../src/app/(workspace)/reports/page.tsx>), [reports read model](../src/data/read-models/reports.ts), [report request](../src/app/api/exports/reports/live-report-request.ts), and [security migration](../supabase/migrations/202608010009_security_followup.sql).

**Why it fails.** An operations-only manager can request tips, payroll, receipts, expenses, or COGS by direct export request even if the UI later hides a card.

**Surgical fix.** Define one server-side REPORT_CAPABILITY_BY_KIND mapping. Apply it in UI catalog filtering, page loading, CSV/PDF endpoints, export RPC, and exact-table RLS. Consider separate Operational and Financial report destinations, but keep identical server enforcement.

**Acceptance.** Negative tests for no-report, operations-only, finance-only, and owner principals across UI, direct endpoint, RPC, and underlying tables.

### P0-04 — “Install or reset draft” can create a one-click booking outage

**Evidence.** The button calls its action immediately: [reservation-setup-workspace.tsx:101](../src/components/reservations/reservation-setup-workspace.tsx) and [reservation-setup-workspace.tsx:323](../src/components/reservations/reservation-setup-workspace.tsx). The RPC disables public booking, messaging, staff push, clears approval, disables Dinner, and overwrites the 17-table floor: [reservation hardening migration](../supabase/migrations/20260809234206_reservation_api_hardening.sql). Reapproval toggles do not default to current live values.

**Surgical fix — preferred.** Versioned draft/published configuration, before/after diff, future-reservation impact analysis, atomic publish, and rollback.

**Minimum safe fix.** Require typed location confirmation, create a restorable snapshot, prefill current channel values, and block reset when future commitments exist unless an explicit migration plan is reviewed.

**Acceptance.** Simulate future bookings, reset attempt, cancel, confirm, rollback, and prove public availability never silently goes dark.

### P0-05 — Toast Retry deadlocks the worker

**Evidence.** Retry creates a queued job. The worker rejects whenever any queued or running job exists, then tries to create a different running job instead of claiming the queued one: [integration migration](../supabase/migrations/202608010014_integrations_reports_notifications.sql) and [Toast worker](../src/app/api/internal/integrations/toast-labor/route.ts).

**Surgical fix.** Atomically claim the earliest due queued job with a lease or advisory lock. Create a scheduled job only when no queued job exists. Recover expired leases.

**Acceptance.** Failed → retry → claimed → completed, concurrent workers, duplicate request, and stale-lease recovery.

### P0-06 — Demo booking and waitlist submissions report success without changing state

**Evidence.** Demo Book and Add to waitlist close their dialogs and write success text but never insert a record: [reservations-workspace.tsx:1025](../src/components/reservations/reservations-workspace.tsx) and [reservations-workspace.tsx:1108](../src/components/reservations/reservations-workspace.tsx).

**Why it fails.** A tester believes a booking survived; the next view silently disproves it. Existing tests cover transitions, not submission persistence.

**Surgical fix.** Add reducer-backed insertDemoReservation and insertDemoWaitlistEntry using stable IDs, correct sort order, duplicate-click protection, and the same table suggestion/conflict semantics as live mode. If demo must not mutate, replace “booked/added” with explicit “preview only; no record created.”

**Acceptance.** Submit, see the new row, reopen it, reload under the same principal, isolate another principal, and repeat a lost-response/double-submit case.

### P0-07 — Staff can acknowledge a pre-shift they cannot read

**Evidence.** VIPs, allergies, large parties, specials, staffing, goals, training, and manager notes exist in the read model but the card renders only date, covers, status, and acknowledgement count before Acknowledge: [service-control read model](../src/data/read-models/service-control.ts) and [live Service Control](../src/components/service/live-service-control-workspace.tsx).

**Why it fails.** The acknowledgement cannot be used as allergy or service-readiness evidence.

**Surgical fix.** Render the complete immutable published version before action. Separate private manager notes from the staff projection. Bind each acknowledgement to an exact version. Publishing gets Preview & publish with a diff; retraction creates a superseding version.

**Acceptance.** Employee must scroll/read the full version, acknowledge that version, see a newer version as unacknowledged, and never see private notes.

### P0-08 — The independent purchase-order approval control is bypassed

**Evidence.** The capability catalog separates create and approve, but the UI only consumes create. The creation RPC inserts submitted immediately and receiving accepts submitted orders without an approval transition: [capability foundation](../supabase/migrations/20260808135755_capability_authorization_foundation.sql), [inventory workspace](../src/components/inventory/live-inventory-workspace.tsx), and [exact capability migration](../supabase/migrations/20260811105153_inventory_exact_capability_enforcement.sql).

**Surgical fix.** Implement draft → submitted → approved → sent → partially received → received/closed/cancelled. Enforce different-person approval and spend thresholds in the database. Issued POs are cancelled or superseded, never deleted.

**Acceptance.** Creator cannot self-approve above threshold; receiver cannot receive an unapproved PO; partial delivery and cancellation keep immutable evidence.

### P0-09 — Prep and production do not exist despite chef permissions advertising them

**Evidence.** prep.manage and prep.complete exist and are granted, but there is no route, schema, read model, workflow, or component: [capabilities.ts:18](../src/lib/permissions/capabilities.ts) and [expansion status](le-yard-os-expansion-status.md).

**Setup A — minimum launch.** Manual daily prep board with station, recipe/component, target quantity/unit, due time, assignee, state, actual yield, note, and evidence.

**Setup B — advanced.** Deterministic suggestions from reservations, historical mix, pars, and on-hand. Suggestions remain reviewable and never post automatically.

**Safety.** Completing prep previews ingredient consumption and finished-batch movements; confirmation posts the ledger; correction is a compensating entry.

### P0-10 — Production acceptance is still unproven

**Evidence.** The production Operations alias reached connected sign-in. Real credentials, tenant records, provider delivery, and the separate Host alias were not used. The visual mobile viewport could not be forced and its invalid capture was rejected.

**Surgical fix.** Treat this as an acceptance gate, not an excuse to infer success: authenticated role accounts, isolated test location, seeded service date, provider sandbox, 320px phone, tablet landscape, and direct Host/Operations alias verification.

## P1 — Serious workflow and trust failures

| ID | Failure and evidence | Surgical fix and acceptance |
|---|---|---|
| P1-01 | **Employee Today leaks owner information.** Irini sees $8.4k net sales, $12.7k projection, average check, comparisons, and Resolve decisions. The fixture hard-codes these at [today-workspace.tsx:112](../src/components/today/today-workspace.tsx) and [today-workspace.tsx:128](../src/components/today/today-workspace.tsx). | Build persona-specific Today projections. Employee: next shift, assigned station/section, brief, personal tasks, Toast state. Chef: kitchen exceptions. Manager/owner: financial and whole-room metrics. Direct data must be omitted, not CSS-hidden. |
| P1-02 | **Demo Service grants manager controls to everyone.** The demo page hard-codes availability, manager log, and pre-shift management true: [service page](<../src/app/(workspace)/service/page.tsx>). | Resolve capability booleans identically in demo/live. Staff get read-only published brief and permitted availability actions; management receives draft/publish/log controls. |
| P1-03 | **Guest actions separate from floor context.** Selecting Maya Rivera leaves actions below the pacing/floor stack. Assignment mode then tells the host to choose a table while the map is off-screen. | Use a persistent right-side drawer on desktop and bottom sheet on tablet. Keep selected guest, current table, overlap result, and actions visible while the floor remains interactive. |
| P1-04 | **Arrival, assignment, seating, and completion have no real correction path.** Demo transitions and table moves commit immediately at [reservations-workspace.tsx:808](../src/components/reservations/reservations-workspace.tsx) and [reservations-workspace.tsx:841](../src/components/reservations/reservations-workspace.tsx). Action registry calls some reversible, while the database is forward-only and Complete releases allocation. | Arrive and pre-seat table move: one tap + 8–10 second audited Undo backed by a version check. Seat: Undo only if the physical/table correction RPC can compensate. Complete: confirmation or explicit Reopen that restores reservation, allocation, and table events. Never show cosmetic Undo. |
| P1-05 | **“Notified” does not prove guest contact.** The database starts the 15-minute offer window before provider delivery succeeds. | waiting → notifying/queued → notified. Start expiry on first successful delivery. Show channel, queued/sent/failed, sent time, retry, call fallback, and live deadline. |
| P1-06 | **Waitlist rows are not rush-ready; Remove is immediate.** They omit elapsed wait, quote delta, offer deadline, masked contact, and delivery status. Remove cancels immediately. | Show “waiting 27m · quoted 20m · 7m overdue” or “offer expires in 08:14.” Confirm Remove with guest/party/wait summary, or implement an audited 8-second restore. |
| P1-07 | **Booking/waitlist errors are hidden behind modals and pending dialogs remain dismissible.** The page-level notice sits below the modal layer. | Dialog-local role=alert, focus invalid field/summary, preserve values, and disable Escape/backdrop/X/Cancel while unresolved. Close only after confirmed success. |
| P1-08 | **Floor editing auto-saves consequential layout changes.** Dragging persists each move, has no overlap/egress validation, and only the latest move is undoable. | Local layout draft, overlap/edge/egress validation, multi-step Undo, Review changes, explicit Save floor layout?, and Discard. Keep public inventory on the published version. |
| P1-09 | **Booking forms conceal assignment logic.** Save chooses best fit without showing candidate tables, interval conflicts, pacing consequence, or alternatives. Walk-in time presentation is inconsistent. | Before Save show exact time, duration, party, table candidate(s), interval availability, pacing bucket, and “unassigned” option. Re-check on confirm. Preserve the scheduled/phone no-double-booking invariant. Use one 12-hour presentation. |
| P1-10 | **Standalone Host loses service context.** Navigation is Reservations, setup, and Guests only: [app-surface.ts](../src/lib/app-surface.ts) and [navigation.ts](../src/components/shell/navigation.ts). | Preferred: compact read-only pre-shift, 86, staffing exception, and delivery-failure strip inside Reservations. Alternative: restricted read-only Service and location Messages routes. |
| P1-11 | **Dates and personas are internally inconsistent.** Today says peak Saturday Apr 18; reservations and closeout use other dates; Schedule shows Aug 3–14 against Aug 19; “Tonight” remains stale. | Generate all fixtures relative to one simulated business date and time. Preserve selected persona within simulation. Add a fixed clock to tests. |
| P1-12 | **Schedule publish, swaps, and drag changes lack proportional review.** Publish and Approve/Deny execute directly; drag persists immediately. | Draft locally. Publish review shows week/version, shifts, open shifts, acknowledgements, hours, and cost. Swap approval names both employees, date/time, and role. Provide audited Undo for draft movement. |
| P1-13 | **Message attachment failure can orphan the text message.** Text sends and form clears before attachment prepare/upload/finalize completes. | Upload/finalize before publishing, or keep a sender-only pending attachment with Retry/Cancel and atomically publish after finalization. Retain the file on failure. |
| P1-14 | **Offline copy warns but writes remain enabled.** Mutation controls can submit while the UI says protected actions are online-only. | When connectivity is definitively offline, show a timestamped read-only snapshot and disable writes. Reconnect displays a diff and explicit Reconcile; never silently replay inventory, 86, publish, or reservation writes. |
| P1-15 | **Floor and pacing accessibility is incomplete.** Table meaning depends on visual color/title; VIP is effectively an icon; portions in Service Control has no accessible name. | Accessible names include table, seats, physical state, and assignment. Announce keyboard movement/state changes. Give every pacing bucket covers/limit text and every numeric control a label. |
| P1-16 | **86 is free-text and immediate.** Typos and renames can fork one item into multiple truths: [live Service Control](../src/components/service/live-service-control-workspace.tsx) and [service read model](../src/data/read-models/service-control.ts). | Use canonical menu_item_id, recipe_id, or inventory_item_id plus immutable label snapshot. Running low can be one-tap; 86/restore confirms item/location/state/portions and supports an inverse event Undo. |
| P1-17 | **Receiving posts stock and cost without final review or exceptions.** There is no damaged, rejected, substituted, missing, unexpected, temperature, lot, expiry, invoice/photo, or reason model. | PO-versus-delivery review with delivered/accepted/rejected/delta/cost/evidence. Confirm receipt & post. High-value/exception deliveries can require separate manager review. Corrections are returns or linked receiving transactions. |
| P1-18 | **Recipe “Ingredient cost” can be materially wrong.** The model sums batch ingredients, does not divide by yield, and only resolves an exact unit; UI labels the result beside menu price. | One server-side as-of cost resolver converts base units, applies waste, calculates batch and portion cost separately, shows food-cost %, price age, and missing coverage. Never show a complete percentage with missing inputs. |
| P1-19 | **Recipe publish is generic Save, and Archive corrupts the visible state.** Demo fields mutate immediately; Archive hides the count but not the row: [kitchen-workspace.tsx:20](../src/components/kitchen/kitchen-workspace.tsx). | Separate draft from publish. Preview diff and affected menu/prep items. Archive confirmation, archived label/filter, Restore version, dirty-close guard, and reducer tests that count/list/selection agree. |
| P1-20 | **Kitchen handoff is hidden from chefs.** Chef role lacks manager_log.manage and the log has no owner, due time, resolution, or assignment. | Split a kitchen-safe operational handoff from sensitive guest/HR/cash notes, or add field/category policy. Add assignee, due time, related item/equipment/recipe, resolve/reopen, and immutable versions. |
| P1-21 | **Chef Today is an owner dashboard, not a 30-second BOH command center.** Mateo sees sales, average check, and dining-room decisions; connected Chef Today lacks upcoming covers, known allergies, 86, prep, station load, BOH exceptions, deliveries, and waste. | Persona projection with next 90-minute covers/allergy/large-party context, sourced 86, prep readiness, BOH staffing exceptions, deliveries, and inventory actions. Display source freshness. Do not invent ticket pace without KDS/POS evidence. |
| P1-22 | **Physical count is biased and fragile.** Expected quantity and live variance show during counting, all 79 items must be entered, and there is no save/resume. | Blind count by storage area/cycle group, save/pause/resume with counter/timestamp, reveal expected after submit, responsive review cards, and final quantity/value confirmation. Correction is a compensating count. |
| P1-23 | **Long BOH forms discard on backdrop or Escape.** Full count, PO, delivery, recipe, and catalog work can vanish. | Dirty guard: Keep editing, Save draft, Discard changes. Any local recovery draft must be encrypted, session-bound, expiring, and never auto-post after reconnect. |
| P1-24 | **Waste can make operational stock stale and may drive balance negative.** Pending waste is omitted from service availability; approval posts negative movement without a balance exception. | Show posted on-hand and effective available after pending waste. Negative approval creates a reconciliation exception, or requires override capability/reason. Do not hide real count errors by blanket rejection. |
| P1-25 | **Labor management uses role checks, not exact capabilities.** Non-employees are treated as management; pending corrections and missed breaks are missing. | Enforce time.review/time.approve. Keep Toast authoritative, but show late/no-show, early clock, job mismatch, overtime risk, correction, auto-clock-out, and missed-break exceptions with source timestamp and correction path in Toast. |
| P1-26 | **Capabilities are bypassed for private HR data and integrations.** General managers can receive certifications, emergency contacts, documents, and integration actions based on role. | Exact capability at navigation, read model, workflow, RPC, and RLS. Introduce separate private-record capabilities; operational performance access must not imply HR document access. |
| P1-27 | **Manual CSV imports queue forever in this repository.** UI promises a processor; finalization only inserts a queued job; no consumer was found. | Leased service-role worker, staging rows, dry-run/error report, idempotent merge, explicit owner approval before financial/destructive application, lineage, heartbeat, and terminal state. Refuse imports if the processor is unavailable. |
| P1-28 | **Financial headlines mix approved, pending, and rejected records.** Tips, closeout performance, and income revenue sum states while separately showing approval counts. | Headline only approved/locked facts. Pending/rejected values get separate reconciliation cards. Test mixed-state datasets and carry state into exports. |
| P1-29 | **Every report looks fresh now.** latest() starts at generatedAt, so old/empty data cannot win; UI then says Fresh. | Separate generatedAt from nullable sourceObservedAt. Render current/stale/empty/partial and include both timestamps in UI/export. |
| P1-30 | **Effective-dated capability administration can edit the wrong row.** Newest rows load first, then a Map lets older duplicates overwrite them. | Resolve effective state server-side for location/date, show history/scheduled changes, prevent overlaps, and create superseding versions. Stage changes behind Review & apply. |
| P1-31 | **Role/location save silently chooses the smallest UUID as primary/home.** UI offers unordered checkboxes; SQL chooses the first sorted selection. | Require explicit primaryLocationId, preserve current primary when valid, and review before/after role, locations, capabilities, and home location. Typed confirmation for owner/admin, promotion, and suspension. |
| P1-32 | **Major owner records lock without adequate review.** Demo Owner approve is immediate; connected closeout submit, tip lock, and policy activation also lack a complete review boundary. | Submit gets review; pending closeout gets audited withdraw/supersede. Owner approval modal shows location/date/sales/cash variance/pool/people and requires Approve & lock. Post-approval corrections are linked revisions or adjustments, never delete. |

## P2 — Correctness, clarity, and polish

1. **Settings truthfulness.** Playground says synthetic mock data is off and operational records are empty while synthetic data is visible. Replace with a persistent “Synthetic playground” banner and data-source label on every card.
2. **Account owner vs equity owner.** Settings says “Owners: Donald & Maris.” Rename this to “System owners” or “Owner access accounts,” and state that access role does not represent legal equity or governance.
3. **Editable settings with no save boundary.** Organization fields look editable but have no Save, Cancel, dirty state, or persistence. Make read-only in demo or implement Draft → Review & save.
4. **Backups and audit overclaim.** Do not show “Supabase-managed · Available” without a connected project and verified backup status. Audit actors must be named principals, not “user”; add request evidence and before/after detail.
5. **MFA copy is unclear and enforcement is weak.** “3 of 9 marked” does not explain who or what “marked” means; production AAL2 is optional. Show enrolled/required/noncompliant accounts and require step-up for permissions, financial locks, exports, retention, and credentials—or for the full owner/admin workspace.
6. **Stale data stays visually live.** Toast timers continue advancing after source staleness; Income says Live when stale; Settings says Tenant configured while owner decisions remain. Freeze/mark approximate values and show “last known as of…”.
7. **Audit is shallow.** Only 50 events load; there are no filters, object detail, diffs, or request evidence. Add pagination, actor/action/object/date filters, and a redacted detail drawer.
8. **Business-date logic can include future demand or use UTC defaults.** Use the restaurant service business date consistently; show forward reservations only in a labeled forecast panel.
9. **Delivery history adds unlike units.** Replace a summed “accepted” quantity across cases/kilograms/each/liters with N lines, total accepted value, or grouped quantities.
10. **Catalog/recipe realtime is incomplete.** Add scoped invalidation for items, pars, vendors, prices, recipes, and units so another kitchen tablet does not stay stale.
11. **Closeout sticky action is stale.** After calculation it still says “calculate before submitting” and continues to foreground Calculate. Change to “Calculated · balanced · review before submit,” and invalidate calculation on any edit.
12. **Global Create is a dead promise for restricted users.** Irini sees Create, “No authorized creation entry points,” and “Navigate, create, or find…” even when create/find are unavailable. Adapt the label and placeholder to actual actions or hide the control.

## The confirmation and undo standard

| Action class | Examples | Required interaction |
|---|---|---|
| Immediate + audited Undo | Arrive, pre-seat table move, running-low, Ready/Needs reset, draft schedule move | Commit optimistically; 8–10 second Undo backed by versioned inverse operation |
| Review + confirm | 86/restore, Complete party, waitlist removal without restore, receiving, service exception, schedule release/swap, closeout submit | Show exact actor, object, before/after state, downstream consequence, and a specific verb |
| Draft → preview diff → confirm | Floor layout, schedule publish, pre-shift publish, recipe publish, role/location/capability settings | Save draft freely; publish only after a diff and impact review; Restore creates a new version |
| Confirm + compensate | Owner financial lock, inventory posting, issued PO, approved count/waste, payroll export | No destructive Undo; correction creates a linked adjustment, reversal, return, cancellation, or superseding version |
| Dirty-form exit | Count, PO, delivery, recipe, catalog | Keep editing / Save draft / Discard changes |

The existing reservation-cancellation dialog is the model: it names the record, consequence, delivery behavior, and reason. The same grammar should be a shared component and server contract—not reimplemented ad hoc.

## Surgical mockups

### FOH: persistent guest drawer, assignment preview, and real Undo

![FOH safety mockup](<../output/product-audit/2026-08-19/34a-mockup-host-safety.png>)

### Chef: truthful readiness when connected inputs are absent

![Chef truthfulness mockup](<../output/product-audit/2026-08-19/34b-mockup-chef-truthful.png>)

### Owner: immutable closeout confirmation and compensating correction

![Owner confirmation mockup](<../output/product-audit/2026-08-19/34c-mockup-owner-confirmation.png>)

The interactive static artifact is [phase-1-surgical-mockups.html](<../output/product-audit/2026-08-19/phase-1-surgical-mockups.html>).

## What survived verification

- Full unit suite: 136 files, 768 tests passed.
- TypeScript typecheck passed.
- FOH targeted suite: 7 files, 47 tests passed.
- BOH targeted suite: 8 files, 46 tests passed.
- Owner targeted suite: 37 tests passed.
- Inventory capability/catalog, service-control, capability, financial configuration, income, people configuration, function-grant, and service-day PGlite suites passed.
- Cancellation confirmation is strong.
- Exact closeout arithmetic reconciles to cents.
- Different-person approval protections exist for closeout, tip runs, and tip policy at the database layer.
- Toast remains attendance authority; the app does not invent local punch controls.
- Reservation availability/no-double-booking foundations remain conservative.
- No production service, database record, message, booking, schedule, provider, or deployment was changed.

The local test runtime used Node 25.6.1 while the project supports Node 22 or 24. Tests still passed, but the runtime emitted local-storage path warnings; rerun release acceptance on a supported Node version.

## Required Phase 1 exit gates

1. Close P0-01 through P0-09 with direct negative authorization and lifecycle tests.
2. Implement the shared confirmation/undo/versioning grammar for reservations, schedule, service, inventory, settings, and finance.
3. Create truthful persona fixtures from one source and one simulated business clock.
4. Run authenticated connected acceptance in an isolated location with host/server/chef/manager/owner accounts.
5. Verify Host and Operations aliases separately, including 320px phone and tablet landscape.
6. Prove provider delivery state, Toast retry, import processing, offline/reconnect behavior, and no-double-booking under concurrent writes.

## Recommended first implementation slice

The highest-risk and most reusable slice is:

1. Same capability resolver in demo and live.
2. Shared ReviewConfirmDialog plus typed-confirm option.
3. Versioned action toast with server-backed Undo/compensating command.
4. Apply it first to reservation Arrive/table move/Complete, reservation reset, closeout approval, pre-shift publish, and 86.

That slice removes the most dangerous trust failures without committing Phase 2 to a larger information-architecture direction.
