# Groups: client conversations, team requests, and tickets

Le Yard OS exposes Groups at `/messages`. Owners and admins see three Twilio views alongside the existing internal Team channels:

- **Client conversations** is the shared, paginated transcript of incoming and outgoing SMS/MMS, including automated replies, human replies, timestamps, attachments, and carrier status. “Needs a human” filters conversations held for human handling.
- **Team requests** receives SMS/MMS sent to the existing Le Yard number by active employees whose phone is recorded in People, plus the existing configured owner phones. Employees use the business number, not an owner's personal number. Employee texts cannot execute account changes or AI tools. Unrecognized numbers initially appear in Client conversations; correct the employee's People record and reconcile history to classify them.
- **Tickets** holds issues and agent handoff summaries. A ticket can link to a source message and its MMS attachments. Notes, resolution, and reopening are internal and append-only. “Reply in conversation” opens the separate SMS/MMS composer.

The shared Twilio inbox retains the existing owner/admin access boundary. Employees keep their existing internal channel permissions and see the business SMS contact on their Groups page. They do not gain access to client or other employees' private messages.

## Human handoff

Configure an SMS agent to call `POST /api/internal/communications/agent/sms-handoff` with the existing agent-tool authentication, a stable UUID `requestId`, the conversation's E.164 `phone`, a short `reason`, and a `summary`. Do not put authentication credentials in the request body or logs.

The endpoint validates the request, checks the retry claim, marks the conversation for a human, claims the operation, saves a ticket, and saves an owner notification before attempting the fixed client notice. A repeated request does not send another notice. Queued/accepted results are not delivery confirmations. An uncertain result keeps human handling enabled and asks the operator to inspect history; it must not be retried under a new ID automatically.

The notice says: “Le Yard: I’m bringing a member of our team into this conversation to help. They’ll reply here. Reply STOP to opt out.”

Automated sends through `sendTwilioMessage` and the inbound SMS reservation flow stop while the thread is assigned to a human. A staff SMS/MMS reply also assigns human handling. “Return to automation” is an explicit operator action; resolving a ticket does not restart an agent. An already submitted carrier request cannot be recalled.

The existing SMS enable flag and service-consent checks still apply. A recent inbound exchange can permit a direct service reply for up to 48 hours without creating recurring or marketing consent; a recorded opt-out takes precedence. The 48-hour limit is an application choice. This follows the distinction between direct conversational replies and ongoing engagement in [Twilio's Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy).

This change supplies the handoff endpoint and guarded send path. It does not configure an external agent platform or activate a new AI model. An external sender that bypasses Le Yard OS cannot be paused by this application; route agent sends through the guarded helper/API integration.

## History and MMS

Inbound callbacks persist the exact text before acknowledging receipt. Status callbacks fetch the authoritative Twilio message so a duplicate callback does not append another transcript entry. App-originated outgoing messages record the operator or automation source. Historical messages whose author cannot be established display “sender unverified.” A failed archive after carrier acceptance is not reported as an unsent SMS; callbacks and reconciliation recover it.

Staff can upload up to three JPEG/PNG images, with a combined 4 MB limit. File signatures, ownership, and size are checked server-side. The private bucket supplies short-lived signed URLs to Twilio. Incoming attachments are opened through the owner-authenticated media proxy. [Twilio's Message API](https://www.twilio.com/docs/messaging/api/message-resource) provides the media and delivery-status interface.

Use `node scripts/sync-communication-history.mjs` with the existing protected runtime environment for a read-only count of available provider messages. Add `--apply` to reconcile them into the private archive. It paginates to the end of both directions, de-duplicates by message SID, preserves existing author attribution and text, and logs counts only. This is needed for pre-existing Twilio history and can also recover missed callbacks. It cannot reconstruct provider messages or attachments already deleted before import.

Messages and tickets have keyset pagination. Search applies to loaded messages. Groups refreshes every 15 seconds while visible and clearly reports unavailable data. The notification drawer supplies in-app owner notifications; this change does not add closed-app push delivery.

## Release and acceptance

1. Apply `20260908120000_communications_groups.sql` and `20260908120001_communications_force_rls.sql` to the existing shared database. Together they add four private tables with forced row-level security, the ticket status view, employee-number lookup, a private MMS bucket, and the updated runtime schema fingerprint.
2. Deploy this revision to each surface that uses the shared Le Yard OS runtime contract, including Operations, Phone, and Host. Coordinate the migration and deployments because the contract requires the new migration head. Verify all affected `/api/health` responses and signed-in pages.
3. Run history reconciliation with `--apply`; verify prior SMS/MMS and author labels in the signed-in Groups page.
4. Wire the external SMS agent's human-escalation tool to the endpoint and its automated sends through the guarded path.
5. With an authorized test handset, verify client inbound SMS/MMS, agent handoff notice delivery and owner notification, blocked automated follow-up, a human SMS/MMS reply, STOP/START behavior, and an employee-number conversation in Team requests. Verify no personal owner number appears in replies.

No Twilio number, Messaging Service, campaign, or forwarding destination needs to be replaced. This revision has not itself been deployed or tested through a live carrier.

Live acceptance testing may temporarily set `COMMUNICATIONS_TEST_OWNER_ID` and
`COMMUNICATIONS_TEST_UNTIL` on Operations. Until the specified UTC instant, only
notifications associated with the existing `TWILIO_FORWARD_DONALD` contact are
restricted to that active owner. Other contacts and voice routing are unaffected.
Remove these two settings after testing; expiry also restores normal recipients.
