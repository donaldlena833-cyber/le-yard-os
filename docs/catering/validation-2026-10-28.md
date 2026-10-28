# Catering release-check repair — October 28

This batch advances the existing dormant receiver/owner register draft. It is not
an OS production release or activation. Corporate and offsite private-party briefs
remain equal; Donald is the initial owner; catering availability stays unconfirmed.

## Corrections

The completed October 26 verify job revealed a real draft permission regression:
its service-role USAGE grant on the shared `private` schema violated the existing
attestation isolation contract. The pending catering migration now uses an
unexposed `catering_private` schema for dedicated credentials and rate buckets,
with explicit service-only grants and forced RLS. It grants no shared-private
schema access. The unchanged attestation assertion passes, and a native catering
check independently proves that boundary. Browser/owner reads still use the same
organization-scoped RLS on public.catering_inquiries. No acceptance marker is seeded.

The native business-conflict harness set search_path=pg_catalog for its intentional
migration transformation probe and left it set while later migrations ran. It now
resets that setting after completing the probe. All twelve checks pass, including
unchanged reviewed body hashes, unchanged grants/security attributes, both
negative guard probes and a genuine engine-generated serialization failure.

Correction to the October 26 packet: the reported body-drift/unreviewed-function
messages were successful, expected rejection probes, not unresolved findings.
The actual failing condition was a later missing `shifts` type caused by the leaked
search path. Historical raw reports are preserved; no reviewed hash was changed.

The reservation-push native fixture lacked a service window and staff creator
required by the current admission trigger. It now follows the existing PGlite
fixture with a dated, offline synthetic service and creator. No production policy,
trigger, timing assertion, subscription lock or replay assertion was relaxed.
The actual two-worker lock/lease/current-subscription/non-replay test passes.

## Evidence and release boundary

- Full unit suite: 1,515/1,515 across 211 files; generated public types unchanged
  and verified (157 tables,4 views,321 functions,16 enums).
- Catering native PostgreSQL:21 checks pass, including predecessor upgrade,
  dedicated-schema/shared-private isolation, both audiences, quotas/concurrency,
  owner/admin/manager/suspended/cross-tenant denials and local security advisors.
- Attestation regression passes all original assertions. Business-conflict native
 12/12 accepted. Reservation-push native concurrency passes.
- Production build/typecheck/lint and full integration results are preserved in
  this chat's October 28 release packet; final CI is recorded separately.
- Read-only hosted metadata on October28: catering table absent, catering_private
  schema absent, expected head20261025085858. No hosted migration, environment
  setting, client credential, order/reservation state, notification or outreach
  was changed. The pending app/migration head remains20261026101813.

Keep the complete OS app/schema release coordinated. Do not merge a partial
migration into a running old app, relax the readiness guard or enable direct
intake from a successful test/build. The next gate is actual isolated hosted
relay→storage→owner access, plus approved handling/retention and operational
handoff; local tests or a Vercel preview alone do not establish that outcome.
