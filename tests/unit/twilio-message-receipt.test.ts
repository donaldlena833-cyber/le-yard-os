vi.mock("@/lib/owner-sms-alerts.server", () => ({
  ownerSmsAlertsEnabled: vi.fn().mockReturnValue(false),
  isOwnerSmsAlertRecipient: vi.fn().mockReturnValue(false),
  enqueueOwnerSmsAlerts: vi.fn().mockResolvedValue([]),
  enqueueOwnerSmsReplyGuidance: vi.fn().mockResolvedValue([]),
  processOwnerSmsAlertQueue: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/sms-ai-pilot.server", () => ({
  enqueueSmsPilot: vi.fn().mockResolvedValue(undefined),
  processSmsPilotQueue: vi.fn(),
}));
vi.mock("@/lib/communication-groups.server", () => ({
  saveCommunicationMessage: vi.fn().mockResolvedValue({ internal: false }),
  communicationThreadMode: vi.fn().mockResolvedValue("automation"),
}));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { POST } from "@/app/api/twilio/sms/incoming/route";
import {
  logCommunicationEvent,
  revokeServiceSmsConsent,
} from "@/lib/communications.server";
vi.mock("@/lib/communications.server", () => ({
  findGuestByPhone: vi.fn().mockResolvedValue(null),
  logCommunicationEvent: vi.fn().mockResolvedValue(true),
  revokeServiceSmsConsent: vi.fn().mockResolvedValue(true),
  recordServiceSmsConsent: vi.fn().mockResolvedValue(true),
  detectPrivateEventLead: vi.fn().mockReturnValue({ isLead: false }),
  detectReservationIntent: vi.fn().mockReturnValue(false),
  notifyOwnersOfCommunication: vi.fn().mockResolvedValue(undefined),
}));
const account = `AC${"a".repeat(32)}`;
const origin = "https://operations.leyardny.com";
function request(prefix: string, extra: Record<string, string> = {}) {
  const values: Record<string, string> = {
    AccountSid: account,
    To: "+13328779035",
    From: "+12125550103",
    MessageSid: prefix + "b".repeat(32),
    Body: "test",
    ...extra,
  };
  const url = origin + "/api/twilio/sms/incoming";
  const signature = createHmac("sha1", "test-token")
    .update(
      url +
        Object.keys(values)
          .sort()
          .map((key) => key + values[key])
          .join(""),
    )
    .digest("base64");
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: new URLSearchParams(values),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(false);
  vi.mocked(isOwnerSmsAlertRecipient).mockReturnValue(false);
  vi.mocked(logCommunicationEvent).mockResolvedValue(true);
  vi.stubEnv("TWILIO_ACCOUNT_SID", account);
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+13328779035");
  vi.stubEnv("TWILIO_FROM_NUMBER", "");
  vi.stubEnv("TWILIO_PUBLIC_BASE_URL", origin);
  vi.stubEnv("TWILIO_SMS_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());
it.each(["SM", "MM"])(
  "accepts %s message identifiers without auto-sending while disabled",
  async (prefix) => {
    const response = await POST(
      request(prefix, {
        NumMedia: "1",
        MediaUrl0: "https://api.twilio.com/test-media",
        MediaContentType0: "image/jpeg",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("<Message>");
    expect(logCommunicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "sms.inbound",
        metadata: expect.objectContaining({ mediaCount: 1 }),
      }),
      { required: true },
    );
  },
);
it("honors STOP even while automation is disabled", async () => {
  const response = await POST(
    request("SM", { Body: "STOP", OptOutType: "STOP" }),
  );
  expect(response.status).toBe(200);
  expect(revokeServiceSmsConsent).toHaveBeenCalledOnce();
  expect(await response.text()).not.toContain("<Message>");
});
it("does not acknowledge receipt when durable storage fails", async () => {
  vi.mocked(logCommunicationEvent).mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  expect((await POST(request("SM"))).status).toBe(503);
});

it("preserves inbound whitespace exactly for later review", async () => {
  const { saveCommunicationMessage } = await import(
    "@/lib/communication-groups.server"
  );
  await POST(request("SM", { Body: "  Text\nwith spacing.  " }));
  expect(saveCommunicationMessage).toHaveBeenCalledWith(
    expect.objectContaining({ body: "  Text\nwith spacing.  " }),
  );
});
it("archives before acknowledging a receipt and asks Twilio to retry if the archive fails", async () => {
  const { saveCommunicationMessage } = await import(
    "@/lib/communication-groups.server"
  );
  vi.mocked(saveCommunicationMessage).mockRejectedValueOnce(
    Error("archive offline"),
  );
  expect((await POST(request("SM"))).status).toBe(503);
});
it("keeps an escalated client out of automated reservation replies", async () => {
  const { communicationThreadMode } = await import(
    "@/lib/communication-groups.server"
  );
  vi.mocked(communicationThreadMode).mockResolvedValueOnce("human");
  vi.stubEnv("TWILIO_SMS_ENABLED", "true");
  const { detectReservationIntent, notifyOwnersOfCommunication } = await import(
    "@/lib/communications.server"
  );
  vi.mocked(detectReservationIntent).mockReturnValue(true);
  const r = await POST(
    request("SM", { Body: "I need to change my reservation" }),
  );
  expect(await r.text()).not.toContain("<Message");
  expect(notifyOwnersOfCommunication).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: "sms_human_reply" }),
  );
});
it("routes employee texts and MMS to team requests even when guest automation is disabled", async () => {
  const { saveCommunicationMessage } = await import(
    "@/lib/communication-groups.server"
  );
  vi.mocked(saveCommunicationMessage).mockResolvedValueOnce({ internal: true });
  const { notifyOwnersOfCommunication } = await import(
    "@/lib/communications.server"
  );
  const r = await POST(
    request("MM", { Body: "Can I change my shift?", NumMedia: "1" }),
  );
  expect(await r.text()).not.toContain("<Message");
  expect(notifyOwnersOfCommunication).toHaveBeenCalledWith(
    expect.objectContaining({ actionUrl: "/messages?message=MM" + "b".repeat(32) }),
  );
});

it("keeps employee texts in Team when guest AI chat is enabled", async () => {
  const { saveCommunicationMessage } = await import(
    "@/lib/communication-groups.server"
  );
  const { enqueueSmsPilot } = await import("@/lib/sms-ai-pilot.server");
  vi.mocked(saveCommunicationMessage).mockResolvedValueOnce({ internal: true });
  vi.stubEnv("SMS_AI_PILOT_ENABLED", "true");
  vi.stubEnv("GEMINI_API_KEY", "fixture");
  vi.stubEnv("TWILIO_SMS_ENABLED", "true");
  const response = await POST(request("SM", { Body: "Can I change my shift?" }));
  expect(response.status).toBe(200);
  expect(enqueueSmsPilot).not.toHaveBeenCalled();
});

it("durably queues every external guest before acknowledging and schedules post-response work", async () => {
  const { after } = await import("next/server");
  const { enqueueSmsPilot, processSmsPilotQueue } = await import(
    "@/lib/sms-ai-pilot.server"
  );
  vi.stubEnv("SMS_AI_PILOT_ENABLED", "true");
  vi.stubEnv("GEMINI_API_KEY", "fixture");
  vi.stubEnv("TWILIO_SMS_ENABLED", "true");
  const r = await POST(request("SM"));
  expect(r.status).toBe(200);
  expect(await r.text()).not.toContain("<Message");
  expect(enqueueSmsPilot).toHaveBeenCalledOnce();
  expect(after).toHaveBeenCalledWith(processSmsPilotQueue);
  vi.clearAllMocks();
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(false);
  vi.mocked(isOwnerSmsAlertRecipient).mockReturnValue(false);
  await POST(request("SM", { Body: "STOP" }));
  expect(enqueueSmsPilot).not.toHaveBeenCalled();
  await POST(request("SM", { From: "+12125550104" }));
  expect(enqueueSmsPilot).toHaveBeenCalledOnce();
  vi.mocked(enqueueSmsPilot).mockRejectedValueOnce(Error("queue offline"));
  expect((await POST(request("SM"))).status).toBe(503);
});

import { ownerSmsAlertsEnabled, isOwnerSmsAlertRecipient, enqueueOwnerSmsAlerts, enqueueOwnerSmsReplyGuidance } from "@/lib/owner-sms-alerts.server";
it("durably forwards complete incoming text independently of guest automation", async () => {
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(true);
  const body = "  reservation\n" + "x".repeat(1500) + "  ";
  expect((await POST(request("SM", { Body: body, NumMedia: "2" }))).status).toBe(200);
  expect(enqueueOwnerSmsAlerts).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sourceSid:"SM"+"b".repeat(32),from:"+12125550103",body,mediaCount:2}));
});
it("also forwards opt-out receipts while preserving provider opt-out handling", async () => {
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(true);
  const response = await POST(request("SM", {Body:"STOP", OptOutType:"STOP"}));
  expect(enqueueOwnerSmsAlerts).toHaveBeenCalledOnce();
  expect(revokeServiceSmsConsent).toHaveBeenCalledOnce();
  expect(await response.text()).not.toContain("<Message>");
});
it("requests a provider retry when durable alert enqueue fails", async () => {
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(true);
  vi.mocked(enqueueOwnerSmsAlerts).mockRejectedValueOnce(Error("offline"));
  expect((await POST(request("SM"))).status).toBe(503);
});
it("native founder replies get inbox guidance and never forward to the other founder or AI", async () => {
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(true);
  vi.mocked(isOwnerSmsAlertRecipient).mockReturnValue(true);
  const { enqueueSmsPilot } = await import("@/lib/sms-ai-pilot.server");
  expect((await POST(request("SM", {Body:"Yes book it"}))).status).toBe(200);
  expect(enqueueOwnerSmsReplyGuidance).toHaveBeenCalledOnce();
  expect(enqueueOwnerSmsAlerts).not.toHaveBeenCalled();
  expect(enqueueSmsPilot).not.toHaveBeenCalled();
});
it("does not send founder guidance in response to STOP", async () => {
  vi.mocked(ownerSmsAlertsEnabled).mockReturnValue(true);
  vi.mocked(isOwnerSmsAlertRecipient).mockReturnValue(true);
  expect((await POST(request("SM", {Body:"STOP", OptOutType:"STOP"}))).status).toBe(200);
  expect(enqueueOwnerSmsReplyGuidance).not.toHaveBeenCalled();
  expect(enqueueOwnerSmsAlerts).not.toHaveBeenCalled();
});
