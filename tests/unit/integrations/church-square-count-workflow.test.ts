import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendChurchSquareCount } from "@/data/workflows/church-square-counts";
import type { WorkflowContext } from "@/data/execute";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), write: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/integrations/church-square-configuration.server", () => ({
  churchSquareCountConfiguration: () => ({ merchantId: "merchant", locationId: "church" }),
}));
vi.mock("@/lib/integrations/square-counts.server", () => ({
  SquareCountClient: class {
    writePhysicalCount = mocks.write;
    confirmPhysicalCount = mocks.confirm;
  },
  SquareCountError: Error,
}));

const id = (suffix: number) => `a1200000-0000-4000-8000-00000000000${suffix}`;
const input = { organizationId: id(1), locationId: id(2), itemId: id(3), requestId: id(4), quantity: "0", reason: "Sold final portion" };
const context: WorkflowContext = { supabase: {} as WorkflowContext["supabase"], actor: { userId: id(5), aal: "aal2", memberships: [
  { organizationId: id(1), role: "manager", locationIds: [id(2)], organizationWide: false },
] } };
const claim = {
  status: "pending", requestId: id(4), attemptId: id(6), observedAt: "2026-11-14T12:00:00.000Z",
  quantity: "0", merchantId: "merchant", squareLocationId: "church", variationId: "sandwich", wasDispatched: false,
};

describe("Church Street physical stock count workflow", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires a dispatch receipt and preserves an ambiguous count for the same ID", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: true });
    mocks.write.mockImplementationOnce(async (_observation, beforeWrite) => {
      await beforeWrite();
      throw new Error("Square connection lost");
    });
    await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "pending" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "service_claim_church_square_count", "service_mark_church_square_count_dispatched",
    ]);
    expect(mocks.write.mock.calls[0][0]).toEqual({
      requestId: id(4), occurredAt: claim.observedAt, quantity: 0, variationId: "sandwich",
    });
  });

  it("recovers an aged dispatched count by readback without writing to Square again", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...claim, status: "recovery_required", wasDispatched: true } })
      .mockResolvedValueOnce({});
    mocks.confirm.mockResolvedValueOnce({ physicalCountId: "square-receipt", currentQuantity: "3" });
    await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "confirmed", currentQuantity: "3" });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("service_finish_church_square_count", {
      p_request_id: id(4), p_attempt_id: id(6), p_status: "confirmed", p_provider_count_id: "square-receipt",
    });
  });

  it("stops when the database scope does not match the configured café", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...claim, squareLocationId: "other-site" } });
    await expect(sendChurchSquareCount(context, input)).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
