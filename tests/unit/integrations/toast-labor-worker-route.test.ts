import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/integrations/toast-labor/route";

describe("Toast Labor worker route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects requests before touching provider or database configuration", async () => {
    vi.stubEnv("TOAST_LABOR_SYNC_SECRET", "s".repeat(32));
    const response = await POST(
      new Request("https://os.example/api/internal/integrations/toast-labor", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
