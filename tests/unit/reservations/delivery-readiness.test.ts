import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configuredReservationDeliveryAdapters } from "@/lib/reservations/delivery-readiness.server";

const environmentKeys = [
  "RESERVATION_PUBLIC_SITE_URL",
  "RESERVATION_LINK_SIGNING_SECRET",
  "RESERVATION_DELIVERY_SECRET",
  "RESEND_API_KEY",
  "RESERVATION_EMAIL_FROM",
  "RESERVATION_SMS_DELIVERY_ENABLED",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof environmentKeys)[number], string | undefined>;

beforeEach(() => {
  process.env.RESERVATION_PUBLIC_SITE_URL = "https://www.leyard.example";
  process.env.RESERVATION_LINK_SIGNING_SECRET = "s".repeat(48);
  process.env.RESERVATION_DELIVERY_SECRET = "d".repeat(48);
  process.env.RESEND_API_KEY = "resend-test";
  process.env.RESERVATION_EMAIL_FROM = "reservations@leyard.example";
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.TWILIO_AUTH_TOKEN = "twilio-test";
  process.env.TWILIO_FROM_NUMBER = "+12125550100";
  delete process.env.RESERVATION_SMS_DELIVERY_ENABLED;
});

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("reservation delivery readiness", () => {
  it.each([undefined, "false", "TRUE", " true "])(
    "keeps Twilio undiscoverable unless the kill switch is exact true (%s)",
    (value) => {
      if (value === undefined)
        delete process.env.RESERVATION_SMS_DELIVERY_ENABLED;
      else process.env.RESERVATION_SMS_DELIVERY_ENABLED = value;
      expect(configuredReservationDeliveryAdapters()).toEqual(["email"]);
    },
  );

  it("discovers SMS only when the exact switch and every credential are present", () => {
    process.env.RESERVATION_SMS_DELIVERY_ENABLED = "true";
    expect(configuredReservationDeliveryAdapters()).toEqual(["email", "sms"]);
    delete process.env.TWILIO_FROM_NUMBER;
    expect(configuredReservationDeliveryAdapters()).toEqual(["email"]);
  });

  it("fails closed when disabled Twilio credentials are the only adapter", () => {
    process.env.RESERVATION_SMS_DELIVERY_ENABLED = "false";
    delete process.env.RESEND_API_KEY;
    delete process.env.RESERVATION_EMAIL_FROM;
    expect(() => configuredReservationDeliveryAdapters()).toThrowError(
      expect.objectContaining({
        status: 503,
        code: "verification_unavailable",
      }),
    );
  });
});
