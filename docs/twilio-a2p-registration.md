# Le Yard — Twilio A2P 10DLC Registration Packet

Status as of September 5, 2026: PREPARED, NOT SUBMITTED. No Twilio account or business phone number has been provisioned by this implementation. A working carrier integration, account verification and paid-account billing are still required. A preview build is not an end-to-end telephony test.

## Verified identity and account instructions

- IRS legal business name: **LE YARD CORP**. Use this exact IRS spelling in the EIN-matching field. Public/corporate styling: **Le Yard Corp.**
- Entity type: **Corporation — privately held New York domestic business corporation**, not LLC or sole proprietor.
- Business address: **858 9TH AVE, NEW YORK, NY 10019, US**.
- Account and business contact email: **office@leyardny.com**, explicitly selected by Donald.
- Authorized representative: **Donald Lena, Owner**. The startup workspace also lists Co-President and Treasurer; do not attest to execution of officer appointments without the corresponding corporate record.
- EIN: **RETRIEVED AND VISUALLY CHECKED AGAINST THE IRS CP575A NOTICE DATED AUGUST 6, 2026. ENTER DIRECTLY IN TWILIO. DO NOT COMMIT THE EIN OR NOTICE TO THIS PUBLIC REPOSITORY.**
- Source: original EIN notice attached to Donald's August 17, 2026 incorporation-documents email; identity/address cross-checked with the private startup workspace. The startup workspace facts did not include the EIN itself.
- Donald's mobile forwarding/verification number has been supplied in the private conversation. Keep it in secure configuration, not this document or public source code. Do not port, replace, or publish his personal number.
- Maris's forwarding number is still required before a real two-phone test.

Do not ask the owner to repeat the EIN, legal name, address, email, or Donald's phone. Do not place passwords, API secrets, full EIN, or personal forwarding numbers in commits, logs, URLs, screenshots for publication, or chat replies.

## Number selection instructions

Donald has authorized selection of one memorable NYC business number. Search live authenticated Twilio inventory for Voice + SMS capability, prioritizing a **999 exchange** or **2121 ending**. Also consider repeated final digits and other alternating/repeated endings. Search 212, 646, 332 and 917; a genuinely memorable 646/332/917 number is preferable to a random 212 number. Use area code as a tiebreaker, not the main ranking factor.

Patterns such as `212-999-XXXX` and `646-XXX-2121` are search targets only, NOT verified available phone numbers. Never publish an example as the assigned number. Do not buy a premium third-party vanity number, a toll-free number, a second line, or a number without Voice + SMS without further approval. Standard Twilio inventory only. Recheck availability and the current monthly number price before purchase. Do not add forwarding/webhooks until their deployment and signature checks have passed.

## Recommended initial campaign

**Campaign name:** Le Yard Guest Care

**Use case:** Customer care / transactional guest service. Keep promotional marketing out of the first campaign. Do not use the public opening-news/marketing checkbox as proof of service-SMS consent for this campaign. Marketing requires separate consent and a compatible approved campaign before sending.

## Campaign description

Le Yard uses this campaign to respond to guest-initiated text messages and to send requested transactional messages related to reservations, waitlist requests, private-event inquiries, missed-call follow-up, and active guest-support conversations. Guests initiate a text to Le Yard or explicitly agree to receive service texts when requesting service. Promotional marketing is not part of this campaign.

## Message flow / consent flow — verify actual implementation before filing

Only describe methods that are deployed and tested at submission time:

1. **Guest-initiated SMS:** A guest texts the published Le Yard business number. Responses stay within that guest's request; this is not enrollment in recurring promotions.
2. **Missed-call recovery:** The unanswered-call IVR offers an optional text response and collects a keypad opt-in. Proposed disclosure: "To receive texts from Le Yard about this request, press 1. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Otherwise, stay on the line to leave a voicemail." Retain the CallSid, timestamp, disclosure version and keypad choice. A missed call alone is NOT consent.
3. **Reservation:** Capture explicit permission for reservation/service SMS separately from entering a contact number and separately from marketing. Retain the consent text/version, purpose, timestamp and evidence. Until that capture is implemented and tested, do not claim the web booking form supplies SMS consent.
4. **Waitlist:** Ask whether the guest wants waitlist/service texts and record that permission before sending. Joining a waitlist does not automatically enroll someone in marketing.
5. **Private-event inquiry:** Respond to the guest's inbound SMS or request explicit permission to follow up by text. Do not infer consent from an email inquiry containing a phone number.

## Opt-out / help

- STOP and recognized opt-out equivalents suppress further non-exempt SMS from this sender, including ordinary transactional texts, until a valid opt-in. Use an allowed alternate channel for necessary service communication.
- START/UNSTOP may restore service messaging where supported; they do not independently grant marketing consent.
- HELP returns Le Yard identification, assistance contact, and STOP instructions.
- Configure and verify Messaging Service Advanced Opt-Out. Avoid duplicate automated opt-out confirmations from both Twilio and application code.
- A bare CANCEL may be treated as an SMS opt-out keyword. Do not advertise it as a reservation-cancellation shortcut; use a clearly disambiguated reservation-management flow.

## Sample messages

1. `Le Yard: Your reservation for {party_size} on {date} at {time} is confirmed. Reply here for help. Reply STOP to opt out.`
2. `Le Yard: You requested a text after calling us. Reply with how we can help, including your preferred date, time, and party size. Reply STOP to opt out.`
3. `Le Yard: A table may be available for your waitlist request for {party_size} at {time}. Reply YES to ask us to book it or NO to pass. Not confirmed until we send confirmation. Reply STOP to opt out.`
4. `Le Yard: Your reservation has been changed to {date} at {time} for {party_size}. Reply here for help. Reply STOP to opt out.`
5. `Le Yard: We received your private-event inquiry for {date}. A member of our team will follow up. Reply STOP to opt out.`

Sample help response: `Le Yard Guest Care: For help, contact office@leyardny.com or call our published business number. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out.`

## Public URLs

- Website: https://leyardny.com
- Privacy policy: https://leyardny.com/privacy
- Terms & messaging: https://leyardny.com/terms

The Terms and strengthened Privacy content are staged on `feature/a2p-compliance` in the `le-yard` repository. Verify their public deployment without authentication before filing. That branch has diverged from current main; preserve newer website/email-consent changes and review conflicts before merging. Do not submit inaccessible preview URLs as public evidence.

## Activation checklist

1. Create the top-level account using office@leyardny.com; verify email/mobile and enable MFA. The developer-kit plugin is not an authenticated carrier-account connection.
2. Upgrade the account and configure billing securely. A2P requires a paid account.
3. Create/approve Trust Hub customer profile and A2P brand using the verified IRS identity and private EIN.
4. Publish and verify public Privacy and Terms; deploy and test every consent method described in the submission.
5. Search actual available inventory, rank memorable patterns, verify the current price, and provision exactly one Voice + SMS NYC local number.
6. Create a Messaging Service, attach the number, configure Advanced Opt-Out and record the exact provider resource IDs.
7. Submit Le Yard Guest Care with only accurate, working consent methods; record the submitted status and registration identifiers. Submission is not approval.
8. Confirm campaign approval and number association before activating application SMS.
9. Install server-side secrets in the actual deployment environment. Never commit or expose them to the browser.
10. Verify Voice/SMS webhook signatures and routing on the intended production deployment before attaching webhooks to the number.
11. Start human-first. Test Donald and Maris simultaneously, voicemail interception, no-answer fallback, inbound/outbound SMS, opt-out suppression, caller ID and call-through. No production tests to guests or vendors.
12. Do not activate AI booking or claim completion until real carrier calls/texts, inventory writes, consent checks, human handoff and failure paths have passed end-to-end testing.

## Current external blocker

This chat has no authenticated Twilio account connection or securely configured Twilio credentials. Account signup, number availability/purchase and A2P submission have NOT been executed. The owner must complete the secure account-creation/verification/billing step and authorize Twilio in an execution environment before those operations can run.
