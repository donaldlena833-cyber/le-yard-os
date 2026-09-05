import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { POST } from "@/app/api/twilio/sms/incoming/route";
import { logCommunicationEvent, revokeServiceSmsConsent } from "@/lib/communications.server";
vi.mock("@/lib/communications.server", () => ({
  findGuestByPhone: vi.fn().mockResolvedValue(null), logCommunicationEvent: vi.fn().mockResolvedValue(true),
  revokeServiceSmsConsent: vi.fn().mockResolvedValue(true), recordServiceSmsConsent: vi.fn().mockResolvedValue(true),
  detectPrivateEventLead: vi.fn().mockReturnValue({ isLead: false }), detectReservationIntent: vi.fn().mockReturnValue(false),
  notifyOwnersOfCommunication: vi.fn().mockResolvedValue(undefined),
}));
const account = `AC${"a".repeat(32)}`;
const origin = "https://operations.leyardny.com";
function request(prefix: string, extra: Record<string, string> = {}) {
  const values: Record<string, string> = { AccountSid: account, To: "+13328779035", From: "+12125550103", MessageSid: prefix + "b".repeat(32), Body: "test", ...extra };
  const url = origin + "/api/twilio/sms/incoming";
  const signature = createHmac("sha1", "test-token").update(url + Object.keys(values).sort().map(key => key + values[key]).join("")).digest("base64");
  return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(values) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(logCommunicationEvent).mockResolvedValue(true);
  vi.stubEnv("TWILIO_ACCOUNT_SID", account); vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+13328779035"); vi.stubEnv("TWILIO_FROM_NUMBER", "");
  vi.stubEnv("TWILIO_PUBLIC_BASE_URL", origin); vi.stubEnv("TWILIO_SMS_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());
it.each(["SM", "MM"])("accepts %s message identifiers without auto-sending while disabled", async prefix => {
  const response = await POST(request(prefix, { NumMedia: "1", MediaUrl0: "https://api.twilio.com/test-media", MediaContentType0: "image/jpeg" }));
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("<Message>");
  expect(logCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "sms.inbound", metadata: expect.objectContaining({ mediaCount: 1 }) }), { required: true });
});
it("honors STOP even while automation is disabled", async () => {
  const response = await POST(request("SM", { Body: "STOP", OptOutType: "STOP" }));
  expect(response.status).toBe(200); expect(revokeServiceSmsConsent).toHaveBeenCalledOnce();
  expect(await response.text()).not.toContain("<Message>");
});
it("does not acknowledge receipt when durable storage fails", async () => {
  vi.mocked(logCommunicationEvent).mockRejectedValueOnce(new Error("database unavailable"));
  expect((await POST(request("SM"))).status).toBe(503);
});
