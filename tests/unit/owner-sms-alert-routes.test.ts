import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ enabled: true, setup: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/owner-sms-alerts.server", () => ({
  ownerSmsAlertsEnabled: () => m.enabled,
  enqueueOwnerSmsSetup: m.setup,
  processOwnerSmsAlertQueue: m.process,
}));
import { GET, POST } from "@/app/api/internal/communications/owner-alerts/route";
const secret = "s".repeat(40);
const requestId = "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5";
function request(body?: unknown, authorization = `Bearer ${secret}`) {
  return new Request("https://phone.leyardny.com/api/internal/communications/owner-alerts", {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.enabled = true;
  m.setup.mockResolvedValue([]);
  m.process.mockResolvedValue({ accepted: 2 });
  vi.stubEnv("OWNER_SMS_ALERTS_SECRET", secret);
});
afterEach(() => vi.unstubAllEnvs());
it.each(["", "Bearer wrong", "Bearer " + "a".repeat(1100)])("rejects invalid worker authorization", async (authorization) => {
  expect((await GET(request(undefined, authorization))).status).toBe(403);
  expect(m.process).not.toHaveBeenCalled();
});
it("fails closed if a secret is absent or too short", async () => {
  vi.stubEnv("OWNER_SMS_ALERTS_SECRET", "short");
  expect((await GET(request(undefined, "Bearer short"))).status).toBe(403);
});
it("does not process when forwarding is disabled", async () => {
  m.enabled = false;
  expect((await GET(request())).status).toBe(409);
  expect(m.process).not.toHaveBeenCalled();
});
it("drains an authorized queue without caching", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(m.process).toHaveBeenCalledOnce();
});
it("accepts only the bounded setup operation with caller supplied idempotency key", async () => {
  expect((await POST(request({ action: "setup", requestId }))).status).toBe(200);
  expect(m.setup).toHaveBeenCalledExactlyOnceWith(requestId);
  expect(m.process).toHaveBeenCalledOnce();
});
it.each([
  { action: "setup", requestId: "bad" },
  { action: "send", requestId },
  { action: "setup", requestId, to: "+12125550100" },
  { action: "setup", requestId, body: "Custom text" },
])("rejects custom destinations/content or invalid setup", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(m.setup).not.toHaveBeenCalled();
});
it("reports durable queue errors without leaking provider details", async () => {
  m.process.mockRejectedValue(Error("private provider details"));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});
