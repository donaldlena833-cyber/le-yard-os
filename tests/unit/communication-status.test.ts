import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), valid: true }));
vi.mock("@/lib/twilio.server", () => ({
  readTwilioForm: async (r: Request) => ({
    params: new URLSearchParams(await r.text()),
  }),
  validateTwilioRequest: () => m.valid,
  twilioPhoneNumber: () => "+13328779035",
  twilioRestClient: () => ({ messages: () => ({ fetch: m.fetch }) }),
}));
vi.mock("@/lib/communications.server", () => ({
  logCommunicationEvent: vi.fn(),
}));
vi.mock("@/lib/communication-groups.server", () => ({
  saveCommunicationMessage: m.save,
}));
import { POST } from "@/app/api/twilio/sms/status/route";
const sid = "SM" + "a".repeat(32);
function request() {
  return new Request("https://operations.leyardny.com/api/twilio/sms/status", {
    method: "POST",
    body: new URLSearchParams({ MessageSid: sid, MessageStatus: "sent" }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.valid = true;
  m.save.mockResolvedValue({ internal: false });
  m.fetch.mockResolvedValue({
    sid,
    from: "+13328779035",
    to: "+12125550123",
    body: "Exact automated reply",
    status: "delivered",
    direction: "outbound-reply",
    dateSent: new Date(),
    numMedia: "1",
    errorCode: null,
  });
});
it("uses the authoritative delivered status when an older sent callback arrives", async () => {
  expect((await POST(request())).status).toBe(204);
  expect(m.save).toHaveBeenCalledWith(
    expect.objectContaining({
      sid,
      status: "delivered",
      body: "Exact automated reply",
      senderKind: "automation",
      mediaCount: 1,
    }),
  );
});
it("requests a retry when the durable transcript write fails", async () => {
  m.save.mockRejectedValue(Error("offline"));
  expect((await POST(request())).status).toBe(503);
});
it("rejects invalid signatures before reading the provider", async () => {
  m.valid = false;
  expect((await POST(request())).status).toBe(403);
  expect(m.fetch).not.toHaveBeenCalled();
});
it("rejects a message that belongs to another number", async () => {
  m.fetch.mockResolvedValue({ from: "+12125550199", to: "+12125550123" });
  expect((await POST(request())).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});
