import { expect, it } from "vitest";
import { communicationTestOwner } from "@/lib/communication-test-routing";
const now = Date.parse("2026-09-08T12:00:00Z");
const env = { TWILIO_FORWARD_DONALD: "+12125550123", COMMUNICATIONS_TEST_OWNER_ID: "11111111-1111-4111-8111-111111111111", COMMUNICATIONS_TEST_UNTIL: "2026-09-08T16:00:00Z" };
it("isolates only the configured testing contact", () => {
  expect(communicationTestOwner(env.TWILIO_FORWARD_DONALD, env, now)).toBe(env.COMMUNICATIONS_TEST_OWNER_ID);
  expect(communicationTestOwner("+12125550456", env, now)).toBeNull();
  expect(communicationTestOwner(undefined, env, now)).toBeNull();
});
it("restores normal recipients after the temporary window", () => {
  expect(communicationTestOwner(env.TWILIO_FORWARD_DONALD, env, Date.parse(env.COMMUNICATIONS_TEST_UNTIL))).toBeNull();
  expect(communicationTestOwner(env.TWILIO_FORWARD_DONALD, {}, now)).toBeNull();
});
it("never broadcasts a test when its configured recipient is invalid", () => {
  expect(() => communicationTestOwner(env.TWILIO_FORWARD_DONALD, { ...env, COMMUNICATIONS_TEST_OWNER_ID: "invalid" }, now)).toThrow();
});
