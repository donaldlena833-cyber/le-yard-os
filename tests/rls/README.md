# Native RLS acceptance

Run `npm run test:rls` from the repository root with `RLS_TEST_DATABASE_URL` set to an isolated, loopback PostgreSQL 17 control database named `postgres`. There is no PGlite fallback. The runner requires initialized platform roles and rejects browser roles with superuser or RLS-bypass privileges.

For a separate control database with pgTAP installed:

```sh
supabase db start --workdir .github/rls-database
RLS_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres npm run test:rls
supabase stop --workdir .github/rls-database
```

The default local password above belongs to the isolated CI database profile. Do not use hosted, forwarded, shared or production credentials. The runner creates a random disposable database, applies every checked-in migration and the synthetic seed, executes all fourteen required SQL files, and drops only that database. It does not reset the control database or change global roles. Each SQL file also rolls back its own records. A missing required file, SQL error, failed assertion, incomplete TAP plan or cleanup failure makes the gate fail.

Set `RLS_TEST_REPORT_PATH` to save structured results. The report includes the server version, source migration digest, each SQL file's digest, all TAP results and cleanup status. The GitHub workflow uses the pinned CLI version 2.98.2 and a database-only profile. Its definition has been rehearsed locally; an actual GitHub run remains separate evidence.

| File | Assertions | Contract |
| --- | ---: | --- |
| 00_rls_coverage.sql | 13 | Forced RLS, explicit policies, anonymous grants, private storage, audit guard, future defaults and fingerprint drift |
| 01_tenant_and_roles.sql | 31 | Employee/Manager/Admin/Owner and other-tenant scope; explicit positive and negative guest capabilities; member commands and Owner promotion boundary |
| 02_workflow_guards.sql | 13 | Qualified clock-in, actor-owned correction and exact retry, self-approval refusal, management approval, ledger denial and immutable audit |
| 03_tip_engine.sql | 34 | Approved source derivation, equal/weighted hours, split shifts, zero net minutes, excluded roles, independent adjustments/approval and locked evidence |
| 04_current_scope_signals.sql | 28 | Scoped read-only signal fields, forced RLS, grants, tenant/capability/location/suspension and retired Broadcast producers |
| 05_service_shift_read_stability.sql | 7 | Unchanged reads preserve rows/timestamps; real policy changes still materialize once |
| 06_current_preshift_projection.sql | 12 | Current publications and drafts from each service survive bounded reads; notes, drafts and location scope stay enforced |
| 07_reservation_signal_sources.sql | 12 | Four actual producer trigger sources, allowed allocation/waitlist changes, and append-only table-status refusals |
| 08_square_source_evidence.sql | 44 | Explicit provider, exact mapping, private source versions, scope-bound windows, immutable attempts and approved retry lineage; no financial posting |
| 09_sql_warning_triage.sql | 21 | Clock-reader volatility/body/security preservation,42 explicit timestamp examples across9 settings contexts, prepared-plan rejection and bounded helper checks |
| 10_checklist_authoring_boundaries.sql | 72 | Malformed input, exact binary/wire size boundaries, compressed storage, authoring/retry, orphan prevention and role/location scope |
| 11_staffing_replay_and_overlap.sql | 25 | Current retry scope, decision-offer binding, private assignment serialization, adjacent intervals, conflicting claims/offers/publications and superseded plans |
| 12_staffing_capabilities_and_publication.sql | 25 | Effective management grants/denials before fresh and saved commands, Employee capability operation, publication qualification/employment/role dates, cancellation and exact history |
| 13_receiving_proposed_quantities.sql | 25 | Original delivered/proposed bounds, finite precision, no orphan or corrective stock from invalid input, retained pending evidence, independent review/replay, internal helper ACL and historical completed results |

The financial vectors retain 34/33/33 cent allocation from three equal participants, 20/80 from weighted split-shift labor, and 58/43 after independently approved +10/-5 cent adjustments to a 101-cent source. Runs are prepared through the current closeout/labor command. No direct writes are reopened to satisfy retired tests. Invalid preparation leaves no orphan run, and a manually constructed unprepared run is refused.

These tests use synthetic SQL JWT helpers. They prove native database authorization and financial invariants, not real Auth sign-in, provider delivery, staff-device operation, wage-policy approval or payroll acceptance. The separate connected role/browser rehearsal supplies real local Auth evidence.

References: [Supabase database-only startup](https://supabase.com/docs/reference/cli/supabase-db-start), [pgTAP](https://pgtap.org/documentation.html).

A direct trigger-function call inside a pgTAP negative probe crashed this local PostgreSQL build. Check the actual ACL here and use the separate Data API refusal check; do not broaden EXECUTE or repeat that crash probe as an application test.
