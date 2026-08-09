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
- `npm run test:e2e` — PASS: 50/50 desktop/mobile Chromium tests, including the 20-route axe matrix, Time Clock restoration, and Service Control.
- `npm install --package-lock-only --ignore-scripts` — PASS; npm reported 0 vulnerabilities (Node 25 emitted the expected engine warning because the project supports Node 22/24).
