import { describe, expect, it, vi } from "vitest";
import { retryIntegrationSync } from "@/data/workflows/integrations";
vi.mock("@/data/policy", () => ({ requireOrganizationOperations: () => ({ role: "owner" }) }));
describe("retired provider jobs", () => {
  it("refuses a direct retry before queueing database work", async () => {
    const rpc = vi.fn();
    const from = vi.fn((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ error: null, data: table === "integration_sync_jobs"
          ? { id: "job", organization_id: "org", connection_id: "connection", status: "failed", attempts: 1, max_attempts: 5 }
          : { provider: "toast" } }),
      };
      return query;
    });
    await expect(retryIntegrationSync({ actor: {}, supabase: { from, rpc } } as never, { requestId: "request", syncJobId: "job" })).rejects.toMatchObject({ code: "conflict", message: "This integration has been retired. No retry was queued." });
    expect(rpc).not.toHaveBeenCalled();
  });
});
