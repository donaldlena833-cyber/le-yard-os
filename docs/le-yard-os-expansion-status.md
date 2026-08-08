# Le Yard OS expansion status

Updated: 2026-08-08

This is the tracked implementation record for the Le Yard OS expansion mission. It is updated during implementation. A checked item means the repository contains a working, verified slice; a partial item names the exact boundary. Synthetic demo behavior is never evidence that a connected workflow is live.

## Current repository findings

- The application is Next.js 16.2 App Router with React 19, TypeScript, Supabase/PostgreSQL, Zod, Motion, Vitest, Playwright, and portable PGlite migration verification.
- The tenant hierarchy is already `organization -> locations`. All 116 public tables use enabled and forced RLS; anonymous table access is revoked.
- The data layer already centralizes verified JWT actors, active organization memberships, location scope, schema validation, server actions, database errors, and connected/demo result boundaries.
- Critical workflows already use actor-derived RPCs, private idempotency request records, immutable terminal evidence, integer-cent money, canonical inventory units, audit triggers, and private storage.
- Existing inventory covers catalog configuration, counts, count approval, purchase-order creation, receiving, waste, transfers, price history, recipes, and immutable stock transactions.
- Existing coarse permissions remain for backward compatibility, but the repository now also has a database-backed operational capability layer for job roles, effective location scope, and explicit user grants/denials.
- Connected mode fails closed and does not substitute demo records. Effective capabilities are loaded for the active location before rendering a ready workspace.
- Navigation is grouped under the target Today, Service, Kitchen, Team, Guests, Money, Operations, Insights, and Settings areas and filters modules using effective capabilities.
- Demo mode once again exposes its clearly marked synthetic single-room inventory, vendors, invoices, guests, tasks, SOPs, incidents, maintenance, announcements, and chat records. Connected components remain separate and never import these fixtures.
- The repository includes unit, PGlite integration, pgTAP RLS, connected Playwright, demo E2E, accessibility, database-contract, and build verification commands.
- No provider credentials are available for Toast, reservations, OCR, accounting, payroll, email, push, weather, or events. Provider-neutral/disabled-state behavior must remain truthful.

## Implementation decisions

- Preserve organization roles as the security and administration ceiling; add operational capabilities beneath them.
- Owners retain every capability. Admins retain broad operational capabilities. Owner MFA requirements on existing sensitive administration remain unchanged.
- Effective capabilities are actor-derived from current job-role assignments at a location, plus optional user grants/denials. A matching user denial wins over grants. Inactive or out-of-date assignments do not authorize.
- Capability assignment rows are deactivated/effective-dated rather than deleted. Direct authenticated DML is revoked; audited, idempotent commands manage assignments.
- Capability checks will be enforced in both the server data layer and PostgreSQL commands. UI visibility is an affordance, not a security boundary.
- Existing role behavior remains available while individual workflows migrate to capability enforcement; the completed Chef catalog slice is capability-enforced in both its server workflow and database command.
- Catalog/product/recipe configuration remains versioned or history-preserving. Inventory ledger history remains append-only.
- New public tables will use explicit tenant/location foreign keys, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, least-privilege grants, and audit/update triggers.
- No live deployment, live provider connection, public website change, or production Supabase mutation is part of this run.

## Workstream checklist

### 1. Capability-based access control

- [x] Capability catalog covering the requested operational capability keys
- [x] Job-role capability assignments
- [x] Location-specific capability scope
- [x] User-specific grants and denials
- [x] Effective dates and activation/deactivation
- [x] Secure `has_capability(...)`, `has_any_capability(...)`, and `effective_capabilities(...)` database helpers
- [x] Effective-capability read model for the signed-in user
- [x] Idempotent, actor-derived assignment commands
- [x] Capability assignment audit evidence
- [~] Capability-aware RLS and workflow enforcement: catalog reads and the completed Chef catalog write slice are enforced; remaining operational RPCs still require capability-specific follow-up migrations
- [x] Permission-aware UI helpers, navigation, settings assignment UI, and unavailable-action explanation
- [x] Demo Executive Chef, Sous Chef, FOH Manager, Bar Manager, and employee templates
- [x] Portable cross-tenant, cross-location, grant/deny, replay, audit, direct-DML, and Owner/Admin invariant tests

### 2. Navigation and role-specific home

- [x] Consolidate primary navigation to Today, Service, Kitchen, Team, Guests, Money, Operations, Insights, Settings
- [x] Hide inaccessible modules and the implemented inventory actions using effective capabilities
- [~] Owner command center exists; expanded financial/freshness/risk composition remains
- [~] Chef command center exists; expanded stock/order/prep/86 evidence remains
- [~] FOH Manager command center exists; expanded reservations/pre-shift/logbook evidence remains
- [~] Employee command center exists with own shifts, open coverage, announcements, and earnings boundary
- [~] Capability-aware mobile navigation exists; critical-workflow three-tap audit remains

### 3. Inventory command center

- [~] Existing catalog, pars, vendor packs, prices, counts, waste, transfers, recipes, and on-hand views are present
- [x] Capability-based Chef item, vendor, vendor-pack/price, location-par, and recipe management without Admin access
- [ ] Storage areas and item placement
- [ ] Shelf life, count frequency, specifications/images, substitutes
- [ ] Minimum order, order multiple, lead time, delivery day, and cutoff configuration
- [ ] Operational status calculation: healthy/low/critical/overstock/pending/stale/cost anomaly/unavailable
- [ ] Fast phone flows for waste, count, low stock, and transfer
- [ ] Theoretical/actual usage and variance evidence

### 4. Purchasing and receiving

- [~] Existing idempotent PO creation, delivery receiving, price history, and immutable inventory posting are present
- [ ] Explainable suggested-order calculation and pack rounding
- [ ] Explicit guarded PO lifecycle through approval/sent/partial/closed/cancelled
- [ ] Receiving exceptions for rejected/damaged/substituted/missing/unexpected/short/over lines
- [ ] Confirmation attachments and exception review

### 5. Invoice ingestion and matching

- [~] Private receipt upload, OCR job/evidence, duplicate review, expense and delivery links exist
- [ ] Invoice header/line-item model and structured editor
- [ ] Provider-neutral extraction interface and deterministic test provider
- [ ] PO, delivery, item, vendor SKU, and category matching
- [ ] Approval workflow and approved price-history/accounting-support evidence
- [ ] Forwarded email/provider entry adapters remain integration-dependent

### 6. Recipes, menu costing, and menu engineering

- [~] Versioned recipes, canonical ingredient quantities, waste factors, and current costing exist
- [ ] Recipe metadata, sub-recipes, instructions, photos, allergens, station, active dates, approval state
- [ ] Menu-item mapping, external IDs, prices, targets, and service periods
- [ ] Historical recipe cost and driver explanation
- [ ] Sales-backed menu engineering with disclosed thresholds and source coverage

### 7. Prep and production planning

- [ ] Prep-plan schema, statuses, assignments, evidence, actual yield, waste, and variance
- [ ] Manual and template creation
- [ ] Deterministic reservation/forecast/menu-mix/inventory suggestion engine
- [ ] Reviewable ingredient-consumption/finished-batch posting

### 8. Service command center

- [~] Existing Today read model has role-scoped employee, chef, and management surfaces
- [ ] Thirty-second service/staffing/kitchen/operations/money/integration command center
- [ ] Severity hierarchy and evidence/freshness/action presentation

### 9. Manager logbook and handoff

- [ ] Auditable log entries, links, follow-up, status, and mobile quick entry
- [ ] Previous-service unresolved handoff on Today

### 10. Pre-shift workflow

- [ ] Draft/publish/template/archive workflow
- [ ] Structured service context and employee acknowledgement/comments
- [ ] Today acknowledgement progress

### 11. 86 and running-low

- [ ] Immutable availability events and current state
- [ ] Realtime FOH propagation
- [ ] Fast authorized Chef update
- [ ] Pre-shift, Today, and service integration
- [ ] Explicit provider capability boundary for any Toast write-back

### 12. Scheduling and labor intelligence

- [~] Scheduling, publishing, acknowledgement, swaps, and open shifts exist
- [ ] Explainable demand, staffing, labor-dollar, and coverage recommendations
- [ ] Configurable assumptions separated from draft compliance rules

### 13. Contextual employee performance

- [ ] Manager-only contextual metrics with range, sample, completeness, comparison, and limitations
- [ ] No opaque score or automated employment decision

### 14. Guest CRM and service recovery

- [~] Guest profiles, contacts, visits, reservations, consent, notes, tags, and human-reviewed merge exist
- [ ] Least-privilege service-facing tonight context
- [ ] Guest-recovery cases, follow-up, cost, patterns, and reporting

### 15. Maintenance and asset management

- [~] Maintenance requests and audited status workflow exist
- [ ] Asset catalog, documents, warranty, preventive maintenance, downtime, repair cost, recurrence

### 16. Food-safety support

- [ ] Configurable owner-approved log definitions, readings, thresholds, exceptions, corrective action, and review
- [ ] Missing/out-of-range Today signals without legal certification claims

### 17. Cash management and closeout

- [~] Closeout, cash variance, independent approval, attachments, tip calculation, and immutable locking exist
- [ ] Drawer, drops, paid outs, refunds, safe, deposit preparation/verification/match
- [ ] Separate guarded cash/closeout/tip/deposit approvals

### 18. Financial operating intelligence

- [~] COGS periods, approved labor view, closeouts, expenses, and reports exist
- [ ] Prime cost with target/variance/drivers
- [ ] Actual-versus-theoretical item/category variance with coverage/freshness
- [ ] Weekly/monthly budget and forecast model

### 19. Forecasting engine

- [ ] Provider-neutral forecast runs, source snapshots, assumptions, outputs, confidence, coverage, actuals, and error
- [ ] Deterministic baseline for covers, sales, mix, labor, prep, inventory, and purchasing

### 20. Proactive operational intelligence

- [ ] Evidence-backed insight schema, stable fingerprint, deduplication, freshness, confidence, action, and resolution

### 21. Ask Le Yard

- [~] Deterministic connected queries with citations and guarded proposals exist
- [ ] Expanded operational questions, role/location scope, source coverage, freshness, and draft actions

### 22. Notifications

- [~] In-app notifications, preferences, encrypted push metadata, and derived evidence exist
- [ ] Priority, quiet hours, digests, escalation, acknowledgement, and deduplication
- [ ] Push/email remain disabled until verified credentials/processes exist

### 23. Global search and command palette

- [ ] Permission-scoped entity search
- [ ] Keyboard-accessible and touch-friendly quick actions

### 24. Mobile, PWA, realtime, and offline

- [~] PWA shell, responsive workspaces, private camera/file inputs, and several realtime subscriptions exist
- [x] Critical demo workflow mobile and accessibility pass for Today, schedule, messages, vendors, invoices, inventory, guests, team, closeout, and reports
- [ ] Visible idempotent offline draft queue for safe workflows only
- [ ] Explicit conflict/stale-data handling

### 25. Integration platform

- [~] Adapter registry, private credentials, manual CSV, retries, row outcomes, and health evidence exist
- [ ] Normalized Toast contracts and reconciliation
- [ ] Reservation contracts and consent provenance
- [ ] Accounting/payroll approved-export contracts
- [ ] Invoice/email, vendor ordering, weather, event, calendar, and optional delivery adapters

### 26. Reports and daily briefs

- [~] Fourteen report types with connected CSV/PDF exports exist
- [ ] Owner, Chef, Manager, and Employee daily briefs with linked evidence
- [ ] Universal source, freshness, coverage, partial/stale, mapping, and confidence presentation

## Migrations added

- `supabase/migrations/20260808135755_capability_authorization_foundation.sql`
  - adds the 40-key system capability catalog
  - adds forced-RLS `job_role_capabilities` and `user_capability_overrides`
  - adds effective-date/location-aware private evaluation and actor-derived public helpers
  - adds idempotent audited Owner/Admin assignment commands
  - adds capability-aware inventory read policies
  - adds a narrow idempotent Chef operational catalog command for items, vendors, packs/prices, and location pars

## Routes and components added

- Existing routes are preserved; navigation now groups them into the target nine operating areas.
- Added `src/components/settings/capability-configuration.tsx` for active/inactive job-role capability assignments at one location or across accessible locations.
- Added `src/lib/permissions/capabilities.ts` as the typed application capability catalog, UI predicates, kitchen grouping, and synthetic role templates.
- Added the `configureJobRoleCapabilityAction` server action and its validated `configureJobRoleCapability` data workflow.
- Updated authenticated workspace resolution to load effective capabilities for the active location, in parallel with persona resolution, and fail closed when the capability query fails.
- Updated Settings data, inventory workflows/read model/editor, shared navigation, shell command palette, and generated database types.
- Restored clearly synthetic, single-active-room demo records to Inventory, Vendors, Receipts, Guests, Tasks, SOPs, Maintenance, Incidents, announcements, and internal chat. Connected workspaces remain isolated.

## Tests added

- `scripts/verify-capabilities-pglite.mjs`
  - all forward migrations plus synthetic seed
  - effective grants and denial precedence
  - tenant/location isolation
  - manager self-escalation refusal
  - Chef item/vendor/pack/price/par commands
  - exact replay, audit evidence, direct-DML revocation, and anonymous denial
- `tests/unit/permissions/capability-navigation.test.ts`
  - Executive Chef navigation scope
  - manager-without-capability refusal
  - ordinary employee module isolation
- Updated live inventory and workspace fixtures for explicit capability context.
- Updated schedule/chat E2E coverage to use the current synthetic Chef identity and a visible pinned synthetic announcement.
- Added keyboard-focusable labels to responsive inventory and guest overflow regions.
- Made the full PGlite verifier date-portable by creating a current actor-published test shift instead of mutating immutable seed evidence.

## Completed items

- Repository architecture, required handoff documents, route tree, existing data-layer conventions, demo/connected boundaries, test scripts, and all migration object definitions have been inventoried.
- Capability schema, assignment commands, active-location evaluation, audit evidence, connected session loading, navigation filtering, assignment UI, synthetic templates, and the Chef catalog write slice are implemented.
- Database types now include 116 tables, 3 views, 193 functions, and 16 enums.
- Demo Inventory, Vendors, Receipt review, Guestbook, Tasks/SOPs, schedule acknowledgement, and internal chat are populated and behave consistently on desktop and mobile.
- The complete repository verification gate, all portable integration verifiers, 415 unit tests, 46 desktop/mobile Playwright tests, 20 focused accessibility tests, production build, and dependency audit pass.

## Partially completed items

- Inventory count, waste, transfer, purchase, receiving, and approval RPCs still use their existing management-role command checks; UI visibility is capability-aware, but each RPC needs a follow-up forward migration before Employees with operational capabilities can safely use those writes.
- The existing inventory slice is functionally broad, but it lacks the requested storage-area, ordering-assumption, receiving-exception, prep, and availability-event models.
- The Settings capability UI currently manages job-role assignments. User-specific grant/deny schema and commands are tested but do not yet have a management screen.

## Integration-dependent items

- Toast, reservation, accounting, payroll, OCR/email, vendor ordering, weather, local events, push, and email delivery.
- These will remain provider-neutral and visibly disabled until credentials, source samples, scopes, and owner approval exist.

## Remaining risks

- Capability checks must not accidentally broaden generic helpers such as `can_manage_location`, because those helpers protect unrelated cash, payroll, guest, and security workflows.
- Organization-wide catalogs need a location-derived capability context so a user cannot reuse a capability outside an assigned location.
- The source fixture still contains legacy multi-location synthetic records for broad test coverage; single-room demo workspaces filter those records, but future reports must preserve that filter consistently.
- Native pgTAP RLS tests need Docker/local Supabase. Portable PGlite checks do not fully emulate Auth, Storage, or Supabase Realtime.
- Live connected E2E and native pgTAP RLS were not run because no local/live Supabase URL, credentials, or connected test identity was provided. No production project was contacted.
- Capability assignment is an administrative security function. Whether Admins should be able to grant every operational capability, or whether selected grants should be Owner-only, needs Owner policy review before production rollout.

## Verification record

Passed on 2026-08-08:

- `npm run verify`: lint, generated database contract, typecheck, 415 unit tests, every PGlite integration verifier, and production build
- `npm run test:integration`: base migrations plus owner bootstrap, People configuration, inventory catalog, capability, Operations configuration, and financial configuration verifiers
- `npm run test:db:pglite`: all 26 forward migrations, synthetic seed, security/workflow checks, and 116/116 forced-RLS table catalog
- `npm run test:capabilities:pglite`: capability grants/denials, tenant/location isolation, Manager self-escalation refusal, Chef catalog workflow, exact replay, audit, and direct-DML denial
- `npm run test:e2e`: 46/46 desktop and 390px-mobile browser tests
- `npm run test:a11y`: 20/20 focused accessibility tests
- `npm audit --audit-level=high`: zero vulnerabilities after updating the transitive `nanoid` patch release in the lockfile

Not run:

- `npm run test:rls`, `npm run test:db:lint`, and `npm run test:e2e:connected`: these require a configured local or isolated connected Supabase test environment and authenticated test identities. Running them against an unrelated or production project would violate this mission's safety boundary.
- `npm run verify:connected`: intentionally not run for the same reason.

## Exact next actions

1. Replace the remaining inventory management-role checks with capability-specific command checks through forward-only RPC migrations and add PGlite/RLS coverage for each approval boundary.
2. Add user grant/deny management UI with explicit reason, dates, location scope, and visible effective-source explanation.
3. Add storage areas, item placement, pack/order assumptions, and an explainable suggested-order vertical slice.
4. Add receiving exception evidence and an invoice-line matching pipeline before expanding prep and realtime 86 workflows.
5. Expand role-specific Today screens using source freshness, evidence coverage, and severity once the corresponding operational records exist.
