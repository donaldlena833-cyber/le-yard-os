# Owner runbook

This runbook is for Donald and Maris as Owner accounts. It distinguishes normal restaurant operation from changes that need a deliberate policy, security, or production decision.

## Public Vercel Production playground

The approved playground is for product familiarization, usability testing, and deciding what to improve. "Production" refers only to Vercel's stable hosting channel. The app is still a synthetic, resettable playground, not the live back office.

- Create or use only a new Le Yard OS Vercel project rooted at this directory. Do not link, deploy over, or change the existing public restaurant website.
- In Vercel Production scope, use `NEXT_PUBLIC_DEMO_MODE=true` and the exact `LE_YARD_PLAYGROUND_MODE=production-playground`. Vercel must supply `VERCEL_ENV=production`; never set that platform variable yourself.
- The canonical Vercel Production URL is public and must be treated as discoverable. The application-level two-Owner login remains mandatory, and unauthenticated workspace/API requests must fail closed.
- Store exactly two temporary Owner principals as usernames plus salted scrypt password hashes. Never store plaintext passwords in source control, local environment files, Vercel variables, commands, logs, tickets, or messages.
- Keep a newly generated signing secret and the hashed registry in Vercel's sensitive Production environment scope. The resulting signed, `HttpOnly`, `Secure`, `SameSite=Lax` session expires after eight hours.
- Treat these as custom playground identities, not Supabase Auth accounts. They do not prove MFA, production invitation delivery, tenant RLS, or shared data persistence.
- Treat every operational record as mock data. Changes reset and are not reliably shared between owners; do not enter employee, guest, payroll, receipt, vendor, or other confidential restaurant data.
- Do not rely on the URL being unadvertised, robots directives, or the per-instance login throttle as the only security boundary. Keep use limited to the two owners; broader testing requires Vercel Deployment Protection or an approved durable rate-limiting service first.
- The address `858 9th Ave, New York, NY 10019` is owner-supplied. Its presence does not convert surrounding synthetic data into production records.
- Leave Supabase, SMTP, monitoring, push, Toast, Resy, OpenAI, external AI, and OCR provider configuration out of this playground.
- When testing ends, remove the Production playground values, rotate the session-signing secret, and delete, disable, or protect the public playground deployment.

The Supabase account currently has two active projects, which is the free-project limit. Neither unrelated project may be paused, modified, or reused without separate explicit approval. The temporary identities therefore remain non-Supabase accounts until isolated project capacity is available.

## Draft assumptions to review

The interface may display these owner-supplied assumptions for feedback, but they are unpublished and do not calculate or certify compliance or payroll:

- a shift longer than six hours receives a 30-minute unpaid break; exact meal-period timing and any additional rules still need review
- overtime is displayed at 1.5 times the regular rate subject to applicable law; workweek, eligibility/exemptions, and regular-rate inputs still need definition
- there is no automatic gratuity; customers choose voluntary tips
- an event fee is 10% and remains separate from tips; its tax, accounting, disclosure, and wage treatment still need review
- payroll export format, destination, pay-period mapping, and approval sequence are undecided

Do not approve or publish these settings until both owners and the appropriate payroll/legal advisors have resolved the missing definitions. Do not treat a break before or after a shift as compliant meal timing merely because it appears in mock content.

### What retention means

Retention is the rule for how long each kind of record is kept before archival or deletion: receipts, employee documents, guest/consent data, audit history, exports, and backups may need different periods. Retention is currently unset. That means Le Yard OS performs no policy-driven automatic deletion; it does not mean every platform copy is guaranteed to exist forever, nor does it establish the correct legal period. A future decision must name the record class, duration, deletion/archival action, backup handling, legal holds, and approving owner.

## Production launch gate

Do not bootstrap the live tenant until both owners approve all items below:

- [ ] Donald's verified work email
- [ ] Maris's verified work email
- [ ] organization and restaurant names
- [ ] confirm the owner-supplied Ninth Avenue address plus every location phone, timezone, service period, and any additional location
- [ ] logo/brand assets and approved product name
- [ ] job codes and role assignments
- [ ] labor, paid/unpaid break, overtime, missed-punch, and schedule rules
- [ ] tip eligibility, sources, service-charge treatment, weights, exclusions, adjustments, and approval rules
- [ ] payroll export format and receiving provider
- [ ] receipt, employee-document, guest, audit, and backup retention policy
- [ ] isolated Supabase project capacity and production Vercel access plus separate explicit live-back-office deployment approval
- [ ] SMTP, push, Toast, Resy, and payroll/accounting credentials that are actually approved

The application must not infer these inputs from demo content or from the temporary playground identities.

## Initial owner bootstrap

1. Apply reviewed migrations to an empty production Supabase application database.
2. Confirm open signup is disabled, SMTP works, and callback URLs point to the production HTTPS origin.
3. Copy `docs/owner-bootstrap.example.json` to an access-controlled, untracked path and replace every placeholder with the signed-off organization and location details.
4. Set `OWNER_DONALD_EMAIL` and `OWNER_MARIS_EMAIL` to the two verified work emails. Set connected Supabase/Vercel environment values, but do not set the confirmation yet.
5. Run `npm run bootstrap:owners -- --config /absolute/path/to/approved-bootstrap.json`. This is a dry run: it validates the complete plan, derives stable identifiers, makes no network calls, and prints a plan-bound confirmation.
6. Both owners review the exact organization, locations, emails, timezones, currency, and generated identifiers. Set `LE_YARD_BOOTSTRAP_CONFIRM` to the emitted value only after approval.
7. Run the same command with `--execute`. It refuses demo/local origins, verifies an empty application database, sends two Supabase Auth invitations, and atomically creates the tenant plus two pending Owner memberships through a service-only database function. It never creates or prints a password.
8. Unset `LE_YARD_BOOTSTRAP_CONFIRM`. Each owner opens their own one-time link, sets their own password, and enrolls and verifies an authenticator factor.
9. Confirm both active Owner memberships and AAL2 administrative access. Verify neither account can view the other's password or authenticator secret.
10. Configure approved job codes and operating policies only from the signed-off launch sheet.
11. Invite a non-owner test user, verify role/location isolation, then suspend the test account.

If execution stops after an Auth invitation is sent, rerun the identical approved plan. The deterministic request/tenant identifiers allow a safe resume only when the existing Auth metadata matches exactly. A mismatch or cleanup warning requires manual review in Supabase before any retry; never delete an unrelated Auth identity to force bootstrap through.

Never create a shared owner login. Never send a temporary password over chat or email. Never remove the final active Owner.

## Daily operating rhythm

The routines below describe a future connected workspace. In the temporary playground they are test scenarios only; entries do not persist or become shared restaurant records.

### Before service

1. Open Today and review open shifts, staffing warnings, tasks, inventory alerts, and pending approvals.
2. Confirm the published schedule and resolve open-shift or swap requests.
3. Review current vendor prices and open purchase orders before approving the kitchen plan.
4. Review urgent maintenance/incidents and assign a responsible person.
5. Confirm low-stock decisions against the current count and order status.

### During service

1. Keep schedule break timing visible for every shift longer than six hours; managers approve whether the 30-minute unpaid break sits during, before, or after the shift.
2. Use location chat for operational handoffs; use management channels for sensitive discussion.
3. Record waste, deliveries, tasks, incidents, and maintenance events when they occur.
4. Do not edit a completed financial or inventory ledger record to hide a mistake; use the documented correction/compensating flow.

### End of shift

1. Complete covers, sales, comps, voids, expected cash, actual cash, notes, and attachments.
2. Resolve the cash variance; the system calculates cents but does not explain an undocumented discrepancy.
3. Submit the closeout for a separate authorized review when the operating policy requires it.
4. Calculate tips from the approved policy version and inspect the explanation, sources, exclusions, adjustments, and cent reconciliation.
5. Approve and lock only when every source and participant is correct. A locked tip run is immutable.
6. Export payroll-support CSV only after punch corrections, closeout, and tips are approved.

## Weekly review

- Compare published versus worked labor and resolve pending attendance corrections.
- Review overtime and schedule warnings against the owners' approved labor rules.
- Review tip exports and approval history before payroll handoff.
- Inspect inventory variance, waste, COGS, recipe cost, and vendor price movement.
- Review receipts/OCR exceptions and duplicates.
- Review guest consent, duplicates, allergies, and high-value notes with least-privilege access.
- Review open incidents, maintenance requests, overdue tasks, and SOP acknowledgements.
- Review integration failures and rejected CSV rows without exposing credentials.
- Review the immutable audit trail for security-sensitive or unexpected changes.

## User lifecycle

### Invite

Only Owners or Admins may invite. Confirm the email, role, and location scope before sending. Admins may not assign the Owner role unless the database policy explicitly permits it; the intended interface reserves Owner assignment to an existing Owner.

### Change role or location

Use least privilege. Managers and Employees should have explicit location memberships. Confirm the audit event immediately after a sensitive change.

### Suspend

Suspend rather than delete when an employment or access relationship ends. This preserves schedules, time records, closeouts, messages, and the audit chain. Rotate any shared operational credential the person could access.

## AI and automation review

Ask Le Yard may summarize or propose; it may not finalize payroll, tips, punch edits, inventory adjustments, or guest changes. Before approving a proposal:

1. read every cited record
2. check confidence and freshness
3. identify missing live integrations or incomplete input
4. confirm the normal role permission and location scope
5. approve through the underlying workflow, not from unverified text

If a result has no identifiable citations, treat it as invalid.

## Incident response

For suspected unauthorized access or data exposure:

1. suspend the affected user and revoke active sessions
2. rotate exposed Supabase, integration, email, or push credentials
3. preserve audit and application-error records
4. record an incident without placing raw secrets in notes
5. determine affected tenant, locations, records, and time window
6. notify the owners and required vendors/advisors under the approved incident policy
7. restore only through the tested backup procedure when integrity is affected

## Production change discipline

- Use a preview environment for every release.
- Review forward-only migrations; never edit an already-applied production migration.
- Run `npm run verify:full`, then the native Supabase RLS and database-lint checks against the release candidate.
- Take or confirm a recoverable backup before a high-risk migration.
- Keep a rollback or forward-fix decision documented.
- Record the release and restore evidence in the operational log.
