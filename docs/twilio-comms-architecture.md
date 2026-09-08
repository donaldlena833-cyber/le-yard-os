# Le Yard Communications Architecture

## Goals

Use one permanent Twilio phone number as the single public identity for Le Yard across inbound voice, outbound voice, SMS, AI-assisted reservations, event lead capture, vendor calling, and guest conversation history.

## Day-one routing

- Inbound voice: callers hear a short Le Yard welcome, then Twilio dials Donald and Maris simultaneously. First human to accept wins.
- Answer confirmation: forwarded legs require a keypress before bridge to avoid carrier voicemail stealing the call.
- No-answer path: record voicemail metadata and trigger an SMS recovery flow.
- Inbound SMS: all messages are persisted in Le Yard OS and become one conversation tied to the guest phone identity.
- Outbound staff calls: originate through Twilio so recipients see the Le Yard caller ID.
- Outbound SMS: always sent from the same Le Yard number / Messaging Service.

## AI-ready routing

Later, ElevenLabs (or another swappable voice provider) can become the first voice hop. The AI must call Le Yard OS tools for availability and booking changes. The AI never owns inventory.

### Fish Audio welcome

The day-one welcome is a generated recording rather than a live synthesis request. This keeps inbound calls working if Fish Audio is unavailable and avoids paying to generate identical speech on every call.

1. Create a scoped Fish Audio key and expose it locally as `FISH_API_KEY`.
2. Optionally set `FISH_REFERENCE_ID` to the approved Le Yard voice.
3. Run `npm run voice:generate-reception`.
4. Deploy `public/audio/le-yard-reception.mp3` and set `TWILIO_RECEPTION_AUDIO_URL` to its public HTTPS URL.

Until that URL is configured, Twilio speaks the same welcome text. A future interactive receptionist would add streaming speech recognition, an LLM dialogue layer, Fish Audio streaming TTS, and the existing human-transfer tools; it is a separate call path from this reliable greeting and ring group.

### Required agent tools

- checkAvailability(date, time, partySize)
- createReservation(...)
- modifyReservation(...)
- cancelReservation(...)
- joinWaitlist(...)
- createPrivateEventLead(...)
- transferToHuman(reason, summary)
- lookupGuestByPhone(phone)

## Identity model

Phone number is the canonical communications identity. Calls, SMS, reservations, waitlist entries, private-event inquiries, and guest notes should attach to the same contact where possible.

## Private-event detection

Escalate language such as buyout, private dinner, birthday party, corporate event, engagement party, rehearsal dinner, or parties above the normal reservation limit into a private-event lead rather than a standard reservation.

## Vendor mode

Vendor contacts are separate from guest contacts. Authorized staff can place outbound calls with the Le Yard caller ID without getting access to guest SMS history.

## Reporting

Daily communications summary should report inbound calls, human answered calls, AI handled calls, missed calls, recovered missed calls, reservations created/modified/cancelled, waitlist fills, event leads, vendor calls, and estimated booked covers/revenue.

## Compliance

- Use an approved Trust Hub customer profile.
- Register a US local number for A2P 10DLC before production SMS.
- Keep transactional/service messaging consent separate from promotional marketing consent.
- Maintain public privacy policy and SMS terms with STOP/HELP handling.
- Use Twilio API keys in production, not an Auth Token embedded in application code.
- Validate Twilio webhook signatures on every inbound Twilio endpoint.
