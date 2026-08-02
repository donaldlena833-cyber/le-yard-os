import "server-only";

import { assertFound, throwDatabaseError, WorkflowError } from "./errors";
import {
  requireLocationAccess,
  requireLocationManagement,
  requireOrganizationAccess,
} from "./policy";
import type {
  AuthenticatedActor,
  UserScopedSupabaseClient,
} from "./types";

export interface ScopedLocation {
  id: string;
  organizationId: string;
}

export async function requireAccessibleLocation(
  supabase: UserScopedSupabaseClient,
  actor: AuthenticatedActor,
  locationId: string,
): Promise<ScopedLocation> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, organization_id, is_active")
    .eq("id", locationId)
    .maybeSingle();

  if (error) throwDatabaseError(error, "The location could not be verified.");
  const location = assertFound(data, "The location was not found.");
  requireOrganizationAccess(actor, location.organization_id);
  requireLocationAccess(actor, location.organization_id, location.id);
  if (!location.is_active) throw new WorkflowError("conflict", "This location is inactive.");
  return { id: location.id, organizationId: location.organization_id };
}

export async function requireManagedLocation(
  supabase: UserScopedSupabaseClient,
  actor: AuthenticatedActor,
  locationId: string,
): Promise<ScopedLocation> {
  const location = await requireAccessibleLocation(supabase, actor, locationId);
  requireLocationManagement(actor, location.organizationId, location.id);
  return location;
}

export async function requireActorEmployee(
  supabase: UserScopedSupabaseClient,
  actor: AuthenticatedActor,
  organizationId: string,
): Promise<{ id: string; organizationId: string }> {
  requireOrganizationAccess(actor, organizationId);
  const { data, error } = await supabase
    .from("employees")
    .select("id, organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", actor.userId)
    .eq("employment_status", "active")
    .maybeSingle();

  if (error) throwDatabaseError(error, "Your employee profile could not be verified.");
  const employee = assertFound(
    data,
    "An active employee profile is required for this action.",
  );
  return { id: employee.id, organizationId: employee.organization_id };
}

