import { describe, expect, it } from "vitest";
import {
  requiresOwnerMfaGate,
  selectTotpFactorState,
  type MfaFactorLike,
} from "@/lib/auth/mfa";

function factor(
  id: string,
  overrides: Partial<MfaFactorLike> = {},
): MfaFactorLike {
  return {
    id,
    factor_type: "totp",
    status: "verified",
    friendly_name: "Le Yard authenticator",
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("TOTP factor selection", () => {
  it("requires enrollment when no verified TOTP factor exists", () => {
    expect(selectTotpFactorState([])).toEqual({ kind: "enroll" });
    expect(
      selectTotpFactorState([
        factor("unverified", { status: "unverified" }),
        factor("phone", { factor_type: "phone" }),
      ]),
    ).toEqual({ kind: "enroll" });
  });

  it("selects the most recently updated verified TOTP factor", () => {
    const selected = selectTotpFactorState([
      factor("older", { updated_at: "2026-07-01T12:00:00.000Z" }),
      factor("newer", {
        friendly_name: "Owner iPhone",
        updated_at: "2026-08-01T12:00:00.000Z",
      }),
    ]);

    expect(selected).toEqual({
      kind: "challenge",
      factor: {
        id: "newer",
        friendlyName: "Owner iPhone",
        updatedAt: "2026-08-01T12:00:00.000Z",
      },
    });
  });

  it("returns only challenge-safe factor metadata", () => {
    const input = {
      ...factor("factor-safe"),
      secret: "must-not-cross-the-helper-boundary",
    };
    const selected = selectTotpFactorState([input]);

    expect(selected).toMatchObject({ kind: "challenge" });
    expect(JSON.stringify(selected)).not.toContain("must-not-cross");
  });
});

describe("Owner workspace MFA gate", () => {
  it("blocks only live Owners below AAL2", () => {
    expect(
      requiresOwnerMfaGate({
        mode: "live",
        role: "owner",
        identity: { aal: "aal1" },
      }),
    ).toBe(true);
    expect(
      requiresOwnerMfaGate({
        mode: "live",
        role: "owner",
        identity: { aal: "aal2" },
      }),
    ).toBe(false);
    expect(
      requiresOwnerMfaGate({
        mode: "live",
        role: "admin",
        identity: { aal: "aal1" },
      }),
    ).toBe(false);
    expect(
      requiresOwnerMfaGate({
        mode: "demo",
        role: "owner",
        identity: { aal: "aal1" },
      }),
    ).toBe(false);
  });
});
