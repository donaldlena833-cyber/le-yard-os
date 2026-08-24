# Le Yard OS — Phase 2 product-system blueprint

Date: August 19, 2026
Status: implementation-ready product direction; no production mutation or deployment performed
Predecessor: [Phase 1 deep role user testing](./phase-1-role-user-testing-2026-08-19.md)

## Executive decision

Le Yard should remain **two focused staff products with one operational spine**:

- **Le Yard Host** is the sole staff-facing transactional workspace for reservations, waitlist, floor, and guest records.
- **Le Yard OS** is the role-adaptive workspace for Today, service, labor, BOH, money, reporting, and administration.
- Both surfaces consume the same server-side identity, capability, data-scope, business-clock, command, lifecycle, and audit contracts.
- Operations may show bounded reservation summaries and exceptions, but it deep-links an authorized user into Host for staff reservation or guest mutations.

This is not a visual redesign and it is not a rewrite. It is the minimum architecture that makes the existing product truthful, role-safe, recoverable, and testable during a real service.

The order matters:

```text
baseline truth
    ↓
role/data authorization ─── shared action safety ─── Toast retry hotfix
    ↓                          ↓
Host reservations        persona Today / Service
    ↓                          ↓
finance/governance ─── labor/schedule/integrations
    ↓
BOH purchasing/costing
    ↓
manual Prep
    ↓
connected service rehearsal and release gate
```

## Phase 2 visual handoff

The complete, interactive, 1440-pixel design board is [phase-2-operating-blueprint.html](<../output/product-audit/2026-08-19/phase-2-operating-blueprint.html>). It uses the existing Le Yard graphite, ivory, saffron, positive, warning, and danger language and incorporates the real Phase 1 evidence instead of inventing a second design system.

| Frame | Purpose | Export |
|---|---|---|
| 00 | North star and product thesis | [cover](<../output/product-audit/2026-08-19/40-phase-2-cover.png>) |
| 01 | Host + OS topology decision | [topology](<../output/product-audit/2026-08-19/41-phase-2-topology.png>) |
| 02 | Five-part identity and role projection | [role projection](<../output/product-audit/2026-08-19/42-phase-2-role-projection.png>) |
| 03 | Role-specific command views | [role views](<../output/product-audit/2026-08-19/42b-phase-2-role-views.png>) |
| 04 | Universal action-safety grammar | [action safety](<../output/product-audit/2026-08-19/43-phase-2-action-safety.png>) |
| 05 | Data-truth and simulation contract | [data truth](<../output/product-audit/2026-08-19/44-phase-2-data-truth.png>) |
| 06 | Operational lifecycles and corrections | [lifecycles](<../output/product-audit/2026-08-19/44b-phase-2-lifecycles.png>) |
| 07 | 30/60/90 delivery sequence | [roadmap](<../output/product-audit/2026-08-19/45-phase-2-roadmap.png>) |
| 08 | Owner-ready exit gates | [exit gates](<../output/product-audit/2026-08-19/46-phase-2-exit-gates.png>) |

The HTML is intentionally frame-based and self-contained so the frames can be imported or rebuilt one-for-one in Figma without reinterpretation.

## 1. Product topology

### Recommended: dedicated Host writer, projected OS context

| Product | Owns | Does not own |
|---|---|---|
| Public restaurant site | Brand, menu, hours, public navigation | Staff operations |
| Guest reservation surface | Guest availability, booking, confirmation, cancellation within guest policy | Staff table and service mutations |
| Le Yard Host | Staff reservation book, waitlist, floor, guest recovery, delivery-state visibility | Finance, inventory, HR, broad administration |
| Le Yard OS | Today, Service, Schedule, Toast mirror, BOH, finance, reports, approvals, settings | A second staff reservation editor |

The existing deployment split in [app-surface.ts](../src/lib/app-surface.ts) should remain. The correction is not to combine the screens; it is to share the contracts beneath them.

The Host → OS boundary is deliberate:

- Host remains fast, narrow, and usable at the door.
- Managers receive a prominent **Open Host** action with location, business date, and selected record preserved.
- OS reads a safe reservation/service projection for Today and kitchen demand.
- Host receives a safe, read-only strip for the published pre-shift, current canonical 86 state, staffing exceptions, and provider failures.
- The destination reauthorizes every deep link. Capability names, access tokens, or guest secrets never travel in the URL.

### Alternative: identical reservation workspace in both deployments

This is viable only if Host and OS render the exact same shared module, ship simultaneously, use identical cache/offline behavior, and pass contract-level parity tests. It reduces context switching for managers but creates two staff mutation surfaces and doubles the browser/session/release acceptance burden.

**Decision:** do not take this alternative now. Reconsider only if measured manager switching cost exceeds the operational and release risk.

## 2. Identity, experience, authority, and data scope

The current product frequently treats `owner`, `manager`, `employee`, or a regex-derived `chef` persona as if each one completely describes a person. Phase 2 separates five independent inputs:

```ts
type AccessContext = {
  membershipRole: "owner" | "admin" | "manager" | "employee";
  experienceMode:
    | "host"
    | "server"
    | "bartender"
    | "boh_staff"
    | "kitchen_lead"
    | "service_manager"
    | "owner_operator";
  assignment: {
    organizationId: string;
    locationId: string;
    jobId: string | null;
    stationId: string | null;
    sectionId: string | null;
    businessDate: string;
    servicePhase: string;
  };
  effectiveCapabilities: string[];
  dataScope: {
    organizations: string[];
    locations: string[];
    stations: string[];
    sections: string[];
    subjectPersonId: string | null;
    audiences: string[];
  };
};
```

Rules:

1. **Membership role** governs invitations, security administration, location administration, and capability administration.
2. **Experience mode** chooses navigation, vocabulary, Today composition, and prioritization. It never grants authority.
3. **Active assignment** says where and in what context the person is working now.
4. **Effective capability** authorizes every route, read model, field, export, command, RPC, and worker-side effect.
5. **Data scope** removes records and fields the actor should never receive. Sensitive data is not fetched and hidden with CSS.
6. An owner working the door may switch to Host mode, but the switch neither grants nor removes capabilities.
7. Operational `privilegedRoles` bypasses should be removed. Owner/admin accounts receive explicit capabilities; governance-only operations may still require a membership role.
8. Self-service Schedule, Toast status, Earnings, assigned Tasks, and pre-shift acknowledgement are subject-scoped entitlements. Chef mode must not remove them.

### One route policy, consumed everywhere

Create one declarative `ROUTE_POLICY` and use it for:

- navigation enumeration;
- direct page access;
- server read models;
- route handlers and exports;
- action palette and global Create;
- demo and connected workspaces;
- API/RPC authorization tests.

The current navigation admits role **or** capability in [navigation.ts](../src/components/shell/navigation.ts), while operational actions still contain privileged role bypasses in [action-registry.ts](../src/lib/actions/action-registry.ts). These must converge on the same exact-capability decision.

Reports require a server-owned `REPORT_CAPABILITY_BY_KIND` mapping. Generic `/reports` access must never imply tips, payroll, receipts, expenses, COGS, or financial export access.

### Capability vocabulary refinements

- Split service allergy/dietary context from commercial guest history and private management notes.
- Add `service.availability.signal` for a low-risk running-low report; retain `service.availability.manage` for 86/restore.
- Add bounded read capabilities for recipes, stock, vendors, roster, team schedule/time, invoices, and operational reports.
- Split operational People from private HR records and documents.
- Keep `time.review` and `time.approve` separate.
- Keep purchase create, approve, send, receive, and correction separate.
- Make report-kind authorization reusable by UI, endpoint, RPC, export, and RLS.

## 3. Role-projected experiences

There should be one system of record, not one shared dashboard. Each opening view is a server-generated projection containing the smallest complete set of facts needed to act.

| User | Primary surface | Opening view | Default routes/actions | Omitted by default |
|---|---|---|---|---|
| Host / maître d’ | Host | Current book, next arrivals, late/no-show, waiting/offer state, unassigned parties, table conflicts, pacing, delivery failures, narrow brief/86/staffing strip | Reservations, Guests, authorized Messages; self Schedule/Toast state in OS | Revenue, management log, private HR, purchasing, configuration without `reservations.configure` |
| Server | OS | Shift, assigned section/station, complete published brief, current 86, assigned-service allergy/large-party facts, personal tasks, Toast state | Today, Schedule, Time, scoped Messages, Tasks, Earnings | Revenue, guest contact/spend history, other staff records, publish/resolve controls |
| Bartender | OS | Bar station, bar prep, beverage running-low/86, delivery exceptions, cover demand interval, personal tasks, Toast state | Today, Prep, scoped Inventory, Schedule, Time, Messages, Earnings | General finance, broad inventory purchasing, management decisions, private guest notes |
| Chef / BOH | OS | Next 90-minute covers, known allergies and large parties, canonical 86, prep readiness by station, BOH schedule vs Toast, deliveries, waste, stock exceptions, freshness | Today, Prep, Inventory, Recipes, Vendors, Service, Schedule, Messages, Time, Earnings according to capability | Owner finance, FOH private log, full CRM, payroll/admin settings. Never invent KDS/ticket pace. |
| Manager | OS + Open Host | Whole-room exceptions: reservations, service readiness, staffing, breaks, guest recovery, handoff, provider health, closeout state | Service, Schedule, Time review, People roster, Tasks, Messages, operational Reports, Closeout preparation, domain routes by capability | Financial metrics without finance capability, private HR without private-record capability, cross-location data |
| Owner / admin | OS, switchable presentation | Location/portfolio exceptions, approved performance, approvals, source health, configuration and launch blockers | Money, Reports, People Admin, Integrations, Settings, Audit and operational domains only when authorized | Unverified provider status, synthetic values in connected mode, cross-location data outside scope; access role never claims legal ownership |

### Today projection contract

Each Today response should include:

- `principal`, `experienceMode`, assignment, business date, and location;
- a list of cards already filtered by exact capability and data scope;
- source and observation metadata per card;
- an explicit `live`, `stale`, `synthetic`, `not_connected`, `blocked`, or `empty` state;
- only valid actions for the current actor, record version, service phase, and connection state;
- a safe deep link when work belongs in the other deployment.

Do not send an owner card to an employee and rely on component branching. The field and action should not exist in the payload.

## 4. Operational handoffs

Every cross-domain or cross-surface envelope should carry:

```text
organizationId · locationId · businessDate · sourceObservedAt
version · actor · audience · subjectId · trace/request ID
```

The required handoffs are:

1. **Host → service team:** covers, arrivals, pacing, waitlist, and exceptions. Server receives assigned-service facts; Chef receives demand/allergy aggregates; Manager receives whole-room exceptions.
2. **BOH/bar → Host:** canonical item availability events. Host never maintains a second 86 truth.
3. **Manager → staff:** an immutable, audience-specific pre-shift version. The complete applicable version is visible before acknowledgement. Private manager notes stay separate.
4. **Schedule → Toast:** Schedule is the plan; Toast is attendance authority. Today displays both timestamps and the discrepancy, then routes correction to Toast.
5. **Reservations → table service:** ephemeral assigned-table context only; no CRM contact, spend, or management notes.
6. **Prep → inventory:** completion first previews ingredients consumed and finished batch created; confirmation posts append-only ledger movements.
7. **Manager → owner:** manager prepares/submits closeout; a separately authorized actor reviews and locks. Later correction is linked evidence.

## 5. Universal action-safety system

“Are you sure?” is not a universal solution. Friction must match the consequence, and every correction must be real at the domain/database level.

The current [action registry](../src/lib/actions/action-registry.ts) describes reversibility, while the generic [workflow executor](../src/data/execute.ts) returns only ordinary success/error data. Replace the single descriptive reversibility flag with orthogonal, executable safety axes:

```ts
type ActionSafetyContract = {
  commandKey: string | null;
  effect: "navigation" | "draft" | "domain_state" | "ledger" | "external_side_effect";
  commit:
    | "none"
    | "immediate"
    | "review_confirm"
    | "version_publish"
    | "acknowledge"
    | "approve_lock";
  correction: {
    mode: "inverse" | "compensate" | "supersede" | "none";
    commandKey?: string;
    serverWindowSeconds?: number;
  };
  confirmation: {
    level: "none" | "summary" | "reason" | "typed_phrase" | "step_up";
    phrase?: string;
    reasonRequired?: boolean;
  };
  concurrency: Array<"entity_version" | "aggregate_revision" | "head_event" | "preview_hash">;
  offline: "cached_read" | "local_draft" | "online_only";
};
```

Confirmation, commit style, and correction are independent. `service.running_low` can be immediate + inverse; `service.86` review-confirm + inverse; `schedule.publish` version-publish + supersede; `closeout.approve` approve-lock + compensate; `preshift.acknowledge` acknowledge + no correction.

The registry remains a presentation/routing source. It is never the authorization authority: each narrow domain RPC re-resolves the principal, capability, data scope, AAL, threshold, current state, and correction eligibility.

| Class | Use when | Interaction | Correction |
|---|---|---|---|
| R1 — Immediate + Undo | Speed matters and a valid inverse exists | Commit, then show affected record and an 8–10 second Undo | Append a version-checked inverse event |
| R2 — Review + Confirm | A commitment or downstream person changes | Show exact actor, object, before/after, conflicts, reach, and a specific final verb | Reopen, return, revoke, or linked correction command |
| R3 — Preview + Publish | Shared content or configuration is versioned | Draft freely; preview exact diff and impact; explicitly publish | Restore/supersede with a new version |
| R4 — Lock + Compensate | Financial, ledger, approval, or issued evidence | Final summary, authority, anomalies, irreversible warning; step-up/typed confirm at configured threshold | Linked adjustment, reversal, return, cancellation, or superseding record |
| Dirty exit | A long form has unsaved work | Keep editing / Save draft / Discard changes | Draft expires under a declared policy; it never silently posts |

### Interaction sequence

```text
Resolve → Preview → Authorize → Commit → Receipt → Correct if needed
```

1. **Resolve:** server returns the action definition for actor, subject, state, location, service phase, source state, and device/offline policy.
2. **Preview:** calculate the exact affected record, before/after state, downstream effects, conflicts, and authority requirement.
3. **Authorize:** enforce capability, scope, different-person approval, configured threshold, and optional AAL2 step-up.
4. **Commit:** one idempotency key, one expected version, one domain transaction.
5. **Receipt:** return the audit event, resulting version/state, durable correction action, and source refresh state.

### Preview request and receipt

Major changes first create an expiring preview bound to actor, target, expected heads, normalized payload, policy version, and calculated effects:

```ts
type CommandPreviewRequest<P> = {
  actionKey: string;
  schemaVersion: 1;
  organizationId: string;
  locationId?: string;
  target: { type: string; id: string };
  expected: {
    entityVersion?: number;
    aggregateRevision?: number;
    headEventId?: string;
  };
  payload: P;
};

type CommandPreview = {
  previewId: string;
  actionKey: string;
  target: { type: string; id: string; label: string };
  expected: {
    entityVersion?: number;
    aggregateRevision?: number;
    headEventId?: string;
  };
  previewHash: string;
  expiresAt: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  effects: Array<{
    kind: string;
    label: string;
    severity: "info" | "warning" | "critical";
  }>;
  warnings: Array<{ code: string; message: string; blocking: boolean }>;
  confirmation: {
    level: "none" | "summary" | "reason" | "typed_phrase" | "step_up";
    phrase?: string;
    reasonRequired: boolean;
    requiresAal2: boolean;
  };
};
```

The preview hash covers the canonical action key, target, expected heads, normalized payload, authoritative before/after projection, downstream effects, and policy version. Confirmation never trusts a client-supplied diff; the server recomputes it under lock.

### Apply envelope and durable receipt

```ts
type CommandEnvelope<TInput> = {
  commandId: string;
  schemaVersion: 1;
  actionKey: string;
  organizationId: string;
  locationId?: string;
  target: { type: string; id: string };
  expected: {
    entityVersion?: number;
    aggregateRevision?: number;
    headEventId?: string;
    previewId?: string;
    previewHash?: string;
  };
  payload: TInput;
  reason?: string;
  correlationId?: string;
  causationCommandId?: string;
  client: {
    surface: "operations" | "host";
    sentAt: string;
    timezone: string;
    tabId: string;
  };
};

type CommandReceipt<TResult> = {
  commandId: string;
  actionKey: string;
  replayed: boolean;
  target: { type: string; id: string };
  actorId: string;
  appliedAt: string;
  beforeVersion?: number;
  afterVersion?: number;
  result: TResult;
  auditEventIds: string[];
  correction: null | {
    mode: "inverse" | "compensate" | "supersede" | "none";
    actionKey?: string;
    available: boolean;
    expiresAt?: string;
    expectedCurrentVersion?: number;
  };
  warnings: string[];
};
```

Never accept `actorId`, role, capability, approver, AAL, or authoritative timestamps from the client. Organization/location are cross-checked against the target, not trusted as scope proof. Exact retries return the exact persisted result, versions, timestamps, effect IDs, and audit IDs; only the transport-level `replayed` marker differs.

### Typed failures

```ts
type CommandErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "step_up_required"
  | "not_found"
  | "stale"
  | "conflict"
  | "preview_expired"
  | "preview_stale"
  | "undo_expired"
  | "undo_superseded"
  | "offline"
  | "database";

type CommandFailure = {
  ok: false;
  code: CommandErrorCode;
  reason: string;
  message: string;
  current?: {
    entityVersion?: number;
    aggregateRevision?: number;
    headEventId?: string;
  };
};
```

Use stable machine codes in SQLSTATE detail/hint fields; never branch on prose. `stale`, `preview_stale`, `undo_expired`, and `undo_superseded` demand different recovery interfaces.

### Transaction algorithm

Every domain command follows the same sequence:

1. Verify the authenticated principal.
2. Normalize domain values server-side: text, enums, set ordering, decimal scale, instants.
3. Take an advisory lock on `commandId`.
4. If the command already exists, return the stored receipt only when actor/action/target/scope/canonical-payload hash match; otherwise reject ID reuse with zero writes.
5. Resolve the target and authoritative organization/location.
6. Re-resolve exact capability, data scope, AAL, different-person rule, and threshold.
7. Lock affected aggregates and ledger heads in deterministic order.
8. Check entity version, aggregate revision, head event, and preview expiry/hash.
9. Recompute the preview under those locks; any mismatch is `preview_stale` with zero writes.
10. Bind transaction-local command context for audit triggers.
11. Apply domain writes, inverse metadata, ledger entries, and outbox events.
12. Persist result/effect evidence and mark the command complete inside the same transaction.
13. Return the durable receipt.

Idempotency lookup must happen before present-state transition checks. Otherwise a retry can return a later record state or fail a new availability check even though its first application already succeeded.

Use shared private helpers, but do **not** expose a generic security-definer `execute_command(actionKey, payload)` dispatcher. Keep narrow, explicitly granted, typed domain RPCs such as `apply_reservation_arrival_v2` and `publish_schedule_v2`.

### Additive evidence model

Preserve the existing `private.operation_requests` foundation and add sidecars rather than renaming or replacing it:

- `private.operation_command_receipts`: request/action/target, role/AAL/capability snapshot, preview, before/after versions and hashes, redacted result evidence, correction mode/window, correlation/causation, applied time.
- `private.command_previews`: actor-bound target, expected state, canonical payload hash, effects hash, capability/AAL policy, expiry, consumed command.
- `private.command_effects`: one row per affected entity with sequence, versions/hashes, audit, ledger, and outbox references.
- `private.command_links`: source and correcting commands with `inverse`, `compensation`, or `supersedes` relationship.
- `public.audit_events`: add command/correlation/causation IDs, effect sequence, entity version, and event kind; use table-specific redaction allowlists.

An applied command remains applied forever. Its corrected state is derived from links; never rewrite it to “undone.” Expose receipts only through a narrow, redacting, actor/capability-aware RPC.

### Shared UI primitives

Implement one set of primitives instead of ad hoc dialogs:

- `ActionReviewDialog`: `loading → ready → submitting → applied | stale | error`; object identity, actor/location, before/after, conflicts, downstream reach, data/policy freshness, and authority.
- `ReviewConfirmDialog`: specific title and final verb; optional reason, typed confirmation, or step-up challenge. A stale result keeps the dialog open, preserves input, identifies the changed head, and offers **Review latest**.
- `ActionReceiptToast`: committed result, durable receipt link, countdown only when the server returned a valid inverse.
- `DirtyExitDialog`: Keep editing, Save draft, Discard changes.
- `CommandErrorSummary`: dialog-local `role="alert"`, preserved inputs, focus to the first actionable error, retry only when safe.
- `CommandConflictPanel`: who/what changed, latest version, Review latest, and Copy unsaved values.
- `ActionReceiptDrawer`: actor, server time, version chain, effects, causal links, and the valid correction.
- `useCommandAction`: command IDs, pending state, receipt lookup, optimistic rollback, source refresh, and multi-tab invalidation.

Pending commands disable backdrop, Escape, X, Cancel, duplicate submit, and conflicting actions. A failed command remains in context; it must not hide behind the modal. A timeout or lost response is an **uncertain outcome**, not a failure: query by idempotency key before offering Retry.

Persist only non-sensitive pending metadata in session storage: command ID, action key, target ID, payload hash, and submission time. Never store raw HR, guest, closeout, or inventory payloads there. `BroadcastChannel` should invalidate stale heads in other tabs after a receipt arrives.

### Action copy rules

- The button names the result: **Approve & lock**, **Confirm receipt & post**, **Publish schedule**, **Remove from waitlist**, **Restore availability**.
- The dialog names the exact guest, table, service date, location, amount, people, or items affected.
- The copy explains the valid correction before commitment.
- “Undo” appears only when a tested server-side inverse exists.
- Immutable records are never deleted to simulate correction.

## 6. Data-truth contract

A value is not “live” because a component rendered it. Every projection carries:

```ts
type ProjectionEvidence = {
  state: "live" | "stale" | "synthetic" | "not_connected" | "blocked" | "empty";
  source: string;
  sourceObservedAt: string | null;
  generatedAt: string;
  businessDate: string;
  scope: Record<string, string | string[]>;
  completeness: "complete" | "partial" | "blocked" | "empty";
  version: string | number | null;
  missingDependencies?: string[];
};
```

| State | Required presentation |
|---|---|
| Live | Source observed within the declared threshold; show source/time where operationally relevant |
| Stale | Keep the last-known value, label “as of,” freeze/mark timers, and limit writes that depend on freshness |
| Synthetic | Persistent Playground label on the shell and every derived card; fixed simulated clock |
| Not connected | No invented values; identify the missing provider/dataset and setup path |
| Blocked | A dependency is incomplete; name it and do not calculate a confident total |
| Empty | Connected, successfully queried, and valid zero records in the declared scope |

`generatedAt` never participates in source freshness. It tells when the projection was built, not when the underlying evidence was observed.

### Playground parity

The Playground should be synthetic, but not dishonest:

- resolve identity and route access before choosing demo/live components;
- use the same route policy, action registry, capabilities, field scopes, lifecycle reducers, and confirmation grammar;
- use one fixed restaurant-local business clock across Today, Host, Schedule, Service, and Closeout;
- scope stored state by organization + principal + surface;
- never report “booked,” “sent,” “published,” or “approved” without mutating the corresponding model;
- never substitute plausible data for missing connected configuration.

## 7. Domain lifecycles and valid corrections

| Domain | Required lifecycle | Correction contract |
|---|---|---|
| Reservation | booked → confirmed → arrived → seated → completed; cancellation/decline branches are explicit | Versioned correct/reopen. Table/allocation events must be restored consistently. Scheduled/phone overlap remains fail-closed. |
| Waitlist offer | waiting → queued → delivered/notified → accepted → seated / expired / cancelled | Deadline begins on first provider delivery success. Cancel/restore only during a defined window; provider retry is idempotent. |
| Pre-shift | draft → review → published vN → acknowledged by version | Retract/supersede with vN+1. Never delete acknowledged content. |
| Availability | available → running low → 86 → restored | Append inverse event against canonical item + location. Preserve label snapshot. |
| Schedule | draft → review → published → acknowledged → revised | Draft Undo; published revision identifies affected people and requires acknowledgement. |
| Purchase order | draft → submitted → approved → sent → partially received → received/closed/cancelled | Different-person approval and threshold in PostgreSQL. Cancel/supersede issued PO; return/credit for receipt. |
| Receiving | draft delivery → exception review → posted | Return or linked correcting receipt; never delete ledger movement. |
| Count/waste | draft → submitted → reviewed → approved → ledger posted | Compensating count/movement. Pending depletion appears in effective availability. |
| Recipe | draft → reviewed → published vN → archived | Restore/supersede version; price/yield evidence is as-of and coverage-aware. |
| Prep | planned → ready/in progress/blocked → completion preview → posted | Linked compensating inventory movement and corrected yield evidence. |
| Closeout/tips | draft → calculated → submitted → reviewed → approved/locked | Withdraw before approval; linked adjustment or superseding run after lock. |
| Attachment message | local selection → uploaded/finalized → published | Retry/cancel sender-only pending attachment; never orphan visible message text from its promised attachment. |

Database rule: every mutating command checks `expected_version` and `idempotency_key`. Every success returns `event_id`, `resulting_version`, and the only valid correction for that resulting state.

### Key command contracts

| Action | Safety/fence | Exact behavior |
|---|---|---|
| Arrive reservation | R1; reservation version | Append arrival and version N+1. Ten-second inverse restores the exact prior state as N+2 only while arrival remains the head. |
| Assign table before seating | R1; reservation version + interval allocation | Undo restores prior table IDs only while the receipt version remains current and those tables remain collision-free. Never weaken the GiST exclusion. |
| Seat | R2 unless atomic inverse is proven | Physical correction must update reservation, allocation, and table state together. No cosmetic Undo. |
| Complete | R2; reservation/allocation/table heads | Review consequence. `Correct completed reservation` atomically restores a valid reservation, collision-free allocation, and table event or changes nothing. |
| Cancel / no-show | R2; reservation version | Required reason and immutable revision. Reinstatement is a new revision and reruns availability. |
| Table Ready / Needs reset | R1; latest table-status event | Append the inverse event only while the event remains the head. |
| Floor layout | R3; aggregate revision + preview hash | Local/server draft with overlap, boundary, and egress validation; publish the whole floor atomically. Restore clones an old version into a new draft. |
| Reservation setup/reset | R3/R4; configuration revision + preview | Typed location phrase, future-commitment impact, provider/feature effects, restorable snapshot. No one-click overwrite. |
| Running low | R1; canonical item head | Append event and allow inverse while still head. |
| 86 / restore | R2; canonical item head | Confirm item/location/state/portions/reason. Append event with `previous_event_id`; Undo creates linked inverse only while current. |
| Publish pre-shift | R3; draft revision + preview hash | Immutable vN, audience-safe projection, supersede prior version. Acknowledgement binds version ID and content hash; corrections never carry acknowledgement forward. |
| Draft schedule drag | R1; shift version + schedule draft revision | Immediate within draft; inverse only while the moved version remains current. |
| Publish schedule | R3; aggregate revision + preview hash | Review week/version, shifts, open shifts, hours, estimated cost, warnings, and acknowledgement effects. One immutable publication and one notification batch. |
| Approve swap | R2; swap version + both shift versions | Name both people, roles, date/time, and effect. Concurrent decision produces one winner and one stale result. |
| Submit closeout | R2; closeout draft version + preview hash | Review sales, payments, expected/actual cash, variance, tips, covers, evidence, and missing evidence. Creates immutable pending revision. |
| Approve closeout/tips | R4; pending/calculation version + preview hash | Exact capability, different person, AAL/threshold, under-lock recalculation. Post-lock correction is a linked adjustment/superseding revision. |
| PO submit/approve/send | R2/R4; PO version + preview | Exact capability and configured different-person/threshold policy in PostgreSQL. Issued orders cancel or supersede; never delete. |
| Confirm receipt & post | R4; PO + delivery-draft versions + ledger heads | Review ordered/prior/delivered/accepted/rejected/substituted/missing/unexpected/cost/temperature/lot/expiry/evidence. Correction is linked return/adjustment. |
| Approve count/waste | R4; draft version + per-item ledger heads | Recompute under sorted locks. Show quantity/value and intervening movements. Negative result requires explicit override/reason and reconciliation exception. |
| Apply access change set | R3/R4; organization authorization revision | Review role, status, locations, explicit primary, effective capabilities, newly reachable/lost data. Owner/suspension/sensitive grants require typed confirm + AAL2. |

### Offline and reconnect contract

Realtime loss and inability to send a command are different states:

- **Online:** a command endpoint responded recently.
- **Degraded:** realtime is unavailable but HTTP is not proven offline. A command may proceed only through a fresh preview and head checks.
- **Offline:** `navigator.onLine === false` or a command endpoint fails at the network layer. All domain mutations are disabled.

Only long-form local drafts may survive offline. They must be encrypted, session-bound, principal/organization/location-bound, expiring, and purged on logout or scope switch. Never queue reservations, 86, schedule publication, finance, inventory, receiving, or access commands.

Reconnect performs a three-way comparison—server base, local draft, latest server—and offers **Reconcile**, **Save as new draft**, or **Discard**. Confirmation always generates a fresh preview. A lost response while online triggers receipt lookup by command ID, not a new command. Undo expiry uses server time; the visual countdown cannot extend it.

## 8. Concrete implementation slices

### Slice 0 — Baseline and infrastructure truth

Effort: S–M
Risk: Critical because every later result depends on it

- Preserve and reconcile the existing user-owned dirty worktree and migration head.
- Run the supported Node 22 or 24 runtime, not the current Node 25 local audit runtime.
- Inventory connected vs synthetic adapters, provider readiness, migrations, generated types, aliases, and feature flags.
- Turn the Phase 1 findings into an issue-to-test ledger.
- Keep public booking, email, SMS, push, and production provider flags off.

Exit: a reproducible baseline passes lint, database type check, typecheck, unit/PGlite verification, build, and the current demo browser suite.

### Slice 1 — Role and data authorization

Effort: L
Dependencies: Slice 0

- Add the five-part access context.
- Replace role/persona shortcuts with one `ROUTE_POLICY` and exact capabilities.
- Resolve demo identity before workspace selection.
- Build server-side Today projectors for all six operating views.
- Split guest service context, commercial history, and private notes.
- Split operational People from private HR.
- Enforce report kind at page, read, export, RPC, and RLS layers.
- Require explicit primary location; resolve effective-dated capability rows server-side.

Exit: every role account passes navigation, direct URL, payload field, search, export, action, endpoint, RPC, and RLS negative tests.

### Slice 2 — Shared mutation-safety spine

Effort: M shared foundation; L adoption
Dependencies: Slice 0; developed in parallel with Slice 1

- Add the command envelope, preview/commit boundary, receipt, uncertain-outcome recovery, and correction declaration.
- Implement the shared preview, confirm, receipt/Undo, dirty-exit, and error components.
- Add expected-version and idempotency enforcement to each adopted command.
- Apply first to Arrive/table move/Complete, reservation reset, pre-shift publish, 86/restore, closeout approval, and floor/schedule/recipe publish.

Exit: double-click, replay, stale version, permission loss, timeout/lost response, valid inverse, expired inverse, and compensating correction all have automated evidence.

### Slice 3 — Host reservations and guest recovery

Effort: L
Dependencies: Slices 1 and 2

- Make demo booking/waitlist reducers real and identical in lifecycle semantics to connected mode.
- Add the persistent guest drawer and keep the floor interactive.
- Add candidate table, interval conflict, pacing, and unassigned preview before booking.
- Implement provider-aware waitlist delivery and start the deadline on delivery success.
- Make Arrive/table move reversible where the server can compensate; make Complete reviewable and Reopen explicit.
- Add local modal errors, preserved inputs, pending-state lock, and duplicate protection.
- Move floor editing to Draft → Validate → Review changes → Save/Publish.
- Add the narrow service-readiness strip and OS → Host deep links.

Exit: real-browser rush rehearsal proves book, waitlist, delivery failure/retry, arrival, assignment, seating, correction, completion/reopen, conflict, and reconnect on desktop/tablet/phone without weakening the GiST no-double-booking boundary.

### Slice 4 — Service Control and role-specific Today

Effort: L
Dependencies: Slices 1–3

- Render the full audience-safe pre-shift before acknowledgement; bind acknowledgement to exact version.
- Replace free-text 86 truth with canonical subjects and inverse events.
- Split kitchen-safe operational handoff from sensitive manager notes.
- Build Host, Server, Bartender, Chef, Manager, and Owner projections.
- Apply the data-truth states and one simulated business clock.
- Hide/disable writes during a definitively offline or stale-critical state.

Exit: the same seeded service produces six materially different, least-privilege views; each user can complete their job in 30 seconds without seeing forbidden fields.

### Slice 5 — Owner finance and governance

Effort: L
Dependencies: Slices 1 and 2

- Fix report-kind authorization and export/RLS parity.
- Calculate financial headlines from approved/locked records only; show pending/rejected reconciliation separately.
- Separate `sourceObservedAt` from `generatedAt`.
- Add complete closeout/tip review and linked corrections.
- Move role/location/capability changes to staged diff and Review & apply.
- Add owner/admin step-up for high-risk actions.
- Replace one-click reservation setup/reset with snapshot, diff, confirmation, and rollback/supersede.
- Add audit filters, pagination, principal, before/after diff, request evidence, and redaction.

Exit: mixed-state finance fixtures reconcile; unauthorized report kinds fail at every layer; immutable owner actions have complete evidence and tested correction.

### Slice 6 — Labor, schedule, integrations, and degraded operation

Effort: L
Dependencies: Slices 1 and 2

- Hotfix Toast Retry first: retry must not create a queued job that prevents the worker from claiming it.
- Enforce `time.review` and `time.approve`; show pending correction, late/no-show, early clock, job mismatch, overtime risk, auto-clock-out, and missed-break exceptions when sourced.
- Keep Toast authoritative and link/instruct correction there.
- Add schedule draft, publish diff, acknowledgement, swap review, and concurrency handling.
- Make message attachment publication atomic or visibly sender-pending.
- Refuse CSV imports while processor health is unavailable; then implement leased worker, staging, dry run, row errors, idempotent merge, heartbeat, cancellation, and lineage.
- Provide a stale read-only snapshot plus explicit reconnect diff. Never silently replay consequential offline writes.

Exit: native PostgreSQL retry/concurrency tests, schedule tests, attachment failure tests, import-processor-disabled tests, and offline/reconnect browser tests pass.

### Slice 7 — BOH purchasing, receiving, inventory, and costing

Effort: L
Dependencies: Slices 1 and 2

- Implement the full PO lifecycle and independent approval in PostgreSQL.
- Add delivery exception evidence: delivered, accepted, rejected, substituted, missing, unexpected, temperature, lot, expiry, cost, invoice/photo, reason.
- Add a review-before-post boundary and return/correction workflow.
- Build blind counts by storage area with save/pause/resume and post-submit variance reveal.
- Show posted on-hand and effective availability after pending waste; turn negative stock into an explicit exception/override.
- Build one server-side as-of unit conversion/cost resolver: batch cost, portion cost, food-cost percentage, price age, and missing coverage.
- Add recipe draft/diff/publish/archive/restore and a dirty-exit guard.

Exit: different-person PO approval, partial receipt, exception correction, count resume, concurrent approval, and complete/incomplete costing fixtures all pass database and mobile acceptance.

### Slice 8 — Manual Prep

Effort: L
Dependencies: Slices 4 and 7

- Daily plan by business date/service.
- Station, recipe/component, target quantity/unit, due time, assignee, state, actual yield, note, evidence.
- Manual and template creation; no forecast automation in the first version.
- Completion preview for ingredient consumption and finished-batch movement.
- Explicit confirm to post; linked compensation for correction.
- Chef Today projection of readiness and exceptions.

Exit: capability/location/RLS, target/unit validation, replay, concurrent completion, insufficient-stock warning/override, reconciliation, correction, tablet/phone, and offline-refusal tests pass.

### Slice 9 — Connected acceptance and cutover

Effort: M internally; external prerequisites remain unestimated
Dependencies: all selected go-live slices

- Use an isolated location and real role accounts: Owner, Admin, Manager, Chef, Host, Server/employee, BOH employee, view-only, operate-only, explicit denied, expired assignment, and cross-location.
- Verify direct route, payload fields, action list, endpoint, RPC, RLS, search, and export.
- Test 320-pixel phone, 390-pixel phone, tablet landscape, desktop, keyboard, and screen reader.
- Verify Host and Operations aliases separately.
- Rehearse one full service: pre-shift → reservations/waitlist → 86 → labor exception → receiving/waste → closeout/tips.
- Prove provider sandbox delivery, uncertain outcome/retry, source staleness, offline/read-only/reconnect, backup/restore, and forward-fix behavior.

Exit: every release gate in Section 11 has captured evidence and the owner signs the isolated pilot. Production feature flags remain independent and off until their exact path passes.

## 9. 30/60/90 sequence

These are dependency horizons, not calendar promises. A horizon exits only when its evidence gate passes.

### First 30 — make the system trustworthy

- Baseline and infrastructure truth.
- Role/data authorization and persona parity.
- Shared safety spine.
- Toast Retry hotfix.
- Report-kind security.
- Demo reservation/waitlist state truth.
- Reservation reset snapshot/review.
- Complete pre-shift before acknowledgement.
- One simulation clock and persistent synthetic labels.

Exit: P0-01 through P0-07 are closed with negative authorization, replay, and lifecycle proof. No user sees or performs an unauthorized operation, and no major action lacks a truthful correction boundary.

### Next 60 — survive a complete service

- Host guest drawer, assignment, waitlist delivery, and reservation corrections.
- Service brief, canonical availability, and persona Today.
- Owner closeout, reporting freshness, finance truth, settings, and audit hardening.
- Schedule publish/swap and Toast exception management.
- Offline read-only and explicit reconciliation.
- Start isolated connected role acceptance.

Exit: an isolated FOH/BOH/manager/owner rehearsal completes without false success, permission leak, stale-live claim, unreviewed major mutation, or cosmetic Undo.

### Then 90 — make BOH operational and prove release readiness

- PO lifecycle and separate approval.
- Receiving exceptions.
- Blind/resumable counts and waste correction.
- Correct as-of recipe costing and recipe versions.
- Manual prep/production board.
- Full connected role, mobile, alias, realtime, backup, and provider-disabled/sandbox acceptance.

Exit: all P0s and selected service-critical P1s are closed, the connected rehearsal passes, and remaining external launch inputs are explicitly blocking rather than silently simulated.

## 10. Phase 1 finding-to-slice coverage

| Findings | Primary closure |
|---|---|
| P0-01, P0-02, P1-01, P1-02, P1-26, P1-30, P1-31 | Slice 1 — role/data authorization |
| P0-03, P1-28, P1-29, P1-32; owner P2 truth/audit/MFA | Slice 5 — finance/governance |
| P0-04, P1-08, P1-12, P1-19 and settings save boundaries | Slices 2, 3, 5, and 7 — draft/review/publish |
| P0-05, P1-13, P1-14, P1-25, P1-27 | Slice 6 — labor/integrations/degraded operation |
| P0-06, P1-03 through P1-10, P1-15 | Slice 3 — Host |
| P0-07, P1-11, P1-16, P1-20, P1-21 | Slice 4 — Service/Today |
| P0-08, P1-17 through P1-19, P1-22 through P1-24; BOH P2 realtime/unit summary | Slice 7 — BOH core |
| P0-09 | Slice 8 — manual Prep |
| P0-10 and all cross-device/provider evidence | Slice 9 — connected gate |
| Global dead promises, stale labels, business-date copy, and closeout sticky-state polish | Adopt inside the owning slice; verify in the connected gate |

## 11. Owner-ready exit gates

No selected capability is “done” until all applicable gates pass:

1. **Role isolation:** six operating principals plus denied/expired/cross-location cases; direct URLs, palette, search, exports, and protected fields.
2. **Action recovery:** every reversible action has a tested server inverse; every immutable action has a linked compensation; every no-correction state explains why.
3. **Concurrent safety:** double submit, replay, stale version, same-table collision, worker lease, provider timeout, and lost response.
4. **Source truth:** live/stale/synthetic/not-connected/blocked/empty states with correct timestamps and no generated-at freshness substitution.
5. **Provider reality:** Toast retry, SMS/email delivery, attachment retry, import processor, and reconciliation.
6. **Service devices:** both aliases on 320px and 390px phones, tablet landscape, desktop, keyboard, and screen reader.
7. **Degraded operation:** stale read-only snapshot, disabled consequential writes, reconnect diff, and explicit reconciliation.
8. **Production pilot:** isolated location, real role accounts, seeded business date, feature flags, backup/restore evidence, forward-fix plan, and owner sign-off.

### Minimum verification by layer

| Layer | Required proof |
|---|---|
| Unit/contract | Route policy, field projection, action resolution, risk class, copy, reducer/state machine, freshness |
| PGlite | Exact capability, location/subject scope, idempotency replay, version conflict, different-person rule, append-only correction |
| Native PostgreSQL | Concurrency, GiST conflicts, worker claim/lease, RLS, grants, triggers, transaction rollback |
| Browser | Full user workflow, pending/error/uncertain states, keyboard/focus, mobile/tablet, dirty exit, reconnect |
| Connected provider | Delivery success/failure, source timestamp, retry, disabled/unconfigured state, idempotent reconciliation |
| Release | Supported Node, full verify/build, migration/type parity, separate Host/OS aliases, restore evidence |

### Universal mutation acceptance suite

Every registered mutation must prove all applicable cases:

1. Same command ID + canonical payload returns the same receipt and creates no additional row, event, ledger entry, notification, or outbox job.
2. Reusing an ID with a different actor, action, target, scope, or payload is rejected with zero writes.
3. Two commands using expected version N produce one winner and one typed stale loser.
4. Any authoritative change after preview invalidates confirmation.
5. Capability revocation after preview causes database denial.
6. AAL-required action at AAL1 returns `step_up_required`; retry after step-up uses a fresh preview.
7. Undo creates a new linked command/event and never deletes history.
8. Late Undo returns `undo_expired`; downstream-head change returns `undo_superseded`.
9. Lost HTTP response followed by receipt lookup/retry cannot duplicate effects.
10. Definite offline state disables submit; reconnect never auto-posts.
11. Every receipt links all affected audit, ledger, and outbox evidence.
12. Receipt/audit projections redact sensitive evidence for unauthorized roles.
13. Cancel receives initial focus, focus returns to the trigger, busy dialogs cannot close, and dialog errors are announced.
14. Optimistic UI rolls back on denial/conflict and never shows Undo before a server receipt.
15. Action registry, Zod schema, RPC capability, and database integration test agree on the same action key and safety class.
16. Cross-tab receipts invalidate stale projections before the second tab can commit from an old head.

## 12. Migration and release discipline

Use **expand → verify → switch → contract**:

1. Reconcile the migration head and preserve user-owned changes.
2. Add a forward-only migration; never edit an applied migration.
3. Prefer additive tables/nullable fields, versioned commands, and backward-compatible reads.
4. Verify locally with focused unit, PGlite, and native PostgreSQL tests.
5. Regenerate and byte-check database types.
6. Deploy dual-read or flag-off code to an isolated Preview.
7. Apply the migration and run RLS, database lint, concurrency, realtime, and connected role tests.
8. Enable only the exact slice after acceptance.
9. Remove legacy behavior in a later release.
10. For reservations, settings, finance, PO, and inventory, capture recoverable backup/forward-fix evidence.

Per PR: lint, database type check, typecheck, focused unit tests, focused PGlite verifier, build.
Per completed slice: full verify, desktop/mobile browser tests, accessibility, native concurrency where applicable.
Release candidate: full verification, native RLS/database lint, attested connected acceptance, restore evidence, and a role-based service rehearsal.

## 13. Policy setups and recommended defaults

### A. Host topology

- **Recommended:** Host is the only staff reservation/guest writer; OS reads bounded summaries and deep-links.
- Alternative: identical shared reservation module in both deployments, with simultaneous releases and parity acceptance.

### B. Owner/admin step-up

- **Recommended:** require AAL2 when entering sensitive settings/finance and re-use a short-lived step-up session; re-challenge for credentials, retention, high-threshold payments/locks, and owner/admin assignment.
- Alternative: step up only per consequential action. Lower interruption, but greater chance of sensitive data exposure on an unattended session.

### C. Purchase and receiving separation

- **Recommended:** different-person approval above configurable spend/exception thresholds; direct receiver posting only for low-risk, matched deliveries when explicitly permitted.
- Stricter alternative: all submitted POs and all receipts require separate approval.

### D. Offline continuity

- **Recommended launch setup:** no cached tenant pages; encrypted, session-bound, expiring form drafts; a sanitized short-lived read-only service snapshot; explicit reconnect diff; no automatic write replay.
- Higher-continuity alternative: an on-premise read-only edge snapshot. Consider only after threat modeling and support ownership are clear.

### E. Fast service actions

- **Recommended:** running-low, arrival, and safe pre-seat table corrections use a real 8–10 second server-backed inverse.
- Alternative where inverse proof is not possible: a compact R2 review rather than a fake Undo.

### F. Floor, schedule, recipe, brief, and settings edits

- **Recommended:** local/server draft → diff/validation → explicit publish/apply; short Restore means a new version.
- Do not auto-save consequential published state.

## 14. Explicitly deferred

Do not let speculative intelligence outrun trustworthy restaurant records. Defer:

- forecast-driven prep and suggested ordering;
- menu engineering and theoretical-versus-actual analytics;
- proactive AI operations and expanded Ask Le Yard;
- KDS/ticket-pace claims or Toast write-back;
- automated OCR/email invoice matching and accounting transmission;
- payroll transmission;
- broad offline mutation queues;
- employee performance scoring or automated employment decisions;
- food-safety “compliance” certification claims;
- a full asset/preventive-maintenance platform;
- multi-location expansion beyond proven isolation;
- weather/events/delivery adapters;
- public booking, live messaging, push, or provider activation without credentials and connected acceptance.

## 15. First implementation package

The highest-risk, highest-reuse package is:

1. one access context and route/capability resolver in demo and connected mode;
2. server-side persona projection and field omission;
3. command preview/envelope/receipt with expected version and idempotency;
4. shared review-confirm, real Undo, dirty-exit, and error primitives;
5. adoption in reservation Arrive/table move/Complete, reservation setup reset, pre-shift publish, 86/restore, and closeout approval;
6. negative role, replay, conflict, timeout, correction, accessibility, and browser tests.

That package closes the dangerous trust gap without committing the project to speculative features or a new visual language.

## Verification performed for this blueprint

- The interactive board was rendered in a real browser at a 1536 × 1000 viewport against 1440-pixel frames.
- All six role variants and all four action-risk variants were exercised.
- The page has no horizontal overflow at the verification viewport.
- All embedded evidence images have alternative text.
- Browser console errors: none.
- Static frame exports were captured for the complete architecture story.
- No production data, provider, message, booking, deployment, or database was changed.
- No product source file was modified; only this handoff and the audit output artifacts were added.
