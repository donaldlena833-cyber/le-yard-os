# Release and pilot runbook

This runbook is intentionally operational. A passing repository test does not authorize public booking, provider delivery, or a production migration.

## Before staging

- [ ] Record the exact OS/site/Reserve/Host commit and deployment SHAs.
- [ ] Confirm the OS production alias is synthetic playground or protected-offline mode.
- [ ] Confirm `RESERVATION_PUBLIC_BOOKING_ENABLED=false`.
- [ ] Confirm SMS, push, and guest messaging are disabled unless their provider gates are explicitly accepted.
- [ ] Capture the remote Supabase migration head and compare it to the application release manifest.
- [ ] Confirm the connected database contract returns an exact match.

## Staging acceptance

- [ ] Apply the complete forward migration chain to an isolated Supabase target.
- [ ] Provision synthetic Owner, Admin, Manager, Host, view-only, operate-only, denied, expired, and cross-location identities.
- [ ] Run the connected attestation workflow against the exact deployed commit.
- [ ] Prove Auth, RLS, Storage, Realtime, schema health, reservation lifecycle, and capability boundaries.
- [ ] Verify no guest PII, provider payload, public management identifier, or cross-location record is returned.
- [ ] Verify the messaging and push kill switches before and after queued-work creation.
- [ ] Run the managed backup/restore rehearsal and retain the evidence identifier.

## Physical and service rehearsal

- [ ] Walk the room and sign the floor/table/bar/patio inventory.
- [ ] Approve the floor revision only after the pacing simulation passes.
- [ ] Rehearse arrivals, walk-ins, holds, no-shows, combined tables, patio closure, and late arrivals.
- [ ] Choose one reservation writer. The incumbent and OS must not both publish independent public inventory.
- [ ] Verify the restaurant phone, support email, privacy URL, and cancellation policy.
- [ ] Test email verification, confirmation, modification, cancellation, expired links, reissue, provider failure, and support escalation.

## Pilot approval

Public inventory may be enabled only when every item below is true:

- [ ] Two independent reviewers approved the release manifest.
- [ ] Schema contract and connected acceptance are green.
- [ ] Owner identities and MFA enrollment are verified.
- [ ] Managed backup/PITR and restore evidence is current.
- [ ] Physical floor and pacing are owner-approved.
- [ ] Email delivery is proven; SMS and push remain off unless separately approved.
- [ ] Staff completed a full-service rehearsal.
- [ ] Rollback and kill-switch actions were rehearsed.

Start with no more than 20–25% of approved inventory and expand only after reviewing the service evidence. Record oversells, table conflicts, hold expiry, delivery, support, arrival load, ticket times, and nightly reconciliation.

## After the pilot

Prioritize observed operational pain in this order: storage locations, receiving discrepancies and invoice matching, manager handoff, 86 propagation, food safety, purchasing/pack rounding, prep planning, cash/prime cost, and integrations. Do not add new surface area before the current writer, recovery, and reconciliation model is stable.
