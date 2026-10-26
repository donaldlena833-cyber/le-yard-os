import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/integrations/toast-labor/route";

describe("retired integration worker", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("cannot resume provider requests when legacy credentials remain configured", async () => {
    vi.stubEnv("TOAST_LABOR_SYNC_SECRET", "s".repeat(32));
    vi.stubEnv("TOAST_CLIENT_ID", "legacy-client");
    vi.stubEnv("TOAST_CLIENT_SECRET", "legacy-secret");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await POST();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "This integration has been retired. No sync was performed." });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });
});
