# Integration framework

Le Yard OS treats every external system as an adapter behind a stable internal boundary. Core operations work without live Toast or Resy access. Manual CSV is the initial supported transport.

## Adapter contract

Each connection records:

- tenant and optional location scope
- provider, display name, adapter version, and capability set
- connection health and last successful sync timestamp
- immutable sync jobs, bounded retry state, import jobs, adapter events, and row-level outcomes

Credentials live in `private.integration_credentials`. Browser roles have no privileges on that schema. Encryption keys belong in the trusted runtime/key manager, not in a database row.
The connected read model also omits the public connection's free-form `configuration` object so this operational screen cannot become an accidental secret viewer.

## Manual CSV flow

1. A password-authenticated Owner/Admin selects an active location and a supported import contract.
2. The browser performs a fast validation pass for UTF-8 CSV structure, normalized unique headers, exact row width, size/row/cell ceilings, required fields, unsafe control bytes, and spreadsheet formulas.
3. The server authorizes the actor from the session and issues a one-use signed upload for the tenant/location path in the private `imports` bucket.
4. After upload, the server downloads the exact stored bytes, checks the signed size and path again, repeats validation, and calculates a SHA-256 fingerprint.
5. An atomic database command derives actor, tenant, and timestamps; it creates an idempotent queued import job and append-only audit/integration evidence.
6. A future approved import processor reads the private source, performs source-specific date, currency, external-ID, and location mapping, stages row outcomes, and applies only human-reviewed mappings.
7. The import file, counts, non-sensitive failures, actor, and timestamps remain available in scoped history.

Manual imports reject values beginning with `=`, `+`, `@`, or a nonnumeric `-` after leading whitespace. Exports independently escape formula-like values. Currency remains integer cents and timestamps include an explicit timezone after source-specific processing.

Demo mode remains synthetic. Connected mode reads only persisted connection/job evidence and never simulates a successful upload, retry, or provider sync. The connected CSV path currently validates, fingerprints, stores, and queues source files; applying rows to restaurant records remains disabled until real source samples, mapping rules, and the import worker are approved.

## Toast adapter

Initial intended capability: read sales/closeout source records. Live synchronization is disabled until the restaurant confirms eligible Toast API access, credentials, restaurant GUIDs, permitted locations, rate limits, historical range, and data-processing approval.

The adapter must:

- remain read-only unless separate write access is explicitly approved
- preserve Toast external IDs for idempotency
- normalize money to integer cents and retain source totals
- map business dates using the location timezone
- never treat an imported total as an approved closeout or tip distribution
- retry transient failures with bounded exponential delay and surface permanent errors for review

## Income check-state boundary

The Income workspace reads a provider-neutral latest-check fact rather than querying a Toast-specific browser model. Only a trusted service-role adapter may call `ingest_income_sales_check`. The command is tenant/location scoped, serializes each external check, rejects stale or conflicting source versions, resolves the restaurant operating date, and stores money in integer cents. Browser roles cannot select raw external check identifiers or execute ingestion.

Until an approved adapter supplies these facts, connected Income renders live revenue and tracked contribution as unavailable—not zero—and continues to show only authoritative internal labor, recorded expense, closeout, received-inventory, waste, and reservation-demand evidence. Reservation covers are never converted into revenue. Received inventory remains a purchasing diagnostic rather than same-day COGS, and tracked contribution is explicitly not accounting profit.

## Reservation writer and future Resy adapter

Le Yard's first-party reservation platform is the intended authoritative writer, not yet the proven live source of truth. Public inventory stays disabled until the owners select exactly one writer for the pilot and shadow reconciliation shows that covers, tables, cancellations, modifications, and availability match the incumbent source. A future Resy adapter may read or reconcile reservations and guest/visit context, but live synchronization is disabled until approved integration access and an independently tested conflict protocol are supplied.

The system must never accept public writes from two reservation sources merely because both adapters are configured. If two-way writing is ever proposed, it requires explicit conflict ownership, external identifiers, replay-safe source bindings, delayed/out-of-order event handling, cancellation and date-swap tests, reconciliation evidence, a kill switch, and separate approval. None of those conditions is currently satisfied.

The adapter must preserve consent provenance and must not infer marketing consent from a reservation. Guest deduplication remains a human-reviewed workflow.

The public Le Yard website is not a Resy adapter. It uses the scoped, versioned Le Yard booking API described in [reservations.md](reservations.md).

## Payroll/accounting adapters

The application currently generates payroll-support exports. It does not file taxes, originate payroll, move money, or post accounting entries. A future provider adapter requires a field mapping, approval state, idempotency key, reconciliation response, and explicit owner authorization.

## Retry and error handling

- transient failures enter a bounded retry schedule
- authorization/configuration failures pause the connection
- row errors remain reviewable without exposing raw credentials or unrelated personal data
- completed sync events are immutable
- manual retry creates a new server-stamped job rather than rewriting terminal history
- health status must never imply fresh data when the last sync is stale or partial

## Production enablement checklist

- [ ] approved provider agreement and credentials
- [ ] nonproduction/sandbox validation when available
- [ ] exact locations and capability scope
- [ ] field map and timezone/currency rules
- [ ] backfill date range and volume estimate
- [ ] retry, rate limit, and alert thresholds
- [ ] privacy/consent review
- [ ] reconciliation report and human approval step
- [ ] credential rotation owner
- [ ] disconnect and rollback procedure
- [ ] audit review after first live sync
