# Release verification — 2026-08-24

This checkpoint establishes the reviewed, fail-closed baseline for Le Yard OS before any public-booking approval or production promotion.

## Release authority

- The database owns the public release decision through a versioned location release record.
- The earliest accepted public reservation date is December 1, 2026.
- Pilot inventory is capped at 25%.
- `booking_approved` and `support_ready` both default to false and require an AAL2 owner/admin management action.
- `RESERVATION_PUBLIC_BOOKING_ENABLED=false` is an emergency negative gate. It cannot open booking by itself.
- Public slot tokens are bound to the current release ID and business date.
- The public release endpoint exposes only the authenticated seven-field contract consumed by the Le Yard public site.

## Opening Room authority

- The v1 production workspace is preserved as immutable revision 1.
- The audited v1-to-v2 migration creates revision 2 and a matching audit event.
- Only the two confirmed planned-value-only `Unallocated` legacy mismatches are eligible for normalization; nonzero committed or paid mismatches abort the migration.
- Direct authenticated table updates are revoked. Saves use an AAL2 owner/admin optimistic-concurrency RPC with immutable revision history and explicit conflict results.

## Independent local evidence

Verified with Node.js 22.22.0 on August 24, 2026:

- `npm run verify:full` — exit 0.
- ESLint — passed.
- Generated database contract — 146 tables, 3 views, 295 functions, and 16 enums verified.
- Vitest — 146 files, 795 tests passed.
- PGlite migration and integration suites — all 83 migrations passed, including release authority, AAL2 enforcement, Opening Room migration/refusal cases, RLS, and function grants.
- Next.js production build — passed; 39 routes generated.
- Playwright — 66 desktop/mobile Chromium journeys passed, including accessibility, CSP, reservations, service controls, schedule, records, team, reports, and security flows.
- Dependency audit — 0 vulnerabilities.
- `git diff --check` — passed.

Expected build warnings were limited to intentionally missing local runtime environment variables; the affected paths failed closed and the build exited successfully.

## Production hold

At this checkpoint no release record is approved and public booking remains disabled at the emergency environment gate. Applying the migration must not be followed by enabling booking, sending provider messages, or promoting the public reservation surface until the remaining connected/provider/staff/accessibility release gates have passed.
