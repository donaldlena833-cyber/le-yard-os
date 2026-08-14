# Le Yard OS Version 0.2 Implementation Status

Branch: `codex/le-yard-os-v0-2-operational-authoring`
Started: 2026-08-08

## Findings

- The dedicated branch started at `194dedb`, the same commit as the fetched `origin/main` on 2026-08-08.
- The branch contained in-progress capability authorization, inventory/catalog UI, documentation, and test changes. Those changes were preserved and audited.
- The connected Time Clock data layer, workflows, realtime component, and RLS-backed database commands still existed; only the route had been replaced by an incorrect redirect to `/vendors`.
- Before hardening, later migrations inherited PostgreSQL's default function execution grant to `PUBLIC`. Trigger functions and policy-support helpers therefore needed an explicit grant audit rather than relying on the Supabase advisor warning alone.

## Decisions

- Do not edit existing migrations. All database changes must be forward-only.
- Preserve existing Supabase/PostgREST behavior while tightening function execution grants.
- Use capability-based authorization layered over existing roles instead of one-off Manager/Chef exceptions.
- Keep connected mode free of synthetic operational records.
- Keep connected restaurant operating tables empty until an Owner explicitly supplies real records. On 2026-08-08, the Owner supplied and approved the photographed opening menu; only the required ingredient catalog, categories, measured recipes, menu prices, and immutable recipe versions were added. Vendors, packs, pars, price history, stock, and purchasing remain empty.
- Normalize both supported PostgREST representations of the single-column effective-capability RPC at the authenticated session boundary. This prevents valid persisted grants from being lost because of a generated-type/runtime-shape mismatch.
- Do not geofence authentication. Authorized users may sign in from any physical location. Browser geolocation is disabled by response policy; database location membership remains a tenant record-access scope and never represents device position.
- Treat the authenticated user's optional profile as display data, not authorization evidence. A transient profile read error falls back to signed Auth claims while membership, organization, location, and capability checks continue to fail closed.
- Keep Geist as the single application typeface and improve legibility through a deliberate operational scale rather than introducing another font. Mobile metadata now has a 12px floor, controls use 44px-or-larger touch targets, and iOS form controls remain at 16px to avoid input zoom.
- Treat long mobile operational workflows as viewport-bound tasks. Inventory-count dialogs now portal to the document body, own a single vertical scroll region, and keep their header and safe-area action bar reachable above shell navigation.

## Migrations

- `20260809032415_fix_recipe_save_authorization_and_variable_scope.sql`: repairs the Manager/Chef recipe RPC's ambiguous organization variable and enforces `recipe.manage` inside the database command boundary.
- `20260808194246_role_capability_templates_and_route_access.sql`: backfills safe operational capability defaults for recognized Chef/management job roles and applies the same templates to newly created recognized roles without creating restaurant operating data.

- `20260808135755_capability_authorization_foundation.sql`: persisted capability catalog, job-role grants, user overrides, location/effective-date scope, audit-backed administration, effective-capability loading, and Chef catalog command foundation.
- `20260808170406_public_function_grant_hardening.sql`: deny-by-default public-schema function execution, explicit authenticated RPC manifest, service-only isolation, and future default-privilege hardening.
- `20260808170937_v0_2_kitchen_authoring_capabilities.sql`: precise item/category/unit capabilities plus the location-scoped `configure_kitchen_foundation` command and legacy item-capability bridge.
- `20260808171523_service_control_foundation.sql`: append-only availability events, versioned Manager Log, structured immutable published pre-shifts, acknowledgements, forced RLS, audit, and four actor-derived commands.

## Files Changed

Initial tracked status document created:

- `docs/version-0.2-implementation-status.md`
- `scripts/verify-function-grants-pglite.mjs`
- `supabase/migrations/20260808170406_public_function_grant_hardening.sql`
- `src/app/(workspace)/time-clock/page.tsx`
- `.github/workflows/ci.yml`
- `src/app/(workspace)/service/page.tsx`
- `src/app/actions/workflows/service-control.ts`
- `src/components/permissions/action-permission.tsx`
- `src/components/service/live-service-control-workspace.tsx`
- `src/data/read-models/service-control.ts`
- `src/data/service-control-schemas.ts`
- `src/data/workflows/service-control.ts`
- `scripts/verify-capabilities-pglite.mjs`
- `scripts/verify-service-control-pglite.mjs`
- `tests/unit/permissions/action-permission.test.tsx`
- `scripts/data/le-yard-opening-menu-v1.mjs`
- `scripts/import-le-yard-opening-menu.mjs`
- `tests/unit/data/le-yard-opening-menu.test.ts`
- `supabase/migrations/20260809032415_fix_recipe_save_authorization_and_variable_scope.sql`
- `src/app/globals.css`
- `src/components/shell/app-shell.tsx`
- `src/components/ui/page-frame.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/status-pill.tsx`
- `src/components/ui/surface.tsx`
- `src/components/inventory/inventory-modal-frame.tsx`
- `src/components/inventory/live-inventory-workspace.tsx`
- `src/components/inventory/inventory-workspace.tsx`
- `src/components/today/live-today-workspace.tsx`
- `src/components/today/today-workspace.tsx`
- `src/components/kitchen/kitchen-workspace.tsx`
- `src/lib/accessibility/use-modal-dialog.ts`
- `tests/unit/data/live-inventory-interactions.test.tsx`
- `tests/unit/ui/primitives.test.tsx`

## Tests

- Added deterministic PGlite function-grant verifier covering anonymous denial, browser RPC allowlisting, service/trigger isolation, SECURITY DEFINER `search_path`, and future-default intent.
- Added the verifier to `npm run test:integration` as `npm run test:function-grants:pglite`.
- Extended capability verification for precise Chef unit/category/item grants, exact replay, cross-location denial, audit evidence, and direct-DML denial.
- Added `test:service-control:pglite` for 86 events, handoff versions, pre-shift publish/acknowledge, changed replay rejection, location scope, employee denial, audit, and immutable history.
- Added unit coverage for capability navigation, empty-catalog Chef actions, and all reusable permission-action states.
- Added demo Playwright checks proving Time Clock no longer redirects and Service Control is reachable.
- Added non-secret GitHub Actions jobs for lint, generated types, TypeScript, unit, integration, build, and desktop Chromium demo E2E.
- Added role-prioritized mobile navigation and direct-route permission coverage for Executive Chef and Employee sessions.
- Added focused capability-response normalization tests for both generated string arrays and PostgREST row objects, including malformed/unknown-value rejection.
- Added a deterministic 20-recipe opening-menu specification test covering unique dish names, exact gram portions, valid waste factors, declared ingredients, prices, and the absence of vendor/pack/par/stock assignments.
- Extended the PGlite capability verifier to prove Chef recipe creation, exact replay, immutable version creation, and database-level `recipe.manage` denial.
- `npm run verify` passed after the opening-menu import: 76 unit-test files / 425 tests, all portable migration and security verifiers, generated database types, lint, typecheck, and the production build.
- Added focused UI primitive coverage for the shared page header, surfaces, buttons, and status pills.
- Added an inventory-count mobile regression that verifies the body portal, task layout, single scroll owner, responsive rows, absence of input autofocus, safe-area actions, initial close focus, and opener focus return.

## Completed Requirements

- Dedicated feature branch created.
- Tracked Version 0.2 implementation status document created.
- Public-schema function execution is deny-by-default for `PUBLIC`, `anon`, and `authenticated`, followed by explicit grants to approved browser RPCs and policy-support helpers.
- Service-only and trigger-only functions are not browser executable.
- The connected and demo Time Clock route is restored; `/time-clock` no longer redirects to Vendors.
- Persisted capability definitions now include the requested item, category, and unit split while preserving the legacy catalog key for backward compatibility.
- A non-Admin Executive Chef with effective location grants can author units, categories, items, vendors, packs/prices, pars, recipes, POs, receiving, counts, and waste through existing/new commands; security/user administration remains role-bound.
- Connected Kitchen setup shows real empty states and visible next actions. Recipe creation remains visible without inventory items; new recipes default to an incomplete draft and visibly report incomplete costing.
- Reusable permission-aware action states support allowed, missing capability, missing location, MFA required, missing prerequisite, workflow unavailable, and read-only explanations.
- Time Clock is restored in primary navigation for employees and management.
- Service Control is persisted and realtime: authorized staff can record running-low/86/restored events, managers can add versioned handoffs and publish pre-shifts, and employees can acknowledge published pre-shifts.
- Today shows current availability and published pre-shift context without inventing reservation figures.
- The connected Le Yard Kitchen now contains 20 active menu recipes, 142 exact-weight ingredient lines, 79 ingredient items in eight categories, and 20 immutable recipe versions. Every import write is attributed to Mateo's authenticated Chef account. No vendor, vendor pack, vendor price, par, stock transaction, or purchase record was created.
- The application shell now has consistent mobile navigation controls, safe-area-aware drawers, deduplicated workspace context, stronger active states, and portaled/focus-managed command and navigation overlays.
- The P0 inventory-count overlap is fixed: route animation no longer leaves a transformed containing block, the count is responsive without horizontal scrolling or autofocus jumps, and the submission controls remain above the phone home indicator and shell navigation.
- Today, Kitchen, and Inventory now use the same editorial warm-ivory surface hierarchy, clearer page headers, larger operational numbers, calm raised metric cards, and shared interaction primitives. The typography floor was raised across the remaining workspaces for consistent legibility.

## Incomplete Requirements

- Storage-area authoring and menu mappings are not yet implemented, so the requested ten-step Kitchen Setup is only partially complete.
- Vendor operational terms beyond the existing contact/account/payment fields (delivery days, cutoff, lead time, minimum order, notes) are not yet authorable.
- Recipe category/station/portion/instructions/notes and inline item creation are not yet persisted; the current immutable recipe versions cover yield, ingredients, waste factor, price, and draft/active state.
- Manager Log attachment upload and related-record pickers are schema-ready only at the command boundary; the initial UI captures the core handoff.
- Pre-shift station assignments, previous-handoff picker, and comment questions need follow-up UI.
- Session lifecycle has existing coverage for credential separation, MFA gating, logout cookie cleanup, signed-session expiry/tampering, second-user credential resolution, and invalid cookie cleanup; a live Supabase stale-refresh-token acceptance test still requires an approved nonproduction Auth environment.
- Native Supabase RLS/database lint was not run locally because Docker is unavailable. The authorized Le Yard polishing project migration was applied only after portable verification, and connected browser acceptance was performed against the deployed application.

## Blockers

- External provider acceptance remains blocked until Toast/reservation/payroll or other provider credentials are configured. No provider behavior is simulated in connected mode.

## Exact Verification Results

### 2026-08-09 Owner MFA and manual costing follow-up

- Added forward migration `20260809142645_password_only_owners_and_direct_inventory_costs.sql`.
- Owner authorization now accepts authenticated AAL1 password sessions while preserving organization, location, role, capability, RLS, idempotency, audit, and final-owner protections. Existing MFA factors remain optional and are not deleted.
- Added `record_inventory_item_cost(...)`: a vendor-neutral, effective-dated, append-only cost command scoped by `inventory.price.manage`, active location access, and exact request replay.
- Added Kitchen Setup authoring for cost per compatible unit and opening stock. Opening stock reuses the full-count workflow and requires independent approval before changing the ledger.
- Updated the visual tokens to a lighter off-white canvas with quieter borders, flatter shadows, and reduced paper texture.
- `npm run types:database` — PASS: 121 tables, 3 views, 201 functions, and 16 enums.
- `npm run test:capabilities:pglite` — PASS: direct-cost create/replay, changed replay rejection, cross-location denial, audit evidence, Chef capability, and Owner authorization. Connected Owner/Admin MFA is implemented as an opt-in deployment gate.
- `npm run test:function-grants:pglite` — PASS: 201 public functions with deny-by-default execution and explicit client/service boundaries.
- `npm run verify` — PASS: lint, generated database contract check, TypeScript, 431/431 unit tests across 77 files, all nine portable integration/security verifiers, and the optimized Next.js production build.
- `npm run test:e2e` — 49/50 passed in one desktop/mobile run; one mobile `/guests` request hit a transient Next development-server JSON parse 500. The exact failed accessibility test was rerun immediately and passed 1/1 with no code change.
- Connected Le Yard Supabase migration — PASS: `password_only_owners_and_direct_inventory_costs` applied to project `qcmwqnonxabdsntfsuzy` after the full portable verifier passed. No other Supabase project was modified.
- Removed passive Chef access-boundary banners and similar role narration from Kitchen, Chef Today, Vendors, and the authorized Inventory Setup state. Permission enforcement and actionable read-only feedback remain intact.

### 2026-08-09 direct recipe authoring and modal polish

- The connected Recipes tab now exposes `New recipe` and a per-recipe `Edit` action to Owner/Admin and users with `recipe.manage`; recipe authors no longer need to enter Setup to edit a recipe.
- The shared immutable recipe command now powers both Setup and the Recipes tab. The editor covers recipe name, yield, yield unit, menu price, draft/published state, ingredient selection, quantities, units, waste factors, add, and remove.
- Recipe costing is presented as responsive cards with visible cost coverage. A direct `Costs & stock` action opens the existing manual unit-cost and opening-stock setup surface.
- Catalog edit dialogs now keep Cancel/Save controls visible in a safe-area-aware sticky footer. The recipe editor uses responsive ingredient cards with no desktop minimum width or horizontal scrolling.
- Added a focused interaction test proving an authorized Chef can open an existing recipe from Recipes, change its menu price and ingredient quantity, and submit the actor-derived `recipe.save` command.
- Focused verification: 15/15 inventory UI/interaction tests passed; TypeScript, focused ESLint, and whitespace verification passed.
- Final `npm run verify` — PASS: lint, generated database contract check, TypeScript, 432/432 unit tests across 77 files, all nine portable integration/security verifiers, and the optimized Next.js production build. An unrelated message-channel timing test missed its first full-suite wait, passed immediately in isolation, and passed again in the clean full verification run.
- Local in-app browser inspection was unavailable because the browser security policy blocks agent access to `localhost`; no alternate browser or policy workaround was used. The existing local dev preview remained available to the Owner.

- `npm run lint` — PASS.
- `npm run typecheck` — PASS after service-control/type generation.
- Focused capability-response normalization tests — PASS: 3/3.
- `npm run types:database` — PASS: generated 121 tables, 3 views, 198 functions, and 16 enums.
- `npm run test:function-grants:pglite` — PASS: 198 public functions verified.
- `npm run test:capabilities:pglite` — PASS: grants/denials, tenant/location isolation, Chef catalog/foundation workflow, replay, audit, and direct-DML revocation.
- `npm run test:inventory-catalog:pglite` — PASS.
- `npm run test:service-control:pglite` — PASS.
- Opening-menu specification tests — PASS: 3/3 menu structure, exact-weight ingredient, waste-factor, and no-vendor-assignment assertions.
- Focused Vitest (`capability-navigation`, `live-inventory-ui`) — PASS: 6 tests.
- `npm run verify` — PASS: lint, generated type check, TypeScript, 425/425 unit tests, all portable integration verifiers, and production build.
- Connected database verification — PASS: 8 categories, 79 inventory items, 20 recipes, 142 recipe ingredient lines, and 20 immutable recipe versions; vendor, vendor-item, price-history, par, and inventory-transaction counts remain zero.
- Connected function-grant verification — PASS: `save_manager_recipe` has a fixed empty `search_path`, denies `PUBLIC`/`anon`, permits `authenticated`, and enforces `recipe.manage` in the function body. Supabase's corresponding `SECURITY DEFINER` warning is intentional for this actor-derived browser RPC; the advisor remediation reference is https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable.
- `TZ=UTC npm run test:integration` — PASS after deriving synthetic closeout business dates in the seeded New York location timezone; this removes the UTC-midnight CI boundary without changing production logic.
- Inventory modal focus/animation regression — PASS: 8 consecutive runs / 80 assertions after waiting for animated dialog cleanup before checking restored focus or reopening.
- `npm run test:e2e` — PASS: 50/50 desktop/mobile Chromium tests, including the 20-route axe matrix, Time Clock restoration, and Service Control.
- `npm install --package-lock-only --ignore-scripts` — PASS; npm reported 0 vulnerabilities (Node 25 emitted the expected engine warning because the project supports Node 22/24).
- UI-polish browser review — PASS in the in-app browser: Today, Kitchen, Inventory, shell navigation, and the command palette were visually inspected; the desktop inventory document had no horizontal overflow and the command palette opened, focused, closed with Escape, and returned control correctly.
- Focused UI tests — PASS: 4/4 shared primitive tests and 12/12 live-inventory interaction tests.
- `npm run verify` after the UI/UX polish — PASS: lint, 121-table generated database contract check, TypeScript, 430/430 unit tests across 77 files, all nine portable integration/security verifiers, and the optimized Next.js production build.

### 2026-08-13 reservations, remembered sessions, and Toast Labor

- Walk-in creation now excludes physically unavailable tables from immediate suggestions and retries a raced PostgreSQL exclusion conflict without the stale table assignment. Scheduled/phone reservations retain strict conflict behavior.
- Connected document traffic is canonicalized to `NEXT_PUBLIC_APP_URL` before Supabase Auth runs, keeping the selected 8-hour or 30-day session in one host-only cookie jar across deployment aliases.
- Added forward migration `20260813144236_toast_labor_time_entry_sync.sql` with provider identities, deletion markers, a location-safe sync-health read, and a service-role-only replay-safe Toast time-entry/break ingestion command.
- Added a protected Toast Labor worker, read-only connected/demo Time Clock surfaces, fail-closed employee/job mappings, provider freshness, and durable row outcomes. Production activation still requires approved credentials and a scheduler calling the canonical origin.
- Verification: generated contract PASS (139 tables, 3 views, 262 functions, 16 enums); portable migration/Toast replay checks PASS; TypeScript PASS; unit suite PASS (756 tests across 134 files); production build PASS.
