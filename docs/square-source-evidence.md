# Square source evidence

Square is the selected POS. This local adapter is a **Sandbox source-evidence stage**: it reads selected order/payment/refund fields, retains versioned evidence and records bounded import receipts. It does not post income, closeouts, stock consumption, tips or payroll. Real Square access, financial reconciliation and production operation remain unaccepted.

The application worker stays disabled unless explicitly configured. The low-level reader pins API version `2026-09-16` and uses fixed environment-to-host mappings; the application configuration/ingest commands accept Sandbox source mappings only. It verifies the exact merchant, active location, currency and timezone before reading resources. Source identities retain their case; no fuzzy account/location matching occurs.

## Data and retry contract

- Orders use a numeric version when supplied; POS-created orders may omit it and use their update timestamp. Payments/refunds use update timestamps. A version-scheme change or conflicting facts for one version requires review.
- Read windows use update time, explicit pagination and an overlapping/backfill-compatible receipt. Payment/refund reads override the default created-date lower bound so late changes to older sales are not silently excluded. Real API acceptance must confirm these pinned queries.
- Only bounded, allowlisted fields are retained; guest, card and receipt payload fields are removed. Missing money stays absent. Money is an exact safe integer in the mapped currency; original, net, tax, tip, service-charge and refund amounts retain separate meanings. Line-item, comp and sold-item mapping are not implemented by this stage.
- An entire source window validates and persists atomically. Immutable private versions retain history; older observations cannot replace the current head. A successful request receipt replays without another provider read. Default caps are31 elapsed days,100 pages per resource kind,10,000 retained versions and32MiB per window; exceeding a cap fails the window and requires narrowing it.
- Terminal jobs and their attempt identities remain immutable. An Owner/Admin uses the existing `retry_integration_sync_job` command to queue a new retry ID with lineage and an incremented attempt. The original failure remains. Queued requests bind the original source mapping and dates; failed attempts cannot silently become successes.
- New source receipts bind the approved mapping. Older null-scope receipts remain unchanged and require review. Mapping with retained source versions or accepted runs cannot change silently; a reviewed remapping procedure is still needed.
- Connection state remains pending reconciliation after successful source transport. Financial posting is always false. Pausing the connection prevents further reads/imports; retained records and audit evidence remain.

## Configuration and operation

An Owner/Admin configures the exact fake Sandbox merchant/location through `configure_square_source_connection(requestId, localLocationId, merchantId, squareLocationId, enabled)`. The local location supplies its timezone; this rehearsal maps USD. No API credentials are stored in the public configuration. The approved merchant/location mapping and broader ownership workflow need real restaurant acceptance.

Server-only settings:

```text
LE_YARD_SQUARE_SOURCE_SYNC_ENABLED=false
SQUARE_SOURCE_SYNC_SECRET=
SQUARE_SOURCE_CONNECTION_ID=
SQUARE_SANDBOX_ACCESS_TOKEN=
```

Provide a strong secret of at least32 characters and the actual Sandbox token through private server secret storage when authorized. Never prefix these variables with `NEXT_PUBLIC_`, include them in reports, or paste credentials into chat. A trusted caller can POST JSON containing only `requestId`, `windowFrom` and `windowTo` to `/api/internal/integrations/square-source`, with the configured Bearer secret. The connection comes from server configuration. The response explicitly says provider acceptance and financial posting are false. Responses prohibit caching; body bytes are bounded.

A signature utility verifies the exact configured HTTPS notification URL and raw UTF-8 bytes using constant-time HMAC comparison. No Square webhook subscription, webhook receipt ledger or public webhook handler is enabled by this work. Polling is a controlled worker invocation; no recurring production job was installed.

## Local verification

Use the guarded `tests/local-readiness/square-source.test.mjs` with the existing explicit loopback fixture/status/evidence paths and `vitest.local-readiness.config.mts`. It uses real local Auth, Data API and PostgreSQL with an isolated fake HTTP Square provider through injected test transport. No actual Square API request or credential is used. It retains labeled source/audit/job records, disables its fake source connection and closes its provider server.

The native RLS gate includes44 Square assertions in `08_square_source_evidence.sql`; the complete suite has194 assertions across9 required files. Actual Auth/Data API denial is separate from SQL JWT-helper evidence. A permission-denied native SQL-wrapper probe crashed this pinned PostgreSQL17.6 build; its failed baseline remains F44. Safe ACL checks and actual Auth/Data API refusals cover the boundary, while independent platform diagnosis remains open.

Focused source-client/worker-boundary unit tests cover37 cases. The broader unit, portable migration, build, types, typecheck, lint and browser results are separate, version-bound evidence in the readiness package.

## Remaining acceptance

Actual Square developer/Sandbox access and permissions; account setup and commercial terms; representative acknowledgement; real API query/version behavior and rate limits; missing identifiers and credential rotation; owner setup/remapping UI; source-completeness and refund/tender/tax/service-charge/comp reconciliation; business-date rules and line-item/catalog mappings; reviewed canonical income posting and closeout comparison; timecard/payroll authority; webhook deduplication and scheduling; real devices, offline settlement and staff acceptance. The unused prior POS adapter/client/setup/CSV contract are removed. Its old worker is retired with HTTP410. Historical SQL identities and records remain for audit compatibility; attendance authority is unconfigured.

References: [Square Sandbox](https://developer.squareup.com/docs/devtools/sandbox/overview), [Square API specification](https://github.com/square/connect-api-specification/blob/master/api.json), [Search orders](https://developer.squareup.com/docs/orders-api/manage-orders/search-orders), [Payment reads](https://developer.squareup.com/reference/square/payments-api/list-payments), [Refund reads](https://developer.squareup.com/reference/square/refunds-api/list-payment-refunds), [Webhook validation](https://developer.squareup.com/docs/webhooks/step3validate).
