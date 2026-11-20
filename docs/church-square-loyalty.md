# Church Street loyalty and Apple Wallet

Operations `/loyalty` reads the existing Church Street Square connection. The native Square loyalty program owns enrollment, Apple Wallet passes, purchase points and redemption. Operations never issues a second card or awards duplicate purchase points.

## Current release

- Live owners and admins in the active `le-yard-church-street` organization and `CHURCH` location can read the program and browse twenty accounts at a time, or search by exact international phone number.
- Every read verifies the configured Square merchant, active Church Street location, address, USD and America/New_York, then verifies that the seller's loyalty program includes that location.
- Reads use `LOYALTY_READ`, `CUSTOMERS_READ` and the existing merchant/location permissions. Credentials stay in the Operations production environment. Production reads remain unavailable in preview, host and phone deployments.
- Square accounts are ordered oldest first. Shared seller programs are labeled explicitly; account membership and lifetime points do not establish local visits or local spend.
- Profile reads are batched. A missing, deleted or unavailable customer is shown without a name or birthday. Only phone suffixes and birthday month/day reach the browser. No customer data is copied to the Operations database or logged.
- Refreshes and pagination are on demand. No background customer sync, marketing sends, birthday rewards, custom Wallet notifications, reorder, gifting or fresh-batch features are installed.
- `/api/health/loyalty` checks merchant, location and program readiness only. It never retrieves members. Warm-instance probes are coalesced for sixty seconds.

## Native Square activation

1. Sign into the correct café seller in Square Dashboard. Confirm Church Street's location and the existing subscription. If Loyalty is inactive or absent, review the actual plan price and select an earning rule and reward before activation. The API cannot create or modify the base program.
2. In Loyalty settings, enable enrollment and check-in through Apple Wallet. Review the location name, receipt logo and brand color. This setting is not exposed in the public Loyalty API and cannot be inferred from an ACTIVE program.
3. Get the actual Square loyalty signup/status link from the dashboard before publishing any enrollment QR. Do not manufacture a URL or expose a customer-specific link as the general signup link.
4. Verify an actual Apple Pay invitation on the café reader, complete customer acceptance, add the pass and check the initial balance. On another eligible purchase, verify the account is recognized, points accrue once and an available reward can be redeemed. Physical device and reader results are separate from API readiness.
5. Optional birthday collection and marketing require their own explicit customer flow and channel permissions. Existing birthdays can be viewed in Operations; this release does not initiate a birthday campaign.

References: [Square enrollment](https://squareup.com/help/us/en/article/6469-enroll-to-square-loyalty-using-square-point-of-sale), [Loyalty API](https://developer.squareup.com/docs/loyalty-api/overview), [loyalty account search](https://developer.squareup.com/reference/square/loyalty-api/search-loyalty-accounts), [bulk customer retrieval](https://developer.squareup.com/reference/square/customers-api/bulk-retrieve-customers).
