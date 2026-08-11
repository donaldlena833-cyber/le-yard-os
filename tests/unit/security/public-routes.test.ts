import { describe, expect, it } from "vitest";
import { isPublicRequestPath } from "@/lib/auth/public-paths";

describe("public route boundary", () => {
  it.each([
    "/sign-in",
    "/invite",
    "/auth/callback",
    "/api/health",
    "/api/internal/reservation-push",
    "/api/internal/reservation-messages",
    "/api/internal/connected-acceptance/attest",
    "/api/v1/availability",
    "/api/v1/reservations/confirm",
    "/manifest.webmanifest",
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
  ])("keeps %s protected", (path) => {
    expect(isPublicRequestPath(path)).toBe(false);
  });
});
