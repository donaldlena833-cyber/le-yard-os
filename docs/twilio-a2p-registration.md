# Le Yard — Twilio A2P 10DLC Registration Packet

This packet is prepared for Twilio Console registration. Legal identity fields must be copied exactly from Le Yard's IRS/EIN records and should not be guessed from branding or website copy.

## Recommended initial campaign

**Campaign name:** Le Yard Guest Care

**Use case:** Customer care / transactional guest service. Keep promotional marketing out of the first campaign so reservation, waitlist, missed-call, and guest-support traffic has a clear consent story. A separate marketing campaign can be added later if Le Yard wants recurring promotional SMS.

## Campaign description

Le Yard uses this campaign to respond to guest-initiated text messages and calls and to send transactional messages related to reservations, waitlist requests, private-event inquiries, missed-call follow-up, and active guest-support conversations. Guests provide their mobile number while requesting service, initiate a text to Le Yard, or explicitly request a text during a missed-call flow. Promotional marketing is not part of this campaign.

## Message flow / consent flow

Guests can enter this messaging relationship in these ways:

1. **Reservation:** A guest supplies a mobile number while requesting or managing a reservation. Le Yard uses the number for reservation confirmations, changes, cancellation/service notices, and guest support related to that reservation.
2. **Guest-initiated SMS:** A guest texts the published Le Yard business number. Le Yard replies to help with the guest's request.
3. **Missed-call recovery:** If a guest calls and Le Yard cannot answer, the recorded disclosure asks the caller to press 1 to request a text response. The disclosure states that message/data rates may apply and that the guest can reply STOP.
4. **Waitlist:** A guest provides a mobile number and asks to join a waitlist. Le Yard may text an availability offer and related service updates.
5. **Private-event inquiry:** A guest who initiates a text or otherwise provides a number for an active private-event inquiry may receive service follow-up about that inquiry.

Promotional marketing consent is tracked separately and is not required for reservations, waitlists, orders, or guest support.

## Opt-out / help

- STOP: opt out where applicable.
- START: opt back in where supported.
- HELP: receive help information.
- Twilio Messaging Service Advanced Opt-Out should remain enabled so carrier-compliant keyword handling is centralized.

## Sample messages

1. `Le Yard: Your reservation for {party_size} on {date} at {time} is confirmed. Reply here for help. Reply STOP to opt out.`
2. `Le Yard: Sorry we missed your call. Reply with how we can help, including your preferred date, time, and party size. Reply STOP to opt out.`
3. `Le Yard: A table may be available from the waitlist for {party_size} at {time}. Reply YES to accept or NO to pass. Reply STOP to opt out.`
4. `Le Yard: Your reservation has been changed to {date} at {time} for {party_size}. Reply here for help. Reply STOP to opt out.`
5. `Le Yard: We received your private-event inquiry for {date}. A member of our team will follow up. Reply STOP to opt out.`

## Public URLs

- Website: https://leyardny.com
- Privacy policy: https://leyardny.com/privacy
- Terms & messaging: https://leyardny.com/terms

The Terms and strengthened Privacy content are staged on the `feature/a2p-compliance` branch of the `le-yard` website repository and must be deployed publicly before campaign submission.

## Business identity — MUST be confirmed from legal records

Fill these fields only from the actual IRS / formation / Twilio-authorized representative records:

- Exact legal business name: **NEEDS OWNER CONFIRMATION**
- EIN: **ENTER DIRECTLY IN TWILIO; DO NOT STORE IN THIS REPOSITORY**
- Entity type: **NEEDS OWNER CONFIRMATION**
- Registered business address: **NEEDS OWNER CONFIRMATION**
- Authorized representative full legal name: **NEEDS OWNER CONFIRMATION**
- Authorized representative title: **NEEDS OWNER CONFIRMATION**
- Authorized representative business-domain email: **NEEDS OWNER CONFIRMATION**
- Authorized representative phone: **NEEDS OWNER CONFIRMATION**

## Suggested number preference

Prefer a voice/SMS-capable NYC local number in this order if inventory permits:

1. 212
2. 646
3. 332
4. 917

Do not purchase a number that lacks the required Voice and SMS capabilities.

## Activation checklist

1. Upgrade/verify Twilio account and billing.
2. Create/approve Trust Hub customer profile / A2P brand using exact legal identity.
3. Publish Privacy + Terms URLs.
4. Purchase the permanent Le Yard Voice + SMS local number.
5. Create a Messaging Service and attach the number.
6. Enable/confirm Advanced Opt-Out.
7. Submit the Le Yard Guest Care campaign with the description, flow, and samples above.
8. Associate the approved campaign with the Messaging Service/number.
9. Configure Voice webhook to `https://operations.leyardny.com/api/twilio/voice/incoming` (POST).
10. Configure Messaging webhook to `https://operations.leyardny.com/api/twilio/sms/incoming` (POST).
11. Add production credentials to Vercel secrets; never commit them.
12. Start with `TWILIO_INBOUND_MODE=human` and field-test human routing before switching AI first-answer on.
