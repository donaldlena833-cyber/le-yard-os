# Current Le Yard OS implementation and acceptance status

Updated October25,2026 for the isolated readiness checkout. This replaces the August8 checkbox list; its [historical snapshot](audits/2026-08-08-expansion-baseline.md) remains available. A historical unchecked item does not mean the feature is absent today.

## Version and evidence boundary

Operations base commit `9e673d3287042642c1bae65e7d49a9e498c73ead` plus the local review patch;118 migrations through `20261025085858`,156 public tables,4 views,319 public functions and16 enums. Opening Room is a separate checkout based on `8eca64ac03fe7f374a95dc17aaa1dbaa8c485158`. These are local source/test identities, not a hosted release or restaurant sign-off.

Use four separate status questions: is the implementation present; which exact local commands/browser behaviors were exercised; has the real provider/hosted target accepted it; and has the operating lead/staff accepted it on restaurant devices. The last two cannot be inferred from code, screenshots, generated fixtures or a green build.

## Current implementation slices

| Slice | Present implementation and local evidence | Remaining operating acceptance |
| --- | --- | --- |
| People and permissions | Current membership/location/capability resolution, effective job assignments and explicit overrides; real local roles and native RLS tests | Approved per-person permissions, qualified staffing and shared-device turnover |
| Receiving and inventory | Accepted/rejected quantities, independent exception review, immutable stock postings, cycle/spot/full count scope, waste and transfers | Vendor credit/replacement financial closure, actual physical quantities and custody |
| Recipes and prep | Recipe-traced draft/publish/actual-yield completion and replay-safe stock posting exercised in the integrated day | Approved stations, labels, shelf life, allergens, batch traceability and demand rules |
| Service Control | Manager logs, versioned pre-shifts, version-specific acknowledgements, immutable86/running-low/restoration events, current scoped refresh signals | Complete allergy/cash/guest-recovery carryover and approved escalation/closure |
| Reservations and floor | Canonical DD08 logical floor, authoritative turn quotes, pacing/capacity refusals, edit/cancel, no-show replacement and replay recovery | Physical room approval, elapsed turns/reset buffers, one live writer and provider acceptance |
| Financial support | Manual recorded labor, independent closeout approvals, derived tip sources/allocations and idempotent support exports | Cash/tip policy, independent Square control totals and payroll/accounting receiving receipts |
| Square | Explicit provider and Sandbox-only allowlisted order/payment/refund source stage;45 connected fake-provider checks and44 Square assertions within194 native tests at112 (version-bound Square evidence) | Actual API access, financial/business-date/catalog reconciliation and reviewed posting; real devices/offline settlement |
| Attendance | Retained attendance records; current source setup pending | Select timekeeping authority, configure and validate actual punches/corrections/payroll handoffs |
| Opening Room | Separate local logic, clock-pinned browser and11 connected checks | Actual commitments, budget, shared hosted operation and owner acceptance |
| Recovery | Earlier105-migration same-cluster DB/Auth/REST/Storage restore42/42 plus6 cleanup checks; latest118 checkpoint listing-validated | Latest checkpoint restore, independent/managed infrastructure, frontend/Realtime/provider recovery and agreed RPO/RTO |

The unused Toast adapter/client/setup/sales CSV and staff punch instructions are removed. Its old HTTP worker is retired with410; historical SQL/source/audit identities are retained for compatibility. Square POS selection does not select Square attendance, payroll or reservation services.

Current source requires no second factor: `requiresOwnerMfaGate()` is false and migration `20260907141430_permanent_password_auth.sql` supersedes old AAL2-era gates. Password authentication never grants an organization role, location or capability by itself. See the [permission matrix](permission-matrix.md) and current RLS/function bodies. Historical `_aal2_legacy` names are not evidence of a current MFA requirement.

## Coverage across operating areas

The table below records exercised surfaces and remaining acceptance, not a claim that every possible workflow passed. Exact command/browser results, failed baselines, source hashes and version bounds are retained in the separate readiness package (`validation-summary.json`, `findings.csv`, `workflow-coverage.csv` and `package-manifest.json`).

| Area | Exercised scenario | Required next acceptance |
| --- | --- | --- |
| Opening Room | Work, dependency dates, budget, payments, refunds and concurrent edits | Hosted multi-user acceptance; reconcile actual opening commitments/owners/dates; staff walkthrough and managed recovery |
| Today | Role-safe command center, source freshness and exceptions | Live role sessions and staff prioritization; current hosted load and physical-device latency |
| Reservations | Book, arrive, seat, complete, change, cancel, no-show and waitlist | Approved staff exception/source-of-truth policies; hosted exact-source acceptance; staffed current-device rehearsal |
| Floor and pacing | 40-seat capacity, turns, held/closed tables and party size | Physical table/combination/accessibility approval |
| Public booking | Gates, hold expiry, guest identity and delivery lifecycle | Approved public pilot and actual provider messages |
| Guestbook | Allergy search, consent, hospitality profile and merge | Server/chef acknowledgement and real guest consent |
| Phone and SMS | Keypad, fallback, history, consent, media and outbound truth | Handset call, routing, voicemail and receipt-based delivery |
| Groups | Internal announcements, reactions and case notes | Real membership delivery and multidevice acknowledgement |
| Service Control | Pre-shift, running-low, 86, manager log and handoff | Staffed allergy/86/handoff drill, escalation ownership, physical-device acceptance and reviewed deployment; archive/history pagination and approved briefing/allergy chain |
| Kitchen recipes | Ingredient quantities, recipe costing and versions | Approved production recipes, allergens and menu mappings |
| Prep | Draft, publish, assign, yield, post and correct | Approved recipe inputs, batch traceability, physical labels and station timing |
| Inventory counts | Blind count, review and immutable stock adjustment | Physical count and receiving stock baseline |
| Waste and transfers | Reasons, review, destination custody and stock effects | Physical waste/transfer evidence and staff acceptance |
| Purchasing | PO creation, review and vendor price history | Vendor cutoffs, lead times, actual order transmission |
| Receiving | Partial receipt, damage, substitution and independent review | Cold-chain decision/recheck, physical evidence image, vendor credit closure |
| Invoices | OCR review, duplicate handling, PO links and item suggestions | Live extraction provider and full invoice/credit accounting |
| People | Invites, job roles, location scope, availability, leave and documents | Synthetic Auth role matrix, employee device and document access |
| Scheduling | Create, publish, swaps, open shifts and employee acknowledgement | Call-out and qualified replacement rehearsal |
| Time Clock | Retained attendance, missed-punch policy and future source handoff | Select actual timekeeping authority and qualified employee/job mappings; reconcile real punches, breaks, corrections and timezone/business dates; approve F33 manager/second-review policy and receiving payroll handoff. |
| Closeout | Cash movements, tenders, variance, submit and independent approval | Physical drawer/drop/deposit custody; approved procedures and source reconciliation Actual restaurant-device and broader financial visual acceptance remain separate from the responsive F48 proof. |
| Tips and earnings | Eligibility, cents, policy versions, locks and self-only earnings | Approve actual restaurant policy and missed-punch review rule; verify payroll mapping and receiving-provider acceptance |
| Income and reports | Checks, costs, freshness, filtered reports and exports | Source completeness and external reconciliation |
| Tasks, checklists and SOPs | Create, assign, evidence, version, acknowledge and complete | Role-specific real procedures and photo evidence on devices |
| Food-safety support | Temperature/photo entry and escalation | Approved ranges, rechecks and trained lead sign-off |
| Maintenance and incidents | Create, private scope, transition and follow-up | Equipment outage and incident response rehearsal |
| Ask Le Yard | Citations, proposals, confirmation, authorization and Undo | Owner-approved live provider, if desired |
| Settings and access | Location scope, explicit denies, expiry and administrative boundaries | Approved per-person permissions; remote session/token-revocation semantics, hosted/mixed-version rollout and physical shared-device turnover; dedicated Host/Phone guard browser acceptance. |
| Realtime and offline | Paused commands, reconnect, stale state and recovery | Broader Realtime subscription-authorization races and mid-command reconnect recovery; dedicated Host/Phone browsers, coordinated hosted mixed-version rollout, production latency/load and physical shared-device turnover. |
| Integrations | Source health, CSV custody, retries and kill switches | Actual Square Sandbox/API access, query/version/rate-limit acceptance, owner setup/remapping, independent financial/business-date/catalog reconciliation and reviewed posting; webhook/scheduling, devices/offline acceptance; offer confirmation and explicit attendance/reservation/payroll/accounting authorities. |
| Backups | Archive provenance, schema, data, grants and restore | Approved RPO/RTO/retention/key custody; managed backup/PITR and truly independent infrastructure; Realtime/frontends/providers, offsite and physical operational fallback acceptance; pre-incident acknowledged transaction completeness was not established by those health checks |

## Repeatable local gates

Use Node22. The complete portable migration chain is `npm run test:integration`; it does not emulate real Auth/Storage/Realtime. The native SQL suite is `npm run test:rls` with an explicitly isolated loopback `RLS_TEST_DATABASE_URL`; it creates/drops only its own disposable database and requires all15 files/418 assertions. Real sign-ins, file payloads and browser behavior have separately guarded runners under `tests/local-readiness/` with explicit fixture, status, evidence and localhost origin paths.

Do not reset retained records, link a hosted database or infer current availability from historical healthy evidence. The readiness sandbox is stopped between controlled runs. The exact-source build, type generation, typecheck, unit and lint results are separate from provider, production and physical-staff acceptance.

The current revision adds client context withdrawal and correct Closeout landmarks; its specific accepted/failing browser outcomes belong in the current readiness package. No approval or rollout is implied by this documentation update.

Version-bound114 coverage passed287 assertions across11 files. Timestamp/clock corrections at113 retain their earlier215-check proof; checklist shape/storage coverage now adds72 assertions and20 actual-Auth/Data API checks. F38 is closed locally with21 documented warnings remaining; F51 corrects malformed checklist drafts. Equipment/incident commands pass23 actual connected checks; asset links and physical operating acceptance remain open (F22). The full integrated35-check service day remains at112.

Earlier115 staffing coverage passes312 native assertions,19 concurrency checks,20 actual-Auth/API checks and6 browser/persistence checks. Assignment overlap and current retry access are guarded; acknowledgement display now matches the current assigned person. All10 attendance/financial hashes match the pre-round114 checkpoint. Call-out policy, station minimums, staff/device and provider acceptance remain separate.

Earlier116 adds337/337 native assertions,24 capability/qualification concurrency checks across7 interleavings,18 actual-Auth/Data API checks, and a repeated19/19 overlap race suite. Explicit schedule.manage denial is enforced for reopen/decide commands and their saved results; an explicitly authorized Employee can operate those commands at an assigned location. Publication rechecks active job roles, employment/start/end dates and effective location qualifications while holding relevant records. A later withdrawal is a separate operating follow-up; automated alerts and reassignment remain proposed. Ten attendance/financial table hashes match the pre-round115 checkpoint. No fresh browser, hosted release, physical staff or provider acceptance is claimed for116.

At117, receiving proposal bounds and retained evidence checks pass362 native assertions,26 concurrency checks and27 actual-Auth/Data API cases. The reviewed migration changes two public bodies and adds one internal pure validator; existing records/security metadata are preserved. Partial PO and corrective stock reconcile to4 accepted units, while a nominal credit claim remains accepted/unconfirmed. Duplicate invoice identifiers and actual substitution/credit closure remain open operating expansions.

## Prep118 boundary and acceptance

Published formulas capture normalized ingredients, yield/conversion factors and a verifiable recipe version. Legacy active tasks require explicit `prep.manage` adoption; completed history is not backfilled. `prep.complete` permits assigned start/completion, while correction requires `prep.manage`; current scope and original-actor receipts remain enforced. A private ledger revision rejects conflicting stale-snapshot postings. Native418, concurrency26/10 phases, actual-Auth/API25 and Owner/staff browser15 pass locally. The measured-yield field requires explicit entry; posted/corrected actual yield and restaurant-local dated deadlines remain visible. Full1488 units, build/types/type/lint pass after browser corrections; the20-verifier SQL chain is bound by an exact two-file source bridge.15 production decisions remain pending; demand, non-stock work, physical lots/labels/SOP/expiry/allergy/release and staffed acceptance remain open. No hosted deployment or physical prep is claimed.
