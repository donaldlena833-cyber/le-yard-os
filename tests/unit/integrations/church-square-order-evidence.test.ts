import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), scope: vi.fn(), configuration: vi.fn(), get: vi.fn(), rpc: vi.fn(), query: vi.fn(), receiptQuery: vi.fn(),
  serviceRpc: vi.fn(), serviceResult: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.serviceRpc }) }));
vi.mock("@/data/actor", () => ({ requireAuthenticatedActor: async () => ({ userId: "church-staff" }) }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({
  verifyChurchSquareOrderWindowScope: mocks.scope,
}));
vi.mock("@/lib/integrations/church-square-orders.server", () => ({
  churchSquareOrderConfiguration: mocks.configuration,
  ChurchSquareOrderClient: class { get = mocks.get; },
}));

import { lookupChurchSquareOrderEvidenceAction, recoverChurchSquareOrderEvidenceAction } from "@/app/actions/workflows/church-square-order-evidence";

const orderId = "production-order-ABC0123456";
const createdAt = "2026-11-14T14:00:00Z";
const updatedAt = "2026-11-14T14:15:00Z";
const workspace = {
  identity: { userId: "church-staff" }, activeLocation: { id: "church-location" }, capabilities: ["manager_log.manage"],
};
const fulfillment = {
  type: "PICKUP", status: "COMPLETED", promisedAt: "2026-11-14T14:20:00Z",
  readyAt: "2026-11-14T14:12:00Z", handoffAt: null, completedAt: updatedAt, canceledAt: null, rejectedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.scope.mockResolvedValue(true);
  mocks.configuration.mockReturnValue({ merchantId: "approved-merchant", locationId: "square-location" });
  mocks.get.mockResolvedValue({
    id: orderId, createdAt, updatedAt, version: 7, sourceHint: "SQUARE_ONLINE", status: "COMPLETED",
    lineItems: [{ note: "private-item-note" }],
    fulfillments: [{ ...fulfillment, id: "private-fulfillment", note: "private-ticket-note" }],
  });
  mocks.rpc.mockImplementation((name) => ({
    abortSignal: name === "get_church_square_order_receipt_evidence" ? mocks.receiptQuery : mocks.query,
  }));
  mocks.query.mockResolvedValue({ error: null, data: { updatedAt, matches: true } });
  mocks.receiptQuery.mockResolvedValue({ error: null, data: { order: null, payment: null } });
  mocks.serviceRpc.mockReturnValue({ abortSignal: mocks.serviceResult });
  mocks.serviceResult.mockResolvedValue({ error: null, data: true });
});

it("compares the exact completed order and returns only checklist evidence", async () => {
  const result = await lookupChurchSquareOrderEvidenceAction({ orderId: ` ${orderId} ` });
  expect(result).toEqual({
    ok: true, mode: "live", persisted: false,
    data: {
      reference: "ABC0123456", checkedAt: expect.any(String), canRecover: true,
      square: { status: "COMPLETED", source: "SQUARE_ONLINE", createdAt, updatedAt, version: 7, fulfillments: [fulfillment] },
      operations: { status: "observed", updatedAt, matches: true, recoveredAt: null, source: null, savedAt: null },
      receipts: { order: null, payment: null },
    },
  });
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("order", orderId);
  expect(mocks.rpc).toHaveBeenCalledWith("get_church_square_order_evidence", {
    p_location_id: "church-location", p_merchant_id: "approved-merchant", p_square_location_id: "square-location",
    p_order_id: orderId, p_square_updated_at: updatedAt, p_square_version: 7,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("get_church_square_order_receipt_evidence", {
    p_location_id: "church-location", p_merchant_id: "approved-merchant", p_square_location_id: "square-location",
    p_order_id: orderId,
  });
});

it("keeps first saves separate from signed receipts and withholds private webhook fields", async () => {
  const receivedAt = "2026-11-14T14:00:09Z";
  const savedAt = "2026-11-14T14:05:00Z";
  const orderReceipt = { eventType: "order.updated", squareCreatedAt: createdAt, receivedAt, processedAt: null, state: "pending" };
  const paymentReceipt = { eventType: "payment.created", squareCreatedAt: createdAt, receivedAt, processedAt: savedAt, state: "verified" };
  mocks.query.mockResolvedValue({ error: null, data: { updatedAt, matches: true, source: "scheduled", savedAt } });
  mocks.receiptQuery.mockResolvedValue({ error: null, data: {
    order: { ...orderReceipt, eventId: "private-event-id" }, payment: { ...paymentReceipt, resourceId: "private-payment-id" },
  } });
  const result = await lookupChurchSquareOrderEvidenceAction({ orderId });
  expect(result).toMatchObject({ ok: true, data: { operations: { source: "scheduled", savedAt }, receipts: {
    order: orderReceipt, payment: paymentReceipt,
  } } });
  expect(JSON.stringify(result)).not.toContain("private-");

  mocks.receiptQuery.mockRejectedValueOnce(new Error("Receipt lookup timed out"));
  const unavailable = await lookupChurchSquareOrderEvidenceAction({ orderId });
  expect(unavailable).toMatchObject({ ok: true, data: { operations: { source: "scheduled", savedAt } } });
  if (unavailable.ok && unavailable.mode === "live") expect(unavailable.data).not.toHaveProperty("receipts");
});

it("distinguishes no stored order from an unavailable comparison", async () => {
  mocks.query.mockResolvedValueOnce({ error: null, data: null }).mockRejectedValueOnce(new Error("Transport unavailable"));
  for (const status of ["not_observed", "unavailable"]) {
    expect(await lookupChurchSquareOrderEvidenceAction({ orderId })).toMatchObject({
      ok: true, data: { operations: { status } },
    });
  }
});

it("checks scope and validation before provider access and withholds results after a permissions change", async () => {
  mocks.scope.mockResolvedValueOnce(false);
  expect(await lookupChurchSquareOrderEvidenceAction({ orderId, locationId: "other" })).toMatchObject({ ok: false });
  expect(await lookupChurchSquareOrderEvidenceAction({ orderId })).toMatchObject({ ok: false, code: "forbidden" });
  expect(mocks.get).not.toHaveBeenCalled();

  mocks.query.mockResolvedValueOnce({ error: { code: "42501" }, data: null });
  expect(await lookupChurchSquareOrderEvidenceAction({ orderId })).toMatchObject({ ok: false, code: "forbidden" });

  mocks.receiptQuery.mockResolvedValueOnce({ error: { code: "42501" }, data: null });
  expect(await lookupChurchSquareOrderEvidenceAction({ orderId })).toMatchObject({ ok: false, code: "forbidden" });
});

it("recovers the checked provider revision and reads back the audited copy", async () => {
  const recoveredAt = "2026-11-14T15:00:00Z";
  mocks.query.mockResolvedValue({ error: null, data: { updatedAt, matches: true, recoveredAt } });
  expect(await recoverChurchSquareOrderEvidenceAction({ orderId, checkedRevision: updatedAt, checkedVersion: 7 }))
    .toMatchObject({ ok: true, persisted: true, data: { operations: { matches: true, recoveredAt } } });
  expect(mocks.serviceRpc).toHaveBeenCalledExactlyOnceWith("service_recover_church_square_order", expect.objectContaining({
    p_actor_id: "church-staff", p_location_id: "church-location", p_merchant_id: "approved-merchant",
    p_square_location_id: "square-location", p_order_id: orderId, p_facts: expect.objectContaining({ id: orderId, version: 7 }),
  }));
});

it("rejects an outdated provider version and a user without Manager Log access before the save", async () => {
  const input = { orderId, checkedRevision: updatedAt, checkedVersion: 7 };
  mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: [] } });
  expect(await recoverChurchSquareOrderEvidenceAction(input)).toMatchObject({ ok: false, code: "forbidden" });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(await recoverChurchSquareOrderEvidenceAction({ ...input, checkedVersion: 6 })).toMatchObject({ ok: false, code: "stale" });
  expect(mocks.serviceRpc).not.toHaveBeenCalled();
});
