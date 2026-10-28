# Catering inquiry register

October 26, 2026. Initial owner: Donald, then delegate (confirmed October 24).
This draft adds an owner-only `/catering-inquiries` workspace on the Operations
surface. It is not a production release or direct-intake activation.

## Owner workflow

1. Open Catering inquiries in Operations. Choose both audiences, corporate, or
   offsite private-party; both audience types have identical access and detail.
2. Read the full brief, including preferred date/time, requested guests/format,
   offsite location, dietary requests, budget and source. A missing field means
   not supplied, rather than an operating commitment.
3. Donald checks `office@leyardny.com` separately. This register contains only
   receiver-stored requests and does not import mail, send notifications, or
   establish inbox delivery. Keep receipt IDs with the internal follow-up.
4. Check actual kitchen feasibility before drafting a reply. Formats, guest-count
   limits, prices, coverage and earliest catering date remain unconfirmed.
5. Do not label a record quoted, won, ordered or fulfilled based on its receipt.
   This read-only version has no follow-up/disposition writes. A response-time
   promise, delegated staff permissions, retention/deletion and subsequent
   quote/order/fulfillment tracking still need implementation/operating decisions.

## Access and failure behavior

The route is owner-only and appears only in Operations, not Host or Phone.
Anonymous sessions use the existing sign-in boundary. The read model uses the
session-bound public Supabase client, never a service key, with organization and
active-location filters. The existing owner RLS policy remains authoritative;
admins, managers, employees, suspended and cross-organization users cannot read
these rows. Query fields are bounded; pages return at most 20 requests plus one
lookahead, ordered by stored time and ID. A filter resets to page one.

A schema/query/decoding failure shows unavailable. An empty page says precisely
that it covers stored requests for the selected location/filter, not email
inquiries or all business outcomes. No global inquiry/revenue counter is inferred.
No browser storage, export, new API, mutation action or payload logging is added.
Private client IDs, hashes and request keys are not selected or rendered.
The service worker continues network-only navigation with a public offline page.

Demo mode uses two visibly labeled fictitious samples with example.com contacts.
These fixtures never stand in for connected records or customer results. Connected
mode never falls back to them. The page is dynamic and marked noindex/nofollow.

## Rehearsal and release checklist

- Apply the complete coordinated migration chain and matching app to an isolated
  nonproduction environment. The branch now includes current main through
  `8cafd31`; expected head is `20261026101813`. The dormant catering migration
  was moved forward to `20261026101813` before any production application.
  October 26 read-only provider checks confirm no catering table/migration and
  a hosted expected head of `20261025085858`; no production schema was changed. This is not an instruction
  to update production or accept partial schema compatibility.
- With synthetic data only, prove actual hosted relay → committed receipt →
  PostgREST read → authorized owner detail. Verify another owner organization,
  non-owner and suspended user see no data; switch locations and confirm scope.
- Distinguish local SQL checks, local demo rendering, normal Vercel preview READY,
  hosted migrated behavior and production outcomes in the release record.
- Keep both receiver and website direct-intake flags off until handling/retention,
  coordinated release and the hosted owner handoff are ready. The public website
  continues its existing review/copy/email path.
- Do not merge while required CI checks fail or assert deployment from a Git push.
  Rollback must coordinate app/schema; preserve any accepted inquiry records.
