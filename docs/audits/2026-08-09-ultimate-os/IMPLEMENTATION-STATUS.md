# Le Yard OS implementation status

- Evidence date: 2026-08-11
- Scope: repository-controlled follow-through on the final delivery plan
- Activation state: public booking, guest messaging, SMS, push, and physical-floor activation remain off

This is the current handoff for the 2026-08-09 audit. The audit remains the historical diagnosis; this file records what the subsequent implementation proved and what is still a release gate.

## Gate status

| Gate                           | Status                                                    | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Remaining proof or work                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 0 — reservation safety    | **Implemented locally; native CI green**                  | Exact location/local-date capabilities; bounded Host reservation/guest DTOs; server-owned channel-bound verification; HttpOnly browser-bound management sessions; atomic expiry; location-serialized rolling pacing; location-safe CRM identity and merge locks; recurring service-period/DST/party invariants; GiST overlap protection; scoped replay; provisional-contact redaction; leased outbox recovery; abuse buckets; real PostgreSQL 17 reservation/schedule concurrency jobs. | Migrations are still unshipped drafts. Rerun connected role/location and CRM race acceptance in an isolated production-like Supabase environment before activation.                                                                                                                        |
| Gate 1 — OS action spine       | **Substantial first vertical slice**                      | Typed `ActionDefinition`; six work modes; stable registry-driven mobile destinations; grouped Navigate/Create/Find/Recent/Contextual omnibox; Today dominant action and reservation exceptions; state-aware permission-resolved reservation object actions with a confirmed No-show boundary; shared accessible Modal, Drawer, Popover, Tabs, FormField, ReadState, ResponsiveDataView, ConversationLog, ConfirmActionDialog, and InlineNotice; keyboard/focus/touch-target checks. | Complete object-level action adoption across Guest, Task, Schedule, Inventory, and Closeout records; migrate remaining legacy inspectors; collect real task baselines before claiming interaction improvements.                                                                          |
| Gate 2 — resilient operations  | **Substantial repository slice; lifecycle work remains**  | Scoped reservation RPCs and replay evidence; typed `ServiceDaySnapshot`; separate snapshot-read and provider-sync freshness; floor-now/future-inventory projections; capability-aware reservation UI; atomic schedule/template commands with publish serialization; exact sensitive Today reads; materialized timezone-aware service shifts with permission-aware exception authoring and native PostgreSQL exception/configuration serialization; responsive reservation floor/book; shared coalesced, reconnect-aware, ID-only Realtime invalidation with explicit stale states. | Run connected Realtime publication/reconnect acceptance; consolidate remaining multi-record workflows; add approved append-only offline outbox behavior; finish responsive alternatives across dense modules.                                                   |
| Gate 3 — production-like pilot | **Not authorized / not started**                          | Kill switches and fail-closed configuration are present; launch dependencies are documented.                                                                                                                                                                                                                                                                                                                                                                                        | Isolated Supabase acceptance, providers, monitoring, backup/PITR and restore, secret rotation, shadow reconciliation, one-writer decision, physical-floor verification, pilot, rollback, and explicit activation approval.                                                               |

No repository test is treated as evidence for provider delivery, a production-like environment, the physical room, the incumbent writer, backups, or a live pilot.

## Delivered reservation contract

- A public create produces a private provisional hold and tentative allocation, never a confirmed reservation.
- The browser receives only an opaque hold ID, expiry, and delivery state. Verification and management capabilities remain server-side or in path-scoped HttpOnly cookies.
- Verification is bound to purpose, tenant, location, hold, expiry, and the proven email or SMS channel. Only that proven coordinate may enter CRM or receive management delivery.
- Confirmation or expiry atomically redacts provisional name, contacts, requests, and unproved coordinates.
- Availability and database pacing include confirmed commitments plus pending unexpired holds only.
- Every inventory writer serializes at the location, records affected operating dates, and releases exact overlapping expired holds before the fresh pacing/table check. Active table intervals remain protected by PostgreSQL GiST.
- Active service periods cannot overlap across recurring weekday, overnight carryover, or intersecting effective dates. DST gaps/folds, party bounds, authoritative turn duration, and service end are revalidated before a public commitment.
- Approved periods materialize into dated service shifts with exact instants. Closures, pacing limits, and opening/closing buffers have explicit audited exception lifecycles and are enforced independently by availability and database writes.
- Hosts read a fixed 10-field reservation RPC and narrow guest summaries. Browser roles cannot select provider payloads, external IDs, or public-management identifiers; linked CRM evidence requires exact location capability.
- Contact and sensitive hospitality data are independently authorized. Shared-profile updates and merges require capability across every affected linked location; raw mutation kernels remain service-only.
- Public confirmation, staff booking, and waitlist entry use one location-safe identity resolver. It locks normalized contacts before guest rows, rechecks after waits, rejects ambiguity and cross-command UUID collisions, and never attaches a verified coordinate to an unrelated location's profile.
- Staff reservation creation owns an immutable wrapper request hash and a distinct inner command ID, so exact retries survive later CRM merges while changed payloads fail. Public confirmation is serialized per scoped hold before replay lookup.
- Public create, confirm, exchange, modify, and cancel are tenant/location scoped and replay-safe. A reservation move refreshes both its active management token and matching browser-bound exchange evidence atomically.
- Outbox claims exclude work whose linked hold, offer, reminder, or confirmation can no longer remain valid for the full lease. Claims are bounded to eight messages under a 120-second lease and 10-second provider timeout.
- Resend uses an idempotency key. SMS remains disabled because Twilio crash-after-acceptance deduplication has not been proven.

## Exact-byte verification

Passed on the current local worktree:

- `le-yard-os`: `npm run verify` — lint, generated database contract (138 tables, 3 views, 251 functions, 16 enums), typecheck, 118 unit files / 622 tests, all portable integration suites, and production build.
- Reservation database lifecycle/security PGlite suite, materialized service-shift lifecycle suite, Income operating-snapshot suite, Realtime publication contract, and the 251-function grant audit.
- Reservation Playwright matrix — 6/6 desktop/mobile tests, including keyboard and focus behavior, repeated-control sizing, 320 CSS-pixel reflow, future-book isolation, open-state axe scans, and rejection of browser console/page errors.
- Route accessibility matrix — 24/24 desktop/mobile checks with no serious or critical axe findings.
- Public `le-yard` integration — 10/10 tests, lint, TypeScript, and production build.
- `npm audit --audit-level=high` in both repositories — zero reported vulnerabilities.
- `git diff --check` in both repositories.

Not yet passed:

- `test:reservations:concurrency` and `test:schedule-atomic:concurrency` still have no local dedicated database URLs and intentionally never fall back to PGlite. Their PostgreSQL 17 GitHub jobs are the native branch gate and must remain green after every push; this does not replace connected Supabase acceptance.
- CRM identity and merge races have deterministic migration-backed rollback proofs, and the reservation native harness includes a stale-contact two-session case. A true two-session merge-versus-resolver run is still part of production-like acceptance rather than a claimed local pass.
- Connected public-site-to-OS browser/API acceptance, real provider failure and crash recovery, explicit 400% browser zoom, dark/open/error/loading state coverage for every critical workflow, screen-reader and physical-device testing, and field Core Web Vitals.

## Release gates that remain open

1. Run both native PostgreSQL concurrency jobs and the connected role/location matrix in an isolated production-like Supabase environment.
2. Prove Auth, RLS, Realtime, cron, monitoring, backup/PITR, restore, and secret rotation.
3. Approve provider identities and failure handling. Keep SMS off until a duplicate-safe Twilio boundary exists.
4. Add an authenticated recovery/reissue policy for guests who never establish a management session during the 48-hour link lifetime.
5. Add platform WAF/bot controls, query-token access-log redaction, consent/privacy acceptance, and backup-deletion proof.
6. Physically verify floor inventory, combinations, paths, buffers, service windows, pacing, cutoffs, and accessibility.
7. Shadow and reconcile incumbent inventory; select one writer or independently approve and test a conflict protocol.
8. Pilot one location with support ownership, kill switches, rollback, and daily reconciliation before releasing a small inventory tranche.
9. Add native exception-concurrency acceptance, connected Realtime publication/reconnect proof, approved offline append-only actions, and the remaining dense-module responsive views.

The operational reservation contract and commands are documented in [`docs/reservations.md`](../../reservations.md). The complete external and product limitations remain in [`docs/known-limitations.md`](../../known-limitations.md).
