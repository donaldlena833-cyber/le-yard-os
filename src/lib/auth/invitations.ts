import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppRole } from "@/types";

export const INVITATION_TTL_HOURS = 24;

export function canInviteRole(actorRole: AppRole, requestedRole: AppRole): boolean {
  if (actorRole !== "owner" && actorRole !== "admin") return false;
  return requestedRole !== "owner" || actorRole === "owner";
}

export function createInvitationTracking() {
  const material = randomBytes(32);
  return {
    tokenHash: createHash("sha256").update(material).digest("hex"),
    employeeId: randomUUID(),
    expiresAt: new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1_000).toISOString(),
  };
}

export function invitationCallbackUrl(appUrl: string, organizationId: string): string {
  const callback = new URL("/auth/callback", appUrl);
  callback.searchParams.set("next", `/invite?organization=${organizationId}`);
  return callback.toString();
}
