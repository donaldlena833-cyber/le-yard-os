import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { sendTwilioMessage, twilioForwardNumbers, validateTwilioRequest } from "@/lib/twilio.server";
import { POST as readiness } from "@/app/api/twilio/readiness/route";
import { POST as book } from "@/app/api/internal/communications/agent/reservations/route";
import { communicationsCreateReservation } from "@/lib/communications-reservations.server";

vi.mock("@/lib/communications-reservations.server", () => ({ communicationsCreateReservation: vi.fn() }));
vi.mock("@/lib/communications.server", () => ({
  resolveLeYardTenant: vi.fn().mockResolvedValue({ organizationId: "test-org", locationId: "test-location" }),
  logCommunicationEvent: vi.fn().mockResolvedValue(true), hasServiceSmsConsent: vi.fn().mockResolvedValue(false),
}));
const account = `AC${"a".repeat(32)}`;
const base = "https://operations.leyardny.com";
function signed(path: string, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = { AccountSid: account, To: "+13328779035", ProbeChannel: "voice", Timestamp: String(Math.floor(Date.now() / 1000)), ...overrides };
  const url = `${base}${path}`;
  const signature = createHmac("sha1", "test-auth-token").update(url + Object.keys(values).sort().map(key => key + values[key]).join("")).digest("base64");
  return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(values) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TWILIO_ACCOUNT_SID", account); vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+13328779035"); vi.stubEnv("TWILIO_FROM_NUMBER", "");
  vi.stubEnv("TWILIO_FORWARD_DONALD", "+12125550101"); vi.stubEnv("TWILIO_FORWARD_MARIS", "+12125550102");
  vi.stubEnv("TWILIO_PUBLIC_BASE_URL", base); vi.stubEnv("TWILIO_SMS_ENABLED", "false");
  vi.stubEnv("TWILIO_AI_BOOKING_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());
describe("Twilio callback boundaries", () => {
  it("allows exact signed callbacks to reach their handler", () => {
    expect(isPublicRequestPath("/api/twilio/voice/incoming")).toBe(true);
    expect(isPublicRequestPath("/api/twilio/readiness")).toBe(true);
  });
  it("does not expose outbound calls or a broad prefix", () => {
    for (const path of ["/api/twilio/voice/outbound", "/api/twilio/voice/incoming/extra", "/api/twilio/admin"])
      expect(isPublicRequestPath(path)).toBe(false);
  });
  it("accepts the official signature for the configured account", async () => {
    const request = signed("/api/twilio/readiness");
    expect(validateTwilioRequest(request, new URLSearchParams(await request.clone().text()))).toBe(true);
  });
  it("rejects correctly signed requests for another account", async () => {
    const request = signed("/api/twilio/readiness", { AccountSid: `AC${"b".repeat(32)}` });
    expect(validateTwilioRequest(request, new URLSearchParams(await request.clone().text()))).toBe(false);
  });
  it("rejects missing signatures", () => {
    expect(validateTwilioRequest(new Request(base), new URLSearchParams())).toBe(false);
  });
  it("rejects missing secret rather than throwing", async () => {
    const request = signed("/api/twilio/readiness"); vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect(validateTwilioRequest(request, new URLSearchParams(await request.clone().text()))).toBe(false);
  });
});
describe("Activation gates", () => {
  it("requires two distinct personal destinations", () => {
    vi.stubEnv("TWILIO_FORWARD_MARIS", "+12125550101"); expect(() => twilioForwardNumbers()).toThrow(/distinct/);
  });
  it("prevents a loop back to the restaurant number", () => {
    vi.stubEnv("TWILIO_FORWARD_MARIS", "+13328779035"); expect(() => twilioForwardNumbers()).toThrow(/distinct/);
  });
  it("makes no outgoing SMS request while disabled", async () => {
    await expect(sendTwilioMessage("+12125550103", "test")).rejects.toThrow(/disabled/);
  });
  it("unsigned readiness cannot leak configuration", async () => {
    expect((await readiness(new Request(`${base}/api/twilio/readiness`, { method: "POST" }))).status).toBe(403);
  });
  it("signed readiness exposes neither token nor forwarding numbers", async () => {
    const response = await readiness(signed("/api/twilio/readiness")); expect(response.status).toBe(200);
    const body = await response.text(); expect(body).not.toContain("test-auth-token"); expect(body).not.toContain("5550101");
    expect(JSON.parse(body).liveCarrierTestsPassed).toBe(false);
  });
  it("expired readiness probes are rejected", async () => {
    expect((await readiness(signed("/api/twilio/readiness", { Timestamp: "1" }))).status).toBe(400);
  });
  it("missing Maris configuration blocks activation", async () => {
    vi.stubEnv("TWILIO_FORWARD_MARIS", ""); expect((await readiness(signed("/api/twilio/readiness"))).status).toBe(503);
  });
  it("AI cannot create reservations merely because a tool secret exists", async () => {
    vi.stubEnv("LE_YARD_AGENT_TOOL_SECRET", "t".repeat(32));
    const response = await book(new Request(`${base}/api/internal/communications/agent/reservations`, { method: "POST", headers: { authorization: `Bearer ${"t".repeat(32)}` }, body: "{}" }));
    expect(response.status).toBe(503); expect(communicationsCreateReservation).not.toHaveBeenCalled();
  });
});
function bookingRequest(extra: Record<string, unknown> = {}) {
  vi.stubEnv("LE_YARD_AGENT_TOOL_SECRET", "t".repeat(32)); vi.stubEnv("TWILIO_AI_BOOKING_ENABLED", "true");
  return new Request(`${base}/api/internal/communications/agent/reservations`, {
    method: "POST", headers: { authorization: `Bearer ${"t".repeat(32)}`, "content-type": "application/json", "idempotency-key": "12345678-1234-4234-8234-123456789abc" },
    body: JSON.stringify({ guestConfirmed: true, slotToken: "s".repeat(45), partySize: 2, firstName: "Test", lastName: "Guest", email: "guest@example.com", phone: "+12125550103", ...extra }),
  });
}
describe("No false reservation confirmations", () => {
  it("does not label an unconfirmed inventory result confirmed", async () => {
    vi.mocked(communicationsCreateReservation).mockResolvedValue({ reservationId: "12345678-1234-4234-8234-123456789abc", status: "booked" });
    const response = await book(bookingRequest()); expect(response.status).toBe(202);
    const body = await response.json(); expect(body.confirmed).toBe(false); expect(body.status).toBe("booked");
  });
  it("confirms only when inventory explicitly confirms", async () => {
    vi.mocked(communicationsCreateReservation).mockResolvedValue({ reservationId: "12345678-1234-4234-8234-123456789abc", status: "confirmed" });
    const response = await book(bookingRequest()); expect(response.status).toBe(201); expect((await response.json()).confirmed).toBe(true);
  });
  it("requires the guest to confirm details", async () => {
    const response = await book(bookingRequest({ guestConfirmed: false })); expect(response.status).toBe(400);
    expect(communicationsCreateReservation).not.toHaveBeenCalled();
  });
});
