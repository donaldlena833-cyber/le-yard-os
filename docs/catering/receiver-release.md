# Catering receiver: release and activation

This source adds a service-inquiry receiver, not catering availability, bookings,
orders, marketing subscribers or notification delivery. It is disabled by default.
Corporate and offsite private-party requests are equal. Onsite private dining is
separate. This change seeds no clients and changes no live database by itself.

## Contract

POST /api/v1/catering-inquiries accepts an authenticated server-to-server request
from the website relay. It requires a dedicated active, unexpired catering client
credential and UUIDv4 Idempotency-Key, application/json, a maximum 16 KiB body,
strict bounded event/contact fields and explicitly false email-marketing, SMS and
profile consent. The website sends purpose=catering_service_inquiry,
channel=website and noticeVersion=catering-2026-10-21. Never reuse a reservation key
or the guest-interest newsletter endpoint. Server errors contain no brief or
upstream database details; there are no payload/credential logs in this path.

A 201 response with data.status=accepted, data.stored=true and data.inquiryId proves
a committed inquiry record only. Retries with the same normalized payload/client/
key return the original ID, including after the preferred event date passes.
Conflicting reuse returns 409. Database failures never acknowledge acceptance.
There is no notification sender or outbox worker in this batch; notification_status
remains not_configured. No delivery, owner response, quote, order or fulfillment
claim follows from a saved record.

## Storage, abuse protection and reads

public.catering_inquiries stores the qualified brief and source. Its RLS permits
SELECT only to an active owner in the same organization, through the existing
membership/authorization helper. Managers, suspended users, other organizations
and anonymous callers do not get rows; authenticated roles cannot insert/update/
delete or call service RPCs. The source contains no staff inbox UI yet.

Private dedicated clients are inactive by default. Their organization/location
come from server credential configuration, never the browser body. Credential
hashes and rate buckets are private; no client provisioning endpoint is exposed.
The service role gets only required grants on the new tables/functions. Existing
reservation, guest and communication credentials or permissions are unchanged.

Each client's DB transaction serializes acceptance/replay and global/per-email
hourly counters using an advisory transaction lock. Concurrent retries cannot
create duplicate rows; concurrent new requests cannot overshoot a quota. Defaults
are 60/hour globally and 4/hour/contact, configurable within bounded ranges on the
client row; these are abuse limits, not a fulfillment/response promise. Counters
use email hashes and expire after 24 hours during capture. An insertion failure
rolls counters back. Inquiry retention/deletion remains an operational policy to
approve before activation; it is not inferred from counter expiration.

## Coordinated release requirements

The migration 20261023100420 and app EXPECTED_SCHEMA_CONTRACT head must ship
together. Their schema/function/access fingerprints remain fail closed on drift;
no old health guard is bypassed. Regenerate database types after schema changes.
Do not apply this migration alone to a running older OS, or deploy the new OS
without the migration and coordinated rollback plan. Rebase/revalidate against
the OS release owner's current base before merge; another local OS branch contains
unpublished work. Neither main nor production has been modified by this branch.

Before production activation:

1. Confirm inquiry owner and actual inbox responsibility, approved retention and
   access handling, response process and a staff-readable operational handoff.
2. Rehearse the actual website relay/hosted RPC/owner path on an isolated preview;
   local SQL checks do not prove hosted PostgREST routing or UI access.
3. Apply migration and matching app in a coordinated OS release after fresh Git,
   provider/schema and dependency checks. Keep receiver feature flag false.
4. Provision a new dedicated client under the correct organization/location using
   a high-entropy credential in private server configuration. Store only its
   SHA256 hash in private.catering_api_clients; leave it inactive until ready.
   Do not copy any real credential into this document or source.
5. Separately authorize any controlled external inquiry/notification test. Prove
   committed ID, correct owner access, actual recipient receipt and follow-up as
   independent states. This branch has no automatic notifications to test yet.
6. Enable LE_YARD_CATERING_RECEIVER_ENABLED only when the receiver is ready; then
   deliberately configure the website's HTTPS URL/key/named-owner gate on each
   intended project. The calendar or a successful build never enables it.

Rollback: pause both website direct intake and receiver flags first. Preserve
saved inquiry evidence. A previous app expects the prior schema head, so do not
restore an old app while leaving the new DB contract active. Prepare a coordinated
forward compatibility/rollback migration with the release owner; no destructive
DROP of inquiries is an authorized routine rollback. This document does not
perform any rollback or production change.

## Local verification

Use Node 22 and the checked-in package lock. npm test discovers the receiver unit
suite. npm run test:catering:postgres requires CATERING_TEST_DATABASE_URL pointing
to a loopback PostgreSQL postgres control database; the script refuses remote
hosts and creates/drops only a randomly named disposable database. Use an owned
isolated cluster, not an unrelated local app database. It applies the complete
migration chain, tests both audiences, actual RLS/RPC grants, transaction rollback,
expiration/revocation, stable replay and parallel quota/idempotency behavior.

Optional CATERING_RUN_ADVISORS=true runs Supabase security advisors against that
same disposable local database before cleanup. Its local cluster has no TLS;
sslmode=disable is applied only after the loopback guard. Never use that option
for a provider database. CATERING_ADVISOR_OUTPUT controls the local report path.
Other checks: npm run test:db:pglite, npm run test:function-grants:pglite,
npm run types:database:check, npm run typecheck, npm run build and scoped ESLint.

Current production functionality remains the website brief's review/copy/email
mode. This implementation is reviewable source, not a deployed or fulfilled service.

## October 23 validation and runtime prerequisite

The candidate pins Next.js and eslint-config-next to 16.4.2 and sharp to 0.35.5,
with compatible follow-redirects/source-map-js lockfile patches. Runtime-only npm
audit reports zero findings for this candidate; this does not represent the
unchanged OS production runtime or every development dependency.

Local results: 19 real PostgreSQL checks including parallel idempotency/global and
contact limits and local Supabase security advisors; full migration and function
grant regressions; generated types, typecheck, scoped ESLint, production build and
32 scoped unit tests pass. A development HTTP probe confirms the default-disabled
503 response without backend configuration. Production-build readiness guards
were not bypassed to obtain that probe. No hosted relay rehearsal was performed.

The complete unit suite is not green: 1375 pass and 5 fail. All five failures were
reproduced on clean origin/main 9e673d3287042642c1bae65e7d49a9e498c73ead with
its original lockfile and Next 16.2.12. They are existing empty-state wording/
selector assertions in live-connected-ui, live-inventory-interactions,
live-inventory-ui, live-operations-ui and live-integrations-ui. No assertions were
weakened. Resolve or explicitly track them in the coordinated OS release review.
