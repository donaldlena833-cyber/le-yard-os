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

const ownerId = "10000000-0000-4000-8000-000000000001";
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
    const roster = [{ user_id: ownerId, role: "owner" }, { user_id: prepUserId, role: "employee", job_code: "PREP" }];
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
    expect(await readSummary()).toEqual({ pending: 2, needsReview: 0, resources: [] });
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
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db.close();
  }
}, 90_000);
