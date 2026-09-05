import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), log: vi.fn(), user: true, member: true }));
vi.mock("@/lib/communications.server", () => ({
  resolveLeYardTenant: async () => ({ organizationId: "test-organization", locationId: "test-location" }),
  logCommunicationEvent: mocks.log,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user ? { id: "test-user" } : null } }) },
  from: () => ({ select: () => {
    const query = { eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: mocks.member ? { id: "membership" } : null }) };
    return query;
  } }),
}) }));
vi.mock("@/lib/twilio.server", () => ({
  createTwilioCall: mocks.call,
  normalizeE164: (value: string) => { if (!/^\+[1-9]\d{7,14}$/.test(value)) throw new Error("Invalid E.164"); return value; },
  twilioAbsoluteUrl: (path: string) => `https://operations.leyardny.com${path}`,
  twilioPhoneNumber: () => "+13328779035",
  twilioForwardNumbers: () => ({ donald: "+12025550101", maris: "+12025550102" }),
}));
import { POST } from "@/app/api/twilio/voice/outbound/route";
const origin = "https://operations.leyardny.com";
const request = (to = "+12025550199", staff = "donald", source = origin) => new Request(`${origin}/api/twilio/voice/outbound`, {
  method: "POST", headers: { origin: source, "content-type": "application/json" }, body: JSON.stringify({ to, staff }),
});
beforeEach(() => { vi.stubEnv("TWILIO_OUTBOUND_ENABLED", "true"); mocks.user = true; mocks.member = true; mocks.call.mockReset().mockResolvedValue({ sid: "CA" + "1".repeat(32), status: "queued" }); mocks.log.mockReset().mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());
it("does not activate paid calls merely because credentials are present", async () => { vi.stubEnv("TWILIO_OUTBOUND_ENABLED", "false"); expect((await POST(request())).status).toBe(503); expect(mocks.call).not.toHaveBeenCalled(); });
it("rejects cross-origin calls before using the carrier", async () => { expect((await POST(request(undefined, undefined, "https://example.org"))).status).toBe(403); expect(mocks.call).not.toHaveBeenCalled(); });
it("rejects missing origin rather than exposing a server-to-server dial API", async () => { const r = request(); r.headers.delete("origin"); expect((await POST(r)).status).toBe(403); expect(mocks.call).not.toHaveBeenCalled(); });
it("requires a signed-in user", async () => { mocks.user = false; expect((await POST(request())).status).toBe(401); expect(mocks.call).not.toHaveBeenCalled(); });
it("requires active membership in Le Yard", async () => { mocks.member = false; expect((await POST(request())).status).toBe(403); expect(mocks.call).not.toHaveBeenCalled(); });
it("returns a field error for invalid phone numbers", async () => { expect((await POST(request("not-a-number"))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled(); });
it("rejects destinations outside +1 before making even the staff callback", async () => { expect((await POST(request("+442079460000"))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled(); });
it("cannot make the restaurant call itself", async () => { expect((await POST(request("+13328779035"))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled(); });
it("cannot loop a callback into either staff cellphone", async () => { expect((await POST(request("+12025550101"))).status).toBe(400); expect((await POST(request("+12025550102"))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled(); });
it("starts a callback to the selected staff phone, not directly to the guest", async () => { const response = await POST(request("+12025550199", "maris")); expect(response.status).toBe(201); expect(mocks.call).toHaveBeenCalledOnce(); expect(mocks.call.mock.calls[0][0]).toMatchObject({ to: "+12025550102" }); expect(mocks.call.mock.calls[0][0].url).toContain("outbound-bridge"); expect((await response.json()).status).toBe("queued"); });
it("does not report an accepted call as failed if logging breaks", async () => { mocks.log.mockRejectedValue(Error("database unavailable")); const response = await POST(request()); expect(response.status).toBe(201); expect(mocks.call).toHaveBeenCalledOnce(); });
it("rejects unknown staff selectors", async () => { expect((await POST(request("+12025550199", "unknown"))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled(); });
