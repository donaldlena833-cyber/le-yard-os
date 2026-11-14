import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), scope: vi.fn(), configuration: vi.fn(), get: vi.fn(), rpc: vi.fn(), query: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/data/actor", () => ({ requireAuthenticatedActor: async () => ({ userId: "church-staff" }) }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({
  verifyChurchSquareOrderWindowScope: mocks.scope,
}));
vi.mock("@/lib/integrations/church-square-orders.server", () => ({
  churchSquareOrderConfiguration: mocks.configuration,
  ChurchSquareOrderClient: class { get = mocks.get; },
}));

import { lookupChurchSquareOrderEvidenceAction } from "@/app/actions/workflows/church-square-order-evidence";

const orderId = "production-order-ABC0123456";
const createdAt = "2026-11-14T14:00:00Z";
const updatedAt = "2026-11-14T14:15:00Z";
const workspace = { identity: { userId: "church-staff" }, activeLocation: { id: "church-location" } };
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
  mocks.rpc.mockReturnValue({ abortSignal: mocks.query });
  mocks.query.mockResolvedValue({ error: null, data: { updatedAt, matches: true } });
});

it("compares the exact completed order and returns only checklist evidence", async () => {
  const result = await lookupChurchSquareOrderEvidenceAction({ orderId: ` ${orderId} ` });
  expect(result).toEqual({
    ok: true, mode: "live", persisted: false,
    data: {
      reference: "ABC0123456", checkedAt: expect.any(String),
      square: { status: "COMPLETED", source: "SQUARE_ONLINE", createdAt, updatedAt, fulfillments: [fulfillment] },
      operations: { status: "observed", updatedAt, matches: true },
    },
  });
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("order", orderId);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_church_square_order_evidence", {
    p_location_id: "church-location", p_merchant_id: "approved-merchant", p_square_location_id: "square-location",
    p_order_id: orderId, p_square_updated_at: updatedAt, p_square_version: 7,
  });
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
});
