import { handoffNotice } from "@/lib/communication-groups";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  mode: vi.fn(),
  send: vi.fn(),
  notify: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  insert: vi.fn(),
  auth: true,
}));
vi.mock("@/lib/elevenlabs.server", () => ({
  validateAgentToolSecret: () => m.auth,
}));
vi.mock("@/lib/communications.server", () => ({
  resolveLeYardTenant: async () => ({
    organizationId: "org",
    locationId: "loc",
  }),
  notifyOwnersOfCommunication: m.notify,
}));
vi.mock("@/lib/communication-groups.server", () => ({
  setCommunicationThreadMode: m.mode,
}));
vi.mock("@/lib/twilio.server", () => ({
  twilioPhoneNumber: () => "+13328779035",
  sendTwilioMessage: m.send,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: m.insert }),
    storage: { from: () => ({ download: m.download, upload: m.upload }) },
  }),
}));
import { POST } from "@/app/api/internal/communications/agent/sms-handoff/route";
const input = {
  requestId: "12345678-1234-4234-8234-123456789abc",
  phone: "+12125550123",
  reason: "Needs human assistance",
  summary: "Please review the guest’s request.",
};
const request = (body = input) =>
  new Request(
    "https://operations.leyardny.com/api/internal/communications/agent/sms-handoff",
    { method: "POST", body: JSON.stringify(body) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth = true;
  m.mode.mockResolvedValue(undefined);
  m.notify.mockResolvedValue(undefined);
  m.download.mockResolvedValue({
    data: null,
    error: { message: "Object not found" },
  });
  m.upload.mockResolvedValue({ error: null });
  m.insert.mockResolvedValue({ error: null });
  m.send.mockResolvedValue({ sid: "SM" + "a".repeat(32), status: "queued" });
});
it("requires agent authentication before accessing tenant or sending", async () => {
  m.auth = false;
  expect((await POST(request())).status).toBe(403);
  expect(m.mode).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
it("pauses automation and saves the ticket and owner notification before notifying the client", async () => {
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(m.mode).toHaveBeenCalledWith(input.phone, "human", input.reason);
  expect(m.mode.mock.invocationCallOrder[0]).toBeLessThan(
    m.send.mock.invocationCallOrder[0],
  );
  expect(m.insert.mock.invocationCallOrder[0]).toBeLessThan(
    m.send.mock.invocationCallOrder[0],
  );
  expect(m.notify.mock.invocationCallOrder[0]).toBeLessThan(
    m.send.mock.invocationCallOrder[0],
  );
  expect(m.send).toHaveBeenCalledWith(input.phone, handoffNotice, {
    handoffNotice: true,
  });
  expect(await response.json()).toMatchObject({
    status: "queued",
    mode: "human",
  });
});
it("keeps the human handoff and reports an unconfirmed client notice on a provider timeout", async () => {
  m.send.mockRejectedValue(Error("timeout"));
  const r = await POST(request());
  expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({ mode: "human", status: "uncertain" });
  expect(m.mode).toHaveBeenCalledTimes(1);
  expect(m.upload.mock.calls.at(-1)![1]).toContain("uncertain");
});
it("never sends again after a competing claim", async () => {
  m.upload.mockResolvedValueOnce({ error: { message: "exists" } });
  expect((await POST(request())).status).toBe(409);
  expect(m.send).not.toHaveBeenCalled();
});
it("rejects conflicting retries before changing conversation ownership", async () => {
  m.download.mockResolvedValue({
    data: new Blob([
      JSON.stringify({ fingerprint: "another", status: "queued" }),
    ]),
    error: null,
  });
  expect((await POST(request())).status).toBe(409);
  expect(m.mode).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
it("does not tell the client a human was notified when owner notification failed", async () => {
  m.notify.mockRejectedValue(Error("offline"));
  expect((await POST(request())).status).toBe(503);
  expect(m.send).not.toHaveBeenCalled();
});
