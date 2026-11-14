import { createHmac, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { expect, it, vi } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";

const doubles = vi.hoisted(() => ({
  after: vi.fn(),
  serviceRpc: vi.fn(),
  sandbox: {
    environment: "sandbox",
    accessToken: "local-fixture-only-no-square-access",
    merchantId: "MLH4AQVZJGJ88",
    locationId: "LKVCW6E95KEFY",
  },
}));

vi.mock("next/server", () => ({ after: doubles.after }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: doubles.serviceRpc }) }));
vi.mock("@/lib/integrations/church-square-orders.server", async (importOriginal) => ({
  ...await importOriginal(),
  churchSquareOrderConfiguration: () => doubles.sandbox,
}));

import { POST } from "@/app/api/integrations/square/webhook/route";
import { churchSquareWebhookUrl } from "@/lib/integrations/church-square-webhook.server";
import { churchSquareReconciliationResponse } from "@/lib/integrations/church-square-reconciliation";
import { processChurchSquareOrderBackfill } from "@/lib/integrations/church-square-order-backfill.server";
import { churchSandwichBenchRecipes, churchSandwichBread, churchSandwichComponents } from "@/lib/kitchen/church-sandwich-bench";

const ownerId = "10000000-0000-4000-8000-000000000001";
const secondOwnerId = "10000000-0000-4000-8000-000000000002";
const otherTenantUser = "10000000-0000-4000-8000-000000000006";
const prepUserId = "10000000-0000-4000-8000-000000000005";
const invoiceId = "inv:local-replay-invoice";
const invoiceOrderId = "local-replay-catering-order";
const pickupOrderId = "local-replay-pickup-order";
const { merchantId, locationId } = doubles.sandbox;
const money = (amount) => ({ amount, currency: "USD" });

async function asRole(db, role, sub) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub, aal: "aal1" })]);
  await db.exec(role === "service_role" ? "set role service_role" : "set role authenticated");
}

function useServiceRpc(db) {
  doubles.serviceRpc.mockImplementation((name, params) => ({
    abortSignal: async () => {
      const statements = {
        service_record_church_square_webhook: [
          "select public.service_record_church_square_webhook($1,$2,$3,$4,$5::timestamptz,$6,$7::jsonb,$8) as result",
          [params.p_merchant_id, params.p_square_location_id, params.p_event_id, params.p_event_type,
            params.p_created_at, params.p_resource_id, JSON.stringify(params.p_inventory ?? []), params.p_related_order_id ?? null],
        ],
        service_claim_church_square_receipts: [
          "select public.service_claim_church_square_receipts($1,$2) as result",
          [params.p_merchant_id, params.p_square_location_id],
        ],
        service_complete_church_square_receipt: [
          "select public.service_complete_church_square_receipt($1,$2,$3,$4::uuid,$5::jsonb,$6) as result",
          [params.p_merchant_id, params.p_square_location_id, params.p_event_id, params.p_lease,
            params.p_facts ? JSON.stringify(params.p_facts) : null, params.p_failure ?? null],
        ],
        service_claim_church_square_order_backfill: [
          "select public.service_claim_church_square_order_backfill($1,$2) as result",
          [params.p_merchant_id, params.p_square_location_id],
        ],
        service_commit_church_square_order_backfill: [
          "select public.service_commit_church_square_order_backfill($1,$2,$3::uuid,$4::jsonb) as result",
          [params.p_merchant_id, params.p_square_location_id, params.p_lease, JSON.stringify(params.p_orders)],
        ],
        service_release_church_square_order_backfill: [
          "select public.service_release_church_square_order_backfill($1,$2,$3::uuid,$4) as result",
          [params.p_merchant_id, params.p_square_location_id, params.p_lease, params.p_failure],
        ],
      };
      const statement = statements[name];
      if (!statement) throw new Error("Unrecognized local rehearsal RPC");
      const { rows } = await db.query(...statement);
      return { data: rows[0].result, error: null };
    },
  }));
}

function signedEvent(key, input) {
  const body = JSON.stringify(input);
  const signature = createHmac("sha256", key).update(churchSquareWebhookUrl).update(body).digest("base64");
  return new Request(churchSquareWebhookUrl, {
    method: "POST", body,
    headers: { "content-type": "application/json", "x-square-hmacsha256-signature": signature },
  });
}

it("replays the observed Sandbox catering deposit and a pickup fixture through the real Church receipt pipeline", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    const migrationDirectory = new URL("../../supabase/migrations/", import.meta.url);
    const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
    await db.exec(bootstrap);
    for (const name of migrations) await db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
    await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));

    await asRole(db, "service_role");
    const roster = [
      { user_id: ownerId, role: "owner" },
      { user_id: secondOwnerId, role: "owner" },
      { user_id: prepUserId, role: "employee", job_code: "PREP" },
    ];
    const { rows: [provisioned] } = await db.query("select public.service_provision_church_street($1::jsonb) as result", [
      JSON.stringify(roster),
    ]);
    const { organization_id: orgId, location_id: workspaceLocationId } = provisioned.result;
    await db.query("select public.service_set_church_street_active($1::uuid, true)", [orgId]);
    useServiceRpc(db);

    // IDs and event envelopes are local. Invoice timestamps and payment facts mirror Sandbox.
    const readyAt = new Date().toISOString();
    const createdAt = new Date(Date.parse(readyAt) - 5 * 60_000).toISOString();
    const pickupAt = new Date(Date.parse(readyAt) + 5 * 60_000).toISOString();
    const observedInvoice = { createdAt: "2026-11-14T08:38:24Z", updatedAt: "2026-11-14T08:42:23Z" };
    const observedUpdatedMs = Date.parse(observedInvoice.updatedAt);
    // Keep historical replays inside the real seven-day Operations read window.
    const invoiceAgeMs = Date.parse(readyAt) - observedUpdatedMs;
    const useObservedTimes = invoiceAgeMs >= 0 && invoiceAgeMs < 6 * 24 * 60 * 60_000;
    const invoiceAgeAtReadMs = observedUpdatedMs - Date.parse(observedInvoice.createdAt);
    const invoice = {
      id: invoiceId, order_id: invoiceOrderId, location_id: locationId,
      created_at: useObservedTimes ? observedInvoice.createdAt : new Date(Date.parse(readyAt) - invoiceAgeAtReadMs).toISOString(),
      updated_at: useObservedTimes ? observedInvoice.updatedAt : readyAt,
      status: "PARTIALLY_PAID", version: 4,
      next_payment_amount_money: money(800),
      payment_requests: [
        { request_type: "DEPOSIT", due_date: "2026-12-01", computed_amount_money: money(400), total_completed_amount_money: money(400) },
        { request_type: "BALANCE", due_date: "2026-12-04", computed_amount_money: money(800), total_completed_amount_money: money(0) },
      ],
      primary_recipient: { email_address: "recipient@example.invalid" },
    };
    const order = {
      id: pickupOrderId, location_id: locationId, version: 2,
      created_at: createdAt, updated_at: readyAt, state: "OPEN",
      fulfillments: [{
        uid: "local-pickup", type: "PICKUP", state: "PREPARED",
        pickup_details: {
          pickup_at: pickupAt, ready_at: readyAt,
          recipient: { display_name: "Private fixture", address: { address_line_1: "Private fixture address" } },
        },
      }],
    };
    const provider = new Map([
      [`/v2/merchants/${merchantId}`, { merchant: { id: merchantId, country: "US", status: "ACTIVE" } }],
      [`/v2/locations/${locationId}`, { location: {
        id: locationId, merchant_id: merchantId, status: "ACTIVE", timezone: "America/New_York", currency: "USD",
      } }],
      [`/v2/invoices/${encodeURIComponent(invoiceId)}`, { invoice }],
      [`/v2/orders/${pickupOrderId}`, { order }],
    ]);
    const transport = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const payload = provider.get(url.pathname);
      if (url.origin !== "https://connect.squareupsandbox.com" || init?.method !== "GET" || !payload) {
        throw new Error("Outside the local Square Sandbox fixture");
      }
      return Response.json(payload);
    });
    vi.stubGlobal("fetch", transport);

    const key = randomUUID();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_WEBHOOK_ENABLED", "true");
    vi.stubEnv("SQUARE_CHURCH_WEBHOOK_SIGNATURE_KEY", key);
    vi.stubEnv("SQUARE_CHURCH_MERCHANT_ID", merchantId);
    vi.stubEnv("SQUARE_CHURCH_LOCATION_ID", locationId);

    const envelope = { merchant_id: merchantId, created_at: readyAt };
    const paid = {
      ...envelope, type: "invoice.payment_made", event_id: "replay-invoice-payment",
      data: { id: invoiceId, object: { invoice } },
    };
    const fulfillment = {
      ...envelope, type: "order.fulfillment.updated", event_id: "replay-pickup-ready",
      data: { id: pickupOrderId, object: { order_fulfillment_updated: {
        order_id: pickupOrderId, location_id: locationId,
        fulfillment_update: [{ fulfillment_uid: "local-pickup", old_state: "RESERVED", new_state: "PREPARED" }],
      } } },
    };

    expect((await POST(signedEvent(randomUUID(), paid))).status).toBe(401);
    expect((await POST(signedEvent(key, { ...paid, location_id: "OTHER" }))).status).toBe(204);
    expect(doubles.serviceRpc).not.toHaveBeenCalled();

    const readSummary = async () => (await db.query(
      "select public.list_church_square_reconciliation($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const protectedCounts = async () => {
      await db.exec("reset role");
      return (await db.query(`
        select (select count(*) from public.income_sales_checks) as income,
          (select count(*) from public.shift_closeouts) as closeouts,
          (select count(*) from public.prep_tasks) as prep,
          (select count(*) from public.tasks) as tasks,
          (select count(*) from public.inventory_transactions) as inventory
      `)).rows[0];
    };
    const before = await protectedCounts();
    await asRole(db, "service_role");
    for (const event of [paid, fulfillment, paid]) {
      expect((await POST(signedEvent(key, event))).status).toBe(204);
    }
    expect(transport).not.toHaveBeenCalled();

    await asRole(db, "authenticated", ownerId);
    expect(await readSummary()).toEqual({ orderCoverageThrough: null, pending: 2, needsReview: 0, resources: [] });
    await asRole(db, "service_role");
    for (const [work] of doubles.after.mock.calls) await work();
    expect(transport).toHaveBeenCalledTimes(4);

    await asRole(db, "authenticated", ownerId);
    const summary = churchSquareReconciliationResponse.parse(await readSummary());
    expect(summary).toMatchObject({ pending: 0, needsReview: 0 });
    expect(summary.resources).toHaveLength(2);
    expect(summary.resources.find((resource) => resource.kind === "invoice")).toMatchObject({
      reference: invoiceId.slice(-10),
      orderReference: invoiceOrderId.slice(-10),
      status: "PARTIALLY_PAID",
      depositState: "satisfied",
      depositDueCents: 400,
      depositCompletedCents: 400,
    });
    for (const userId of [prepUserId, otherTenantUser]) {
      await asRole(db, "authenticated", userId);
      await expect(readSummary()).rejects.toMatchObject({ code: "42501" });
    }

    expect(await protectedCounts()).toEqual(before);
    const stored = (await db.query("select resource_kind, facts from private.church_square_resource_state")).rows;
    expect(stored.find((resource) => resource.resource_kind === "order").facts.fulfillments).toMatchObject([
      { type: "PICKUP", status: "PREPARED", promisedAt: pickupAt, readyAt, handoffAt: null },
    ]);
    expect(stored.find((resource) => resource.resource_kind === "invoice").facts.paymentRequests).toMatchObject([
      { type: "DEPOSIT", dueDate: "2026-12-01", dueCents: 400, completedCents: 400 },
      { type: "BALANCE", dueDate: "2026-12-04", dueCents: 800, completedCents: 0 },
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/recipient@example\.invalid|Private fixture|primary_recipient/);
    expect((await db.query("select count(*)::int as count from private.church_square_webhook_receipts")).rows[0].count).toBe(2);

    const missedId = "missed-square-order";
    const secondId = "second-missed-square-order";
    let failSecondPage = true;
    let exhaustPages = false;
    const pageCalls = [];
    transport.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://connect.squareupsandbox.com") throw new Error("Unexpected provider origin");
      if (url.pathname !== "/v2/orders/search") {
        if (init?.method !== "GET" || !provider.has(url.pathname)) throw new Error("Unexpected provider read");
        return Response.json(provider.get(url.pathname));
      }
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init.body);
      const window = body.query.filter.date_time_filter.updated_at;
      expect(body).toMatchObject({ location_ids: [locationId], limit: 50, return_entries: false,
        query: { sort: { sort_field: "UPDATED_AT", sort_order: "ASC" } } });
      pageCalls.push({ cursor: body.cursor, ...window });
      const facts = (id, version) => ({
        id, version, location_id: locationId, state: "OPEN", created_at: window.start_at, updated_at: window.end_at,
      });
      if (!body.cursor) return Response.json({
        orders: [facts(missedId, 1), facts(pickupOrderId, 1)], cursor: "page-two",
      });
      if (exhaustPages) return Response.json({ orders: [], cursor: body.cursor + "-next" });
      if (failSecondPage) return new Response(null, { status: 503 });
      return Response.json({ orders: [facts(secondId, 1)] });
    });
    const backfillState = async () => {
      await db.exec("reset role");
      return (await db.query("select covered_through::text, last_failure, window_seconds from private.church_square_order_backfill")).rows[0];
    };
    const expireRetry = async () => {
      await db.exec("reset role; update private.church_square_order_backfill set retry_after = '-infinity'");
      await asRole(db, "service_role");
    };

    await asRole(db, "service_role");
    await processChurchSquareOrderBackfill();
    expect(pageCalls).toHaveLength(0);
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_BACKFILL_ENABLED", "true");
    const claimWindow = async (merchant = merchantId) => (await db.query(
      "select public.service_claim_church_square_order_backfill($1,$2) as result", [merchant, locationId],
    )).rows[0].result;
    await expect(claimWindow("ANOTHER_MERCHANT")).rejects.toMatchObject({ code: "42501" });
    const claimed = await claimWindow();
    expect(await claimWindow()).toBeNull();
    const duplicate = { kind: "order", id: missedId, locationId, currency: "USD", updatedAt: claimed.from };
    const commit = async (lease, orders) => (await db.query(
      "select public.service_commit_church_square_order_backfill($1,$2,$3::uuid,$4::jsonb) as result",
      [merchantId, locationId, lease, JSON.stringify(orders)],
    )).rows[0].result;
    expect(await commit(randomUUID(), [])).toBe(false);
    await expect(commit(claimed.lease, [duplicate, duplicate])).rejects.toMatchObject({ code: "22023" });
    await expect(commit(claimed.lease, [{ ...duplicate, locationId: "OTHER" }])).rejects.toMatchObject({ code: "22023" });
    await expect(commit(claimed.lease, Array(151).fill(duplicate))).rejects.toMatchObject({ code: "22023" });
    await db.exec("reset role; update private.church_square_order_backfill set lease_expires_at = now() - interval '1 second'");
    await asRole(db, "service_role");
    expect(await commit(claimed.lease, [])).toBe(false);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await processChurchSquareOrderBackfill();
      expect(await backfillState()).toMatchObject({ covered_through: null, last_failure: "provider_unavailable" });
      expect((await db.query("select count(*)::int as count from private.church_square_resource_state")).rows[0].count).toBe(2);
      await expireRetry();
      exhaustPages = true;
      await processChurchSquareOrderBackfill();
      expect(await backfillState()).toMatchObject({ covered_through: null, last_failure: "window_too_large", window_seconds: 10800 });
      expect(pageCalls).toHaveLength(5);

      await expireRetry();
      exhaustPages = false;
      failSecondPage = false;
      await processChurchSquareOrderBackfill();
      expect(await backfillState()).toMatchObject({ last_failure: null });
      const [lastFirst, lastSecond] = pageCalls.slice(-2);
      expect(lastSecond).toEqual({ ...lastFirst, cursor: "page-two" });
      expect(Date.parse(lastFirst.end_at) - Date.parse(lastFirst.start_at)).toBe(3 * 60 * 60_000);
      await asRole(db, "authenticated", ownerId);
      const recovered = churchSquareReconciliationResponse.parse(await readSummary());
      expect(Date.parse(recovered.orderCoverageThrough)).toBe(Date.parse(lastFirst.end_at));
      expect(recovered.resources.map((resource) => resource.reference)).toEqual(expect.arrayContaining([
        missedId.slice(-10), secondId.slice(-10),
      ]));

      await asRole(db, "service_role");
      await processChurchSquareOrderBackfill();
      const [overlapFirst] = pageCalls.slice(-2);
      expect(Date.parse(lastFirst.end_at) - Date.parse(overlapFirst.start_at)).toBe(5 * 60_000);
      expect(await protectedCounts()).toEqual(before);
      expect((await db.query("select count(*)::int as count from private.church_square_webhook_receipts")).rows[0].count).toBe(2);
      const pickup = await db.query("select source_version::int, facts from private.church_square_resource_state where resource_id = $1", [pickupOrderId]);
      expect(pickup.rows[0].source_version).toBe(2);
      expect(pickup.rows[0].facts.fulfillments[0].readyAt).toBe(readyAt);
    } finally {
      log.mockRestore();
    }

    await asRole(db, "authenticated", ownerId);
    const serviceDate = "2026-12-05";
    const saveJob = async (requestId, title, stage, job = null, revision = null, date = serviceDate) => (await db.query(
      "select public.save_church_catering_job($1::uuid,$2::uuid,$3,$4::date,$5,$6::uuid,$7::integer) as result",
      [requestId, workspaceLocationId, title, date, stage, job, revision],
    )).rows[0].result;
    const listJobs = async () => (await db.query(
      "select public.list_church_catering_jobs($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const requestId = randomUUID();
    const job = await saveJob(requestId, "  Team lunch  ", "inquiry");
    expect(job).toMatchObject({ title: "Team lunch", serviceDate, revision: 1, stage: "inquiry", invoice: null });
    expect(await saveJob(requestId, "Team lunch", "inquiry")).toEqual(job);
    await expect(saveJob(requestId, "Another lunch", "inquiry")).rejects.toMatchObject({ code: "PT409" });
    const secondJob = await saveJob(randomUUID(), "Second team lunch", "inquiry");
    await expect(saveJob(randomUUID(), job.title, "completed", job.id, 1)).rejects.toMatchObject({ code: "PT409" });
    const confirmed = await saveJob(randomUUID(), job.title, "confirmed", job.id, 1);
    await expect(saveJob(randomUUID(), "Stale revision", "quoted", job.id, 1)).rejects.toMatchObject({ code: "PT409" });

    const attachmentArgs = {
      requestId: randomUUID(), actor: ownerId, scope: merchantId,
      target: job.id, revision: confirmed.revision, invoice: invoiceId, order: invoiceOrderId, date: serviceDate,
    };
    const attachJob = async (values = attachmentArgs) => (await db.query(`
      select public.service_attach_church_catering_invoice($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer,
        $6,$7,$8,$9,'PARTIALLY_PAID',$10::date,$11::timestamptz,'satisfied',400,400) as result
    `, [values.actor, values.requestId, workspaceLocationId, values.target, values.revision,
      values.scope, locationId, values.invoice, values.order, values.date, invoice.updated_at])).rows[0].result;
    await asRole(db, "service_role");
    await expect(attachJob({ ...attachmentArgs, actor: prepUserId })).rejects.toMatchObject({ code: "42501" });
    await expect(attachJob({ ...attachmentArgs, scope: "OTHER" })).rejects.toMatchObject({ code: "42501" });
    await expect(attachJob({ ...attachmentArgs, date: "2026-12-06" })).rejects.toMatchObject({ code: "PT409" });
    const linked = await attachJob();
    expect(linked).toMatchObject({ revision: 3, stage: "confirmed", invoice: {
      invoiceReference: invoiceId.slice(-10), orderReference: invoiceOrderId.slice(-10),
      deposit: { state: "satisfied", dueCents: 400, completedCents: 400 },
    } });
    expect(await attachJob()).toEqual(linked);
    await expect(attachJob({ ...attachmentArgs, requestId: randomUUID(), target: secondJob.id, revision: 1 }))
      .rejects.toMatchObject({ code: "PT409" });

    await asRole(db, "authenticated", ownerId);
    await expect(saveJob(randomUUID(), job.title, "confirmed", job.id, 3, "2026-12-07"))
      .rejects.toMatchObject({ code: "PT409" });
    expect(await listJobs()).toHaveLength(2);
    expect(JSON.stringify(await listJobs())).not.toContain(invoiceId);
    expect(JSON.stringify(await listJobs())).not.toContain(invoiceOrderId);
    expect((await listJobs()).find((entry) => entry.id === job.id).invoice.serviceDateMismatch).toBe(true);
    for (const denied of [prepUserId, otherTenantUser]) {
      await asRole(db, "authenticated", denied);
      await expect(listJobs()).rejects.toMatchObject({ code: "42501" });
      await expect(saveJob(randomUUID(), "Denied", "inquiry")).rejects.toMatchObject({ code: "42501" });
    }

    // New verified facts can change payment status and date without editing the job.
    const refundedAt = new Date().toISOString();
    await db.exec("reset role");
    await db.query(`
      update private.church_square_resource_state
      set source_updated_at = $2::timestamptz, facts = facts || $3::jsonb
      where resource_kind = 'invoice' and resource_id = $1
    `, [invoiceId, refundedAt, JSON.stringify({
      status: "REFUNDED", serviceDate: "2026-12-07", updatedAt: refundedAt,
      deposit: { state: "review_required", dueCents: 400, completedCents: 0 },
    })]);
    await asRole(db, "authenticated", ownerId);
    expect((await listJobs()).find((entry) => entry.id === job.id)).toMatchObject({
      revision: 3, invoice: { status: "REFUNDED", serviceDate: "2026-12-07", serviceDateMismatch: true, linkNeedsReview: false },
    });
    await db.exec("reset role");
    await db.query(`
      update private.church_square_resource_state set facts = facts || '{"orderId":"unexpected-order"}'::jsonb
      where resource_kind = 'invoice' and resource_id = $1
    `, [invoiceId]);
    await asRole(db, "authenticated", ownerId);
    expect((await listJobs()).find((entry) => entry.id === job.id)).toMatchObject({
      revision: 3, invoice: { status: "PARTIALLY_PAID", serviceDate: serviceDate, serviceDateMismatch: false, linkNeedsReview: true },
    });
    const detachRequest = randomUUID();
    const detach = async (reference = invoiceId.slice(-10)) => (await db.query(
      "select public.detach_church_catering_invoice($1::uuid,$2::uuid,$3::uuid,3,$4) as result",
      [detachRequest, workspaceLocationId, job.id, reference],
    )).rows[0].result;
    await expect(detach("wrong")).rejects.toMatchObject({ code: "PT409" });
    const detached = await detach();
    expect(detached).toMatchObject({ stage: "confirmed", revision: 4, invoice: null });
    expect(await detach()).toEqual(detached);
    expect(await protectedCounts()).toEqual(before);
    const audit = await db.query("select previous_link from private.church_catering_job_changes where request_id=$1::uuid", [detachRequest]);
    expect(audit.rows[0].previous_link).toMatchObject({ invoice: invoiceId, order: invoiceOrderId });

    const { rows: [dates] } = await db.query(`
      select ((now() at time zone 'America/New_York')::date + 1)::text as tomorrow,
        ((now() at time zone 'America/New_York')::date + 7)::text as following_week
    `);
    const { tomorrow, following_week: nextWeek } = dates;
    const zeros = { parisien: 0, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 };
    const portions = { ...zeros, parisien: 10, rustique: 2 };
    const otherPortions = { ...zeros, parisien: 7, bleu: 4 };
    const updatePrep = async (job, quantities, publish, request = randomUUID()) => (await db.query(
      "select public.save_church_catering_prep($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::jsonb,$6::boolean) as result",
      [request, workspaceLocationId, job.id, job.revision, JSON.stringify(quantities), publish],
    )).rows[0].result;
    const kitchenSummary = async () => (await db.query(
      "select public.list_church_catering_prep($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    await asRole(db, "authenticated", ownerId);
    const firstKitchenJob = await saveJob(randomUUID(), "Private prep title", "inquiry", null, null, tomorrow);
    const nextKitchenJob = await saveJob(randomUUID(), "Another private title", "inquiry", null, null, tomorrow);
    const laterJob = await saveJob(randomUUID(), "Following week", "inquiry", null, null, nextWeek);
    expect(firstKitchenJob).toMatchObject({ portions: zeros, prepPublishedAt: null });
    await expect(updatePrep(firstKitchenJob, portions, true)).rejects.toMatchObject({ code: "PT409" });
    for (const quantities of [{ ...zeros, bleu: 0.5 }, { ...zeros, bleu: 2001 }, { ...zeros, turkey: 1 }, { ...zeros, bleu: "1" }]) {
      await expect(updatePrep(firstKitchenJob, quantities, false)).rejects.toMatchObject({ code: "22023" });
    }

    const draft = await updatePrep(firstKitchenJob, portions, false);
    expect(draft).toMatchObject({ portions, revision: 2, prepPublishedAt: null });
    const firstConfirmed = await saveJob(randomUUID(), draft.title, "confirmed", draft.id, draft.revision, tomorrow);
    const nextConfirmed = await saveJob(randomUUID(), nextKitchenJob.title, "confirmed", nextKitchenJob.id, nextKitchenJob.revision, tomorrow);
    const laterConfirmed = await saveJob(randomUUID(), laterJob.title, "confirmed", laterJob.id, laterJob.revision, nextWeek);
    const publishRequest = randomUUID();
    const firstPublished = await updatePrep(firstConfirmed, portions, true, publishRequest);
    expect(firstPublished.prepPublishedAt).toEqual(expect.any(String));
    expect(await updatePrep(firstConfirmed, portions, true, publishRequest)).toEqual(firstPublished);
    await expect(updatePrep(firstConfirmed, otherPortions, true)).rejects.toMatchObject({ code: "PT409" });
    await expect(updatePrep(nextConfirmed, zeros, true)).rejects.toMatchObject({ code: "PT409" });
    const nextPublished = await updatePrep(nextConfirmed, otherPortions, true);
    await updatePrep(laterConfirmed, portions, true);

    await asRole(db, "authenticated", prepUserId);
    expect(await kitchenSummary()).toEqual([{ serviceDate: tomorrow, jobCount: 2,
      portions: { ...zeros, parisien: 17, rustique: 2, bleu: 4 }, packedPortions: zeros,
      remainingPortions: { ...zeros, parisien: 17, rustique: 2, bleu: 4 } }]);
    await expect(listJobs()).rejects.toMatchObject({ code: "42501" });
    await expect(updatePrep(firstPublished, zeros, false)).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", otherTenantUser);
    await expect(kitchenSummary()).rejects.toMatchObject({ code: "42501" });

    await asRole(db, "authenticated", ownerId);
    const amended = await updatePrep(firstPublished, { ...portions, parisien: 12 }, false);
    expect(amended.prepPublishedAt).toBeNull();
    const quoted = await saveJob(randomUUID(), nextPublished.title, "quoted", nextPublished.id, nextPublished.revision, tomorrow);
    const reconfirmed = await saveJob(randomUUID(), quoted.title, "confirmed", quoted.id, quoted.revision, tomorrow);
    expect(reconfirmed.prepPublishedAt).toBeNull();
    expect(await kitchenSummary()).toEqual([]);
    expect(await protectedCounts()).toEqual(before);
    const prepAudit = await db.query(`
      select operation, actor_id::text, request_facts->'portions' as portions
      from private.church_catering_job_changes where request_id=$1::uuid
    `, [publishRequest]);
    expect(prepAudit.rows).toEqual([{ operation: "prep_publish", actor_id: ownerId, portions }]);

    const today = (await db.query("select (now() at time zone 'America/New_York')::date::text as day")).rows[0].day;
    const packingDraft = await saveJob(randomUUID(), "Private packing room", "inquiry", null, null, today);
    const packingJob = await saveJob(randomUUID(), packingDraft.title, "confirmed", packingDraft.id, packingDraft.revision, today);
    const packingPlan = await updatePrep(packingJob, portions, true);
    const packedCounts = { ...zeros, parisien: 3, rustique: 2 };
    const packRequest = randomUUID();
    const savePacked = async (job, packed, id = randomUUID(), reference = "Pack list P-07") => (await db.query(
      "select public.save_church_catering_packed_portions($1,$2,$3,$4,$5::jsonb,$6) as result",
      [id, workspaceLocationId, job.id, job.revision, JSON.stringify(packed), reference],
    )).rows[0].result;
    await asRole(db, "authenticated", prepUserId);
    await expect(savePacked(packingPlan, packedCounts)).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", ownerId);
    await expect(savePacked(packingPlan, { ...packedCounts, parisien: 11 })).rejects.toMatchObject({ code: "PT409" });
    const packed = await savePacked(packingPlan, packedCounts, packRequest);
    expect(packed).toMatchObject({ portions, packedPortions: packedCounts, revision: packingPlan.revision + 1 });
    expect(await savePacked(packingPlan, packedCounts, packRequest)).toEqual(packed);
    await expect(savePacked(packingPlan, packedCounts, packRequest, "Different reference")).rejects.toMatchObject({ code: "PT409" });
    await expect(updatePrep(packed, otherPortions, false)).rejects.toMatchObject({ code: "PT409" });
    await expect(saveJob(randomUUID(), packed.title, "confirmed", packed.id, packed.revision, tomorrow)).rejects.toMatchObject({ code: "PT409" });

    await asRole(db, "authenticated", prepUserId);
    expect(await kitchenSummary()).toEqual([{ serviceDate: today, jobCount: 1, portions,
      packedPortions: packedCounts, remainingPortions: { ...zeros, parisien: 7 } }]);
    await asRole(db, "authenticated", ownerId);
    const corrected = await savePacked(packed, { ...packedCounts, parisien: 2 }, randomUUID(), "Pack list P-07 correction");
    expect((await kitchenSummary())[0].remainingPortions.parisien).toBe(8);
    const closed = await saveJob(randomUUID(), corrected.title, "canceled", corrected.id, corrected.revision, today);
    expect(closed.packedPortions).toEqual({ ...packedCounts, parisien: 2 });
    expect(await kitchenSummary()).toEqual([]);
    expect(await protectedCounts()).toEqual(before);

    const ingredient = churchSandwichComponents[0];
    const review = {
      supplierSku: "REHEARSAL-SKU-01",
      sourceReference: "Local fixture label rev 1",
      allergenNotes: "Illustrative label evidence only",
      crossContactNotes: "Illustrative shared bench check",
      storageRule: "Rehearsal closed-packaging instruction",
      openedRule: "Rehearsal opened-product instruction",
      preppedRule: "Rehearsal prepared-product instruction",
    };
    const readEvidence = async () => (await db.query(
      "select public.list_church_ingredient_evidence($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const saveEvidence = async (key, revision, status, fields = {}, request = randomUUID()) => (await db.query(`
      select public.save_church_ingredient_evidence($1::uuid,$2::uuid,$3,$4::integer,$5,$6,$7,$8,$9,$10,$11,$12) as result
    `, [request, workspaceLocationId, key, revision, status, fields.supplierSku ?? null, fields.sourceReference ?? null,
      fields.allergenNotes ?? null, fields.crossContactNotes ?? null, fields.storageRule ?? null,
      fields.openedRule ?? null, fields.preppedRule ?? null])).rows[0].result;
    const library = await db.query(
      "select key from unnest($1::text[]) key where private.is_church_ingredient_key(key)", [churchSandwichComponents],
    );
    expect(library.rows.map(({ key }) => key)).toEqual(churchSandwichComponents);
    await asRole(db, "authenticated", ownerId);
    expect(await readEvidence()).toEqual([]);
    await expect(saveEvidence("Unapproved substitution", 0, "pending")).rejects.toMatchObject({ code: "22023" });
    await expect(saveEvidence(ingredient, 0, "reviewed", { ...review, preppedRule: null })).rejects.toMatchObject({ code: "22023" });
    await expect(saveEvidence(ingredient, 0, "reviewed", { ...review, crossContactNotes: "\n\t" })).rejects.toMatchObject({ code: "22023" });
    const originalRequest = randomUUID();
    const recorded = await saveEvidence(ingredient, 0, "reviewed", review, originalRequest);
    expect(recorded).toMatchObject({ ingredientKey: ingredient, revision: 1, status: "reviewed",
      reviewedAt: expect.any(String), reviewerName: expect.any(String), ...review });
    expect(await saveEvidence(ingredient, 0, "reviewed", review, originalRequest)).toEqual(recorded);
    await expect(saveEvidence(ingredient, 0, "hold", {}, originalRequest)).rejects.toMatchObject({ code: "PT409" });
    await expect(saveEvidence(ingredient, 0, "hold")).rejects.toMatchObject({ code: "PT409" });
    const hold = await saveEvidence(ingredient, 1, "hold", { supplierSku: "REHEARSAL-REPLACEMENT" });
    expect(hold).toMatchObject({ revision: 2, status: "hold", sourceReference: null, openedRule: null,
      reviewedAt: null, reviewerName: null, supplierSku: "REHEARSAL-REPLACEMENT" });

    await asRole(db, "authenticated", prepUserId);
    expect(await readEvidence()).toEqual([hold]);
    const privateAccess = await db.query(`
      select has_table_privilege(current_user,catalog.oid,'select') as readable
      from pg_class catalog join pg_namespace namespace on namespace.oid = catalog.relnamespace
      where namespace.nspname = 'private' and catalog.relname = 'church_ingredient_evidence_changes'
    `);
    expect(privateAccess.rows[0].readable).toBe(false);
    await expect(saveEvidence(ingredient, 2, "reviewed", review)).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", otherTenantUser);
    await expect(readEvidence()).rejects.toMatchObject({ code: "42501" });
    await expect(saveEvidence(ingredient, 2, "reviewed", review)).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "service_role");
    await expect(readEvidence()).rejects.toMatchObject({ code: "42501" });
    expect(await protectedCounts()).toEqual(before);
    const evidenceHistory = await db.query(`
      select previous_facts,result from private.church_ingredient_evidence_changes
      where ingredient_key=$1 order by recorded_at
    `, [ingredient]);
    expect(evidenceHistory.rows).toHaveLength(2);
    expect(evidenceHistory.rows[0]).toEqual({ previous_facts: null, result: recorded });
    expect(evidenceHistory.rows[1]).toEqual({ previous_facts: { ...recorded, reviewedBy: ownerId }, result: hold });

    for (const entry of churchSandwichBenchRecipes) {
      const actual = await db.query("select private.church_sandwich_formula_ingredients($1) as ingredients", [entry.key]);
      expect(actual.rows[0].ingredients).toEqual([churchSandwichBread, ...entry.portions.map(({ ingredient }) => ingredient)]);
    }
    const readFormulas = async () => (await db.query(
      "select public.list_church_sandwich_formulas($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const saveFormula = async (revision, measurements, request = randomUUID(), reference = "Chef bench sheet 01") => (await db.query(`
      select public.save_church_sandwich_formula($1::uuid,$2::uuid,'parisien',$3::integer,$4::jsonb,$5) as result
    `, [request, workspaceLocationId, revision, JSON.stringify(measurements), reference])).rows[0].result;
    const whole = { quantity: 1, measuredInput: 10, measuredUsable: 9, evidenceRevision: 3, yieldBasis: "whole_each" };
    const weighed = { quantity: 71.125, measuredInput: 900, measuredUsable: 740, evidenceRevision: 1, yieldBasis: "weighed_usable_grams" };
    const measurements = {
      [churchSandwichBread]: whole, "French-style ham": weighed, "cultured butter": { ...weighed, quantity: 16 },
    };
    await asRole(db, "authenticated", ownerId);
    expect(await readFormulas()).toEqual([]);
    await expect(saveFormula(0, measurements)).rejects.toMatchObject({ code: "PT409" });
    await saveEvidence(churchSandwichBread, 2, "reviewed", review);
    await saveEvidence("French-style ham", 0, "reviewed", { ...review, supplierSku: "HQ-HAM-01" });
    await saveEvidence("cultured butter", 0, "reviewed", { ...review, supplierSku: "HQ-BUTTER-01" });

    await expect(saveFormula(0, { ...measurements, mustard: weighed })).rejects.toMatchObject({ code: "22023" });
    await expect(saveFormula(0, { ...measurements, "French-style ham": { ...weighed, measuredUsable: 901 } })).rejects.toMatchObject({ code: "22023" });
    await expect(saveFormula(0, { ...measurements, "French-style ham": { ...weighed, measuredUsable: 70 } })).rejects.toMatchObject({ code: "22023" });
    await expect(saveFormula(0, { ...measurements, "French-style ham": { ...weighed, quantity: 71.1111 } })).rejects.toMatchObject({ code: "22023" });
    await expect(saveFormula(0, { ...measurements, [churchSandwichBread]: { ...whole, measuredUsable: 8.5 } })).rejects.toMatchObject({ code: "22023" });
    await expect(saveFormula(0, { ...measurements, [churchSandwichBread]: { ...whole, evidenceRevision: 1 } })).rejects.toMatchObject({ code: "PT409" });

    const formulaRequest = randomUUID();
    const formula = await saveFormula(0, measurements, formulaRequest);
    expect(formula).toEqual({ recipeKey: "parisien", revision: 1, current: true, measurements,
      reviewReference: "Chef bench sheet 01", reviewedAt: expect.any(String), reviewerName: expect.any(String) });
    expect(await saveFormula(0, measurements, formulaRequest)).toEqual(formula);
    await expect(saveFormula(0, measurements)).rejects.toMatchObject({ code: "PT409" });
    await expect(saveFormula(0, measurements, formulaRequest, "Chef bench sheet 02")).rejects.toMatchObject({ code: "PT409" });
    await asRole(db, "authenticated", prepUserId);
    expect(await readFormulas()).toEqual([formula]);
    await expect(saveFormula(1, measurements)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from private.church_sandwich_formula_revisions")).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", otherTenantUser);
    await expect(readFormulas()).rejects.toMatchObject({ code: "42501" });
    await expect(saveFormula(1, measurements)).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "service_role");
    await expect(readFormulas()).rejects.toMatchObject({ code: "42501" });

    const listRegisterChecks = async () => (await db.query(
      "select public.list_church_sandwich_register_checks($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const registerReceipt = async (request, actor = ownerId) => (await db.query(
      "select public.get_church_sandwich_register_check_receipt($1::uuid,$2::uuid,$3::uuid) as result",
      [actor, workspaceLocationId, request],
    )).rows[0].result;
    const saveRegisterCheck = async ({
      request = randomUUID(), actor = ownerId, workspace = workspaceLocationId, recipe = "parisien", revision = 1,
      item = "POS-FIXTURE-ITEM", version = "999999999999999999", outcome = "matched",
      device = "Training register", reference = "Isolated rehearsal ref 01",
    } = {}) => (await db.query(`
      select public.record_church_sandwich_register_check(
        $1::uuid,$2::uuid,$3::uuid,$4,$5::integer,$6,$7,$8,$9,$10
      ) as result
    `, [actor, workspace, request, recipe, revision, item, version, outcome, device, reference])).rows[0].result;
    const registerRequest = randomUUID();
    await asRole(db, "authenticated", ownerId);
    expect(await listRegisterChecks()).toEqual([]);
    await expect(saveRegisterCheck({ request: registerRequest })).rejects.toMatchObject({ code: "42501" });
    await expect(registerReceipt(registerRequest)).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "service_role");
    await expect(listRegisterChecks()).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from private.church_sandwich_register_checks")).rejects.toMatchObject({ code: "42501" });
    await expect(saveRegisterCheck({ actor: prepUserId })).rejects.toMatchObject({ code: "42501" });
    await expect(saveRegisterCheck({ actor: otherTenantUser })).rejects.toMatchObject({ code: "42501" });
    await expect(saveRegisterCheck({ workspace: "30000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ code: "42501" });
    await expect(registerReceipt(registerRequest, prepUserId)).rejects.toMatchObject({ code: "42501" });
    await expect(saveRegisterCheck({ recipe: "figaro" })).rejects.toMatchObject({ code: "PT409" });
    await expect(saveRegisterCheck({ outcome: "approved_for_service" })).rejects.toMatchObject({ code: "22023" });
    await expect(saveRegisterCheck({ device: "Line\nRegister" })).rejects.toMatchObject({ code: "22023" });
    await expect(saveRegisterCheck({ reference: "   " })).rejects.toMatchObject({ code: "22023" });
    await expect(saveRegisterCheck({ item: "invalid item identifier" })).rejects.toMatchObject({ code: "22023" });
    await expect(saveRegisterCheck({ version: "01" })).rejects.toMatchObject({ code: "22023" });
    expect(await registerReceipt(registerRequest)).toBeNull();
    const matchedRegister = await saveRegisterCheck({ request: registerRequest });
    expect(matchedRegister).toEqual({
      id: registerRequest, recipeKey: "parisien", formulaRevision: 1, squareItemId: "POS-FIXTURE-ITEM",
      squareCatalogVersion: "999999999999999999", outcome: "matched", device: "Training register",
      reference: "Isolated rehearsal ref 01", recordedAt: expect.any(String), recordedByName: "Donald Demo",
    });
    expect(await saveRegisterCheck({ request: registerRequest, device: " Training register " })).toEqual(matchedRegister);
    expect(await registerReceipt(registerRequest)).toEqual(matchedRegister);
    await expect(registerReceipt(registerRequest, secondOwnerId)).rejects.toMatchObject({ code: "PT409" });
    await expect(saveRegisterCheck({ request: registerRequest, actor: secondOwnerId })).rejects.toMatchObject({ code: "PT409" });
    await expect(saveRegisterCheck({ request: registerRequest, version: "999999999999999998" })).rejects.toMatchObject({ code: "PT409" });
    const mismatchRegister = await saveRegisterCheck({ outcome: "mismatch", reference: "Isolated rehearsal ref 02" });
    expect(mismatchRegister).toMatchObject({ outcome: "mismatch", formulaRevision: 1 });
    await asRole(db, "authenticated", prepUserId);
    await expect(listRegisterChecks()).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", otherTenantUser);
    await expect(listRegisterChecks()).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", ownerId);
    expect(await listRegisterChecks()).toEqual([mismatchRegister]);
    await saveEvidence("French-style ham", 1, "hold");
    expect(await readFormulas()).toEqual([{ ...formula, current: false }]);
    expect(await saveFormula(0, measurements, formulaRequest)).toEqual({ ...formula, current: false });
    await asRole(db, "service_role");
    await expect(saveRegisterCheck()).rejects.toMatchObject({ code: "PT409" });
    expect(await registerReceipt(registerRequest)).toEqual(matchedRegister);
    expect(await saveRegisterCheck({ request: registerRequest })).toEqual(matchedRegister);
    await asRole(db, "authenticated", ownerId);
    expect(await listRegisterChecks()).toEqual([mismatchRegister]);
    await saveEvidence("French-style ham", 2, "reviewed", { ...review, supplierSku: "HQ-HAM-02" });
    expect(await readFormulas()).toEqual([{ ...formula, current: false }]);
    const updated = await saveFormula(1, { ...measurements, "French-style ham": { ...weighed, evidenceRevision: 3 } });
    expect(updated).toMatchObject({ recipeKey: "parisien", revision: 2, current: true });
    expect(await readFormulas()).toEqual([updated]);
    expect(await saveFormula(0, measurements, formulaRequest)).toEqual({ ...formula, current: false });
    await asRole(db, "service_role");
    await expect(saveRegisterCheck()).rejects.toMatchObject({ code: "PT409" });
    const latestRegister = await saveRegisterCheck({ revision: 2, outcome: "unavailable", reference: "Isolated rehearsal ref 03" });
    expect(latestRegister).toMatchObject({ outcome: "unavailable", formulaRevision: 2 });
    await asRole(db, "authenticated", ownerId);
    expect(await listRegisterChecks()).toEqual([latestRegister]);
    await db.exec("reset role");
    const registerAudit = await db.query(`
      select id::text, recorded_by::text as actor from private.church_sandwich_register_checks order by check_sequence
    `);
    expect(registerAudit.rows).toEqual([matchedRegister, mismatchRegister, latestRegister].map(({ id }) => ({ id, actor: ownerId })));
    await expect(db.query("update private.church_sandwich_register_checks set outcome = 'matched'"))
      .rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", ownerId);

    const listTiming = async () => (await db.query(
      "select public.list_church_sandwich_timing_runs($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const recordTiming = async ({ request = randomUUID(), recipe = "parisien", revision = null, attempted = 6,
      accepted = 5, crew = 1, prep = null, build = 387, pack = null, reference = "Trial sheet 014", note = null } = {}) =>
      (await db.query(`
        select public.record_church_sandwich_timing_run(
          $1::uuid,$2::uuid,$3,$4::int,$5::int,$6::int,$7::int,$8,$9::int,$10::int,$11::int,$12
        ) as result
      `, [workspaceLocationId, request, recipe, attempted, accepted, crew, build, reference, revision, prep, pack, note])).rows[0].result;
    const signedTimingRequest = randomUUID();
    expect(await listTiming()).toEqual([]);
    const bench = await recordTiming({ recipe: "bleu", prep: 0 });
    expect(bench).toMatchObject({ recipeKey: "bleu", formulaRevision: null, prepSeconds: 0, packSeconds: null,
      attempted: 6, accepted: 5, buildSeconds: 387, reference: "Trial sheet 014", note: null });
    expect(await recordTiming({ recipe: "rustique", accepted: 0, build: 1 })).toMatchObject({ accepted: 0 });
    await expect(recordTiming({ accepted: 7 })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ crew: 13 })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ build: 0 })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ pack: 43201 })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ prep: -1 })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ reference: " \t " })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ note: "x".repeat(501) })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ note: "Unexpected\nline break" })).rejects.toMatchObject({ code: "22023" });
    await expect(recordTiming({ revision: 1 })).rejects.toMatchObject({ code: "PT409" });
    await expect(recordTiming({ recipe: "figaro", revision: 1 })).rejects.toMatchObject({ code: "PT409" });
    const measuredTiming = { request: signedTimingRequest, revision: 2, prep: 915, pack: 0, note: "Second build rewrapped" };
    const signedTiming = await recordTiming(measuredTiming);
    expect(signedTiming).toEqual({ id: signedTimingRequest, recipeKey: "parisien", formulaRevision: 2,
      attempted: 6, accepted: 5, crewSize: 1, prepSeconds: 915, buildSeconds: 387, packSeconds: 0,
      reference: "Trial sheet 014", note: "Second build rewrapped", recordedAt: expect.any(String), recordedByName: expect.any(String) });
    expect(await recordTiming({ ...measuredTiming, reference: " Trial sheet 014 " })).toEqual(signedTiming);
    await expect(recordTiming({ ...measuredTiming, prep: null })).rejects.toMatchObject({ code: "PT409" });
    await asRole(db, "authenticated", prepUserId);
    expect((await listTiming())[0]).toEqual(signedTiming);
    await expect(recordTiming()).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from private.church_sandwich_timing_runs")).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", otherTenantUser);
    await expect(listTiming()).rejects.toMatchObject({ code: "42501" });
    await expect(recordTiming()).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "service_role");
    await expect(listTiming()).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", ownerId);

    await db.exec("reset role");
    const formulaHistory = await db.query(`
      select revision,reviewed_by::text,supplier_evidence->'French-style ham'->>'supplierSku' as sku
      from private.church_sandwich_formula_revisions order by revision
    `);
    expect(formulaHistory.rows).toEqual([
      { revision: 1, reviewed_by: ownerId, sku: "HQ-HAM-01" }, { revision: 2, reviewed_by: ownerId, sku: "HQ-HAM-02" },
    ]);
    await expect(db.query("update private.church_sandwich_formula_revisions set review_reference = 'A new value'"))
      .rejects.toMatchObject({ code: "42501" });

    const readBatches = async () => (await db.query(
      "select public.list_church_ingredient_batches($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const batchRequest = randomUUID();
    const handledAt = new Date(Date.now() - 15 * 60_000).toISOString();
    const discardAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const recordBatch = async ({ request = randomUUID(), revision = 3, lot = "LOT-42", code = "PREP-42",
      stage = "prepped", handled = handledAt, discard = discardAt } = {}) => (await db.query(`
      select public.record_church_ingredient_batch($1::uuid,$2::uuid,'French-style ham',$3::integer,$4,$5,$6,$7::timestamptz,$8::timestamptz) as result
    `, [request, workspaceLocationId, revision, lot, code, stage, handled, discard])).rows[0].result;
    const voidBatch = async (request = randomUUID(), reason = "Incorrect physical label", id = batchRequest) => (await db.query(`
      select public.void_church_ingredient_batch($1::uuid,$2::uuid,$3::uuid,$4) as result
    `, [workspaceLocationId, id, request, reason])).rows[0].result;
    const batchQueue = async () => (await db.query(
      "select public.list_church_ingredient_batch_queue($1::uuid) as result", [workspaceLocationId],
    )).rows[0].result;
    const resolveBatch = async (id, outcome, request = randomUUID()) => (await db.query(`
      select public.resolve_church_ingredient_batch($1::uuid,$2::uuid,$3::uuid,$4) as result
    `, [workspaceLocationId, id, request, outcome])).rows[0].result;

    await asRole(db, "authenticated", ownerId);
    expect(await readBatches()).toEqual([]);
    await expect(recordBatch({ revision: 2 })).rejects.toMatchObject({ code: "PT409" });
    await expect(recordBatch({ handled: discardAt })).rejects.toMatchObject({ code: "22023" });
    await expect(recordBatch({ handled: new Date(Date.now() + 60_000).toISOString() })).rejects.toMatchObject({ code: "22023" });
    await expect(recordBatch({ discard: new Date(Date.now() - 1_000).toISOString() })).rejects.toMatchObject({ code: "22023" });
    await expect(recordBatch({ discard: "infinity" })).rejects.toMatchObject({ code: "22023" });
    await expect(recordBatch({ lot: "   " })).rejects.toMatchObject({ code: "22023" });
    const batch = await recordBatch({ request: batchRequest });
    expect(batch).toEqual({ id: batchRequest, ingredientKey: "French-style ham", evidenceRevision: 3, supplierSku: "HQ-HAM-02",
      supplierLot: "LOT-42", batchCode: "PREP-42", handledAs: "prepped", handledAt: expect.any(String), discardAt: expect.any(String),
      storageRule: review.storageRule, handlingRule: review.preppedRule, recordedAt: expect.any(String), recordedByName: expect.any(String),
      evidenceCurrent: true, voidedAt: null, voidReason: null, disposition: null, latestMeasurement: null });
    expect(Date.parse(batch.handledAt)).toBe(Date.parse(handledAt));
    expect(Date.parse(batch.discardAt)).toBe(Date.parse(discardAt));
    expect(await recordBatch({ request: batchRequest, lot: "  LOT-42  " })).toEqual(batch);
    await expect(recordBatch({ request: batchRequest, lot: "OTHER" })).rejects.toMatchObject({ code: "PT409" });
    await expect(recordBatch()).rejects.toMatchObject({ code: "PT409" });
    const opened = await recordBatch({ code: "OPEN-42", stage: "opened" });
    expect(opened).toMatchObject({ handledAs: "opened", handlingRule: review.openedRule });
    const earlier = await recordBatch({ code: "EARLY-42", discard: new Date(Date.now() + 7 * 60_000).toISOString() });
    const exactQueue = [earlier, ...[opened, batch].sort((first, second) => first.id.localeCompare(second.id))];
    expect(await batchQueue()).toEqual({ batches: exactQueue, total: 3 });

    await asRole(db, "authenticated", prepUserId);
    expect(await readBatches()).toEqual([earlier, opened, batch]);
    expect(await batchQueue()).toEqual({ batches: exactQueue, total: 3 });
    await expect(recordBatch()).rejects.toMatchObject({ code: "42501" });
    await expect(voidBatch()).rejects.toMatchObject({ code: "42501" });
    await expect(resolveBatch(earlier.id, "discarded")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from private.church_ingredient_batches")).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "authenticated", otherTenantUser);
    await expect(readBatches()).rejects.toMatchObject({ code: "42501" });
    await expect(batchQueue()).rejects.toMatchObject({ code: "42501" });
    await asRole(db, "service_role");
    await expect(readBatches()).rejects.toMatchObject({ code: "42501" });

    await asRole(db, "authenticated", ownerId);
    const usedRequest = randomUUID();
    await expect(resolveBatch(earlier.id, "expired")).rejects.toMatchObject({ code: "22023" });
    const used = await resolveBatch(earlier.id, "used_up", usedRequest);
    expect(used).toEqual({ ...earlier, disposition: { outcome: "used_up", resolvedAt: expect.any(String), resolvedByName: expect.any(String) } });
    expect(Date.parse(used.disposition.resolvedAt)).toBeLessThan(Date.parse(used.discardAt));
    expect(await resolveBatch(earlier.id, "used_up", usedRequest)).toEqual(used);
    await expect(resolveBatch(earlier.id, "discarded", usedRequest)).rejects.toMatchObject({ code: "PT409" });
    await expect(resolveBatch(earlier.id, "used_up")).rejects.toMatchObject({ code: "PT409" });
    await expect(voidBatch(randomUUID(), "Wrong outcome", earlier.id)).rejects.toMatchObject({ code: "PT409" });
    await saveEvidence("French-style ham", 3, "hold");
    await expect(recordTiming({ revision: 2 })).rejects.toMatchObject({ code: "PT409" });
    expect(await recordTiming(measuredTiming)).toEqual(signedTiming);
    expect(await recordBatch({ request: batchRequest })).toEqual({ ...batch, evidenceCurrent: false });
    await expect(recordBatch({ code: "PREP-43" })).rejects.toMatchObject({ code: "PT409" });
    await expect(resolveBatch(opened.id, "used_up")).rejects.toMatchObject({ code: "PT409" });
    const discarded = await resolveBatch(opened.id, "discarded");
    expect(discarded).toEqual({ ...opened, evidenceCurrent: false, disposition: {
      outcome: "discarded", resolvedAt: expect.any(String), resolvedByName: expect.any(String),
    } });
    const voidRequest = randomUUID();
    await expect(voidBatch(voidRequest, "x".repeat(241))).rejects.toMatchObject({ code: "22023" });
    const voided = await voidBatch(voidRequest);
    expect(voided).toEqual({ ...batch, evidenceCurrent: false, voidReason: "Incorrect physical label", voidedAt: expect.any(String) });
    expect(await voidBatch(voidRequest, "  Incorrect physical label ")).toEqual(voided);
    expect(await recordBatch({ request: batchRequest })).toEqual(voided);
    await expect(voidBatch(voidRequest, "Changed reason")).rejects.toMatchObject({ code: "PT409" });
    await expect(voidBatch(voidRequest, "Incorrect physical label", opened.id)).rejects.toMatchObject({ code: "PT409" });
    await expect(voidBatch()).rejects.toMatchObject({ code: "PT409" });
    await expect(resolveBatch(batchRequest, "discarded")).rejects.toMatchObject({ code: "PT409" });
    expect(await batchQueue()).toEqual({ batches: [], total: 0 });
    expect(await readBatches()).toEqual([voided, discarded, { ...used, evidenceCurrent: false }]);
    await db.exec("reset role");
    const voidAudit = await db.query("select voided_by::text as actor, reason from private.church_ingredient_batch_voids where batch_id=$1", [batchRequest]);
    expect(voidAudit.rows).toEqual([{ actor: ownerId, reason: "Incorrect physical label" }]);
    await expect(db.query("delete from private.church_ingredient_batch_voids")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("update private.church_ingredient_batches set supplier_lot = 'NEW'"))
      .rejects.toMatchObject({ code: "42501" });
    const dispositionAudit = await db.query("select resolved_by::text as actor, outcome from private.church_ingredient_batch_dispositions where batch_id=$1", [earlier.id]);
    expect(dispositionAudit.rows).toEqual([{ actor: ownerId, outcome: "used_up" }]);
    await expect(db.query("delete from private.church_ingredient_batch_dispositions")).rejects.toMatchObject({ code: "42501" });

    // Seed recorded historical/overflow examples without adding a wall-clock delay to the local harness.
    const overflow = await db.query(`
      insert into private.church_ingredient_batches (
        organization_id,location_id,id,ingredient_key,evidence_revision,supplier_sku,supplier_lot,batch_code,
        handled_as,handled_at,discard_at,storage_rule,handling_rule,recorded_at,recorded_by,recorded_by_name
      ) select original.organization_id,original.location_id,gen_random_uuid(),original.ingredient_key,4,
        original.supplier_sku,original.supplier_lot,'OVERFLOW-'||position,original.handled_as,
        original.handled_at - interval '1 day',
        clock_timestamp() + make_interval(mins => position - 2),original.storage_rule,original.handling_rule,
        original.recorded_at - interval '1 day',original.recorded_by,original.recorded_by_name
      from private.church_ingredient_batches original cross join generate_series(1,52) fixture(position)
      where original.id=$1::uuid returning id,batch_code
    `, [batchRequest]);
    // Current supplier review r5 means the historical first batch below can be overdue
    // while the first record verifies held evidence and the second exercises the time gate.
    await asRole(db, "authenticated", ownerId);
    await saveEvidence("French-style ham", 4, "reviewed", { ...review, supplierSku: "HQ-HAM-02" });
    await db.exec("reset role");
    const overdue = await db.query(`
      insert into private.church_ingredient_batches (
        organization_id,location_id,id,ingredient_key,evidence_revision,supplier_sku,supplier_lot,batch_code,
        handled_as,handled_at,discard_at,storage_rule,handling_rule,recorded_at,recorded_by,recorded_by_name
      ) select organization_id,location_id,gen_random_uuid(),ingredient_key,5,
        supplier_sku,supplier_lot,'OVERDUE-CURRENT',handled_as,handled_at - interval '2 day',
        clock_timestamp() - interval '2 minutes',storage_rule,handling_rule,
        recorded_at - interval '2 day',recorded_by,recorded_by_name
      from private.church_ingredient_batches where id=$1::uuid returning id
    `, [batchRequest]);
    await asRole(db, "authenticated", ownerId);
    const boundedQueue = await batchQueue();
    expect(boundedQueue.total).toBe(53);
    expect(boundedQueue.batches).toHaveLength(50);
    expect(boundedQueue.batches[0]).toMatchObject({ batchCode: "OVERDUE-CURRENT", evidenceCurrent: true });
    expect(boundedQueue.batches[1].id).toBe(overflow.rows.find(({ batch_code }) => batch_code === "OVERFLOW-1").id);
    expect(boundedQueue.batches.at(-1).batchCode).toBe("OVERFLOW-49");
    const overdueId = overdue.rows[0].id;
    expect((await readBatches()).some(({ id }) => id === overdueId)).toBe(false);
    await expect(resolveBatch(overdueId, "used_up")).rejects.toMatchObject({ code: "PT409" });
    expect(await resolveBatch(overdueId, "discarded")).toMatchObject({ disposition: { outcome: "discarded" } });
    expect((await batchQueue()).total).toBe(52);
    const recentAfterDiscard = await readBatches();
    expect(recentAfterDiscard).toHaveLength(50);
    expect(recentAfterDiscard[0]).toMatchObject({ id: overdueId, disposition: { outcome: "discarded" } });
    await db.exec("reset role");
    const timingAudit = await db.query("select recorded_by::text as actor from private.church_sandwich_timing_runs where id=$1", [signedTimingRequest]);
    expect(timingAudit.rows).toEqual([{ actor: ownerId }]);
    await expect(db.query("delete from private.church_sandwich_timing_runs")).rejects.toMatchObject({ code: "42501" });
    await db.query(`
      insert into private.church_sandwich_timing_runs (
        organization_id,location_id,id,recipe_key,attempted,accepted,crew_size,build_seconds,reference,recorded_at,recorded_by,recorded_by_name
      ) select organization_id,location_id,gen_random_uuid(),recipe_key,1,1,1,10,'older rehearsal '||position,
        recorded_at - make_interval(mins => position),recorded_by,recorded_by_name
      from private.church_sandwich_timing_runs cross join generate_series(1,32) fixture(position)
      where id = $1
    `, [signedTimingRequest]);
    await asRole(db, "authenticated", ownerId);
    const boundedTiming = await listTiming();
    expect(boundedTiming).toHaveLength(30);
    expect(boundedTiming[0]).toEqual(signedTiming);
    expect(await protectedCounts()).toEqual(before);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db.close();
  }
}, 180_000);
