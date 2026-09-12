import { describe, expect, it } from "vitest";
import { isPublicRequestPath } from "@/lib/auth/public-paths";

describe("public route boundary", () => {
  it.each([
    "/sign-in",
    "/invite",
    "/auth/callback",
    "/api/health",
    "/api/health/email",
    "/api/internal/reservation-push",
    "/api/internal/reservation-messages",
    "/api/internal/integrations/toast-labor",
    "/api/internal/connected-acceptance/attest",
    "/api/twilio/sms/owner-alert-status",
    "/api/internal/communications/owner-alerts",
    "/api/v1/availability",
    "/api/v1/reservations/confirm",
    "/manifest.webmanifest",
    "/le-yard-messages.vcf",
    "/offline.html",
    "/sw.js",
  ])("allows the exact public route %s", (path) => {
    expect(isPublicRequestPath(path)).toBe(true);
  });

  it.each([
    "/today",
    "/api/exports/reports/csv",
    "/api/v10/availability",
    "/sign-in-impersonation",
    "/offline.html.bak",
    "/messages",
    "/api/phone",
    "/api/phone/media",
    "/api/phone/attachments",
    "/api/communications/groups",
    "/api/communications/pilot",
    "/api/twilio/sms/owner-alert-status/extra",
    "/api/twilio/sms/owner-alert-status-admin",
    "/api/internal/communications/owner-alerts/extra",
    "/api/internal/communications/owner-alerts-admin",
    "/le-yard-messages.vcf.bak",
  ])("keeps %s protected", (path) => {
    expect(isPublicRequestPath(path)).toBe(false);
  });
});
