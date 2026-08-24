# Ask Le Yard — single-owner subscription intelligence

Status: implemented and database-enabled for Donald only. The official local Codex runtime remains the default. A separately pinned, self-hosted Sub2API gateway can be selected after its operator terms are accepted, Donald's OpenAI OAuth is complete, and the gateway smoke test passes.

## What works

- Official `@openai/codex-sdk` using the ChatGPT app's signed-in Codex runtime; no OpenAI API key.
- Optional `sub2api_subscription` provider using the gateway's OpenAI-compatible Responses endpoint and a dedicated random gateway key.
- `gpt-5.6-luna` with read-only sandbox, no network, no web search, no approvals, and rejection of any tool-attempt event.
- Answers are grounded in the active location's last 30 days of authorized report evidence.
- Every model citation must match one of the evidence identifiers supplied by Le Yard OS.
- One executable action in the beta: create an unassigned operational task.
- The model creates a pending proposal only. The owner sees the exact title, description, priority, due date, and assignee before confirming.
- A SHA-256 fingerprint prevents a proposal from changing between review and execution.
- Undo cancels a still-open task and records who reverted it, when, why, and under which request ID.
- One active request at a time and no more than 12 starts per owner per hour.

## Operator boundary

Production Supabase contains one authorization row:

- `donaldlena@le-yard.local`
- active `owner` membership
- provider `codex_subscription`
- execution enabled
- MFA assurance level 2 required on every read and write RPC

Maris is intentionally not authorized. Adding another owner later requires a new reviewed migration; buying or sharing a Le Yard account does not automatically enable intelligence.

## Provider setup

The ignored `.env.local` enables the beta on this Mac:

```text
LE_YARD_OWNER_INTELLIGENCE_ENABLED=true
LE_YARD_OWNER_INTELLIGENCE_PROVIDER=codex_subscription
```

The runtime locates `/Applications/ChatGPT.app/Contents/Resources/codex` by default. An explicit `LE_YARD_CODEX_BINARY_PATH` can override that location.

For Sub2API, configure only server-side values:

```text
LE_YARD_OWNER_INTELLIGENCE_PROVIDER=sub2api_subscription
LE_YARD_SUB2API_BASE_URL=https://your-dedicated-gateway.example
LE_YARD_SUB2API_API_KEY=<dedicated-random-gateway-key>
LE_YARD_SUB2API_MODEL=gpt-5.6-luna
```

Remote gateway URLs must use HTTPS. Redirects are rejected, error bodies are not exposed, responses are size-limited, and model output is parsed against the same strict proposal contract. The gateway never receives Supabase credentials and cannot execute an OS action directly.

Verify the subscription runtime:

```bash
npm run test:intelligence:subscription
```

This is a real subscription call and consumes Codex subscription usage. The recorded smoke test used approximately 16.5k input tokens and 149 output tokens.

## Deployment boundary

Do not copy `~/.codex/auth.json`, ChatGPT cookies, refresh tokens, or a Codex home directory into Vercel or Supabase secrets. If Sub2API is used remotely, keep its OAuth material inside the gateway, use a dedicated random gateway key, and expose only the gateway's authenticated HTTPS API.

Supabase remains the authority for identity, evidence, proposal confirmation, execution, and audit regardless of provider. The model may draft only `task.create`; it cannot call tools or mutate database state. Every action still requires a fresh AAL2 owner session, exact reviewed fingerprint, and explicit UI confirmation, with audited undo.

## Verification evidence

- Ordered migration suite: 140 of 140 public tables forced RLS; owner intelligence AAL2, exact confirmation, execution, and audited undo pass.
- Application: full ESLint, TypeScript, generated database contract, 139 test files / 773 tests, and the production Next.js build pass.
- Subscription smoke: structured `task.create`, correct source ID, high priority, unassigned, zero tool calls.
- Browser: desktop and 390-by-844 mobile Ask Le Yard layouts captured under `output/playwright/`.
- Supabase production: the owner-intelligence migration is applied; Donald is the only enabled principal; direct AI-table writes remain denied.
- Guarded Vercel preview build: `https://le-yard-crcp0ry4f-donald-lenas-projects.vercel.app` (the subscription runtime flag is intentionally absent).

The live Supabase advisor still reports the repository's pre-existing warning set, including authenticated access to security-definer workflow RPCs. The five intelligence RPCs appear in that class because authenticated clients may invoke them, but each one rejects callers unless the session is AAL2, the membership is an exact active owner membership, and the principal is explicitly enabled in the private operator table. This is a documented defense-in-depth boundary, not a claim of a warning-free catalog.
