import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processChurchSquareStockRecovery } from "@/lib/integrations/church-square-stock-recovery.server";

const { rpc, retrieveCounts } = vi.hoisted(() => ({ rpc: vi.fn(), retrieveCounts: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/integrations/square-counts.server", () => ({
  SquareCountClient: class {
    retrieveMappedCurrentCounts = retrieveCounts;
  },
}));

const scope = { p_merchant_id: "MERCHANT_1", p_square_location_id: "CHURCH_1" };

function resolveRpc(data: unknown) {
  rpc.mockReturnValueOnce({ abortSignal: async () => ({ data, error: null }) });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_COUNTS_ENABLED", "true");
  vi.stubEnv("SQUARE_CHURCH_ACCESS_TOKEN", "synthetic");
  vi.stubEnv("SQUARE_CHURCH_MERCHANT_ID", scope.p_merchant_id);
  vi.stubEnv("SQUARE_CHURCH_LOCATION_ID", scope.p_square_location_id);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rpc.mockReset();
  retrieveCounts.mockReset();
});

describe("scheduled Church Street Square stock recovery", () => {
  it("reconciles only observations from the mapped provider read, keeping zero distinct from absence", async () => {
    const observations = [{ variationId: "V1", quantity: "0", calculatedAt: "2026-11-14T12:00:00.123456Z" }];
    resolveRpc(["V1", "V2"]);
    retrieveCounts.mockResolvedValueOnce(observations);
    resolveRpc({ applied: 1, ignored: 0 });

    await processChurchSquareStockRecovery();

    expect(rpc).toHaveBeenNthCalledWith(1, "service_list_church_square_stock_mappings", scope);
    expect(retrieveCounts).toHaveBeenCalledExactlyOnceWith(["V1", "V2"]);
    expect(rpc).toHaveBeenNthCalledWith(2, "service_reconcile_church_square_stock", { ...scope, p_inventory: observations });
    expect(console.info).toHaveBeenCalledWith(expect.any(String), { mapped: 2, observed: 1, applied: 1, ignored: 0 });
  });

  it("does not perform an unscoped provider read for absent or invalid mappings", async () => {
    resolveRpc([]);
    resolveRpc(["V1", "V1"]);
    await processChurchSquareStockRecovery();
    await processChurchSquareStockRecovery();
    expect(retrieveCounts).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("leaves existing observations alone when Square returns none or the provider read fails", async () => {
    resolveRpc(["V1"]);
    resolveRpc(["V1"]);
    retrieveCounts.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("read failed"));
    await processChurchSquareStockRecovery();
    await processChurchSquareStockRecovery();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(expect.any(String), { mapped: 1, observed: 0, applied: 0, ignored: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.any(String), "read Square counts");
  });

  it("stays disabled without the production counts connection", async () => {
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_COUNTS_ENABLED", "false");
    await processChurchSquareStockRecovery();
    expect(rpc).not.toHaveBeenCalled();
    expect(retrieveCounts).not.toHaveBeenCalled();
  });
});
