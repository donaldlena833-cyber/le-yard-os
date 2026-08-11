# Connected preview acceptance

Connected release acceptance is a protected, manual check of an already
deployed, isolated Vercel Preview. It does not deploy, promote, migrate, create
a database marker, enable public booking, send guest messages, or contact a
provider.

## Two deliberately different test paths

| Path | Command or workflow | Allowed target | Release evidence |
| --- | --- | --- | --- |
| Developer smoke | `npm run test:e2e:connected:smoke` | Loopback HTTP/HTTPS only | Never |
| Release acceptance | `Connected preview release acceptance` GitHub workflow | Exact attested HTTPS Vercel Preview | Yes, only when every check passes |

Developer smoke may skip unavailable local identities and is labeled as
non-acceptance in both its Playwright project and console output. The protected
workflow never invokes the smoke command.

## Required GitHub Environment

Create a GitHub Environment named `connected-preview-acceptance`. Require an
authorized reviewer, prevent self-review where the repository plan supports it,
restrict deployment branches/tags to reviewed release-candidate refs, and do not
allow routine administrator bypass. These protection rules live in GitHub and
cannot be created or proven by the repository workflow itself.

Set these environment variables for one reviewed synthetic fixture:

- `CONNECTED_PREVIEW_TARGET_ID`
- `CONNECTED_PREVIEW_FIXTURE_ID`
- `CONNECTED_PREVIEW_FIXTURE_REVISION`
- `CONNECTED_PREVIEW_ORGANIZATION_NAME`
- `CONNECTED_PREVIEW_LOCATION_NAME`

Set these environment secrets. Keep them out of repository variables, logs,
artifacts, screenshots, and tracked files:

- `CONNECTED_PREVIEW_ATTESTATION_SECRET`
- `CONNECTED_PREVIEW_OWNER_EMAIL` / `CONNECTED_PREVIEW_OWNER_PASSWORD`
- `CONNECTED_PREVIEW_MANAGER_EMAIL` / `CONNECTED_PREVIEW_MANAGER_PASSWORD`
- `CONNECTED_PREVIEW_HOST_EMAIL` / `CONNECTED_PREVIEW_HOST_PASSWORD`
- `CONNECTED_PREVIEW_VIEW_ONLY_EMAIL` / `CONNECTED_PREVIEW_VIEW_ONLY_PASSWORD`
- `CONNECTED_PREVIEW_OPERATE_ONLY_EMAIL` / `CONNECTED_PREVIEW_OPERATE_ONLY_PASSWORD`
- `CONNECTED_PREVIEW_DENIED_EMAIL` / `CONNECTED_PREVIEW_DENIED_PASSWORD`
- `CONNECTED_PREVIEW_EXPIRED_EMAIL` / `CONNECTED_PREVIEW_EXPIRED_PASSWORD`
- `CONNECTED_PREVIEW_CROSS_LOCATION_EMAIL` / `CONNECTED_PREVIEW_CROSS_LOCATION_PASSWORD`

All identities must be synthetic nonproduction accounts. The workflow is
read-only and hard-sets `E2E_CONNECTED_ENABLE_MUTATIONS=false`; the optional
employee chat mutation probe is not part of this release gate.

## Target prerequisites

Before dispatching the workflow, an authorized operator must independently
prepare all of the following:

1. An isolated Supabase project with the exact repository migration chain
   applied through the commit's latest migration.
2. The reviewed role/location fixture and one unexpired
   `private.connected_acceptance_targets` marker whose schema version equals
   that same latest migration.
3. An existing Vercel Preview of the exact commit, configured with
   `VERCEL_ENV=preview`, `NEXT_PUBLIC_APP_URL` equal to its canonical origin,
   and the matching six `CONNECTED_ACCEPTANCE_*` runtime values.
4. The protected GitHub Environment variables, secrets, and reviewer policy
   above.

Production must contain no acceptance marker. The application attestation route
and runner both reject the known live hosts, and the manual workflow additionally
requires a canonical `*.vercel.app` HTTPS origin.

## Manual run

In GitHub Actions, select `Connected preview release acceptance`, select the
exact release-candidate commit as the workflow ref, and provide:

- `preview_url`: the exact canonical Vercel Preview origin;
- `commit_sha`: the lowercase 40-character SHA of that selected ref; and
- `confirmation`: `RUN CONNECTED RELEASE ACCEPTANCE`.

The first job has no protected environment and receives no secrets. It rejects
the wrong repository/event, a mutable or mismatched ref, a live/local/custom
host, and a checkout whose migration head cannot be derived exactly. It checks
out `commit_sha`, never `main` by implication.

Only after that job passes can GitHub request approval for the protected
environment. Playwright global setup then obtains a fresh nonce-bound HMAC from
the exact Preview. The Preview proves its platform-supplied Git commit and the
service-role-only database marker for the exact migration head, target, fixture,
and revision. The runner validates that proof before its code reads any role
email/password or sends any Supabase Auth request. Missing or mismatched values
fail the run; release acceptance does not skip an incomplete role matrix.

## Evidence and interpretation

After the browser step, the workflow uploads one JSON file for 30 days. It
contains the exact commit and migration head, the required role names, the
workflow run/attempt, the result, and SHA-256 bindings for the Preview and
database fixture. It contains no URL/hostname, project name, target UUID,
fixture UUID/revision, email, password, attestation secret, screenshots, video,
trace, or database row data.

The evidence says `allReleaseAcceptanceChecksPassed: true` only when the signed
preflight and every connected Playwright check passed. Failure, cancellation,
skip, or a browser step that never ran remains non-passing evidence. The GitHub
artifact and job logs are acceptance evidence; local developer-smoke output is
not.

## External gates that remain external

Repository checks cannot create or attest the Preview, protected environment,
reviewer approval, isolated database, short-lived marker, or synthetic Auth
fixtures. They also cannot authorize deployment or production activation. If
any prerequisite is absent, leave release acceptance unresolved rather than
substituting smoke data or a soft assertion.
