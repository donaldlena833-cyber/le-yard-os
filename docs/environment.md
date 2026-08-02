# Environment configuration

Copy `.env.example` to `.env.local` for local work. Vercel environment variables should be configured separately for Development, Preview, and Production; do not copy production secrets into a local or preview environment.

There are no implicit runtime-mode or application-origin defaults. Missing or invalid required values make the deployment not ready: `/api/health` returns `503`, and the proxy fails closed for every other route. Unit tests load the committed synthetic-only `.env.test`; browser tests pass their demo values explicitly. Production rejects an open demo. The owner-approved Vercel Production playground is accepted only when its complete two-Owner gate is present, `LE_YARD_PLAYGROUND_MODE` equals `production-playground`, and Vercel itself supplies `VERCEL_ENV=production`.

## Variable matrix

| Variable | Exposure | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Browser-safe | Yes | Canonical application origin and authentication callback base |
| `NEXT_PUBLIC_DEMO_MODE` | Browser-safe | Yes | Explicit `true` uses synthetic data locally or inside a guarded hosted playground; a connected live deployment must use `false` |
| `LE_YARD_PLAYGROUND_MODE` | Server-only | Hosted playground | Must be `preview` only with `VERCEL_ENV=preview`, or `production-playground` only with `VERCEL_ENV=production` |
| `LE_YARD_PLAYGROUND_SESSION_SECRET` | Server-only secret | Hosted playground | High-entropy signing secret for the eight-hour playground session cookie; scope it only to the intended Vercel target |
| `LE_YARD_PLAYGROUND_USERS_JSON` | Server-only secret | Hosted playground | Exactly two Owner principals containing identifiers and salted scrypt password hashes; never plaintext passwords |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Connected mode | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe | Connected mode | Supabase publishable/anon credential; all access remains subject to RLS |
| `SUPABASE_SECRET_KEY` | Server-only | Connected mode | Supabase secret/service credential for invitation and tightly scoped system operations |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Browser-safe | Push notifications | Browser push subscription key |
| `VAPID_PRIVATE_KEY` | Server-only | Push notifications | Signs push messages |
| `VAPID_SUBJECT` | Server-only | Push notifications | Contact URI, normally an approved operations email |
| `PUSH_SUBSCRIPTION_ENCRYPTION_KEY` | Server-only | Push subscription storage | Base64-encoded 32-byte AES key; generate independently from the VAPID signing key |
| `TOAST_CLIENT_ID` | Server-only | Optional | Approved Toast adapter client ID |
| `TOAST_CLIENT_SECRET` | Server-only | Optional | Approved Toast adapter secret |
| `TOAST_RESTAURANT_GUID` | Server-only | Optional | Restaurant identifier supplied through approved Toast access |
| `RESY_INTEGRATION_TOKEN` | Server-only | Optional | Token supplied through an approved Resy integration arrangement |
| `OWNER_DONALD_EMAIL` | Server-only bootstrap | Production bootstrap | Verified owner email; never seeded with a guessed address |
| `OWNER_MARIS_EMAIL` | Server-only bootstrap | Production bootstrap | Verified owner email; never seeded with a guessed address |
| `LE_YARD_BOOTSTRAP_CONFIRM` | Server-only, one run | Production bootstrap execution | Exact plan-bound confirmation emitted by the dry run; remove immediately afterward |
| `E2E_CONNECTED_APP_URL` | Test runner only | Connected acceptance | Canonical preview origin exercised by the connected Playwright project |
| `E2E_CONNECTED_OWNER_EMAIL` / `PASSWORD` | Test runner secret | Connected acceptance | Nonproduction Owner fixture; the suite proves the AAL2 gate appears after password sign-in |
| `E2E_CONNECTED_ADMIN_EMAIL` / `PASSWORD` | Test runner secret | Connected acceptance | Nonproduction Admin fixture |
| `E2E_CONNECTED_MANAGER_EMAIL` / `PASSWORD` | Test runner secret | Connected acceptance | Nonproduction Manager fixture with explicit location membership |
| `E2E_CONNECTED_EMPLOYEE_EMAIL` / `PASSWORD` | Test runner secret | Connected acceptance | Nonproduction Employee fixture with explicit location membership |
| `E2E_CONNECTED_EXPECTED_ORGANIZATION_NAME` | Test runner only | Connected core matrix | Exact synthetic tenant name; prevents accepting the wrong tenant |
| `E2E_CONNECTED_EXPECTED_LOCATION_NAME` | Test runner only | Connected core matrix | Exact synthetic location name; prevents accepting the wrong location |
| `E2E_CONNECTED_ALLOW_LOCAL` | Test runner only | Local connected acceptance | Explicitly permits HTTP only for a local Supabase/application acceptance environment |
| `E2E_CONNECTED_ENABLE_MUTATIONS` | Test runner only | Optional chat probe | Must equal `true`; read-only route coverage does not set it |
| `E2E_CONNECTED_ENVIRONMENT` | Test runner only | Optional chat probe | Must equal `nonproduction` before any connected write |
| `E2E_CONNECTED_MUTATION_HOST` | Test runner only | Optional chat probe | Must exactly match the hostname in `E2E_CONNECTED_APP_URL` |
| `E2E_CONNECTED_RUN_ID` | Test runner only | Optional chat probe | Unique 1–80 character marker attached to the synthetic write |
| `E2E_CONNECTED_CHAT_CHANNEL_NAME` | Test runner only | Optional chat probe | Dedicated Employee-visible nonproduction channel used by the write probe |

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
13. Keep connected acceptance read-only by default. Enable its single chat mutation probe only in an isolated nonproduction tenant after the environment, exact host, tenant, location, channel, and unique run marker all match.
14. Never store a plaintext playground password in an environment variable, tracked file, shell command history, deployment log, ticket, or chat. Only salted scrypt hashes belong in the server-only registry.
15. Match playground mode and Vercel scope exactly. Use `preview` only in Preview and `production-playground` only in Production; use separately generated secrets for each scope and rotate/remove them when evaluation ends.
16. `VERCEL_ENV` is platform-supplied. Never create or override it as a project environment variable.

## Vercel hosted playground

The playground is a disposable product-evaluation surface, not an interim production database or live back office. The owners have approved a stable Vercel Production URL for this synthetic playground. That URL is public, but workspace content remains behind the application-level two-Owner login.

1. Create a new Vercel project rooted at `le-yard-os`. Do not link or modify the existing public restaurant website project.
2. In Vercel Production scope, set `NEXT_PUBLIC_APP_URL` to the project's canonical public HTTPS Production origin, set `NEXT_PUBLIC_DEMO_MODE=true`, and set `LE_YARD_PLAYGROUND_MODE=production-playground`.
3. Add a newly generated `LE_YARD_PLAYGROUND_SESSION_SECRET` and exactly two salted-scrypt Owner principals in `LE_YARD_PLAYGROUND_USERS_JSON`, both as sensitive Production values.
4. Generate each salted scrypt hash offline or through the approved no-echo helper. Pass secret values through protected standard input or the Vercel dashboard; do not place a password or secret on a command line that will be recorded in shell history.
5. Confirm the registry contains no plaintext password. Usernames are identifiers; the password representation must be a versioned salted scrypt hash.
6. Leave `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, SMTP, VAPID/push, Toast, Resy, AI, and OCR provider values unset for this playground. Any Supabase value must make playground readiness fail closed.
7. Do not set `VERCEL_ENV`; Vercel supplies `production`. The runtime must reject any mode/target mismatch, non-HTTPS/local application origin, invalid signing secret, invalid two-principal registry, or connected Supabase configuration.
8. Treat the signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie as temporary. It expires after eight hours and does not provide Supabase MFA, RLS, or persistent shared data.
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

## Vercel setup

1. Import only the `le-yard-os` directory as the project root.
2. Select the Next.js framework preset and Node.js 22 or 24 (the project pins this supported range).
3. For the owner-approved public Production playground, follow the hosted-playground procedure above. It is synthetic and must not receive Supabase or other provider credentials.
4. A future connected live deployment requires a separate configuration review, an isolated Supabase project, and explicit live-production approval; do not repurpose the playground variables.
5. For connected production, set the live domain and update `NEXT_PUBLIC_APP_URL` and Supabase redirect URLs together.
6. Run the connected preview acceptance suite before promoting any future live deployment.

## Verification without exposing values

Use `/api/health` as the platform readiness probe. A ready runtime returns `200`; incomplete or invalid connected or playground configuration returns `503`. The response separates liveness from readiness but does not identify which dependency, principal, or credential is present, and it never returns keys, hashes, project identifiers, database/model booleans, or validation details. This is a configuration-readiness probe, not proof that Supabase is reachable; connected acceptance must test Auth and database operations separately. Do not print complete environment variables in CI logs or support tickets.
