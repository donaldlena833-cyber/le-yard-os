import { describe, expect, it } from "vitest";
import {
  INVITATION_TTL_HOURS,
  canInviteRole,
  createInvitationTracking,
  invitationCallbackUrl,
} from "../../../src/lib/auth/invitations";

describe("secure invitation helpers", () => {
  it("allows only an owner to assign the owner role", () => {
    expect(canInviteRole("owner", "owner")).toBe(true);
    expect(canInviteRole("admin", "owner")).toBe(false);
    expect(canInviteRole("manager", "employee")).toBe(false);
    expect(canInviteRole("admin", "manager")).toBe(true);
  });

  it("creates an opaque hash, employee id, and short expiry", () => {
    const before = Date.now();
    const tracking = createInvitationTracking();
    expect(tracking.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tracking.employeeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(tracking.expiresAt).getTime()).toBeGreaterThanOrEqual(
      before + INVITATION_TTL_HOURS * 60 * 60 * 1_000 - 1_000,
    );
  });

  it("keeps tenant scope inside the callback's next path", () => {
    expect(invitationCallbackUrl("https://ops.example.com", "11111111-1111-4111-8111-111111111111"))
      .toBe("https://ops.example.com/auth/callback?next=%2Finvite%3Forganization%3D11111111-1111-4111-8111-111111111111");
  });
});
