# Square source evidence

Square is the selected POS. The adapter reads selected order, payment and refund fields, keeps versioned evidence and records bounded import receipts. It does not post income, closeouts, stock consumption, tips or payroll. Both Sandbox and a manual Ninth Avenue production pilot are supported. A verified mapping or successful import does not certify the figures for service close.

The application worker stays disabled unless explicitly configured. The reader pins API version `2026-09-16` and uses a fixed host per environment. It verifies the exact merchant, active location, currency and timezone before reading resources. In production it also checks that Square's address is the Ninth Avenue restaurant, so another location in the same merchant account cannot be substituted. Source identities retain their case.

## Data and retry contract

- Orders use a numeric version when supplied; POS-created orders may omit it and use their update timestamp. Payments/refunds use update timestamps. A version-scheme change or conflicting facts for one version requires review.
- Read windows use update time, explicit pagination and an overlapping/backfill-compatible receipt. Payment/refund reads override the default created-date lower bound so late changes to older sales are not silently excluded. Real API acceptance must confirm these pinned queries.
- Only bounded, allowlisted fields are retained; guest, card and receipt payload fields are removed. Missing money stays absent. Money is an exact safe integer in the mapped currency; original, net, tax, tip, service-charge and refund amounts retain separate meanings. Line-item, comp and sold-item mapping are not implemented by this stage.
- An entire source window validates and persists atomically. Immutable private versions retain history; older observations cannot replace the current head. A successful request receipt replays without another provider read. Default caps are31 elapsed days,100 pages per resource kind,10,000 retained versions and32MiB per window; exceeding a cap fails the window and requires narrowing it.
- Terminal jobs and their attempt identities remain immutable. An Owner/Admin uses the existing `retry_integration_sync_job` command to queue a new retry ID with lineage and an incremented attempt. The original failure remains. Queued requests bind the original source mapping and dates; failed attempts cannot silently become successes.
- New source receipts bind the approved mapping. Older null-scope receipts remain unchanged and require review. Mapping with retained source versions or accepted runs cannot change silently; a reviewed remapping procedure is still needed.
- Connection state remains pending reconciliation after successful source transport. Financial posting is always false. Pausing the connection prevents further reads/imports; retained records and audit evidence remain.

## Configuration and operation

The existing authenticated Sandbox RPC is unchanged for operators: `configure_square_source_connection`. Production uses `configure_square_production_source_connection`; it is restricted to the Ninth Avenue tenant and location. The Operations drawer verifies the IDs with Square before saving the mapping. Neither mapping stores API credentials.

Server-only settings:

```text
LE_YARD_SQUARE_SOURCE_SYNC_ENABLED=false
SQUARE_SOURCE_ENVIRONMENT=sandbox
SQUARE_SOURCE_SYNC_SECRET=
SQUARE_SOURCE_CONNECTION_ID=
SQUARE_SANDBOX_ACCESS_TOKEN=
SQUARE_PRODUCTION_ACCESS_TOKEN=
```

Production pilot:

1. In the Square Developer Console, locate the correct production application. Prefer an OAuth token with only `MERCHANT_PROFILE_READ`, `ORDERS_READ`, and `PAYMENTS_READ` if there is an existing way to issue and rotate one for this app. A Square personal production token works for a single merchant but is unrestricted by Square; use only the production secret store. Never prefix credentials with `NEXT_PUBLIC_` or paste them into chat. The application does not yet automate OAuth refresh.
2. Identify the Ninth Avenue location in Square. An operator can use `node scripts/square-production-preflight.mjs [--location-id <id>]` with a token from a secure operator session or stdin. Match a known physical site; never select the first ID by default. Add the credential as `SQUARE_PRODUCTION_ACCESS_TOKEN` to the **Operations** Vercel project on **Production** only.
3. Coordinate the schema upgrade and Operations, Host and Phone releases. All three surfaces use the same strict schema-health contract. Stage all three builds before applying the shared migration. Do not assign the staged builds to live domains until the new schema is confirmed. Check the three production health endpoints and protected pages after cutover.
4. In Operations, switch to Ninth Avenue. As an Owner/Admin, open **Integrations → Square**. Enter the production merchant and location IDs and select **Verify and save location**. The database keeps the status Pending until reconciliation.
5. On the Operations project, set `SQUARE_SOURCE_ENVIRONMENT=production` and `LE_YARD_SQUARE_SOURCE_SYNC_ENABLED=true` for the pilot deployment. Select **Import last 24 hours** and check the returned counts and the sync ledger. The manual import resolves the location's saved connection; no worker bearer secret is needed for the signed-in Operations button. Verify a real business-day sample in Square before relying on the figures. An empty window proves API transport only.

For internal automation later, provision a separate random worker secret of at least 32 characters and set `SQUARE_SOURCE_CONNECTION_ID` to the exact saved connection. A trusted caller can POST only `requestId`, `windowFrom`, and `windowTo` as JSON to `/api/internal/integrations/square-source` with that worker Bearer secret. Production windows on this route are capped at 72 elapsed hours and the Operations button reads 24 hours. An accepted receipt does not approve the provider for financial posting. Disable the environment flag to stop all runs, or pause the exact production mapping with the owner RPC and `p_enabled=false`; this does not delete evidence.

A signature utility verifies the exact configured HTTPS notification URL and raw UTF-8 bytes using constant-time HMAC comparison. No Square webhook subscription, webhook receipt ledger or public webhook handler is enabled by this work. Polling is a controlled worker invocation; no recurring production job was installed.

## Local verification

Use the guarded `tests/local-readiness/square-source.test.mjs` with the existing explicit loopback fixture/status/evidence paths and `vitest.local-readiness.config.mts`. It uses real local Auth, Data API and PostgreSQL with an isolated fake HTTP Square provider through injected test transport. No actual Square API request or credential is used. It retains labeled source/audit/job records, disables its fake source connection and closes its provider server.

The native RLS gate includes44 Square assertions in `08_square_source_evidence.sql`; the complete suite has194 assertions across9 required files. Actual Auth/Data API denial is separate from SQL JWT-helper evidence. A permission-denied native SQL-wrapper probe crashed this pinned PostgreSQL17.6 build; its failed baseline remains F44. Safe ACL checks and actual Auth/Data API refusals cover the boundary, while independent platform diagnosis remains open.

Focused source-client/worker-boundary unit tests cover37 cases. The broader unit, portable migration, build, types, typecheck, lint and browser results are separate, version-bound evidence in the readiness package.

## Remaining acceptance

Actual Square production authentication and representative readback; source-completeness and refund/tender/tax/service-charge/comp reconciliation; business-date rules and line-item/catalog mappings; reviewed canonical income posting and closeout comparison; timecard/payroll authority; webhook deduplication and scheduling; real devices, offline settlement and staff acceptance. Church Street requires a separate pilot and an exact location mapping of its own. The prior POS worker remains retired (HTTP 410); historical records are retained and attendance authority is unconfigured.

References: [Square Sandbox](https://developer.squareup.com/docs/devtools/sandbox/overview), [Square API specification](https://github.com/square/connect-api-specification/blob/master/api.json), [Search orders](https://developer.squareup.com/docs/orders-api/manage-orders/search-orders), [Payment reads](https://developer.squareup.com/reference/square/payments-api/list-payments), [Refund reads](https://developer.squareup.com/reference/square/refunds-api/list-payment-refunds), [Webhook validation](https://developer.squareup.com/docs/webhooks/step3validate).
