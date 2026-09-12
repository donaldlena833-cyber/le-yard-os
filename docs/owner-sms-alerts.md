# Le Yard Messages on personal phones

New incoming guest and team texts are copied separately to the two founders from the existing Le Yard number. Each alert identifies its sender and links to the exact shared conversation. Long texts use numbered parts; MMS attachments remain in the authenticated inbox. Save the business-only `/le-yard-messages.vcf` contact as **Le Yard Messages** on each phone to label the native SMS thread.

Open the alert link and reply in the shared inbox. That reply uses the Le Yard number and assigns human handling, pausing AI for that conversation. Opening a link alone does not pause AI. A native SMS reply to the alert cannot identify its intended guest; it receives inbox guidance instead and is never relayed to a guessed conversation or echoed to the other founder. Provider STOP/START handling remains in force.

## Delivery

`TWILIO_OWNER_SMS_ALERTS_ENABLED=true` and the existing SMS enable flag activate alerts. Private recipient numbers come from the existing forwarding configuration at dispatch; the outbox stores only `donald` and `maris` labels. Guest consent logic and AI routing remain independent of these owner-authorized internal notifications.

Inbound storage and alert enqueue finish before receipt acknowledgment. The outbox deduplicates by organization, source SID, recipient and part. Atomic claims and ordered parts prevent concurrent workers from duplicating sends. Ambiguous provider outcomes become `uncertain` and require review rather than blind retries. Definitive failures create an in-app owner notice. Dedicated signed callbacks validate the current Twilio resource and update only the alert outbox, avoiding transcript pollution.

The immediate Next `after` worker handles normal intake. The isolated `le-yard-message-alerts` Cloudflare Worker calls the bounded processor once per minute to recover queued work. It holds only `OWNER_SMS_ALERTS_SECRET`, never Twilio or database credentials. Its public handler cannot send messages. Keep that dedicated credential in provider secret stores, never source control.

`POST /api/internal/communications/owner-alerts` accepts only `{ "action": "setup", "requestId": "<stable UUID>" }` with the recovery Bearer credential. It sends one fixed setup/test SMS to each configured founder, with the contact and inbox links. Reuse the UUID after an uncertain response. The endpoint never accepts arbitrary numbers or text.

## Release and checks

Apply the generated owner-alert migration and deploy the matching runtime contract to Phone, Operations and Host. Only Phone needs the alert enable flag and processor credential. Retain the existing Twilio number and Messaging Service webhook routing.

Run the owner alert unit tests, receipt/status tests, `test:owner-sms-alerts:pglite`, `test:communications:pglite`, lint, types and build. Verify live signed callbacks, setup deduplication and separate provider delivery results for both recipients. A provider delivery report does not prove the contact was saved or the text was read on a handset.

To pause forwarding, set the Phone alert flag to false and deploy; the processor then performs no sends. Do not reset uncertain rows to queued without inspecting provider history.
