import { expect, it } from "vitest";
import {
  planSmsAiReply,
  smsAiCost,
  smsAiDecisionSchema,
  smsAiWeek,
  smsPilotContact,
} from "@/lib/sms-ai-policy";
const env = {
  SMS_AI_PILOT_ENABLED: "true",
  GEMINI_API_KEY: "fixture",
  TWILIO_PHONE_NUMBER: "+13328779035",
  TWILIO_FORWARD_DONALD: "+12125550123",
  TWILIO_FORWARD_MARIS: "+12125550125",
};
const decision = smsAiDecisionSchema.parse({
  intent: "reservation",
  date: null,
  time: null,
  partySize: null,
  summary: "Booking inquiry",
  photoDescription: null,
});
it("accepts every valid external SMS contact while guest chat is enabled", () => {
  expect(smsPilotContact(env.TWILIO_FORWARD_DONALD, env)).toBe(true);
  expect(smsPilotContact(env.TWILIO_FORWARD_MARIS, env)).toBe(true);
  expect(smsPilotContact("+12125550124", env)).toBe(true);
  expect(smsPilotContact(env.TWILIO_PHONE_NUMBER, env)).toBe(false);
  expect(smsPilotContact("not-a-phone", env)).toBe(false);
  for (const key of ["GEMINI_API_KEY", "SMS_AI_PILOT_ENABLED"])
    expect(smsPilotContact("+12125550124", { ...env, [key]: "" })).toBe(
      false,
    );
});
it("asks for missing booking fields and checks only valid future availability", () => {
  expect(planSmsAiReply(decision, "2026-09-08")).toMatchObject({
    type: "reply",
    text: expect.stringContaining("date and party size"),
  });
  expect(
    planSmsAiReply(
      { ...decision, date: "2026-09-10", partySize: 4 },
      "2026-09-08",
    ),
  ).toEqual({ type: "availability", date: "2026-09-10", partySize: 4 });
  for (const date of ["2026-02-30", "2026-01-01"])
    expect(
      planSmsAiReply({ ...decision, date, partySize: 4 }, "2026-09-08"),
    ).toMatchObject({
      type: "reply",
      text: expect.stringContaining("future reservation date"),
    });
});
it.each([
  "employee",
  "human",
  "complaint",
  "private_event",
  "reservation_change",
  "hours_menu",
  "photo",
] as const)("routes %s to a human without any record mutation", (intent) => {
  expect(planSmsAiReply({ ...decision, intent }, "2026-09-08").type).toBe(
    "handoff",
  );
});
it("does not loop indefinitely on unclear requests", () => {
  expect(
    planSmsAiReply({ ...decision, intent: "unknown" }, "2026-09-08", 1).type,
  ).toBe("handoff");
});
it("rejects unapproved model actions and computes billed reasoning cost", () => {
  expect(
    smsAiDecisionSchema.safeParse({ ...decision, action: "book" }).success,
  ).toBe(false);
  expect(smsAiCost(1000, 200)).toBe(550);
  expect(smsAiWeek(new Date("2026-09-13T23:59:59Z"))).toBe("2026-09-07");
  expect(smsAiWeek(new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
});
