# Le Yard OS — Phase 2 production release and system grade

Date: August 20, 2026
Release decision: **Production infrastructure is live and A-minus pilot ready; broad all-staff service certification still requires the named human/provider gates below**
Overall grade: **A- / 92**

## Executive judgment

The Phase 1 audit was converted into production changes rather than left as a recommendation list. The linked Supabase schema, Operations deployment, and Host deployment now share the same reviewed migration head. Both canonical applications are healthy and fail closed around authentication and surface routing. Public Reserve resolves real future availability without a synthetic fallback.

The system is suitable for Donald, the second Owner after MFA enrollment, and a controlled Host/Manager/employee pilot. Four live principals now prove the production RLS boundary for Owner, Manager, and employee access, the exact deployed schema has survived an isolated PostgreSQL 17 restore, and both production applications are back on the same fail-closed contract. It is not honest to call the restaurant fully service-certified until the remaining physical, provider, second-owner, managed-backup, and human-accessibility gates have been completed. Those are external acceptance gates, not known code bypasses.

## Production state

| Surface | State | Evidence |
|---|---|---|
| Marketing | Live | `leyardny.com` and `www.leyardny.com` resolve to HTTP 200; `www` canonicalizes to the apex. |
| Public Reserve | Live | `reserve.leyardny.com/reserve` returns HTTP 200 at desktop and 390 px; future availability returned 18 live dinner slots with no browser errors. No test reservation was inserted. |
| Host | Live | `host.leyardny.com/api/health` returns `200 ready`; anonymous reservations redirects to sign-in; non-Host inventory redirects to Reservations. |
| Operations | Live | `operations.leyardny.com/api/health` returns `200 ready`; anonymous reports redirects to sign-in. |
| Opening Room | Live/private | `startup.leyardny.com` returns HTTP 200. This release did not change its privacy boundary. |
| Supabase | Live/current | Project `qcmwqnonxabdsntfsuzy` is `ACTIVE_HEALTHY`; local and remote migration ledgers match through `20260821200955`. |

Production is connected mode, not demo mode. Owner/Admin MFA enforcement is enabled on both Host and Operations. One of two active Owners currently has verified TOTP; the other is sent through enrollment at first authenticated access. Obsolete hosted-playground credentials were removed from Operations.

Public booking is enabled. Email configuration is present. SMS and push delivery remain disabled, so the interface must not promise those channels. Owner Intelligence has no production provider selected while the local Sub2API handoff is deferred.

## Phase 2 closure

### Authorization, reports, and governance

- Management messages are filtered by channel visibility, kind, participant, principal, organization, and application surface.
- Report navigation, read models, RPCs, RLS, CSV, and PDF exports enforce exact report-kind capabilities. Operational reporting no longer implies access to payroll, tips, receipts, expenses, COGS, or sales-to-labor.
- Report freshness comes from actual source evidence; an empty report cannot manufacture a fresh timestamp.
- Member administration requires an explicit primary location and shows the proposed assignment before save.
- High-impact Owner Intelligence mutations use proposal, separate confirmation, fingerprint-bound execution, audit evidence, and bounded Undo. The model cannot write Supabase directly.

### FOH and reservations

- Booking and waitlist demo submissions create durable scoped records rather than showing false success.
- Mutation errors remain inside the active modal; pending requests cannot be dismissed through backdrop, Escape, close, or Cancel.
- Reservation Arrive/Seat/Complete corrections are server-backed, version-fenced, time-bounded, audited, and restore exact allocation state where applicable.
- Floor changes use local draft, review, explicit save, discard, and exact Undo instead of one-click destructive reset.
- Waitlist offer expiry begins from confirmed delivery truth rather than from a click that may not have delivered.

### Service, kitchen, inventory, and purchasing

- Pre-shift acknowledgements include the exact published brief content the employee is acknowledging.
- Service 86/restore events target canonical recipe or inventory IDs, serialize on the subject head, reject stale changes, and support an exact inverse restore.
- Manual Prep now has the advertised location/capability lifecycle, publish/complete controls, inventory posting, audit evidence, concurrency fences, and compensation.
- Inventory counts are blind to expected quantity and variance during entry, support scoped device-resumable drafts, and reveal variance only to review roles.
- Recipe costing is computed by a server RPC using canonical units, waste, effective cost, price quantity, batch yield, portion cost, and missing-cost state.
- Delivery exceptions require structured condition/evidence, a different authorized reviewer, and a linked corrective ledger post rather than rewriting receipt history.
- Purchase orders require independent approval before receiving.

### Integrations and degraded operation

- Toast retry jobs are claimable, lease-expiring, and no longer deadlock behind their own queued record. Toast remains read-only.
- Manual CSV import is unavailable rather than accepting an upload that no worker can process.
- Reservation email configuration is live. SMS and push stay disabled until their delivery/reconciliation evidence exists.
- Sub2API is pinned and locally isolated, and the application adapter is implemented with HTTPS-or-loopback origin validation, no redirects, bounded timeout/body, strict structured output, sanitized errors, and no remote tools. Activation still requires Donald's Mac permission, his own compliance acceptance, and his OAuth session.

## Verification record

| Gate | Result |
|---|---:|
| ESLint | Pass |
| Generated database contract | Pass — 144 tables, 3 views, 291 functions, 16 enums |
| TypeScript | Pass |
| Unit/component tests | 782 / 782 pass across 141 files |
| Portable PostgreSQL migration/integration suites | Pass |
| Optimized local Next.js build | Pass on Node 22.22.0 |
| Browser journeys | 66 / 66 pass |
| Dependency audit | 0 vulnerabilities |
| Runtime schema regression test | Pass; contract now tracks the newest committed migration |
| Supabase migration parity | Pass through `20260821200955` |
| Live RLS principal matrix | Pass — two Owners, one Manager, and one employee; Manager denied financial reports, employee denied management messages and all reports |
| Supabase security advisor | 0 errors; 5 informational deny-all tables, 184 intentional authenticated workflow RPC warnings, and 1 Free-plan password-protection warning |
| Supabase performance advisor | Improved from 527 to 487 notices; all 40 repeated-Auth RLS warnings removed without changing authorization outcomes |
| Isolated PostgreSQL 17 restore | Pass — evidence `05ad5dac-6a94-48a5-885b-4eef89c6e166`, 79 migrations, 144 forced-RLS tables, 365 function grants, exact data/schema fingerprints, complete cleanup |
| Automated accessibility | 28 / 28 desktop and 390 px route audits pass with no serious or critical Axe violations |
| Operations production build | `dpl_9N4j2fCtLqFUvbCKAvLzjT3w7T73` READY; canonical health 200 |
| Host production build | `dpl_6ZcyJFYvEFk5QX7UtuQ8WWL4SsYj` READY; canonical health 200 |
| Fresh Vercel runtime errors | None on Operations or Host after the release |
| Public Reserve read smoke | Desktop/mobile 200; future availability API 200 with live slots |

## A-minus hardening delta

- Rewrote exactly 40 advisor-identified RLS policies to evaluate `(select auth.uid())` once per statement. The migration asserts the complete allowlist before it changes anything, passed the full disposable database replay, and preserved the pre-migration result for every live principal.
- Executed production-authenticated, read-only probes for two Owners, one Manager, and one employee. Owners retained operational and financial report access; the Manager retained operational reports but was denied financial reports; the employee was denied both report classes and saw zero management channels while retaining the all-staff channel.
- Ran the strict PostgreSQL 17 archive/restore drill against a dedicated loopback-only cluster. The restored schema, forced RLS, grants, deterministic data, wrong-password rejection, mutation detection, and cleanup matched the independent reference build. No provider was contacted and no production data was copied.
- Expired the one-day Supabase CLI login exposed by the CLI dry-run preflight. It was not the project database password or an application secret. The scoped role now has an expired `VALID UNTIL`, and application/database connectivity remained healthy.
- Promoted the exact schema contract to Operations and Host. Both canonical health endpoints return `200 ready`; anonymous protected routes still redirect to their surface-specific sign-in page; Vercel reports no fresh runtime error clusters.

## System grade

| Area | Weight | Score | Grade | Judgment |
|---|---:|---:|---:|---|
| Authorization and data isolation | 18 | 18.0 | A | Exact capability/surface boundaries and the four-live-principal positive/negative matrix pass in production. |
| FOH reservations and Host | 16 | 15.0 | A | Core lifecycle, correction/Undo, delivery truth, drafts, live availability, Host deployment, and denial paths pass; provider and physical-floor rehearsal remain. |
| Service Control and Today | 11 | 10.2 | A- | Published brief truth, canonical availability, and 86/restore pass end to end in the database contract; a physical service rehearsal remains. |
| BOH inventory, purchasing, recipes, Prep | 16 | 14.4 | A- | The implemented lifecycles survive the exact 79-migration restore and integration matrix; real receiving/count/costing rehearsal remains. |
| Owner finance and governance | 12 | 11.0 | A- | Production proves exact operational-versus-financial report isolation and explicit location governance; live closeout/payroll reconciliation remains. |
| Integrations and degraded operation | 10 | 7.4 | B | False CSV success, Toast retry deadlock, delivery uncertainty, health contracts, and provider-off behavior are controlled; live Toast/provider/Sub2API evidence remains. |
| Action safety and recoverability | 10 | 9.4 | A | Major actions use review/confirm, idempotency, version fences, independent approval, audit, correction, compensating post, or exact Undo. |
| Accessibility, responsive UI, release engineering | 7 | 6.6 | A | Desktop/mobile Axe, full build, parity, fail-closed schema cutover, aliases, runtime errors, and destructive restore simulation pass; human assistive-tech and managed recovery remain. |
| **Total** | **100** | **92.0** | **A-** | **Production pilot ready; remaining deductions are explicit external acceptance gates.** |

## Remaining production gates, in order

1. **Managed recovery and platform plan:** Supabase still reports the project on the Free plan. Upgrade before business-critical service, verify the current managed backup, rehearse managed database plus private Storage recovery, approve RPO/RTO/retention, and enable leaked-password protection when the plan allows it. The repository-controlled restore drill is now passed; it does not substitute for those provider controls.
2. **Second-owner MFA:** One of two active Owners still lacks verified TOTP. Complete enrollment and prove recovery access before broad use.
3. **Physical service rehearsal:** Execute one controlled opening-to-close rehearsal on the actual phones/tablets and floor: pre-shift, Host, waitlist, seating, 86, Prep, delivery exception, blind count, closeout, correction/Undo, reconnect, and audit review. The live role matrix now covers Owner/Manager/employee access, but dedicated Chef/Host job-mode and cross-location sessions should be captured here.
4. **Provider evidence:** Send and reconcile one explicitly approved reservation email flow, then separately qualify SMS/push before enabling either flag. Rehearse real Toast import/retry against provider evidence; Toast remains the attendance authority.
5. **Sub2API handoff:** When Donald is home, enable the Mac's Local Network permission for the container runtime, restart the pinned loopback stack, personally accept the Sub2API commitment, complete OAuth, create the single-owner group/key, and run propose/confirm/execute/Undo smoke tests. Do not deploy the ChatGPT/Codex session material to Vercel or Supabase.
6. **Human accessibility and measured performance:** Perform VoiceOver plus physical iPad/phone slow-network/reconnect acceptance. Supabase now reports 487 performance notices: 374 unindexed foreign keys, 35 unused indexes, and 78 multiple permissive policies. Collect real pilot query evidence before adding/removing indexes or combining authorization policies; do not trade correctness for a lint score.
7. **Source-control closure:** The deployed Phase 2 release was built from the verified shared worktree, which already contained the implementation and other uncommitted work. Create a reviewed release commit from the intended file set before the next production change; do not bulk-stage the dirty tree without ownership review.

## Operational handoff

- Canonical Operations: https://operations.leyardny.com
- Canonical Host: https://host.leyardny.com
- Public Reserve: https://reserve.leyardny.com/reserve
- Supabase migration head: `20260821200955_cache_auth_uid_in_rls_policies.sql`
- Operations deployment: `dpl_9N4j2fCtLqFUvbCKAvLzjT3w7T73`
- Host deployment: `dpl_6ZcyJFYvEFk5QX7UtuQ8WWL4SsYj`

If either workspace health stops returning `200 ready`, stop mutations and inspect the schema contract, deployment environment, and Supabase project before retrying. Do not downgrade the contract or edit applied migrations to make the health probe pass.
