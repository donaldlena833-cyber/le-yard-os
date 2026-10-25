# Conflict-handling rehearsal

**F41: the reviewed business-conflict family is corrected locally; final source/regression checks pass. No hosted deployment occurred.**

The original stale-availability request timed out after about 60 seconds. The integrated runner incorrectly counted any error as refusal; evidence review invalidated that result, preserved its baseline and replaced broad error checks with explicit SQLSTATE checks. The availability-only correction was followed by this complete review of the remaining function family.

## Correction and limits

At baseline `20261024173500`, 70 other active public/private functions contained 87 occurrences of `40001`. Every occurrence was an explicit application-raised business conflict: stale versions, changed source facts or unavailable replay evidence. They were not engine-generated serialization failures. The clause review preserves their identities, body hashes and exact raises.

Forward migration **20261024174204** changes only those reviewed assignments to `PT409`, which PostgREST returns as HTTP 409. It pins each original body hash, refuses an unreviewed function, verifies all 70 targets / 87 clauses and verifies that each resulting body differs only by the intended replacement. Function signatures, owners, grants, security attributes, scope checks, locks, immutable history and request binding are preserved. Real database-generated serialization failures remain `40001`.

The actual migrated sandbox now contains **zero explicit `40001` business-conflict assignments**, with an exact runtime schema contract at **105 migrations / 317 public functions**. This is a local correction. It does not establish hosted version/configuration acceptance or a production load guarantee.

[Supabase's guidance](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions) describes the PostgREST 14 retry problem and recommends distinct HTTP business-conflict codes. [PostgREST documents PT status codes](https://docs.postgrest.org/en/stable/references/errors.html). The sandbox actually ran PostgREST v14.10; no provider version was upgraded to make this pass.

## Native proof

The disposable native PostgreSQL 17 gate passes **12/12** and drops its own database. It verifies:

- The 70 reviewed source hashes match the baseline catalog.
- A deliberately altered body and an extra unreviewed function each cause the migration to refuse; both probes roll back.
- Exactly 70 function bodies change, each by the intended code substitution; all other body text and all function identities/owners/grants/security attributes remain unchanged.
- The final catalog has no explicit business-conflict `40001` raise, including any migration after the correction; the schema fingerprint matches the exact head.
- Two actual concurrent database transactions produce a genuine `40001` serialization failure. The migration has not relabeled engine errors.

The existing reservation concurrency gate also passes at the new head, including staff/public conflicts, modification races, cancel/modify, guest-identity post-lock rechecks, scheduler/version fences and rollback footprints. The full native permission/financial suite passes 91/91, zero skips/incomplete, across 105 migrations. These native tests use SQL actor helpers; actual Auth/HTTP evidence is separate below.

## Actual Auth and HTTP proof

The connected drill passes **28/28**. Owner, second Owner, Host, Chef and Employee actually sign in to the local Auth service; the mock source-ingestion paths use only the private local service-role client.

| Operation | Result |
| --- | --- |
| Reservation edit/cancel/correction with an old version | PT409/HTTP409; current version/time/status unchanged and no durable request receipt |
| Current reservation edit/cancel and exact retries | Versions 1/2/3; original results retained |
| Floor save with stale but valid-range starting coordinates | PT409/HTTP409; actual coordinates unchanged |
| Prep draft/publish/complete/correct with stale versions | PT409/HTTP409; stale work posts no stock |
| Current prep completion/correction with exact retries | One +2 output movement, one -2 compensation; net zero, no duplicate posting |
| Stale location release command | PT409/HTTP409; prelaunch, zero public inventory, no booking approval and original release ID retained |
| Opening Room v3 stale revision | Existing structured HTTP 200/conflict outcome retained; no forced conversion to an error code |
| Stale sales-check observation | PT409/HTTP409; original net/hash retained; employee ingestion remains forbidden |
| Same POS time-entry version with different facts | PT409/HTTP409; original times/hash retained; exact source retry and older-version no-op remain valid |

All 11 explicit conflict probes returned the intended code/message, with the slowest observed response **9ms** in this single local run. Every request has a 10-second bound; a timeout or gateway failure fails the test. This is a local observation, not a production latency target. The drill is28 checks across representative workflows; it is not 70 separate end-to-end exercises.

Fixture setup initialized a missing synthetic release row only in its default closed state. It also created/reused a disconnected secondary-location mock Toast mapping and used the Owner command to assign a dated synthetic job qualification. These are test inputs, not restaurant release approval, POS connection acceptance or actual employee hours. The first unqualified import was correctly refused; no constraint was bypassed. No merchant credentials, sync worker, public booking, external email/SMS or real provider traffic were enabled.

## Application API boundaries

The public reservation and communications adapters previously mapped unrecognized conflict codes to generic 503 responses. Three added PT409 public-route regressions failed before the local mapping correction. The final cases also retain 40001 compatibility for all three methods. They now return 409 with `reservation_changed` and ask the caller to review the latest details and original request. They do not reveal raw database messages, automatically retry or allocate a new request identity.

The targeted API group passes 42/42: 28 public-route cases, four communications cases, four workflow error cases and six schema-contract cases. The communications tests retain the original request ID, prove no delivery scheduling on conflict, preserve uncertain timeout handling and retain the positive confirmed-result path. These are handler tests with mocked database/provider dependencies, separate from the 28 actual Data API checks.

The sibling public website source was inspected read-only at commit a65182f2ed07044cf7d2d107482e72f65f3ffbbe. Its proxy forwards upstream status; its current dialog retains request IDs on failed requests. No sibling source was changed, and this review is not a hosted public-booking rehearsal. Durable result recovery after a new session/reload remains proposed A18.

## Repeat and guard future changes

From the isolated Operations checkout with Node22:

```sh
# Native PostgreSQL 17 only; creates and drops its own disposable database.
BUSINESS_CONFLICT_DATABASE_URL=<isolated-loopback-postgres-control-url> \
BUSINESS_CONFLICT_REPORT_PATH=<new-report-path> \
npm run test:business-conflicts:native

# Actual local Auth/API only; the application frontend is not required.
LOCAL_READINESS_FIXTURE_PATH=<private-synthetic-fixture-path> \
LOCAL_READINESS_STATUS_PATH=<private-local-backend-status-path> \
LOCAL_READINESS_EVIDENCE_PATH=<new-evidence-path> \
LOCAL_READINESS_SERVICE_DATE=<valid-synthetic-service-date> \
npm run test:business-conflicts:local
```

Use the retained private local files; never point them at hosted endpoints. The HTTP runner accepts only 127.0.0.1:55421/55422 and the synthetic classification. New runs retain labeled fake records. The native gate is added to the database CI job and `verify:connected`; actual GitHub execution remains unrun. Set both native control URL variables when running the complete connected validation command.

Initial harness baselines are retained: wrong quote parameter, out-of-range floor coordinates, missing closed release fixture, unqualified mock POS input and a JavaScript string-replacement issue in the native drift probe. These setup failures were corrected without weakening the expected error codes or database constraints.


Review the readiness evidence package for the version-bound run outputs.

## Portable fixture maintenance

Strict staff admission also exposed older verifier inputs that were outside their configured service, used arbitrary durations or omitted a creator. The verifier now uses explicit location-local times, matching turn durations, a separate current waitlist service and a dated after-midnight service for the cross-business-date cleanup test. Ten pacing covers are supplied by two allowed five-person parties. Reminder checks pass an explicit due clock so the unverified-recipient assertion still tests a due reminder.

Delivery-claim fixtures are admitted before the deliberately injected legacy hold backlog, keeping normal creation subject to pacing. The cross-location, push, income and service-day read-model fixtures retain their original staff source with a valid service and creator. The one intentional nullable-duration historical row is injected only in the disposable PGlite test, with its admission trigger restored and verified before the actual cancellation command. Normal creation gates remain enabled.

The final complete portable chain passes 20/20. Build, typecheck and the independent generated-type check pass; lint has zero errors and one existing worker warning.
