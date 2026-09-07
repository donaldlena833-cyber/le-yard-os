import { describe, expect, it } from "vitest";
import { requiresOwnerMfaGate } from "@/lib/auth/mfa";

describe("connected management MFA gate", () => {
  it("requires AAL2 for live Owner and Admin sessions", () => {
    expect(requiresOwnerMfaGate({ mode: "live", role: "owner", identity: { aal: "aal1" } })).toBe(true);
    expect(requiresOwnerMfaGate({ mode: "live", role: "admin", identity: { aal: "aal1" } })).toBe(true);
    expect(requiresOwnerMfaGate({ mode: "live", role: "owner", identity: { aal: "aal2" } })).toBe(false);
  });

  it("does not block synthetic playground or lower roles", () => {
    expect(requiresOwnerMfaGate({ mode: "demo", role: "owner", identity: { aal: "aal1" } })).toBe(false);
    expect(requiresOwnerMfaGate({ mode: "live", role: "manager", identity: { aal: "aal1" } })).toBe(false);
  });
});
