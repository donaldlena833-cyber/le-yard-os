# Permission matrix

Legend: **Full** means create/read/update/delete within the allowed tenant scope; **Operate** means operational create/update but not user, role, security, or integration administration; **Self** means only the signed-in employee's records; **Assigned** means only locations in `location_memberships`; **Read** means no mutation; **None** means RLS returns no rows and rejects inserts.

Owners and admins have organization-wide access. Owner administrative writes additionally require an AAL2 JWT. Managers are organization members but operational access is limited to assigned locations except for deliberately unified management catalogs and CRM records.

| Capability | Owner | Admin | Manager | Employee |
| --- | --- | --- | --- | --- |
| Organization and settings | Full (AAL2 writes) | Full | Read | Read |
| Locations | Full | Full | Assigned read | Assigned read |
| Create/invite/suspend users | Full (AAL2) | Full | None | None |
| Assign organization roles or locations | Full (AAL2) | Full | None | None |
| Configure job-role definitions | Full (AAL2) | Full | Read | Read |
| Employee job assignments | Full (AAL2); private rate write-only | Full; private rate write-only | Assigned metadata read; no rate access | Self metadata read; no rate access |
| Employee directory/sensitive employment record | Full | Full | Operate | Self |
| Availability | Full | Full | Operate assigned | Self create/update/delete |
| Time off | Full | Full | Decide assigned for another employee | Self submit/edit/cancel pending |
| Certifications | Full | Full | Operate assigned | Self read |
| Emergency contacts | Full | Full | Operate assigned | Self create/update/read |
| Employee documents | Full | Full | Upload and edit metadata assigned | Read only when employee-visible |
| Schedule templates and schedule publishing | Full | Full | Operate assigned | Read assigned |
| Shift acknowledgement | Full | Full | Read assigned | Self create/delete |
| Shift swaps and open shifts | Full | Full | Approve assigned | Request/offer assigned |
| All-staff and location chat | Full | Full | Assigned | Assigned |
| Management chat | Full | Full | Assigned | None |
| Private channels | Member/admin | Member/admin | Member/admin | Member |
| Create/archive channels and set private members | Full (AAL2) | Full | Operate assigned | None |
| Announcements | Full | Full | Create assigned | Read/acknowledge |
| Own messages, reactions, read receipts | Full | Full | Self | Self |
| Clock in/out and breaks | Full | Full | Operate assigned | Self at assigned location |
| Punch correction request | Full | Full | Review/apply assigned | Self request/cancel pending |
| Closeouts and cash reconciliation | Full | Full | Operate assigned | None |
| Author tip policies and versions | Full (AAL2) | Full | Read approved policy | None |
| Tip calculation and approval | Full | Full | Operate assigned | Self final allocation read |
| Payroll export | Full | Full | None | None |
| Receipts, invoices, OCR review, expenses | Full | Full | Operate assigned | None |
| Configure vendors, units, items, recipes, prices, and pars | Full (AAL2) | Full | Read/use | None |
| Configure receipt expense categories | Full (AAL2) | Full | Read/use | None |
| PO, delivery, counts, waste, COGS | Full | Full | Operate assigned | None |
| Inventory transfers | Full | Full | Both locations must be assigned | None |
| Guest CRM, visits, reservations, consent | Full | Full | Operate | None |
| Guest/data export | Full | Full | Report-only, no raw export administration | None |
| Tasks | Full | Full | Operate assigned | Read assigned; update own assignment |
| Checklists | Full | Full | Operate assigned | Run/respond when assigned |
| Published SOPs | Full | Full | Operate | Read/acknowledge assigned |
| Maintenance requests | Full | Full | Operate assigned | Read/create assigned |
| Incident records | Full | Full | Operate assigned | Create/read own report |
| Reports and report exports | Full | Full | Operate | None |
| Toast/Resy/CSV connections and sync history | Full | Full | None | None |
| Integration credential ciphertext | Server only | Server only | None | None |
| AI runs, citations, and action proposals | Full | Full | Operate | None |
| Apply AI-proposed protected action | Human approval + normal permission | Human approval + normal permission | Human approval + assigned permission | None |
| Notifications/preferences | Self plus tenant notifications | Self plus tenant notifications | Self plus tenant notifications | Self |
| Audit events | Full read (AAL2 helper) | Full read | None | None |
| Retention policy and backup evidence | Full (AAL2 writes) | Full | None | None |

## Permission invariants

1. No active organization membership means no tenant data access.
2. `owner` and `admin` can read every location in their organization without explicit location memberships.
3. `manager` and `employee` require an explicit location membership for location-owned records.
4. Only `owner` and `admin` can create invitations, suspend accounts, or change roles/location memberships.
5. The final active Owner cannot be demoted, suspended, or removed.
6. Owner administrative writes require `auth.jwt()->>'aal' = 'aal2'`.
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
17. Inventory catalog, expense-category, tip-policy, and retention writes are Owner/Admin command-only and seed no operating values. Managers may use approved catalog and policy records but cannot define them.
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

The authoritative policies are in `supabase/migrations/202608010005_rls_and_storage.sql`. Catalog and behavioral proof lives in `tests/rls/`. Run:

```bash
npx supabase db reset
npx supabase test db tests/rls --local
```
