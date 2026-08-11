import { WorkflowError } from "./errors";
import type {
  ActorMembership,
  ActorRole,
  AuthenticatedActor,
} from "./types";

const MANAGEMENT_ROLES: readonly ActorRole[] = ["owner", "admin", "manager"];

export function findMembership(
  actor: AuthenticatedActor,
  organizationId: string,
): ActorMembership | undefined {
  return actor.memberships.find(
    (membership) => membership.organizationId === organizationId,
  );
}

export function requireOrganizationAccess(
  actor: AuthenticatedActor,
  organizationId: string,
): ActorMembership {
  const membership = findMembership(actor, organizationId);
  if (!membership) {
    throw new WorkflowError("forbidden", "You do not have access to this organization.");
  }
  return membership;
}

export function requireManagementRead(
  actor: AuthenticatedActor,
  organizationId: string,
): ActorMembership {
  const membership = requireOrganizationAccess(actor, organizationId);
  if (!MANAGEMENT_ROLES.includes(membership.role)) {
    throw new WorkflowError("forbidden", "Management access is required.");
  }
  return membership;
}

/** Mirrors can_operate_org: active management roles; MFA is currently optional. */
export function requireOrganizationOperations(
  actor: AuthenticatedActor,
  organizationId: string,
): ActorMembership {
  const membership = requireManagementRead(actor, organizationId);
  return membership;
}

export function requireLocationAccess(
  actor: AuthenticatedActor,
  organizationId: string,
  locationId: string,
): ActorMembership {
  const membership = requireOrganizationAccess(actor, organizationId);
  if (
    !membership.organizationWide &&
    !membership.locationIds.includes(locationId)
  ) {
    throw new WorkflowError("forbidden", "You do not have access to this location.");
  }
  return membership;
}

/** Mirrors can_manage_location; MFA is currently optional for Owners. */
export function requireLocationManagement(
  actor: AuthenticatedActor,
  organizationId: string,
  locationId: string,
): ActorMembership {
  const membership = requireLocationAccess(actor, organizationId, locationId);
  if (membership.role === "employee") {
    throw new WorkflowError("forbidden", "Location management access is required.");
  }
  return membership;
}

export function canRequestOrganizationWideReport(
  membership: ActorMembership,
): boolean {
  return membership.role === "owner" || membership.role === "admin";
}
