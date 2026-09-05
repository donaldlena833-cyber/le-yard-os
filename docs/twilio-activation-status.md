# Le Yard phone activation: actual status, September 5, 2026

Public number: **+1 332-877-9035**. Account email: **office@leyardny.com**.
The owner acquired this number and funded the Twilio account. Do not buy another
number, port the personal phone, repeat Brand registration, or create a duplicate
Messaging Service/campaign.

The owner supplied Business Profile approval and progressed through the campaign
form in this conversation. Final campaign approval and number registration still
need a read from the authenticated Twilio account. Profile/Brand approval is not
campaign approval. The initial scope is Customer Care, verbal consent, not marketing.

## What this branch actually supplies

- Signed Twilio voice/SMS callbacks, call-through endpoints, optional ElevenLabs
  first-answer routing, and reservation-tool scaffolding.
- Exact callback allowances in session middleware; outbound staff initiation stays
  session-authenticated. No whole-prefix public exception.
- Dedicated read-only signed readiness probe, with missing configuration fail-closed.
- A read-only-by-default configuration script for the already-owned number. It
  checks number ownership and existing service membership, requires signed and
  unsigned deployment probes before writes, saves prior settings outside Git,
  and reads back updated configuration. It never buys a number, creates a campaign,
  sends an SMS, or places a call.
- Explicit SMS and AI-booking activation gates. Missing secrets do not activate them.
- Corrected missed-call language: queue acceptance is not delivery confirmation;
  failed SMS gives an honest voicemail fallback.
- Destination-based service-SMS consent evidence rather than incorrectly invoking
  the authenticated guest-marketing consent RPC from a carrier webhook.
- Stable reservation idempotency keys, explicit guest-confirmation input and
  reporting the actual inventory status, not labeling an unconfirmed result confirmed.

## Secure handoff still required

No authenticated Twilio connector or credential is available to this chat's
execution environment. The Account SID/phone number alone do not authorize API
changes. Add credentials privately to the coding environment that will run the
script and to the le-yard-os Vercel project; never paste them in chat, commit them,
or put them in NEXT_PUBLIC variables. Adding them to Vercel alone does NOT provide
this chat with API access. See .env.twilio.example for non-secret variable names.

Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (webhook validation), preferably
TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (REST), TWILIO_MESSAGING_SERVICE_SID,
TWILIO_PHONE_NUMBER, TWILIO_PUBLIC_BASE_URL, TWILIO_FORWARD_DONALD and
TWILIO_FORWARD_MARIS. Donald's number was supplied in the private conversation;
Maris's phone was not returned by the connected contact lookup. Do not infer it.

After local/CI checks and controlled deployment:

```
node scripts/twilio-configure.mjs --channel=both
node scripts/twilio-configure.mjs --channel=voice --apply
node scripts/twilio-configure.mjs --channel=messaging --apply
```

--apply configures callbacks, not proof of live service. Keep SMS/AI automation
closed until the relevant carrier/consent checks are complete. Configure Advanced
Opt-Out in Twilio and verify STOP/START/HELP in practice. Keypad missed-call consent
must be covered accurately by the registered consent flow before enabling it.

## Not yet complete / not tested live

No real call or SMS/MMS has been placed by this chat. Simultaneous ringing on two
actual phones, personal voicemail interception, outbound displayed caller ID,
voicemail availability, message delivery and opt-out suppression remain untested.
The shared mobile SMS inbox, message notifications while the OS is closed,
conversational SMS reservation booking, verified modifications/cancellations,
waitlist matching/acceptance, structured private-event leads, vendor routing,
daily summaries and ElevenLabs agent configuration are NOT finished merely
because webhook endpoints exist. Do not claim those features are operational.
Webhook replay deduplication, consent ordering under concurrent delivery, rate
limits and verified outbound access controls require further acceptance review.

The simultaneous Dial/screening design requires a real two-phone test; if early
carrier voicemail still cancels the other leg, replace it with a verified
conference/first-human-accept design rather than claiming the prompt solved it.
A fallback on the same OS host cannot cover a total hosting outage; an independently
hosted fallback must be configured and tested before launch.

Neither deployment, A2P approval, nor funding alone constitutes end-to-end acceptance.
