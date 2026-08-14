# Reservation platform

## Current status

The reservation system is a connected-preview implementation. **Public booking is disabled.** The first-party OS is the intended future writer, but it is not the live source of truth until a one-writer decision, shadow reconciliation, production-like acceptance, and explicit activation approval are complete.

The reviewed reservation and operating-day migration chain through `20260811074315_production_schema_compatibility.sql` has reached the shared Supabase project. All subsequent database work is forward-only. The local `20260811080634_reservation_message_recipient_and_version_fences.sql` closeout passed the full migrated-schema two-connection suite on a disposable PostgreSQL 17.10 cluster; it remains intentionally unshipped until connected Supabase acceptance is complete.

There are no deposits, card holds, or payment flows.

## Safety model

| Boundary                                                 | Current contract                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.public_booking_holds`                           | Short-lived contact custody used while the one-step booking transaction binds delivery evidence. The transaction redacts names, contacts, and requests before commit; legacy pending holds still expire or confirm through their original flow. |
| `private.public_booking_verifications`                   | Tenant/location/hold/channel-bound destination evidence. New bookings record `booking_submission`; already-issued links retain `link` evidence and their legacy confirmation flow.                                |
| `public.reservations`                                    | Confirmed staff or guest commitments only, with a version counter and append-only operational events.                                                                                                             |
| `public.reservation_revisions`                           | Immutable staff edit/cancel evidence bound to the exact reservation, location, actor, request scope, payload hash, version, policy, and allocation result.                                                        |
| `public.reservation_table_allocations`                   | Active holds, assignments, and blocks. A PostgreSQL GiST exclusion constraint rejects overlapping active intervals for a table.                                                                                   |
| `private.public_booking_requests`                        | Scoped request ID, payload hash, completion state, and deterministic replay evidence for public commands.                                                                                                         |
| `private.public_booking_management_exchanges` and tokens | One-time, browser-bound exchange evidence and hashed management sessions. Raw session material is returned only to the public-site BFF.                                                                           |
| `public.reservation_message_outbox`                      | Tenant/location-scoped transactional work with dedupe keys, bounded attempts, claim tokens, leases, and stale-worker recovery.                                                                                    |
| `public.waitlist_entries`                                | Explicit waiting, offered, accepted, seated, expired, and cancelled lifecycle. Expiry is atomic with queued-message cancellation.                                                                                 |
| `public.service_shifts`                                  | Materialized operating-day instances with exact timezone-aware boundaries, party limits, turn duration, pacing, buffers, online state, and source-configuration evidence.                                         |
| `public.service_shift_exceptions`                        | Explicit closure, pacing-override, or buffer-override evidence with reason, actor, request replay, revocation, audit, and overlap protection.                                                                     |

The private hold remains the contact-custody boundary. A new one-step booking uses the submitted email as the confirmation and management-delivery destination, reuses an existing matching guest without changing that profile, or creates a new guest without merging unrelated contact data. The same transaction creates the reservation, records submission-bound delivery evidence, redacts the temporary hold, and queues email. Legacy confirmation links continue to prove their original channel and erase provisional names, contacts, and requests. Production privacy, consent, backup-retention, and deletion acceptance remain release gates.

Staff edits and cancellations use expected-version commands. Exact retries return the immutable original result even after later changes; stale new requests fail without overwriting the current commitment. Edits revalidate the materialized service shift, closure, buffers, party bounds, turn policy, pacing, and table intervals under the canonical location inventory lock. Cancellation releases interval inventory, revokes public management tokens, invalidates stale message work, and never fabricates a physical floor-availability event. Browser DTOs receive only bounded revision metadata; reason, actor, payload hash, and full policy/allocation evidence remain service-only.

For a web reservation, staff modify/cancel messages are queued only when the current CRM destination still matches the exact salted destination claim captured from the booking submission or legacy confirmation link. Claims require current, approved reservation settings, `guest_messaging_enabled`, and exact membership of the claimed channel in `verification_channels`; the worker repeats those checks immediately before each provider call. Disabling, de-approving, deleting, or removing a channel atomically cancels queued, failed, and leased work for that scope, clears claims, and records bounded cancellation evidence. Re-enabling delivery permits only new work and never revives a cancelled row. Non-web, missing, changed, or unapproved destinations remain a manual-contact workflow. A provider request already accepted after the final validation cannot be recalled and remains an explicit release/operations gate.

The operating-date implementation now materializes dated `service_shifts` from approved recurring periods with exact timezone-aware start/end instants. It resolves an active materialized shift first, then the latest published schedule's active shift, then a calendar fallback. Closures, pacing overrides, and opening/closing buffer overrides are explicit, revocable lifecycle records rather than inferred UI state.

## Public guest flow

1. The public website BFF calls scoped availability. The OS reads canonical reservation-and-unexpired-hold pacing, applies approved service periods and table inventory, and returns short-lived client-bound slot tokens.
2. A same-origin browser POST sends the chosen slot token and guest form fields to the BFF. The BFF keeps the location-scoped booking API key server-only and signs a first-party abuse identity.
3. The OS verifies the slot before claiming the contact limiter. The database then locks the location/business date, expires stale holds, rechecks approved settings and email delivery, asserts pacing and table overlap, and creates the confirmed reservation plus assignment in one transaction.
4. That transaction binds the submitted email to the reservation's delivery evidence, redacts temporary contact custody, and queues a clean confirmation email. No guest confirmation step or SMS verification message is created.
5. The browser receives only `{reservationId, status, deliveryState}`. It never receives a confirmation number, public code, management token, API key, or bearer capability.
6. The confirmation email contains a signed management-exchange link. Link entry is inert until the guest presses **Open my reservation**. A separate HttpOnly exchange-client nonce binds the first successful exchange to that browser while allowing an exact same-browser retry after response loss.
7. The BFF converts the returned raw management capability into an `HttpOnly` cookie. Browser `GET`, `PATCH`, and `DELETE` requests never contain a bearer token in state, storage, URL, body, or JavaScript-authored capability header. Successful managed reads refresh that cookie from the database-authoritative expiry, including after a staff reschedule.

Already-issued verification links remain supported by `/api/v1/reservations/confirm` so an in-flight legacy hold can complete safely. New booking requests never enter that flow.

Create, confirm, exchange, modify, and cancel fail closed on malformed JSON, oversized UTF-8 bodies, invalid dates, wrong tenant/location/purpose/channel, replay conflicts, unavailable rate-limit storage, or missing delivery prerequisites. Expected failures are generic, `no-store`, and do not disclose whether unrelated guest or reservation records exist.

## API boundary

The OS API is server-to-server. A raw location-scoped client key is generated once and stored only in the public website runtime.

| Method   | OS endpoint                                        | Contract                                                                      |
| -------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET`    | `/api/v1/availability?date=YYYY-MM-DD&partySize=N` | Approved bookable slots with signed slot tokens.                              |
| `POST`   | `/api/v1/reservations`                             | Atomically creates a confirmed reservation and queues its email.              |
| `POST`   | `/api/v1/reservations/confirm`                     | Legacy only: consumes an already-issued signed verification capability.       |
| `POST`   | `/api/v1/reservations/manage/exchange`             | Exchanges a signed link once into a browser-bound management session.         |
| `GET`    | `/api/v1/reservations`                             | Minimal managed-reservation DTO using the BFF-held capability.                |
| `PATCH`  | `/api/v1/reservations`                             | Idempotent move/resize using a fresh signed slot.                             |
| `DELETE` | `/api/v1/reservations`                             | Idempotent cancellation and allocation release.                               |

Create, modify, and cancel require a UUID `Idempotency-Key`. Exact retries must reuse the same key and payload. Legacy confirmation and management exchange use signed-capability fingerprints plus scoped replay evidence.

Create a client only after an isolated connected environment exists. The helper is a dry run unless `--apply` is supplied:

```sh
npm run booking:create-client -- --location-id=<location-uuid> --origin=https://www.leyardnyc.com --name="Le Yard website"
npm run booking:create-client -- --location-id=<location-uuid> --origin=https://www.leyardnyc.com --name="Le Yard website" --apply
```

The public website runtime receives `LE_YARD_BOOKING_API_URL` and the one-time `LE_YARD_BOOKING_API_KEY`. Neither value belongs in this OS runtime or in a `NEXT_PUBLIC_` variable.

New public availability and reservation creation additionally require the OS server variable `RESERVATION_PUBLIC_BOOKING_ENABLED=true`. It defaults fail-closed and remains false until the full release gates pass. A valid existing HttpOnly management session may still request replacement slots while the gate is off; legacy confirmation, management reads, modifications, and cancellations remain available for recovery.

## Staff authorization and guest minimization

RLS is authoritative. Reservation reads and commands use exact effective capability, organization, and location checks; a Manager role alone is not a reservation grant.

- `reservations.view` can read the day book and the narrow guest summary RPC.
- `reservations.operate` can run normal host/service commands.
- `reservations.override` can run separately audited overrides.
- `reservations.configure` can change approved service, floor, pacing, and channel configuration.
- `guest.manage` is required for contact fields and contact/consent/profile commands. Because profile fields are shared state, a non-Owner update must cover every location currently linked to that profile.
- `guest.sensitive_notes.view` is required for allergy, preference, note, visit, or spend context. It never grants contact search or contact mutation by itself.
- Appending hospitality notes requires both capabilities. Sensitive profile changes require sensitive access at every linked location; a partial-scope attempt fails instead of reporting a false success. Guest merges require management authority at every location linked to either profile unless the actor is an Owner/Admin.

The Host day book comes from a bounded fixed-column RPC; browser roles cannot select provider payloads, external identifiers, or public-management identifiers from the raw reservation table. The Host read model receives only display name, VIP flag, and visit count unless a separate guest capability is effective. Contact and sensitive context use independently authorized fixed DTOs: sensitive-only search cannot infer email, phone, birthday, or provider references, and contact-only reads do not serialize visit/spend evidence. Raw CRM rows require an exact authorized `guest_locations` link (Owners/Admins retain explicit tenant-wide semantics), and raw provider custody remains service-only. Legacy composite-return CRM commands are revoked from browser roles; fixed-result replacements validate exact tenant/location/link scope inside each transaction.

Unlinked legacy guest identities intentionally fail closed to location-scoped CRM users. They remain Owner/Admin-only until a trusted workflow creates the correct `guest_locations` evidence; no speculative backfill or automatic cross-location link is included.

Public confirmation, staff reservation creation, waitlist entry, CRM profile changes, and profile merges share one normalized email/phone lock protocol. Identity lookup is exact-location only, ambiguous matches fail closed, row-wait results are rechecked, and a merge validates the resulting contact across the complete union of affected locations before moving evidence. Browser-visible reservation creation owns a separate immutable request claim from its inner reservation command, so an exact response-loss retry remains valid after a later profile merge while any changed payload or cross-command UUID reuse is rejected.

## Expiry, pacing, and concurrency

Every inventory mutation follows one canonical order: acquire the transaction-wide location inventory lock, record the affected operating dates, expire relevant overdue holds (including exact overlapping stale allocations), lock configuration/command rows, perform a fresh pacing and inventory check, then mutate. Availability independently excludes expired holds at read time.

Active service periods are concurrency-protected from recurring wall-clock overlap, including overnight carryover and intersecting effective dates. Approved periods materialize into dated service shifts under the same location configuration lock. Ambiguous or nonexistent DST wall times fail closed in both TypeScript slot generation and PostgreSQL. Availability reads the materialized shift snapshot, excludes closure overlap, applies opening/closing buffers and the effective pacing override, and filters party bounds; the database independently revalidates the same dated policy so an old signed slot cannot survive a policy edit. Active exception evidence must be explicitly revoked before a configuration change can move its service boundary.

The GiST exclusion constraint is the final overlap guard; an application-side availability result is never proof that a table is still free. Date swaps must acquire both local service-date locks through the sorted multi-lock helper.

Portable migration checks are necessary but are not concurrency proof:

```sh
npm run test:reservations:pglite
npm run test:function-grants:pglite
npm run types:database:check
```

Real concurrency requires a dedicated disposable PostgreSQL database:

```sh
RESERVATION_TEST_DATABASE_URL=postgresql://... npm run test:reservations:concurrency
```

The script must refuse a missing URL, apply the real migration chain in isolation, use separate connections, and exercise the actual reservation functions. Synthetic look-alike tables do not satisfy this gate. On August 11, 2026, the complete suite passed locally against a disposable PostgreSQL 17.10 cluster; CI independently provisions PostgreSQL 17 for the same release gate.

Atomic schedule commands have a separate native gate:

```sh
SCHEDULE_TEST_DATABASE_URL=postgresql://... npm run test:schedule-atomic:concurrency
```

It proves create/create versioning, same-name template serialization, and both publication/direct-shift lock orders against the actual migration chain. The complete schedule suite also passed on August 11, 2026 against a separate disposable PostgreSQL 17.10 cluster. It remains CI-wired and intentionally has no portable fallback.

Materialized service-shift exceptions have their own native gate:

```sh
SERVICE_SHIFT_TEST_DATABASE_URL=postgresql://... npm run test:service-shifts:concurrency
```

It refuses remote or shared hosts, requires PostgreSQL 17, creates a unique disposable database, applies the actual migration chain, and proves database-visible serialization for exact configure replay, competing pacing and buffer overrides, concurrent revocation, and both exception-first and configuration-first boundary changes. The complete suite passed on August 11, 2026 against a disposable local PostgreSQL 17.10 cluster and is CI-wired without a portable fallback.

## Delivery worker

`/api/internal/reservation-messages` requires `Authorization: Bearer <RESERVATION_DELIVERY_SECRET>`. It expires scoped hold/waitlist deadlines before reminders and message claims. Claims are deliberately bounded to eight messages for a 120-second lease with a 10-second provider timeout, leaving completion margin for sequential processing. Reminder identities include the reservation version, so a scheduler racing a reschedule cannot block the later correct reminder. Before each provider call, the worker revalidates the claim lease, current approved location settings, guest-messaging switch, exact configured channel, reservation/hold/waitlist lifecycle, reminder window, reservation version, verified channel, and exact verified destination.

Resend requests use an outbox-derived provider idempotency key. Provider response IDs are recorded when returned. Standard Twilio Message creation has no proven idempotent boundary in this implementation, so SMS remains disabled for production until crash-after-provider-acceptance reconciliation or another approved duplicate-safe protocol passes. The server-side `RESERVATION_SMS_DELIVERY_ENABLED` kill switch defaults to `false`; Twilio credentials do not make SMS discoverable or sendable unless that variable is exactly `true`.

Reservation push uses a separate service-role RPC contract. The database atomically materializes eligible notification/subscription pairs, gives one worker a rotating claim token, and rechecks preference, location setting, unread state, tenant, reservation, and subscription immediately before a durable `dispatching` transition. Only the exact token can complete the attempt. Expired pre-provider claims recover, while an expired `dispatching` lease or transport-ambiguous provider failure becomes terminally `uncertain` and is not sent again automatically. Explicit provider HTTP failures may retry up to five attempts; invalid subscriptions are blocked without deleting delivery evidence and are unblocked only when fresh encrypted subscription evidence is saved. `RESERVATION_PUSH_DELIVERY_ENABLED` defaults to `false` and must be exactly `true` in addition to the Owner location setting and approved provider configuration. Web Push acceptance still cannot prove device display, so connected provider monitoring remains a release gate.

## Activation gates

Keep `online_booking_enabled`, guest messaging, SMS, push, and public inventory off until every applicable item is proven:

- isolated Supabase environment with Auth, RLS, Realtime, cron, monitoring, backup/PITR, restore, and secret-rotation acceptance;
- a successful fail-closed connected preflight for the exact nonproduction Preview commit and short-lived private target/schema/fixture marker before any role password is read or Auth request is sent;
- real two-connection create/create, staff/public, modify/modify, date-swap, cancellation/rebook, and waitlist-seat conflict tests;
- connected Owner, Manager, Host, view-only, operate-only, denied, expired-assignment, and cross-location tests;
- approved sender identities, delivery/error monitoring, stale-worker recovery, and provider-failure exercises;
- platform/WAF limits, contact-consent/privacy review, query-string log redaction, and production proof of provisional-contact redaction plus backup deletion;
- physical verification of every table, combination, capacity, path, buffer, service window, pacing limit, and cutoff;
- shadow inventory reconciliation and one authoritative writer, or a separately approved and tested two-way conflict protocol;
- desktop/mobile public-site-to-OS browser acceptance with no console errors, keyboard completion, 320px/400% reflow, and no serious/critical axe findings;
- a one-location pilot with kill switches, support ownership, rollback, and daily reconciliation.

No repository test substitutes for provider, physical-floor, incumbent-writer, backup/restore, or production-environment evidence. Those stay visible as unresolved release gates until they are actually exercised.
