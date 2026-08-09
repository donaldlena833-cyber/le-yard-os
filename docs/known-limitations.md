# Known limitations

This document is intentionally candid. It prevents a polished local workspace from being mistaken for an authorized production system.

## Production blockers

- Donald's and Maris's real emails have not been supplied, so production Owner accounts are not bootstrapped.
- The owner supplied `858 9th Ave, New York, NY 10019`; remaining restaurant/location identity, brand assets, job codes, and final operational rules have not been approved.
- No production Supabase project is connected and no live back-office deployment is authorized. The owners authorized a separate public Vercel Production playground with synthetic data and custom login only; that authorization excludes the existing public restaurant website and does not authorize operational production data.
- The connected Supabase account is already at its two-active-project free limit. No unrelated existing project was modified, paused, or reused, so an isolated Le Yard OS project remains unavailable until capacity or an approved plan is provided.
- SMTP, push, error-monitoring destination, and backup/PITR settings are not configured.
- Toast and Resy credentials/access are not supplied; their live adapters remain disabled.
- Live model calls are intentionally outside this release at the owner's direction. No AI provider key is requested or configured, and no restaurant data is sent to a model provider.

## Data and persistence

- Workspace pages run on a rich synthetic demo store only when `NEXT_PUBLIC_DEMO_MODE=true`. Client-side playground changes reset, are not shared between the two owners, and must not be treated as saved restaurant records.
- The physical address is owner-supplied. Staff, job codes, schedules, messages, receipts, inventory, guests, closeouts, tips, payroll-support outputs, and reports around it remain synthetic mock content.
- The Vercel Production playground gate uses two temporary custom Owner principals with server-only salted scrypt password hashes and an eight-hour signed secure cookie. They are not Supabase Auth or live-production accounts and do not have production MFA.
- The Vercel Production URL is publicly reachable and should be treated as discoverable, although workspace content remains behind the application-level two-Owner login. Robots directives and an unadvertised URL are not authentication controls.
- Playground login throttling is best-effort and per compute instance, not a durable account-wide control. The app remains for the two owners only; enable Vercel Deployment Protection or a shared durable limiter before inviting broader testers.
- Plaintext playground passwords are not valid configuration. They must not be placed in source, environment variables, Vercel logs, shell history, support tickets, or chat; only salted scrypt hashes belong in the server-only hosted-playground registry.
- `LE_YARD_PLAYGROUND_MODE=production-playground` is valid only when Vercel itself supplies `VERCEL_ENV=production`. It does not convert the app into connected mode, and a mode/target mismatch must fail closed.
- Connected mode never falls back to synthetic operational records. Today, Team, Schedule, Messages, Time Clock, Closeout/Tips, Receipts, Inventory, Guests, Operations, Reports, Integrations, Ask Le Yard, notifications, and Settings now have tenant-scoped connected read surfaces; guarded write controls are enabled only where their atomic database workflow is installed.
- The production schema, RLS, Storage policies, server authentication paths, and workflow data/action layer are separate from the demo presentation. Connected behavior still requires acceptance against an approved nonproduction Supabase project before launch.
- Connected CSV/PDF report exports use the current authenticated report read model and create export audit evidence. They refuse truncated reports and never fall back to demo records. A raw all-guest/whole-tenant export remains intentionally locked pending an approved destination and retention rule.
- The receipt upload surface simulates extraction in demo mode. Connected mode stores and reviews existing extraction evidence but does not send images to a live OCR/model provider.
- Connected employee documents accept PDF, JPEG, PNG, and WebP files up to 25 MB, verify size and file signatures before binding metadata, and use private signed downloads. File replacement/deletion, malware scanning, and automatic cleanup of abandoned staged uploads are not yet enabled.
- Connected Team setup lets password-authenticated Owners and Admins define job roles and create, revise, or end verified employee/location assignments. Private hourly rates are write-only in this release and are never shown back in the Team read model; approved job codes, tip points, rates, and effective dates must still be supplied by the owners.
- Connected Inventory setup lets password-authenticated Owners/Admins and location-capable kitchen job roles define units, categories, vendors, items, direct per-unit costs, vendor prices, pars, opening counts, and versioned recipes. Unit conversions remain Owner/Admin-only. No catalog, par, price, stock, or recipe value is inferred from demo data.
- Version 0.2 does not yet persist storage areas, menu mappings, extended vendor delivery terms, or the full recipe metadata/editor requested for the final ten-step bootstrap. Manager Log related-record pickers/attachments and pre-shift station-assignment editing also remain follow-up work.
- Internal 86/running-low updates do not write to Toast. Service Control labels this boundary; Toast synchronization remains disabled until provider capability and owner authorization are proven.
- Connected Closeout and Settings surfaces let password-authenticated Owners and Admins author tip policies and retention decisions. Tip drafts need approval by a different authorized person, and retention remains unset until an owner selects a timed window or explicit no-auto-delete policy.
- The connected CSV integration surface validates, fingerprints, stores, and queues source files without simulating completion. A source-specific worker that stages and applies rows remains intentionally disabled until approved Toast/Resy/export samples and mapping rules are supplied; demo counts remain synthetic.
- Connected chat, schedule, time, inventory, operations, guest, and notification surfaces subscribe to Supabase Realtime where applicable; reconnect and delivery behavior still requires production-like Supabase acceptance testing.
- Users can save in-app notification preferences and encrypted browser push-subscription metadata. Push delivery is not active without VAPID keys and an approved delivery process, so the interface does not claim that browser or email delivery is enabled.
- The invitation action safely provisions new Supabase Auth invitees and can reissue expired or revoked invitations for the same pending identity. Adding an already-registered Auth user to a second organization still requires a dedicated service-only identity-resolution/provisioning path plus an existing-account acceptance email; no browser path is allowed to enumerate accounts or overwrite that user's password. The migration and server branch are locally implementable, but delivery and end-to-end acceptance cannot be certified without production-like SMTP and Auth redirect configuration.

## Policies and compliance

- The playground shows unpublished owner assumptions for evaluation: shifts longer than six hours have a 30-minute unpaid break; an overtime display uses a 1.5 multiplier subject to applicable law; customer tips are voluntary with no automatic gratuity; and an event fee is displayed as 10% and kept separate from tips. These values are not a complete or approved policy. Break timing, workweek definition, employee eligibility/exemptions, regular-rate inputs, fee tax/accounting treatment, tip-distribution eligibility, and approval workflows still require professional and owner review.
- Warnings, calculations, and mock schedules do not determine or certify labor-law, wage, tax, gratuity, payroll, or scheduling compliance. In particular, the interface must not treat a break before or after a shift as a legally compliant meal period without review of the applicable timing rules.
- Le Yard OS is payroll support, not a payroll processor. It does not file taxes, transmit payroll, move money, or originate bank transactions.
- Payroll export format, receiving provider, pay-period mapping, and approval sequence are undecided; any displayed export is illustrative.
- Retention means how long receipts, employee documents, guest data, audit history, exports, and backups are kept before archival or deletion. It is currently unset, so Le Yard OS performs no policy-driven automatic deletion. That does not configure or guarantee third-party backup retention and is not a final legal-retention decision.
- Guest consent fields store provenance but do not establish the restaurant's legal marketing policy.
- Backups and restore evidence are modeled, but a database row does not configure platform backups. Owners must select and verify the active Supabase backup plan/process.

## Integrations and AI

- Toast access can be product/account dependent and may be read-only. The application cannot assume write access.
- Resy synchronization depends on an approved integration arrangement; there is no assumed unrestricted public API.
- In demo mode, Ask Le Yard uses deterministic synthetic evidence. In connected mode, management queries route deterministically to authenticated, RLS-filtered report evidence for the active location and return no answer without source citations. This release does not call a live language model.
- No OpenAI key, external AI provider, or live OCR provider is configured or required for the Vercel Production playground.
- AI proposals cannot automatically finalize payroll, tips, punch edits, inventory adjustments, or guest changes.
- Forecast quality remains limited until approved sales, reservation, schedule, time, and inventory sources are fresh and complete.

## Verification environment

- The portable migration/catalog check runs without Docker. Native pgTAP role-behavior tests, Supabase database lint, Auth, Storage, and Realtime acceptance still require Docker or a connected nonproduction Supabase project.
- This shared parent workspace contains multiple lockfiles. The project pins Next.js output tracing to its own directory and uses the verified webpack dev/build commands; a standalone installation can reevaluate Turbopack.
- Browser tests exercise synthetic demo mode. A guarded connected desktop/mobile matrix now covers authenticated core routes and blocks unexpected writes by default, with a separately confirmed nonproduction chat probe. It cannot run against Supabase until an isolated nonproduction project is available; the invitation email flow also remains unverified because SMTP and Auth redirect configuration are absent.
- The client-error endpoint uses a bounded in-memory per-instance rate limit. It prevents local floods but is not a globally coordinated quota across serverless instances; production monitoring should add a durable or platform-level limiter if abuse is observed.
- `/api/health` verifies configuration readiness without disclosing dependency flags. It does not replace active Supabase availability monitoring or connected smoke tests.

## Required final acceptance

The public Vercel Production playground is suitable only for product familiarization and feedback; it does not satisfy connected or live-production acceptance. Before launching the real back office, rerun all unit, RLS, desktop/mobile browser, accessibility, signed-storage, auth/MFA, realtime, backup-restore, and integration tests against an isolated production-like Supabase preview. Resolve every item in the owner runbook's launch gate and obtain separate explicit live-production approval.
