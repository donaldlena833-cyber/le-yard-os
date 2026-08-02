# Operations security and configuration

Migration `202608010021_operations_security_configuration.sql` closes the receipt, checklist-evidence, chat-channel, and expense-category write boundaries. It is forward-only and depends on the foundation through migration 018; the focused verifier intentionally applies 001–018 plus 021 so it can run independently while adjacent migrations are developed.

## Receipt fingerprinting

Receipt finalization downloads the private object through the caller-scoped Supabase client, verifies its byte count and file signature, computes SHA-256 on the server, and calls `record_receipt_fingerprint`. The command derives the actor, organization, and location from authenticated evidence. Exact retries reuse one request ID and result; a changed receipt or hash conflicts. Exact-hash duplicate matches are limited to the same organization and location, with score `1` and a server-owned reason. Authenticated clients have no direct write grant on `receipt_duplicate_matches` or receipt content hashes.

## Checklist photo evidence

Authenticated users can record non-photo checklist responses through `record_checklist_response`, but that command rejects photo metadata and storage paths. For a photo item, the server workflow first performs all caller-scoped run, assignment, template-item, object-path, size, MIME, and signature checks. It then calls the service-role-only `bind_verified_checklist_photo_response` command with the explicit human actor and AAL so the database reruns authorization and preserves human audit evidence. Browser-authenticated callers cannot invoke the binder directly.

The `checklists` bucket retains its 25 MB ceiling and accepts exactly JPEG, PNG, and WebP. Other bucket settings are unchanged.

## Replay-first commands

`start_checklist_run` and `acknowledge_sop` resolve matching request evidence before rechecking mutable source state. This lets an exact retry return its committed result even if a template, location, or current SOP version changes after the first success. New request IDs still validate current state and fail when their source is no longer eligible.

Client request IDs are stable per command scope and canonical payload. A transient failure reuses the same ID; a payload change receives a new ID; success or closing the relevant surface clears the ID. Receipt uploads/finalization, Operations commands, channel/category configuration, and notification settings use this behavior.

## Channel and category configuration

Managers, Admins, and MFA-ready Owners can create and archive authorized chat channels. Location channels require location management; canonical all-staff, management, and per-location channels cannot be duplicated. Private member replacement is atomic and actor-derived. Direct authenticated channel configuration DML is revoked.

Expense categories are managed by Admins and MFA-ready Owners only. The commands support create, rename/accounting-code update, deactivate, restore, and exact replay without exposing direct authenticated category writes. Deactivation preserves historical receipt references.

## Modal interaction contract

Receipt and Operations dialogs:

- focus a deterministic control when opened;
- trap forward and reverse Tab navigation;
- close on Escape or backdrop activation;
- make the background inert and lock document scrolling while open; and
- restore the original background state and triggering control focus when closed.

## Verification

Run the isolated database contract without Docker:

```bash
node scripts/verify-operations-security-configuration-pglite.mjs
```

The verifier covers receipt replay and forgery, direct-DML and cross-location rejection, verified-photo binding, replay-first checklist/SOP behavior, channel/category permissions and replay, and the exact checklist bucket catalog settings.

Run the focused application regression tests:

```bash
npx vitest run \
  tests/unit/data/stable-request-id.test.ts \
  tests/unit/data/modal-accessibility.test.tsx \
  tests/unit/data/operations-security-configuration.test.ts \
  tests/unit/data/receipt-fingerprint-workflow.test.ts \
  tests/unit/data/checklist-photo-workflow.test.ts \
  tests/unit/data/live-message-configuration.test.tsx
```
