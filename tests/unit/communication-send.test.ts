import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  create: vi.fn(),
  consent: vi.fn(),
  mode: vi.fn(),
  save: vi.fn(),
}));
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: m.create } }),
}));
vi.mock("@/lib/communications.server", () => ({
  hasServiceSmsConsent: m.consent,
}));
vi.mock("@/lib/communication-groups.server", () => ({
  communicationThreadMode: m.mode,
  saveCommunicationMessage: m.save,
}));
import { sendTwilioMessage } from "@/lib/twilio.server";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TWILIO_SMS_ENABLED", "true");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC" + "a".repeat(32));
  vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG" + "b".repeat(32));
  vi.stubEnv("TWILIO_AUTH_TOKEN", "fixture");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+13328779035");
  vi.stubEnv("TWILIO_PUBLIC_BASE_URL", "https://operations.leyardny.com");
  m.consent.mockResolvedValue(true);
  m.mode.mockResolvedValue("automation");
  m.save.mockResolvedValue({ internal: false });
  m.create.mockResolvedValue({
    sid: "SM" + "c".repeat(32),
    from: "+13328779035",
    status: "queued",
    dateCreated: new Date("2026-09-08T12:00Z"),
  });
});
it("prevents an automated agent from replying after human handoff", async () => {
  m.mode.mockResolvedValue("human");
  await expect(
    sendTwilioMessage("+12125550123", "Automated reply"),
  ).rejects.toThrow("assigned to a human");
  expect(m.create).not.toHaveBeenCalled();
});
it("fails closed when handoff state is unavailable", async () => {
  m.mode.mockRejectedValue(Error("offline"));
  await expect(
    sendTwilioMessage("+12125550123", "Automated reply"),
  ).rejects.toThrow();
  expect(m.create).not.toHaveBeenCalled();
});
it("sends a human MMS through the existing sender and archives its authorship", async () => {
  m.mode.mockResolvedValue("human");
  await sendTwilioMessage("+12125550123", "Photo reply", {
    actorId: "owner",
    mediaUrls: ["https://storage.example.test/signed-image"],
  });
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "+13328779035",
      mediaUrl: ["https://storage.example.test/signed-image"],
      statusCallback: "https://operations.leyardny.com/api/twilio/sms/status",
    }),
  );
  expect(m.save).toHaveBeenCalledWith(
    expect.objectContaining({
      senderKind: "staff",
      actorId: "owner",
      body: "Photo reply",
      mediaCount: 1,
    }),
  );
});
it("a human reply and handoff notice still require recipient consent", async () => {
  m.consent.mockResolvedValue(false);
  for (const options of [{ actorId: "owner" }, { handoffNotice: true }])
    await expect(
      sendTwilioMessage("+12125550123", "Reply", options),
    ).rejects.toThrow("consent");
  expect(m.create).not.toHaveBeenCalled();
});
it("does not report an accepted message as unsent if archive persistence fails", async () => {
  m.save.mockRejectedValue(Error("archive offline"));
  const result = await sendTwilioMessage("+12125550123", "Reply", {
    actorId: "owner",
  });
  expect(result.status).toBe("queued");
  expect(m.create).toHaveBeenCalledOnce();
});
