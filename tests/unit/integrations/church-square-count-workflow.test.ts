import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const readback = {
  physicalCountId: "square-receipt", currentQuantity: "3", calculatedAt: "2026-11-14T12:00:01.000Z",
  variationId: "sandwich", locationId: "church",
};
const observationArguments = {
  p_merchant_id: "merchant", p_square_location_id: "church",
  p_inventory: [{ variationId: "sandwich", quantity: "3", calculatedAt: readback.calculatedAt }],
};
let infoLog: ReturnType<typeof vi.spyOn>;

describe("Church Street physical stock count workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date("2026-11-14T12:00:02Z"));
  });
  afterEach(() => {
    infoLog.mockRestore();
    vi.useRealTimers();
  });

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

  it("recovers an aged dispatched count and reconciles its readback without writing to Square again", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { applied: 1, ignored: 0 } });
    mocks.rpc.mockResolvedValueOnce({ data: { ...claim, status: "recovery_required", wasDispatched: true } })
      .mockResolvedValueOnce({}).mockReturnValueOnce({ abortSignal });
    mocks.confirm.mockResolvedValueOnce(readback);
    await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "confirmed", currentQuantity: "3" });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "service_finish_church_square_count", {
      p_request_id: id(4), p_attempt_id: id(6), p_status: "confirmed", p_provider_count_id: "square-receipt",
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith("service_reconcile_church_square_stock", observationArguments);
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(infoLog).toHaveBeenCalledExactlyOnceWith("Church Street Square stock readback synced.", { applied: 1, ignored: 0 });
  });

  it("reconciles the provider's five units rather than the physical input after a new count", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { applied: 0, ignored: 1 } });
    mocks.rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: true })
      .mockResolvedValueOnce({}).mockReturnValueOnce({ abortSignal });
    mocks.write.mockImplementationOnce(async (_observation, beforeWrite) => {
      await beforeWrite();
      return { ...readback, currentQuantity: "5" };
    });
    await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "confirmed", currentQuantity: "5" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("service_reconcile_church_square_stock", {
      ...observationArguments, p_inventory: [{ variationId: "sandwich", quantity: "5", calculatedAt: readback.calculatedAt }],
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(infoLog).toHaveBeenCalledExactlyOnceWith("Church Street Square stock readback synced.", { applied: 0, ignored: 1 });
  });

  it("preserves the confirmed physical receipt if the alert readback loses its separate write", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const abortSignal = vi.fn().mockRejectedValue(new Error("private failure details"));
      mocks.rpc.mockResolvedValueOnce({ data: { ...claim, status: "recovery_required", wasDispatched: true } })
        .mockResolvedValueOnce({}).mockReturnValueOnce({ abortSignal });
      mocks.confirm.mockResolvedValueOnce(readback);
      await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "confirmed", currentQuantity: "3" });
      expect(log).toHaveBeenCalledExactlyOnceWith("Church Street Square stock readback sync incomplete.");
      expect(infoLog).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledTimes(3);
    } finally {
      log.mockRestore();
    }
  });

  it("does not publish a readback until the physical receipt is recorded", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...claim, status: "recovery_required", wasDispatched: true } })
      .mockResolvedValueOnce({ error: { message: "Count receipt unavailable" } });
    mocks.confirm.mockResolvedValueOnce(readback);
    await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "pending" });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    { calculatedAt: "2126-11-14T12:00:00.000Z" },
    { calculatedAt: "2026-11-14T11:59:59.999Z" },
    { locationId: "outside" },
    { variationId: "outside" },
  ])("keeps suspect readback out of stock alerts", async (changes) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.rpc.mockResolvedValueOnce({ data: { ...claim, status: "recovery_required", wasDispatched: true } })
        .mockResolvedValueOnce({});
      mocks.confirm.mockResolvedValueOnce({ ...readback, ...changes });
      await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "confirmed", currentQuantity: "3" });
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledExactlyOnceWith("Church Street Square stock readback sync incomplete.");
    } finally {
      log.mockRestore();
    }
  });

  it("does not read Square or republish a readback when retrying an already confirmed request", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "confirmed", requestId: input.requestId } });
    await expect(sendChurchSquareCount(context, input)).resolves.toEqual({ status: "confirmed" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("stops when the database scope does not match the configured café", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...claim, squareLocationId: "other-site" } });
    await expect(sendChurchSquareCount(context, input)).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
