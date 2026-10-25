# Current permission matrix

Version-bound to118 migrations through `20261025085858` plus the local review patch. This documents enforcement ceilings; it is not an approved per-person staffing policy or a hosted acceptance claim. The [current implementation register](le-yard-os-expansion-status.md) supersedes older expansion checklists.

Legend: **Full** means management authority through the applicable approved commands within tenant scope; it does not permit direct table writes, self-approval or editing/deleting immutable terminal evidence; **Operate** means operational create/update but not user, role, security, or integration administration; **Self** means only the signed-in employee's records; **Assigned** means only locations in `location_memberships`; **Read** means no mutation; **None** means RLS returns no rows and rejects inserts.

Owners and admins have organization-wide access. Password-authenticated Owner sessions currently authorize administrative writes; no second factor is required by the current permanent password policy. Managers and employees receive operational capabilities from effective job-role assignments at accessible locations; an explicit user denial overrides grants. Capabilities never grant organization security administration.

| Capability | Owner | Admin | Manager | Employee |
| --- | --- | --- | --- | --- |
| Organization and settings | Full | Full | Read | Read |
| Locations | Full | Full | Assigned read | Assigned read |
| Create/invite/suspend users | Full | Full | None | None |
| Assign organization roles or locations | Full; final active Owner protected | Administer non-Owner roles; cannot promote another account to Owner | None | None |
| Configure job-role definitions | Full | Full | Read | Read |
| Configure job-role capabilities or user overrides | Full | Full | None | None |
| Employee job assignments | Full; private rate write-only | Full; private rate write-only | Assigned metadata read; no rate access | Self metadata read; no rate access |
| Employee directory/sensitive employment record | Full | Full | Operate | Self |
| Availability | Full | Full | Operate assigned | Self create/update/delete |
| Time off | Full | Full | Decide assigned for another employee | Self submit/edit/cancel pending |
| Certifications | Full | Full | Operate assigned | Self read |
| Emergency contacts | Full | Full | Operate assigned | Self create/update/read |
| Employee documents | Full | Full | Upload and edit metadata assigned | Read only when employee-visible |
| Schedule templates and schedule publishing | Full | Full | Assigned effective `schedule.manage` / `schedule.publish` | Explicit assigned capability where approved; otherwise published read |
| Shift acknowledgement | Full | Full | Read assigned | Self create/delete |
| Shift swaps and open shifts | Full | Full | Reopen/decide with assigned effective `schedule.manage`; self requests/offers/claims | Self request/offer/qualified claim; reopen/decide only with explicit assigned `schedule.manage` |
| All-staff and location chat | Full | Full | Assigned | Assigned |
| Management chat | Full | Full | Assigned | None |
| Private channels | Member/admin | Member/admin | Member/admin | Member |
| Create/archive channels and set private members | Full | Full | Operate assigned | None |
| Announcements | Full | Full | Create assigned | Read/acknowledge |
| Own messages, reactions, read receipts | Full | Full | Self | Self |
| Vendor contacts, prices, and purchasing context | Full | Full | Operate assigned | Read assigned |
| Closeouts and cash reconciliation | Full | Full | Assigned effective closeout/cash capabilities and independent approval rules | None |
| Author tip policies and versions | Full | Full | Read approved policy | None |
| Tip calculation and approval | Full | Full | Operate assigned | Self final allocation read |
| Payroll export | Full | Full | None | None |
| Receipts, invoices, OCR review, expenses | Full | Full | Operate assigned | None |
| Configure units and category hierarchy | Full | Full | Assigned `inventory.unit.manage` / `inventory.category.manage` | Assigned capability where operationally approved |
| Configure unit conversions | Full | Full | None | None |
| Configure items, vendors, packs/prices, pars, and recipes | Full | Full | Assigned capability at location | Assigned capability where workflow supports employee operation |
| Internal running-low / 86 events | Full | Full | Assigned `service.availability.manage` | Read assigned; write only with explicit capability |
| Manager Log | Full | Full | Assigned `manager_log.manage` | None |
| Pre-shift | Full | Full | Draft/publish with `preshift.manage` | Read published and acknowledge self |
| Configure receipt expense categories | Full | Full | Read/use | None |
| PO, delivery, counts, waste, COGS | Full | Full | Operate assigned | None |
| Inventory transfers | Full | Full | Both locations must be assigned | None |
| Guest CRM, visits, reservations, consent | Full | Full | Assigned effective guest/reservation capability and command-specific authorization | Only explicitly supported scoped capability paths; no blanket CRM access |
| Guest/data export | Full | Full | Report-only, no raw export administration | None |
| Tasks | Full | Full | Operate assigned | Read assigned; update own assignment |
| Checklists | Full | Full | Operate assigned | Run/respond when assigned |
| Published SOPs | Full | Full | Operate | Read/acknowledge assigned |
| Maintenance requests | Full | Full | Operate assigned | Read/create assigned |
| Incident records | Full | Full | Operate assigned | Create/read own report |
| Reports and report exports | Full | Full | Operate | None |
| Square/reservation/CSV connections and sync history | Configure/import/retry and scoped history | Same command ceiling | Scoped read only where RLS permits; no configuration/import/retry | None |
| Integration credential ciphertext | Server only | Server only | None | None |
| AI runs, citations, and action proposals | Full | Full | Operate | None |
| Apply AI-proposed protected action | Human approval + normal permission | Human approval + normal permission | Human approval + assigned permission | None |
| Notifications/preferences | Self plus tenant notifications | Self plus tenant notifications | Self plus tenant notifications | Self |
| Audit events | Full read | Full read | None | None |
| Retention policy and backup evidence | Full | Full | None | None |

The table combines organization-role ceilings and operational capabilities. A Manager title alone does not enable every module or financial/guest action. User denials override ordinary capability grants, and effective date/location rules still apply. Current server commands and RLS decide each operation. Time Clock currently exposes retained history and pending source setup; coarse legacy `timeclock.clock_self` names do not create a runnable punch UI or a selected external timekeeper.

## Permission invariants

1. No active organization membership means no tenant data access.
2. `owner` and `admin` can read every location in their organization without explicit location memberships.
3. `manager` and `employee` require an explicit location membership for location-owned records.
4. Only `owner` and `admin` can create invitations, suspend accounts, or change roles/location memberships.
5. The final active Owner cannot be demoted, suspended, or removed.
6. Current Owner/Admin administration uses password-authenticated identity and current database membership. `requiresOwnerMfaGate()` is false; migration `20260907141430_permanent_password_auth.sql` supersedes old AAL2-era bodies. A historical function name never substitutes for inspecting its final body and grants.
7. Employees cannot approve their own time corrections, tip runs, closeouts, inventory changes, or AI proposals.
8. Managers cannot access an unassigned location, including its schedules, punches, closeouts, receipts, inventory, incidents, or report files.
9. A locked tip run and its inputs cannot change. Inventory/consent/integration ledgers use compensating or new records instead of edits.
10. AI records never bypass operational permissions; protected outputs remain proposals until an authenticated human decides and applies them.
11. `anon` has no public-table privileges. `authenticated` privileges are always filtered by RLS.
12. The service role bypasses RLS and therefore belongs only in trusted server functions and controlled administration tooling.
13. Time-off decisions are independent: the subject employee cannot decide their own request, denials require a note, and the database derives the deciding actor.
14. Employee-document object scope, uploader, MIME type, and size cannot be reassigned through metadata controls; employees receive only short-lived downloads for records released to them.
15. Authenticated sessions cannot finalize employee documents directly. The user-scoped server workflow verifies downloaded bytes first, then a service-role-only command restores the human actor and reruns full tenant, location, and employee authorization.
16. Job-role and employee-assignment writes are Owner/Admin command-only. Authenticated reads omit hourly rates for every application role, including Owner and Admin; updates can preserve a stored rate without reading it.
17. Unit conversions, expense categories, tip policies, and retention remain Owner/Admin command-only. Capability-authorized operational users may configure units, categories, items, vendors, vendor packs/prices, location pars, and recipes through narrow actor-derived commands; this does not confer user, credential, security, cash, payroll, or owner-level settings access.
18. Tip-policy drafts require approval by a different authorized person. Retention requires an explicit timed window or an explicit no-auto-delete decision; neither is inferred from demo data.
19. Checklist photo metadata can be bound only after the server downloads and verifies private image bytes. Authenticated browser calls cannot bind a claimed path directly.

## Storage access

| Bucket | Read | Write |
| --- | --- | --- |
| `profile-avatars` | Active tenant members | The profile owner only |
| `employee-documents` | Subject employee when marked visible; management | Management |
| `chat-attachments` | Users allowed into the related channel | Active users at the path's tenant/location; DB attachment ownership is also checked |
| `sops` | Active users at the path's tenant/location | Management |
| `receipts`, `closeouts`, `inventory`, `incidents`, `reports`, `imports`, `checklists` | Management at the tenant/location | Management at the tenant/location |

Every bucket is private. Access is through a user JWT or a short-lived signed URL and follows the `{organization_uuid}/{location_uuid|global}/...` path convention.

## Verification source

The foundation policies begin in `supabase/migrations/202608010005_rls_and_storage.sql`; capability policies and commands are added by `supabase/migrations/20260808135755_capability_authorization_foundation.sql`. Catalog and behavioral proof lives in `tests/rls/` and the focused portable capability verifier. The final current native evidence has418 assertions across15 required files, including actual RLS/ACL and Owner password-session cases; actual Auth/browser tests remain separate. Repeat only against an isolated loopback PostgreSQL17 control database:

```sh
RLS_TEST_DATABASE_URL=postgres://ISOLATED_LOCAL_CREDENTIALS@127.0.0.1:PORT/postgres npm run test:rls
npm run test:capabilities:pglite
npm run test:function-grants:pglite
npm run test:service-control:pglite
```

The native runner creates/drops its own temporary database. Do not reset a retained sandbox or use hosted credentials for this check. No actual GitHub execution, hosted creator-default acceptance, physical shared-device acceptance or approval of staff assignments is implied. Future protected-role default privileges remain a separate open gate even when current table/sequence checks pass.

Scheduling commands recheck current schedule.manage before fresh or saved reopen/decision results and after an assignment-lock wait. Native25 new cases and18 actual-Auth/Data API checks prove grant/denial and same-token changes;24 concurrency checks cover permission/qualification races. Publication holds and revalidates role, employee and location/date assignment records. Historical published results are not rewritten when later qualifications change; staffed handoff and automatic exception handling still need operating acceptance.

At117 the receiving wrapper validates original proposed quantity before zeroing exception posting, and an independent approval refuses invalid retained pending evidence. This does not broaden receiving/approval capabilities, permit same-person approval, rewrite stock history or establish a vendor credit. Native25 receiving cases and27 actual-Auth/Data API checks verify these boundaries.

## Prep118 boundary and acceptance

Published formulas capture normalized ingredients, yield/conversion factors and a verifiable recipe version. Legacy active tasks require explicit `prep.manage` adoption; completed history is not backfilled. `prep.complete` permits assigned start/completion, while correction requires `prep.manage`; current scope and original-actor receipts remain enforced. A private ledger revision rejects conflicting stale-snapshot postings. Native418, concurrency26/10 phases, actual-Auth/API25 and Owner/staff browser15 pass locally. The measured-yield field requires explicit entry; posted/corrected actual yield and restaurant-local dated deadlines remain visible. Full1488 units, build/types/type/lint pass after browser corrections; the20-verifier SQL chain is bound by an exact two-file source bridge.15 production decisions remain pending; demand, non-stock work, physical lots/labels/SOP/expiry/allergy/release and staffed acceptance remain open. No hosted deployment or physical prep is claimed.
