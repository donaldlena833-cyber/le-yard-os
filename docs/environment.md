# Environment configuration

Copy `.env.example` to `.env.local` for local work. Vercel environment variables should be configured separately for Development, Preview, and Production; do not copy production secrets into a local or preview environment.

There are no implicit runtime-mode or application-origin defaults. Missing or invalid required values make the deployment not ready: `/api/health` returns `503`, and the proxy fails closed for every other route. Unit tests load the committed synthetic-only `.env.test`; browser tests pass their demo values explicitly. Production rejects an open demo. The owner-approved Vercel Production playground is accepted only when its complete two-Owner gate is present, `LE_YARD_PLAYGROUND_MODE` equals `production-playground`, and Vercel itself supplies `VERCEL_ENV=production`.

## Variable matrix

| Variable                                    | Exposure              | Required                         | Purpose                                                                                                                                                              |
| ------------------------------------------- | --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                       | Browser-safe          | Yes                              | Canonical application origin, authentication callback base, and session-cookie origin; connected document requests on deployment aliases redirect here              |
| `NEXT_PUBLIC_DEMO_MODE`                     | Browser-safe          | Yes                              | Explicit `true` uses synthetic data locally or inside a guarded hosted playground; a connected live deployment must use `false`                                      |
| `LE_YARD_PLAYGROUND_MODE`                   | Server-only           | Hosted playground                | Must be `preview` only with `VERCEL_ENV=preview`, or `production-playground` only with `VERCEL_ENV=production`                                                       |
| `LE_YARD_PLAYGROUND_SESSION_SECRET`         | Server-only secret    | Hosted playground                | High-entropy signing secret for the 8-hour default / optional 30-day playground session; scope it only to the intended target                                        |
| `LE_YARD_PLAYGROUND_USERS_JSON`             | Server-only secret    | Hosted playground                | Exactly four required principals containing identifiers and salted scrypt password hashes; never plaintext passwords                                                 |
| `LE_YARD_PLAYGROUND_DONALD_PASSWORD_HASH`   | Server-only secret    | Optional hosted-playground alias | Legacy local playground alias only; never use it for production-owner identity or store the plaintext password                                                      |
| `NEXT_PUBLIC_SUPABASE_URL`                  | Browser-safe          | Connected mode                   | Supabase project URL                                                                                                                                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`      | Browser-safe          | Connected mode                   | Supabase publishable/anon credential; all access remains subject to RLS                                                                                              |
| `SUPABASE_SECRET_KEY`                       | Server-only           | Connected mode                   | Supabase secret/service credential for invitation and tightly scoped system operations                                                                               |
| `CONNECTED_ACCEPTANCE_ATTESTATION_ENABLED`  | Server-only config    | Isolated Vercel Preview          | Exact `true` exposes the otherwise inert internal attestation path; the route also requires Vercel's own `VERCEL_ENV=preview`                                         |
| `CONNECTED_ACCEPTANCE_ATTESTATION_SECRET`   | Server-only secret    | Isolated Vercel Preview          | Dedicated 43–128 character base64url secret used for constant-time request authentication and nonce-bound response signing; never reuse a Supabase or user credential |
| `CONNECTED_ACCEPTANCE_TARGET_ID`            | Server-only opaque ID | Isolated Vercel Preview          | Random UUID matching the one short-lived private marker in the isolated Supabase project                                                                              |
| `CONNECTED_ACCEPTANCE_SCHEMA_VERSION`       | Server-only config    | Isolated Vercel Preview          | Exact 14-digit latest applied Supabase migration version, also stored in the marker                                                                                    |
| `CONNECTED_ACCEPTANCE_FIXTURE_ID`            | Server-only opaque ID | Isolated Vercel Preview          | Random UUID identifying the reviewed synthetic Auth/RLS fixture                                                                                                       |
| `CONNECTED_ACCEPTANCE_FIXTURE_REVISION`      | Server-only config    | Isolated Vercel Preview          | Exact reviewed fixture revision, 1–80 letters/numbers/dots/dashes/underscores                                                                                          |
| `BOOKING_SLOT_SIGNING_SECRET`               | Server-only           | Public reservations              | Dedicated high-entropy secret for short-lived signed availability slots                                                                                              |
| `RESERVATION_LINK_SIGNING_SECRET`           | Server-only           | Guest verification               | Independent high-entropy secret for channel-bound verification links, management exchanges, and derived management sessions                                          |
| `RESERVATION_PUBLIC_BOOKING_ENABLED`        | Server-only config    | New public inventory             | Independent hard gate; only exact `true` permits new availability or holds. Defaults false and does not disable existing guest recovery                              |
| `BOOKING_GLOBAL_RATE_LIMIT_MULTIPLIER`      | Server-only config    | Public reservations              | Valid integer 2–20; defaults to twice each route's per-identity ceiling; platform/WAF controls remain a separate launch gate                                         |
| `BOOKING_CONTACT_RATE_LIMIT_PER_HOUR`       | Server-only config    | Public reservations              | Valid integer 1–50; defaults to four create attempts per normalized contact fingerprint per hour                                                                     |
| `RESERVATION_PUBLIC_SITE_URL`               | Server-only           | Guest messaging                  | Canonical public Le Yard origin used in confirmation and management links                                                                                            |
| `RESEND_API_KEY`                            | Server-only           | Reservation email                | Resend credential for guest transactional email                                                                                                                      |
| `RESERVATION_EMAIL_FROM`                    | Server-only           | Reservation email                | Verified sender identity for reservation email                                                                                                                       |
| `RESERVATION_SMS_DELIVERY_ENABLED`          | Server-only config    | Reservation SMS                  | Hard kill switch; only the exact value `true` permits SMS discovery or delivery. Defaults to `false`; credentials alone are inert                                    |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`  | Server-only           | Reservation SMS                  | Twilio account credentials for guest transactional SMS                                                                                                               |
| `TWILIO_FROM_NUMBER`                        | Server-only           | Reservation SMS                  | Approved Twilio sender number                                                                                                                                        |
| `RESERVATION_DELIVERY_SECRET`               | Server-only           | Reservation delivery             | At least 32 characters; authorizes scheduled email/SMS/reminder and push workers                                                                                     |
| `RESERVATION_PUSH_DELIVERY_ENABLED`         | Server-only config    | Reservation push                 | Independent hard gate; only exact `true` permits provider calls. Defaults false; VAPID credentials and the Owner location switch are otherwise inert                 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`              | Browser-safe          | Push notifications               | Browser push subscription key                                                                                                                                        |
| `VAPID_PRIVATE_KEY`                         | Server-only           | Push notifications               | Signs push messages                                                                                                                                                  |
| `VAPID_SUBJECT`                             | Server-only           | Push notifications               | Contact URI, normally an approved operations email                                                                                                                   |
| `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`          | Server-only           | Push subscription storage        | Base64-encoded 32-byte AES key; generate independently from the VAPID signing key                                                                                    |
| `TOAST_CLIENT_ID`                           | Server-only           | Toast Labor sync                 | Approved Toast machine-client ID with `labor:read` and employee-read access                                                                                          |
| `TOAST_CLIENT_SECRET`                       | Server-only           | Toast Labor sync                 | Approved Toast machine-client secret; never expose it to the browser                                                                                                  |
| `TOAST_RESTAURANT_GUID`                     | Server-only           | Toast Labor sync                 | Toast restaurant GUID sent as `Toast-Restaurant-External-ID`                                                                                                         |
| `TOAST_LOCATION_ID`                         | Server-only mapping   | Toast Labor sync                 | Le Yard OS `locations.id` that receives this restaurant's labor facts                                                                                                 |
| `TOAST_LABOR_SYNC_SECRET`                   | Server-only worker    | Toast Labor sync                 | At least 32 characters; authorizes `POST /api/internal/integrations/toast-labor`                                                                                      |
| `TOAST_API_BASE_URL`                        | Server-only config    | Toast Labor sync                 | Optional; defaults to `https://ws-api.toasttab.com` and accepts only Toast production or sandbox API origins                                                         |
| `RESY_INTEGRATION_TOKEN`                    | Server-only           | Optional                         | Token supplied through an approved Resy integration arrangement                                                                                                      |
| `OWNER_1_EMAIL`                             | Server-only bootstrap | Production bootstrap             | First verified owner email; never seeded with a guessed address                                                                                                      |
| `OWNER_1_DISPLAY_NAME`                      | Server-only bootstrap | Production bootstrap             | First owner’s approved display name                                                                                                                                  |
| `OWNER_2_EMAIL`                             | Server-only bootstrap | Production bootstrap             | Second verified owner email; never seeded with a guessed address                                                                                                     |
| `OWNER_2_DISPLAY_NAME`                      | Server-only bootstrap | Production bootstrap             | Second owner’s approved display name                                                                                                                                 |
| `LE_YARD_BOOTSTRAP_CONFIRM`                 | Server-only, one run  | Production bootstrap execution   | Exact plan-bound confirmation emitted by the dry run; remove immediately afterward                                                                                   |
| `RESERVATION_TEST_DATABASE_URL`             | Test runner secret    | Reservation concurrency          | Explicit loopback PostgreSQL URL targeting the `postgres` control database; the suite creates and force-drops only its random test database and refuses remote/shared hosts |
| `SCHEDULE_TEST_DATABASE_URL`                | Test runner secret    | Schedule concurrency             | Explicit loopback PostgreSQL URL targeting the `postgres` control database; the suite creates and force-drops only its random test database and refuses remote/shared hosts |
| `E2E_CONNECTED_APP_URL`                     | Test runner only      | Connected acceptance             | Canonical preview origin exercised by the connected Playwright project                                                                                               |
| `E2E_CONNECTED_ENVIRONMENT`                 | Test runner only      | Connected acceptance             | Must equal `nonproduction_preview`; every other value fails before authentication                                                                                     |
| `E2E_CONNECTED_ATTESTATION_SECRET`          | Test runner secret    | Connected acceptance             | Matches only the isolated Preview's dedicated attestation secret                                                                                                     |
| `E2E_CONNECTED_TARGET_ID`                   | Test runner opaque ID | Connected acceptance             | Exact opaque database/project marker expected from the Preview                                                                                                       |
| `E2E_CONNECTED_EXPECTED_DEPLOYMENT_COMMIT`  | Test runner only      | Connected acceptance             | Exact 40-character lowercase Git SHA expected from Vercel's deployment metadata                                                                                       |
| `E2E_CONNECTED_EXPECTED_SCHEMA_VERSION`     | Test runner only      | Connected acceptance             | Exact 14-digit latest migration version; the RPC verifies it equals `max(supabase_migrations.schema_migrations.version)` and the marker                                |
| `E2E_CONNECTED_FIXTURE_ID`                  | Test runner opaque ID | Connected acceptance             | Exact reviewed synthetic fixture UUID                                                                                                                                |
| `E2E_CONNECTED_FIXTURE_REVISION`            | Test runner only      | Connected acceptance             | Exact reviewed fixture revision bound into the database lookup and signed proof                                                                                       |
| `E2E_CONNECTED_OWNER_EMAIL` / `PASSWORD`    | Test runner secret    | Connected acceptance             | Nonproduction Owner fixture; the suite proves password sign-in reaches the scoped workspace without an MFA gate                                                      |
| `E2E_CONNECTED_MANAGER_EMAIL` / `PASSWORD`  | Test runner secret    | Connected acceptance             | Nonproduction Manager fixture with explicit location membership                                                                                                      |
| `E2E_CONNECTED_HOST_EMAIL` / `PASSWORD`     | Test runner secret    | Connected acceptance             | Nonproduction Host fixture with exact target-location reservation grants                                                                                              |
| `E2E_CONNECTED_VIEW_ONLY_EMAIL` / `PASSWORD` | Test runner secret   | Connected acceptance             | Target-location fixture with only `reservations.view`                                                                                                                |
| `E2E_CONNECTED_OPERATE_ONLY_EMAIL` / `PASSWORD` | Test runner secret | Connected acceptance             | Target-location fixture with only `reservations.operate`                                                                                                             |
| `E2E_CONNECTED_DENIED_EMAIL` / `PASSWORD`   | Test runner secret    | Connected acceptance             | Active target-location fixture with no reservation grant                                                                                                             |
| `E2E_CONNECTED_EXPIRED_EMAIL` / `PASSWORD`  | Test runner secret    | Connected acceptance             | Target-location fixture whose reservation job assignment has ended                                                                                                   |
| `E2E_CONNECTED_CROSS_LOCATION_EMAIL` / `PASSWORD` | Test runner secret | Connected acceptance          | Target-location member whose reservation grant exists only at another synthetic location                                                                             |
| `E2E_CONNECTED_EXPECTED_ORGANIZATION_NAME`  | Test runner only      | Connected core matrix            | Exact synthetic tenant name; prevents accepting the wrong tenant                                                                                                     |
| `E2E_CONNECTED_EXPECTED_LOCATION_NAME`      | Test runner only      | Connected core matrix            | Exact synthetic location name; prevents accepting the wrong location                                                                                                 |
| `E2E_CONNECTED_ENABLE_MUTATIONS`            | Test runner only      | Optional chat probe              | Must equal `true`; read-only route coverage does not set it                                                                                                          |
| `E2E_CONNECTED_EMPLOYEE_EMAIL` / `PASSWORD` | Test runner secret    | Optional chat probe              | Dedicated Employee fixture required only when the isolated chat mutation probe is enabled                                                                            |
| `E2E_CONNECTED_MUTATION_HOST`               | Test runner only      | Optional chat probe              | Must exactly match the hostname in `E2E_CONNECTED_APP_URL`                                                                                                           |
| `E2E_CONNECTED_RUN_ID`                      | Test runner only      | Optional chat probe              | Unique 1–80 character marker attached to the synthetic write                                                                                                         |
| `E2E_CONNECTED_CHAT_CHANNEL_NAME`           | Test runner only      | Optional chat probe              | Dedicated Employee-visible nonproduction channel used by the write probe                                                                                             |

## Rules

1. Never prefix a private credential with `NEXT_PUBLIC_`.
2. Never place `.env.local`, Vercel exports, Supabase keys, OAuth tokens, or integration credentials in Git.
3. Use distinct Supabase projects and credentials for local/development, preview, and production.
4. Rotate a credential after accidental exposure and record the rotation in the audit/incident process.
5. Keep Toast and Resy adapters in manual-import mode until approved access is confirmed.
6. This release has no live AI provider configuration. Do not add a model key to the deployment.
7. `NEXT_PUBLIC_APP_URL` must exactly match the deployment's canonical origin. A future connected production origin must also match the Supabase Auth redirect settings.
8. `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPABASE_URL` must be canonical origins without a path, query, fragment, or embedded credentials. Production connected mode rejects HTTP and local hostnames.
9. Connected mode is ready only when the Supabase URL, publishable key, and server-only secret key are all present. Partial configuration is treated as unavailable.
10. Keep `.env.test` synthetic and secret-free. Do not add connected credentials to tracked environment files.
11. Never set `LE_YARD_BOOTSTRAP_CONFIRM` until both owners have reviewed the dry-run output; unset it as soon as the one-time bootstrap completes.
12. Connected acceptance identities must be synthetic nonproduction fixtures. Never place real staff passwords or production restaurant credentials in test runner variables.
13. Release connected acceptance must complete its nonce-bound HMAC preflight before reading any role credential. The Preview must prove its exact Vercel commit and a service-role-only, short-lived database marker for the opaque target, migration contract, and fixture revision. Production must contain no marker and is also denied by deployment scope and hostname.
14. Keep connected acceptance read-only by default. Enable its single chat mutation probe only in the same attested isolated Preview after the exact host, tenant, location, channel, and unique run marker all match.
15. Never store a plaintext playground password in an environment variable, tracked file, shell command history, deployment log, ticket, or chat. Only salted scrypt hashes belong in the server-only registry.
16. Match playground mode and Vercel scope exactly. Use `preview` only in Preview and `production-playground` only in Production; use separately generated secrets for each scope and rotate/remove them when evaluation ends.
17. `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are platform-supplied. Never create or override them as project environment variables.
18. Keep the public website booking API key and API URL only in that site's server runtime. Never expose the key to the browser or reuse it as a slot, link, delivery, attestation, or encryption secret. Keep every signing secret independent.
19. Schedule both reservation delivery endpoints only after their provider credentials, sender identities, and Owner channel switches are approved. Keep `RESERVATION_SMS_DELIVERY_ENABLED=false`; changing it to the exact value `true` requires separately clearing the documented SMS duplicate-risk release gate.
20. Keep `RESERVATION_PUBLIC_BOOKING_ENABLED=false` until concurrency, abuse, privacy, delivery, incumbent-writer, and physical-floor gates are independently approved. Turning it off stops only new public inventory and holds; confirmation and management of existing commitments remain recovery-critical and available.

## Vercel hosted playground

The playground is a disposable product-evaluation surface, not an interim production database or live back office. The owners have approved a stable Vercel Production URL for this synthetic playground. That URL is public, but workspace content remains behind the application-level two-Owner login.

1. Create a new Vercel project rooted at `le-yard-os`. Do not link or modify the existing public restaurant website project.
2. In Vercel Production scope, set `NEXT_PUBLIC_APP_URL` to the project's canonical public HTTPS Production origin, set `NEXT_PUBLIC_DEMO_MODE=true`, and set `LE_YARD_PLAYGROUND_MODE=production-playground`.
3. Add a newly generated `LE_YARD_PLAYGROUND_SESSION_SECRET` and the four required salted-scrypt principals in `LE_YARD_PLAYGROUND_USERS_JSON`, both as sensitive Production values.
4. Generate each salted scrypt hash offline or through the approved no-echo helper. Pass secret values through protected standard input or the Vercel dashboard; do not place a password or secret on a command line that will be recorded in shell history.
5. Confirm the registry contains no plaintext password. Usernames are identifiers; the password representation must be a versioned salted scrypt hash.
6. Leave `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, SMTP, VAPID/push, Toast, Resy, AI, and OCR provider values unset for this playground. Any Supabase value must make playground readiness fail closed.
7. Do not set `VERCEL_ENV`; Vercel supplies `production`. The runtime must reject any mode/target mismatch, non-HTTPS/local application origin, invalid signing secret, invalid two-principal registry, or connected Supabase configuration.
8. Treat the signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie as temporary. It expires after eight hours by default or 30 days when the user explicitly selects the private-device option; it does not provide Supabase MFA, RLS, or persistent shared data.
9. Treat the canonical Production URL as public and discoverable. App-level login remains mandatory, unauthenticated workspace/API access fails closed, and robots directives do not replace authentication. Before broader testing, add Vercel Deployment Protection or an approved durable limiter; the in-process guard is intentionally only a first layer.
10. When evaluation ends, remove the Production playground values, rotate the session secret, and delete, disable, or protect the public playground deployment.

Playground identities are custom hosted principals, not Supabase Auth users. A new isolated Supabase project is currently blocked by the account's two-active-project free limit. Do not attach either unrelated existing project merely to bypass that limit.

## Supabase production settings

Before connected testing:

- disable open signup; use invitation-only user creation
- configure the exact site URL and callback URLs
- configure SMTP for invitations and password recovery
- enable email confirmation and a strong password policy
- enable MFA and leaked-password protection where supported
- keep all Storage buckets private
- verify the secret key is available only to server runtimes
- apply migrations before enabling connected traffic

Production must never contain a row in `private.connected_acceptance_targets`.
The migration creates the private table and service-only proof RPC but inserts
nothing. The attestation route also refuses `VERCEL_ENV=production` and the
known production hostnames, so a secret or database mistake alone cannot turn a
production deployment into an acceptance target.

## Isolated connected acceptance

Release acceptance and developer smoke are intentionally different commands:

- `npm run test:e2e:connected` is release acceptance. It accepts only a remote
  HTTPS Vercel Preview, requires the exact deployment Git SHA and private
  database marker, and fails if any Owner, Manager, Host, view-only,
  operate-only, denied, expired-assignment, or cross-location fixture is
  missing.
- `npm run test:e2e:connected:smoke` is a loopback-only developer aid. It is
  labeled as non-acceptance in the project name and console output, may skip
  unavailable local identities, and cannot target any deployment.

Prepare an acceptance target only after an isolated Supabase project and
synthetic fixture have been reviewed:

1. Apply the migration chain through
   `20260811091453_connected_acceptance_attestation` to the isolated project.
2. Generate independent random UUIDs for the target and fixture, and a dedicated
   32-byte random secret encoded as 43-character base64url. Do not reuse a Supabase key, booking
   secret, session secret, or user password.
3. As an authorized database operator—not through the service-role application
   client—insert one marker with an expiry no more than 31 days away. Use bound
   `psql` variables or a protected dashboard session; do not place actual values
   in a tracked SQL file:

   ```sql
   insert into private.connected_acceptance_targets (
     target_id,
     environment,
     schema_version,
     fixture_id,
     fixture_revision,
     expires_at,
     created_by
   ) values (
     :'target_id'::uuid,
     'nonproduction_preview',
     :'latest_migration_version',
     :'fixture_id'::uuid,
     :'fixture_revision',
     clock_timestamp() + interval '7 days',
     :'operator_reference'
   );
   ```

4. Set the six `CONNECTED_ACCEPTANCE_*` values only in Vercel Preview scope,
   with `CONNECTED_ACCEPTANCE_ATTESTATION_ENABLED=true`. Deploy the exact commit.
5. Configure the test runner with the matching target/fixture values, the exact
   40-character lowercase deployment SHA, the migration version above, and all
   synthetic matrix identities. Keep role passwords only in the protected test
   runner secret store.
6. Run release acceptance. Global setup first sends a fresh 32-byte nonce. The
   Preview validates the secret in constant time, matches its platform-supplied
   commit and canonical origin, resolves the exact marker using the service-only
   RPC, and returns a nonce-bound HMAC with `Cache-Control: no-store`. Only after
   the runner validates that proof does it read role passwords or permit an Auth
   POST.
7. Delete or let the marker expire after the acceptance window, disable the
   Preview route, and remove/rotate its secret. Never copy the marker or its
   configuration into Production.

## Vercel setup

1. Import only the `le-yard-os` directory as the project root.
2. Select the Next.js framework preset and Node.js 22 or 24 (the project pins this supported range).
3. For the owner-approved public Production playground, follow the hosted-playground procedure above. It is synthetic and must not receive Supabase or other provider credentials.
4. A future connected live deployment requires a separate configuration review, an isolated Supabase project, and explicit live-production approval; do not repurpose the playground variables.
5. For connected production, set the live domain and update `NEXT_PUBLIC_APP_URL` and Supabase redirect URLs together.
6. Run the connected preview acceptance suite before promoting any future live deployment.

## Verification without exposing values

Use `/api/health` as the platform readiness probe. A ready runtime returns `200`; incomplete or invalid connected or playground configuration returns `503`. The response separates liveness from readiness but does not identify which dependency, principal, or credential is present, and it never returns keys, hashes, project identifiers, database/model booleans, or validation details. This is a configuration-readiness probe, not proof that Supabase is reachable; connected acceptance must test Auth and database operations separately. Do not print complete environment variables in CI logs or support tickets.
