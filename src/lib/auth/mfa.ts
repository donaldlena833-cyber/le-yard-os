import type { AssuranceLevel } from "@/lib/auth/workspace-context";
import type { AppRole } from "@/types";

export interface MfaFactorLike {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VerifiedTotpFactor {
  id: string;
  friendlyName: string;
  updatedAt: string | null;
}

export type TotpFactorState =
  | { kind: "enroll" }
  | { kind: "challenge"; factor: VerifiedTotpFactor };

/**
 * Chooses one verified TOTP factor deterministically. Phone, WebAuthn, and
 * unverified enrollment attempts never satisfy the Owner gate.
 */
export function selectTotpFactorState(
  factors: readonly MfaFactorLike[],
): TotpFactorState {
  const verifiedTotp = factors
    .filter(
      (factor) =>
        factor.factor_type === "totp" && factor.status === "verified",
    )
    .map(
      (factor): VerifiedTotpFactor => ({
        id: factor.id,
        friendlyName: factor.friendly_name?.trim() || "Authenticator app",
        updatedAt: factor.updated_at || factor.created_at || null,
      }),
    )
    .sort(
      (left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
        left.id.localeCompare(right.id),
    );

  return verifiedTotp[0]
    ? { kind: "challenge", factor: verifiedTotp[0] }
    : { kind: "enroll" };
}

export function requiresOwnerMfaGate({
  mode,
  role,
  identity,
}: {
  mode: "demo" | "live";
  role: AppRole;
  identity: { aal: AssuranceLevel };
}): boolean {
  return mode === "live" && role === "owner" && identity.aal !== "aal2";
}
