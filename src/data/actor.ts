import "server-only";

import { z } from "zod";
import { WorkflowError, throwDatabaseError } from "./errors";
import type {
  ActorAal,
  ActorMembership,
  ActorRole,
  AuthenticatedActor,
  UserScopedSupabaseClient,
} from "./types";

const userIdSchema = z.string().uuid();
const actorRoleSchema = z.enum(["owner", "admin", "manager", "employee"]);

interface MembershipRow {
  organization_id: string;
  role: ActorRole;
}

interface LocationMembershipRow {
  organization_id: string;
  location_id: string;
}

/**
 * Builds authorization context only from a verified JWT and active membership
 * rows visible to that same user-scoped Supabase session.
 */
export async function requireAuthenticatedActor(
  supabase: UserScopedSupabaseClient,
): Promise<AuthenticatedActor> {
  const { data: claimData, error: claimsError } = await supabase.auth.getClaims();
  const parsedUserId = userIdSchema.safeParse(claimData?.claims?.sub);

  if (claimsError || !parsedUserId.success) {
    throw new WorkflowError("unauthenticated", "Sign in to continue.");
  }

  const userId = parsedUserId.data;
  const [{ data: rawMemberships, error: membershipError }, { data: rawLocations, error: locationError }] =
    await Promise.all([
      supabase
        .from("organization_memberships")
        .select("organization_id, role")
        .eq("user_id", userId)
        .eq("status", "active"),
      supabase
        .from("location_memberships")
        .select("organization_id, location_id")
        .eq("user_id", userId),
    ]);

  if (membershipError) {
    throwDatabaseError(membershipError, "Your organization access could not be verified.");
  }
  if (locationError) {
    throwDatabaseError(locationError, "Your location access could not be verified.");
  }

  const locationRows = (rawLocations ?? []) as LocationMembershipRow[];
  const memberships: ActorMembership[] = [];

  for (const row of (rawMemberships ?? []) as MembershipRow[]) {
    const parsedRole = actorRoleSchema.safeParse(row.role);
    if (!parsedRole.success) continue;

    memberships.push({
      organizationId: row.organization_id,
      role: parsedRole.data,
      locationIds: locationRows
        .filter((location) => location.organization_id === row.organization_id)
        .map((location) => location.location_id),
      organizationWide: parsedRole.data === "owner" || parsedRole.data === "admin",
    });
  }

  if (memberships.length === 0) {
    throw new WorkflowError(
      "forbidden",
      "Your account does not have an active organization membership.",
    );
  }

  const rawAal = claimData?.claims?.aal;
  const aal: ActorAal = rawAal === "aal2" ? "aal2" : "aal1";

  return { userId, aal, memberships };
}

