import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppSurface } from "@/lib/app-surface";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadSurface(surface: "phone" | "host" | "operations") {
  vi.stubEnv("NEXT_PUBLIC_APP_SURFACE", surface);
  vi.resetModules();
  return import("@/lib/app-surface");
}

describe("application surface selection", () => {
  it("defaults to the complete operations system", () => {
    expect(resolveAppSurface(undefined)).toBe("operations");
    expect(resolveAppSurface("unexpected")).toBe("operations");
  });

  it("accepts the dedicated host deployment mode", () => {
    expect(resolveAppSurface("host")).toBe("host");
    expect(resolveAppSurface(" HOST ")).toBe("host");
  });

  it("accepts the dedicated phone deployment mode", () => {
    expect(resolveAppSurface("phone")).toBe("phone");
    expect(resolveAppSurface(" PHONE ")).toBe("phone");
  });

  it("keeps a Phone alert's conversation query available as a navigation destination", async () => {
    const surface = await loadSurface("phone");
    for (const path of [
      "/phone", "/phone?tab=recents", "/messages",
      "/messages?message=SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "/messages?group=clients&phone=%2B12125550123#latest",
    ]) {
      expect(surface.isDestinationAllowedForAppSurface(path), path).toBe(true);
    }
    for (const path of [
      "/today", "/reservations", "/messages/other", "/messages-admin",
      "/messages/../today", "//messages", "https://other.example/messages",
    ]) {
      expect(surface.isDestinationAllowedForAppSurface(path), path).toBe(false);
    }
  });

  it("allows the Phone messages screen and its exact API dependencies", async () => {
    const surface = await loadSurface("phone");
    for (const path of [
      "/phone", "/messages", "/le-yard-messages.vcf", "/api/phone",
      "/api/phone/media", "/api/phone/attachments", "/api/communications/groups",
      "/api/communications/pilot", "/api/twilio/sms/owner-alert-status",
      "/api/internal/communications/owner-alerts",
    ]) {
      expect(surface.isRequestPathAllowedForAppSurface(path), path).toBe(true);
    }
    for (const path of [
      "/today", "/reservations", "/messages/other", "/messages-admin",
      "/le-yard-messages.vcf.bak", "/api/communications", "/api/communications/admin",
      "/api/communications/groups/private", "/api/communications/pilot/private",
      "/api/phone/attachments/private", "/api/exports/reports/csv",
    ]) {
      expect(surface.isRequestPathAllowedForAppSurface(path), path).toBe(false);
    }
  });

  it("keeps Host workspace access limited to reservations and guests", async () => {
    const surface = await loadSurface("host");
    for (const path of ["/reservations", "/reservations/setup", "/guests/guest-id"]) {
      expect(surface.isDestinationAllowedForAppSurface(path), path).toBe(true);
      expect(surface.isRequestPathAllowedForAppSurface(path), path).toBe(true);
    }
    for (const path of ["/phone", "/messages", "/messages?group=clients", "/le-yard-messages.vcf"]) {
      expect(surface.isDestinationAllowedForAppSurface(path), path).toBe(false);
      expect(surface.isRequestPathAllowedForAppSurface(path), path).toBe(false);
    }
  });

  it("preserves access to the complete Operations workspace", async () => {
    const surface = await loadSurface("operations");
    for (const path of ["/today", "/messages", "/phone", "/reservations", "/income"]) {
      expect(surface.isDestinationAllowedForAppSurface(path), path).toBe(true);
      expect(surface.isRequestPathAllowedForAppSurface(path), path).toBe(true);
    }
  });
});
