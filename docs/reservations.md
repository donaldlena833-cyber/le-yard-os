# Reservation platform

## Current status

The reservation system is a connected-preview implementation. **Public booking is disabled.** The first-party OS is the intended future writer, but it is not the live source of truth until a one-writer decision, shadow reconciliation, production-like acceptance, and explicit activation approval are complete.

The reservation and operating-day migrations are local drafts. They may be hardened in place while they remain unshipped. If any has reached a shared database, stop and replace further edits with forward-only migrations.

There are no deposits, card holds, or payment flows.

## Safety model

| Boundary                                                 | Current contract                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.public_booking_holds`                           | Provisional interval and contact data only while pending. Confirmation or expiry atomically redacts names, contacts, requests, and any unproved coordinate. A hold is never presented as a confirmed reservation. |
| `private.public_booking_verifications`                   | One consumed, tenant/location/hold/channel-bound verification fingerprint. The first proven channel wins.                                                                                                         |
| `public.reservations`                                    | Confirmed staff or guest commitments only, with a version counter and append-only operational events.                                                                                                             |
| `public.reservation_table_allocations`                   | Active holds, assignments, and blocks. A PostgreSQL GiST exclusion constraint rejects overlapping active intervals for a table.                                                                                   |
| `private.public_booking_requests`                        | Scoped request ID, payload hash, completion state, and deterministic replay evidence for public commands.                                                                                                         |
| `private.public_booking_management_exchanges` and tokens | One-time, browser-bound exchange evidence and hashed management sessions. Raw session material is returned only to the public-site BFF.                                                                           |
| `public.reservation_message_outbox`                      | Tenant/location-scoped transactional work with dedupe keys, bounded attempts, claim tokens, leases, and stale-worker recovery.                                                                                    |
| `public.waitlist_entries`                                | Explicit waiting, offered, accepted, seated, expired, and cancelled lifecycle. Expiry is atomic with queued-message cancellation.                                                                                 |
| `public.service_shifts`                                  | Materialized operating-day instances with exact timezone-aware boundaries, party limits, turn duration, pacing, buffers, online state, and source-configuration evidence.                                        |
| `public.service_shift_exceptions`                        | Explicit closure, pacing-override, or buffer-override evidence with reason, actor, request replay, revocation, audit, and overlap protection.                                                                      |

The private hold is the provisional-contact boundary. Confirmation copies only the coordinate proven by the signed delivery channel into CRM; the other email or phone is never used for identity matching or management delivery. Confirmation and deadline expiry atomically erase provisional names, contacts, and requests, leaving only non-PII lifecycle/channel evidence. Production privacy, consent, backup-retention, and deletion acceptance remain release gates.

The current `reservations.version` plus `reservation_events` ledger supports replay and audit. A richer immutable policy/revision snapshot remains a Gate 2 follow-up and is not represented as complete here.

The operating-date implementation now materializes dated `service_shifts` from approved recurring periods with exact timezone-aware start/end instants. It resolves an active materialized shift first, then the latest published schedule's active shift, then a calendar fallback. Closures, pacing overrides, and opening/closing buffer overrides are explicit, revocable lifecycle records rather than inferred UI state.

## Public guest flow

1. The public website BFF calls scoped availability. The OS reads canonical reservation-and-unexpired-hold pacing, applies approved service periods and table inventory, and returns short-lived client-bound slot tokens.
2. A same-origin browser POST sends the chosen slot token and guest form fields to the BFF. The BFF keeps the location-scoped booking API key server-only and signs a first-party abuse identity.
3. The OS verifies the slot before claiming the contact limiter. The database then locks the location/business date, expires stale holds, rechecks approved settings and available delivery adapters, inserts a private hold and tentative allocation, and enqueues verification messages in one transaction.
4. The browser receives only `{holdId, holdExpiresAt, deliveryState}`. It never receives a verification capability, public code, management token, or API key.
5. At send time, the leased worker creates a deterministic signed verification link bound to purpose, organization, location, hold, expiry, and the exact email or SMS channel. The raw link is never stored in the database.
6. Link entry stores the capability in a short-lived `HttpOnly`, `SameSite=Lax`, `/api/reservations` cookie and immediately issues a `303` redirect that removes the token from the browser URL. The page does not confirm on mount; the guest must press **Confirm reservation**.
7. The BFF reads the cookie, sends the signed capability server-to-server, and the database atomically proves the channel, converts the hold allocation into a confirmed assignment, creates or matches CRM identity only on that proven coordinate, cancels remaining verification work, and enqueues confirmation only to the proven channel.
8. The confirmation message contains a signed management-exchange link. Link entry is again inert until the guest presses **Open my reservation**. A separate HttpOnly exchange-client nonce binds the first successful exchange to that browser while allowing an exact same-browser retry after response loss.
9. The BFF converts the returned raw management capability into an `HttpOnly` cookie. Browser `GET`, `PATCH`, and `DELETE` requests never contain a bearer token in state, storage, URL, body, or JavaScript-authored capability header.

Create, confirm, exchange, modify, and cancel fail closed on malformed JSON, oversized UTF-8 bodies, invalid dates, wrong tenant/location/purpose/channel, replay conflicts, unavailable rate-limit storage, or missing delivery prerequisites. Expected failures are generic, `no-store`, and do not disclose whether unrelated guest or reservation records exist.

## API boundary

The OS API is server-to-server. A raw location-scoped client key is generated once and stored only in the public website runtime.

| Method   | OS endpoint                                        | Contract                                                                      |
| -------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET`    | `/api/v1/availability?date=YYYY-MM-DD&partySize=N` | Approved bookable slots with signed slot tokens.                              |
| `POST`   | `/api/v1/reservations`                             | Atomic private hold plus verification outbox; returns opaque hold state only. |
| `POST`   | `/api/v1/reservations/confirm`                     | Consumes a channel-bound signed verification capability.                      |
| `POST`   | `/api/v1/reservations/manage/exchange`             | Exchanges a signed link once into a browser-bound management session.         |
| `GET`    | `/api/v1/reservations`                             | Minimal managed-reservation DTO using the BFF-held capability.                |
| `PATCH`  | `/api/v1/reservations`                             | Idempotent move/resize using a fresh signed slot.                             |
| `DELETE` | `/api/v1/reservations`                             | Idempotent cancellation and allocation release.                               |

Create, modify, and cancel require a UUID `Idempotency-Key`. Exact retries must reuse the same key and payload. Confirmation and management exchange use signed-capability fingerprints plus scoped replay evidence.

Create a client only after an isolated connected environment exists. The helper is a dry run unless `--apply` is supplied:

```sh
npm run booking:create-client -- --location-id=<location-uuid> --origin=https://www.leyardnyc.com --name="Le Yard website"
npm run booking:create-client -- --location-id=<location-uuid> --origin=https://www.leyardnyc.com --name="Le Yard website" --apply
```

The public website runtime receives `LE_YARD_BOOKING_API_URL` and the one-time `LE_YARD_BOOKING_API_KEY`. Neither value belongs in this OS runtime or in a `NEXT_PUBLIC_` variable.

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

The script must refuse a missing URL, apply the real migration chain in isolation, use separate connections, and exercise the actual reservation functions. Synthetic look-alike tables do not satisfy this gate.
CI provisions an isolated PostgreSQL 17 service for this job. A local missing-URL failure is still an honest unexecuted gate; the workflow result must pass before release.

Atomic schedule commands have a separate native gate:

```sh
SCHEDULE_TEST_DATABASE_URL=postgresql://... npm run test:schedule-atomic:concurrency
```

It proves create/create versioning, same-name template serialization, and both publication/direct-shift lock orders against the actual migration chain. It is also CI-wired and intentionally has no portable fallback.

## Delivery worker

`/api/internal/reservation-messages` requires `Authorization: Bearer <RESERVATION_DELIVERY_SECRET>`. It expires scoped hold/waitlist deadlines before reminders and message claims. Claims are deliberately bounded to eight messages for a 120-second lease with a 10-second provider timeout, leaving completion margin for sequential processing.

Resend requests use an outbox-derived provider idempotency key. Provider response IDs are recorded when returned. Standard Twilio Message creation has no proven idempotent boundary in this implementation, so SMS remains disabled for production until crash-after-provider-acceptance reconciliation or another approved duplicate-safe protocol passes. The server-side `RESERVATION_SMS_DELIVERY_ENABLED` kill switch defaults to `false`; Twilio credentials do not make SMS discoverable or sendable unless that variable is exactly `true`.

## Activation gates

Keep `online_booking_enabled`, guest messaging, SMS, push, and public inventory off until every applicable item is proven:

- isolated Supabase environment with Auth, RLS, Realtime, cron, monitoring, backup/PITR, restore, and secret-rotation acceptance;
- real two-connection create/create, staff/public, modify/modify, date-swap, cancellation/rebook, and waitlist-seat conflict tests;
- connected Owner, Manager, Host, view-only, operate-only, denied, expired-assignment, and cross-location tests;
- approved sender identities, delivery/error monitoring, stale-worker recovery, and provider-failure exercises;
- platform/WAF limits, contact-consent/privacy review, query-string log redaction, and production proof of provisional-contact redaction plus backup deletion;
- physical verification of every table, combination, capacity, path, buffer, service window, pacing limit, and cutoff;
- shadow inventory reconciliation and one authoritative writer, or a separately approved and tested two-way conflict protocol;
- desktop/mobile public-site-to-OS browser acceptance with no console errors, keyboard completion, 320px/400% reflow, and no serious/critical axe findings;
- a one-location pilot with kill switches, support ownership, rollback, and daily reconciliation.

No repository test substitutes for provider, physical-floor, incumbent-writer, backup/restore, or production-environment evidence. Those stay visible as unresolved release gates until they are actually exercised.
