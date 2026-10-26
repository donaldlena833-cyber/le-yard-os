# October 26 draft validation

This branch includes main through 8cafd31 plus dormant receiver and owner register.
It has not been merged, migrated or activated in production. The public website
remains the existing review/copy/email brief, not this staff workspace.

The owner register is read-only; no hosted inquiry, notification, follow-up, quote,
order, fulfillment or revenue is claimed. See owner-register.md for the actual
handoff and coordinated release checklist.

- Full unit suite: 1,515 passed across 211 files. The five failures observed on the
  October 23 base no longer occur after the current-main merge; no assertions were
  removed or weakened in this batch.
- Local dedicated receiver PostgreSQL suite: 20 final checks passed, including the current-main upgrade contract and local
  Supabase security advisors with no reported issues. Isolated disposable database
  on loopback PostgreSQL 17.10, not hosted production.
- Generated types verify 157 tables, 4 views, 321 functions and 16 enums.
- Production Webpack build and TypeScript pass; scoped lint clean; full lint has
  zero errors and one existing message-alerts worker export warning.
- Fourteen existing desktop accessibility routes pass. New register desktop/mobile
  axe checks report no serious/critical violations; both audience filters work;
  details open; 320/390/1440 checks show no horizontal overflow. Screenshots are
  labeled synthetic demo examples.
- Native whole-project pgTAP RLS run could not start: Homebrew control PostgreSQL
  lacks pgtap (zero files executed, not a passing suite). Existing CI uses isolated
  Supabase PostgreSQL with pgTAP. Dedicated real PostgreSQL catering role/tenant
  denial checks above did run and pass. Docker was unavailable locally; no daemon
  or provider settings changed to work around this.

The historical full-service-day browser assertions were incorrectly included in
ordinary-demo runs without their fixed-clock fixture. A fresh unchanged first
assertion reproduces the missing Full room heading on the ordinary demo. They now
have a separate configuration/server with full-service-day-v1 explicitly selected,
and CI runs both ordinary and historical commands. The V1 fixture remains a
historical projection of a retired floor; its tests do not prove current connected
operational readiness. Final browser/CI results are recorded in the release packet.

The hosted Le Yard project was checked read-only: no catering table, no applied
catering migration, expected head 20261025085858. The unshipped migration was
therefore moved forward using the Supabase CLI to 20261026101813, with the matching
app contract. A dedicated native upgrade check validates the exact predecessor
contract before the new migration and matching fingerprints afterward. Fresh final
checks for that revision are recorded separately; earlier 19-check logs predate it.

Final browser results: ordinary desktop 34/34 and historical fixed-clock 5/5 pass.
After pinning Zod 4.6.6 for GHSA-mrhx-c7xc-m3w5, the complete unit suite again
passes 1,515/1,515, and runtime-only audit reports zero findings. The public
marketing checkout also reports zero runtime findings and has no Zod dependency;
it was not edited or redeployed. Both its known release and the draft Operations
release remain separate.
