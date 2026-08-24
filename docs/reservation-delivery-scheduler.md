# Reservation delivery scheduler activation

The application and database contract are installed, but no schedule or
provider send is activated by migrations. Activation is an environment change
and remains blocked until the release owner confirms the preview deployment,
worker secret, Resend/Twilio configuration, and live queue preflight.

Use Supabase Cron with Vault and `pg_net` to invoke:

- `POST /api/internal/reservation-messages`
- `Authorization: Bearer <RESERVATION_DELIVERY_SECRET from Vault>`
- `X-Le-Yard-Trigger-Source: cron`
- every minute

The scheduler is healthy only when `service_reservation_delivery_health()`
reports `fresh: true`, the latest run has a terminal status, and queue age is
not increasing. The worker persists begin/completion telemetry even when a
scope, expiry, reminder, lease-policy, or claim step fails.

Activation sequence:

1. Verify the canonical preview URL and `/api/health` schema/release/config
   fingerprints.
2. Add the 32+ character worker secret to Vercel and Supabase Vault.
3. Configure the Cron job in Supabase, using Vault inside the database request;
   never embed the secret in a migration or source file.
4. Run one canary request with `X-Le-Yard-Trigger-Source: canary` while guest
   messaging remains disabled.
5. Confirm run telemetry and an empty/non-sendable queue, then enable the Cron
   job. Provider credentials and location messaging settings remain separate
   gates.

Rollback is disabling the Cron job. It does not delete queued work or delivery
evidence.
