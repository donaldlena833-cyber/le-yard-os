import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({
  getServerRuntimeConfiguration: () => ({ ready: false }),
}));

import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("returns a generic 503 for invalid connected configuration", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.status).toBe("not_ready");
    expect(body.liveness).toBe("ok");
    expect(body.readiness).toBe("blocked");
    expect(JSON.stringify(body)).not.toMatch(/database|model|supabase|credential|key/i);
  });
});
