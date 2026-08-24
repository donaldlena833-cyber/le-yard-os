# Le Yard OS — Phase 2 implementation handoff and system grade

> Historical checkpoint. Superseded by `phase-2-production-release-and-system-grade-2026-08-20.md` after the remaining repository-controlled Phase 2 blockers were implemented and released.

Date: August 19, 2026
Decision: **Preview-ready; not approved for production service**
Overall grade: **C+ / 69**

## Executive judgment

This implementation closes the most dangerous authorization and false-success defects found in Phase 1, applies the corresponding schema changes to the linked Supabase project, passes the complete supported-runtime repository gate, and is available in a healthy Vercel preview.

It does **not** complete the full 30/60/90 blueprint. Production promotion remains blocked because connected real-role acceptance, provider delivery evidence, manual Prep, import processing, and the universal correction/Undo grammar are not complete. Calling the system production-ready would overstate the evidence.

## What is now fixed and proven

### Role and data isolation

- Demo Messages filters channels by visibility, kind, participants, organization, principal, and surface. An employee can no longer inherit a management conversation through organization-only storage.
- Demo and connected report catalogs use the same exact report-kind capability map.
- Operational-report access cannot enumerate tips, payroll, receipts, expenses, COGS, or sales-to-labor data.
- Report pages, CSV/PDF export routes, read models, RPC guards, insert guards, and RLS all enforce the same report-kind boundary.
- Employee and chef Today projections omit owner-only sales and decision material instead of merely hiding it visually.
- Demo Service controls resolve exact capabilities rather than treating every simulated user as a manager.
- Protected demo routes resolve route access before rendering the demo surface.

### Reservation and host safety

- Demo reservation and waitlist forms now create real local model records, update counts/pacing, allocate a best-fit table where possible, and persist per organization, location, principal, and surface.
- Browser acceptance creates both records, reloads, and proves that they survive on desktop and mobile.
- Booking and waitlist errors render inside the active dialog with assertive announcement.
- Pending connected forms cannot close through Escape, backdrop, close, or Cancel while a mutation is unresolved.
- Reservation configuration reset requires typed location confirmation.
- Reset refuses to run when future reservations, active holds, or live allocations exist.
- Reset captures a server-side configuration/floor/table/membership snapshot and writes an audit event before replacing the draft.
- Approval switches default to the current online-booking, messaging, and staff-push values rather than silently turning them off.

### Service and pre-shift truth

- Staff can read the published pre-shift content they are asked to acknowledge: allergies, VIPs, large parties, specials, 86/staffing context, stations, handoff, goal, and training point.
- Draft pre-shifts and manager notes remain manager-capability only.
- The first safe projection implementation was rejected after the live Supabase advisor identified a security-definer view. It was replaced with an explicit location-scoped RPC; the production advisor now reports zero errors.
- Acknowledgement is attached to the exact published pre-shift record.

### Purchasing and receiving

- Purchase orders now follow `submitted -> approved -> partially_received/received`, or `submitted -> cancelled` on rejection.
- Approval requires `inventory.purchase.approve` and a reviewer different from the creator.
- Receiving against a submitted or rejected order is blocked in PostgreSQL, not just in the interface.
- Review is idempotent and creates durable audit evidence.
- The UI exposes Review separately from Receive and shows creator/reviewer evidence.

### Toast and integration retry safety

- Retry jobs are claimable rather than deadlocking behind their own queued state.
- Worker leases expire and can be safely reclaimed after an abandoned run.
- Queue identity and terminal evidence remain immutable.
- Toast remains a read-only labor authority; this change does not introduce POS write-back.

### Reporting truth

- Empty reports no longer manufacture “fresh now” from the report-generation timestamp.
- Source freshness is nullable and comes from the newest observed source record.
- Empty/stale reports can therefore be represented honestly in UI and export output.

## Supabase state

Linked project: `qcmwqnonxabdsntfsuzy`

Applied and confirmed:

1. `phase2_go_live_safety`
2. `replace_preshift_security_definer_view`

Live catalog proof confirms the reservation snapshot table, Toast lease column, report-scope RPC, purchase-review RPC, and staff-safe pre-shift read RPC. The security advisor reports **0 errors**, with only the repository's existing informational/warning class plus intentional authenticated workflow-RPC notices. All 140 public tables remain forced-RLS in the portable database contract.

## Verification record

All release checks were run with Node `22.22.0`, which satisfies the declared `22.x || 24.x` runtime.

| Gate | Result |
|---|---:|
| ESLint | Pass |
| Generated database contract | Pass — 140 tables, 3 views, 272 functions, 16 enums |
| TypeScript | Pass |
| Unit/component tests | 772 / 772 pass |
| Portable PostgreSQL migration/integration suites | Pass |
| Migration chain | 63 / 63 pass |
| Forced-RLS catalog | 140 / 140 public tables |
| Optimized Next.js build | Pass |
| Browser tests | 66 / 66 pass before the strengthened booking test |
| Strengthened booking/waitlist persistence test | 2 / 2 pass — desktop and mobile |
| Dependency audit | 0 vulnerabilities |
| Supabase security advisor | 0 errors |
| Vercel preview build | Pass |
| Preview `/api/health` | 200 ready |
| Anonymous `/reports` | 307 to sign-in |
| Anonymous `/api/health/email` | 401 |

Preview: https://le-yard-os-preview-ed8254361d9e-donald-lenas-projects.vercel.app

Production was not promoted.

## System grade

| Area | Weight | Score | Grade | Judgment |
|---|---:|---:|---:|---|
| Authorization and data isolation | 18 | 15.8 | B+ | Stronger exact-capability enforcement; connected six-principal negative matrix is still outstanding. |
| FOH reservations and host operations | 16 | 11.7 | B- | False demo success, modal errors, pending dismissal, and reset safety fixed. Real correction/Undo and notification-delivery state remain. |
| Service Control and Today | 11 | 8.0 | B- | Role projections and readable pre-shift fixed. Canonical 86 lifecycle and kitchen handoff remain. |
| BOH inventory, purchasing, recipes, Prep | 16 | 8.2 | D+ | Independent PO approval is real. Receiving exceptions, blind count/resume, costing, recipe versions, and Prep remain incomplete. |
| Owner finance and governance | 12 | 8.1 | C+ | Report scope/freshness fixed. Mixed-state headlines, universal approval review, and explicit primary-location governance remain. |
| Integrations and degraded operation | 10 | 5.6 | D+ | Toast retry/leases fixed. Manual CSV has no processor; provider delivery and offline reconciliation are unproven. |
| Action safety and recoverability | 10 | 5.5 | D+ | Typed reset confirmation and several busy/error guards exist. Universal versioned Preview/Confirm/Undo/Compensate does not. |
| Accessibility, responsive UI, release engineering | 7 | 6.1 | A- | Automated desktop/mobile accessibility and 320-pixel reservation checks pass; real screen-reader/tablet/provider rehearsal remains. |
| **Total** | **100** | **69.0** | **C+** | **Preview-ready, not service-ready.** |

## Phase 1 blocker disposition

| Finding | Status | Evidence judgment |
|---|---|---|
| P0-01 demo role testing untrustworthy | Partial | Shared capability projection is materially better; full simulated-role matrix and one-clock fixture contract remain. |
| P0-02 management messages exposed | Closed | Channel enumeration, selection, persistence, and send are principal/visibility scoped. |
| P0-03 report capability crossover | Closed locally and in production DB | UI/export/read/RPC/RLS use exact kind capability. Connected real principals remain a release gate, not a known bypass. |
| P0-04 one-click reservation reset outage | Closed | Typed confirmation, blocker query, snapshot, audit, and current-value defaults. |
| P0-05 Toast retry deadlock | Closed | Claim/lease and expired recovery pass database tests. |
| P0-06 demo booking/waitlist false success | Closed | Create, persist, reload, and mobile/desktop browser proof pass. |
| P0-07 unreadable pre-shift acknowledgement | Closed | Staff-safe published content projection and exact acknowledgement are live in Supabase. |
| P0-08 PO approval bypass | Closed | Independent reviewer and database receiving guard pass. |
| P0-09 Prep advertised but absent | **Open blocker** | Capability names still exist without the required production lifecycle. |
| P0-10 production acceptance unproven | **Open blocker** | Preview/local evidence is strong; isolated connected rehearsal and provider proof are not available. |

## Residual release blockers

1. Build manual Prep with capability/location/RLS, targets/units, draft/publish, completion preview, inventory posting, compensation, concurrency, and phone/tablet acceptance.
2. Create a leased manual-CSV processor or make import unavailable before upload. The current queue has no consumer in this repository.
3. Implement server-backed reservation correction: Arrive/table-move Undo, Seat compensation, and Complete Reopen with allocation restoration.
4. Replace floor auto-save with local draft, validation, Review changes, explicit Save, Discard, and multi-step Undo.
5. Build waitlist delivery lifecycle (`queued -> sent/failed`) and start offer expiry only after confirmed delivery.
6. Canonicalize 86/restore against menu/recipe/inventory IDs and require confirmation or inverse-event Undo.
7. Add PO delivery exception evidence and review-before-post; then blind count save/resume and server-side batch/portion costing.
8. Add the manual import worker, provider timeout/retry reconciliation, read-only offline snapshot, and reconnect diff.
9. Fix role/location administration to require an explicit primary location and a before/after review.
10. Run isolated connected acceptance with Owner, Admin, Manager, Chef, Host, employee, denied, expired, and cross-location accounts across both Host and Operations aliases.
11. Rehearse a full service and capture real Toast, email/SMS, browser, mobile, tablet, screen-reader, backup/restore, and forward-fix evidence.

## Release decision

Keep the current production aliases unchanged. Use the preview for review and connected-pilot preparation. Promote only after P0-09 and P0-10 close and the first seven residual release blockers have passing database, browser, and connected evidence appropriate to their risk.

## August 20 owner-intelligence addendum

The single-owner Ask Le Yard beta adds a properly bounded action path without changing the release decision:

- Donald is the only enabled operator; exact active-owner membership and AAL2 are checked on every intelligence RPC.
- The official Codex subscription runtime is local to Donald's signed-in Mac. No OpenAI API key, ChatGPT token, or Codex home directory was copied to Vercel or Supabase.
- The first action grammar is deliberately narrow: propose an unassigned operational task, show the exact values, require a separate confirmation, bind execution to a SHA-256 proposal fingerprint, and offer an audited Undo that cancels a still-open task.
- The model receives only the authorized location's bounded report evidence and cannot use shell, file, MCP, browser, web, or network tools.
- Production Supabase contains the authorization, evidence, proposal, execution, and reversion controls. The guarded Vercel preview builds successfully but does not enable the local-subscription runtime.
- Full verification now covers 139 test files / 773 tests and 279 explicitly reviewed database functions; the real subscription smoke returned a valid structured proposal with zero tool calls.

Updated grade: **C+ / 70**. Action safety and recoverability rises from 5.5 to 6.3 because one complete Preview -> Confirm -> Execute -> Undo path now exists. The weighted overall score rounds to 70; all other area scores and the **not approved for production service** decision remain unchanged. Production intelligence additionally requires the signed localhost owner companion described in `docs/owner-intelligence-runbook.md`; hosting subscription credentials in Vercel is not an acceptable substitute.
