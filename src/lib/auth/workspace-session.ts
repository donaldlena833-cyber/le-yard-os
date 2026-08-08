import "server-only";

import { cookies } from "next/headers";
import { demoIds, demoWorkspace } from "@/lib/demo";
import {
  PLAYGROUND_SESSION_COOKIE,
  readPlaygroundSessionToken,
  type PlaygroundPrincipalId,
} from "@/lib/auth/playground-auth.server";
import {
  deriveWorkspaceScopes,
  normalizeAssuranceLevel,
  resolveWorkspaceDisplayName,
  selectWorkspaceScope,
  toWorkspaceChoices,
  type WorkspaceContextValue,
  type WorkspaceLocationMembershipRow,
  type WorkspaceLocationRow,
  type WorkspaceMembershipRow,
  type WorkspaceOrganizationRow,
  type WorkspaceProfileRow,
} from "@/lib/auth/workspace-context";
import { readWorkspacePreference } from "@/lib/auth/workspace-preference.server";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import {
  DEMO_CAPABILITY_TEMPLATES,
  OPERATIONAL_CAPABILITIES,
  normalizeOperationalCapabilities,
  type OperationalCapability,
} from "@/lib/permissions/capabilities";

export type WorkspaceSessionResolution =
  | { status: "ready"; context: WorkspaceContextValue }
  | { status: "unauthenticated" }
  | {
      status: "no_access" | "no_location" | "configuration_error" | "data_error";
      identity?: { displayName: string; email: string | null };
    };

async function createDemoWorkspaceContext(
  principal: PlaygroundPrincipalId = "donald",
  playground = false,
): Promise<WorkspaceContextValue> {
  const organization = demoWorkspace.organizations.find(
    (candidate) => candidate.id === demoIds.organization,
  )!;
  const locations = demoWorkspace.locations
    .filter((location) => location.organizationId === organization.id && location.active)
    .map((location, index) => ({
      id: location.id,
      organizationId: location.organizationId,
      name: playground
        ? index === 0
          ? "Le Yard"
          : "Private Events · Mock"
        : location.name,
      isPrimary: index === 0,
    }));
  const isEmployee = principal === "irini";
  const isChef = principal === "mateo";
  const identityId =
    principal === "maris"
      ? demoIds.people.maris
      : isEmployee
        ? demoIds.people.irini
        : isChef
          ? demoIds.people.mateo
          : demoIds.people.donald;
  const identity = demoWorkspace.people.find(
    (person) => person.id === identityId,
  )!;
  const membership = demoWorkspace.memberships.find(
    (candidate) => candidate.userId === identity.id,
  )!;

  const preference = await readWorkspacePreference(identity.id);
  // Mateo is a manager/chef in the playground. Keeping that role explicit is
  // important: manager permissions should be exercised by the same account
  // that owns the BOH workflow, without granting owner-only controls.
  const role = isEmployee
    ? ("employee" as const)
    : isChef
      ? ("manager" as const)
      : ("owner" as const);
  // The playground represents one real room. Keep the legacy second mock location
  // out of every role's visible scope until multi-room operations are enabled.
  const accessibleLocations = playground ? locations.slice(0, 1) : role === "employee" ? locations.slice(0, 1) : locations;
  const activeLocation =
    preference?.organizationId === organization.id
      ? accessibleLocations.find((location) => location.id === preference.locationId) ?? accessibleLocations[0]!
      : accessibleLocations[0]!;
  const workspaceChoice = {
    membershipId: membership.id,
    organization: {
      id: organization.id,
      name: playground
        ? "Le Yard"
        : organization.name.replace(" Demo Group", " Hospitality"),
    },
    locations: accessibleLocations,
    role,
    organizationWide: role === "owner",
    ...(isChef ? { persona: "chef" as const } : {}),
  };
  const capabilities: readonly OperationalCapability[] = role === "owner"
    ? OPERATIONAL_CAPABILITIES
    : isChef
      ? DEMO_CAPABILITY_TEMPLATES.executiveChef
      : DEMO_CAPABILITY_TEMPLATES.employee;

  return {
    mode: "demo",
    identity: {
      userId: identity.id,
      displayName: identity.displayName,
      email: playground ? null : identity.email,
      aal: playground ? "aal1" : "aal2",
    },
    organization: workspaceChoice.organization,
    activeLocation,
    locations: accessibleLocations,
    availableWorkspaces: [workspaceChoice],
    membershipId: membership.id,
    role,
    organizationWide: role === "owner",
    capabilities,
    ...(isChef ? { persona: "chef" as const } : {}),
  };
}

function metadataDisplayName(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>).display_name;
}

async function resolveWorkspacePersona(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string,
  locationIds: readonly string[],
): Promise<"chef" | undefined> {
  const employeeResult = await supabase
    .from("employees")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("employment_status", "active")
    .maybeSingle();
  const employeeId = employeeResult.data?.id;
  if (employeeResult.error || !employeeId || !locationIds.length) return undefined;

  const assignmentResult = await supabase
    .from("employee_job_roles")
    .select("job_role_id")
    .eq("organization_id", organizationId)
    .eq("employee_id", employeeId)
    .in("location_id", [...locationIds]);
  const roleIds = [...new Set((assignmentResult.data ?? []).map((assignment) => assignment.job_role_id))];
  if (assignmentResult.error || !roleIds.length) return undefined;

  const roleResult = await supabase
    .from("job_roles")
    .select("name, code, department")
    .eq("organization_id", organizationId)
    .in("id", roleIds);
  if (roleResult.error) return undefined;
  const isKitchenRole = (roleResult.data ?? []).some((role) =>
    [role.name, role.code, role.department ?? ""].some((value) =>
      /chef|kitchen|culinary|boh|back.of.house/i.test(value),
    ),
  );
  return isKitchenRole ? "chef" : undefined;
}

export async function resolveWorkspaceSession(): Promise<WorkspaceSessionResolution> {
  const runtime = getServerRuntimeConfiguration();

  if (runtime.mode === "demo") {
    if (!runtime.ready) return { status: "configuration_error" };
    if (runtime.playground) {
      const cookieStore = await cookies();
      const principal = readPlaygroundSessionToken(
        cookieStore.get(PLAYGROUND_SESSION_COOKIE)?.value,
      );
      if (!principal) return { status: "unauthenticated" };
      return {
        status: "ready",
        context: await createDemoWorkspaceContext(principal, true),
      };
    }

    return { status: "ready", context: await createDemoWorkspaceContext() };
  }

  if (runtime.mode !== "connected" || !runtime.ready) {
    console.error("[workspace-session] connected runtime is not ready", {
      mode: runtime.mode,
      ready: runtime.ready,
      issues: runtime.issues,
    });
    return { status: "configuration_error" };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (claimsError || !claims || !userId) return { status: "unauthenticated" };

  const email = typeof claims.email === "string" ? claims.email : null;
  const preferencePromise = readWorkspacePreference(userId);
  const [membershipResult, profileResult] = await Promise.all([
    supabase
      .from("organization_memberships")
      .select("id, organization_id, user_id, role, status")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("profiles")
      .select("display_name, preferred_name")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const profile = (profileResult.data ?? null) as WorkspaceProfileRow | null;
  const identity = {
    displayName: resolveWorkspaceDisplayName({
      profile,
      claimDisplayName: metadataDisplayName(claims.user_metadata),
      email,
    }),
    email,
  };

  if (membershipResult.error || profileResult.error) {
    console.error("[workspace-session] membership/profile query failed", {
      membership: membershipResult.error?.message ?? null,
      profile: profileResult.error?.message ?? null,
    });
    return { status: "data_error", identity };
  }

  const memberships = (membershipResult.data ?? []) as WorkspaceMembershipRow[];
  if (!memberships.length) return { status: "no_access", identity };

  const organizationIds = [...new Set(memberships.map((membership) => membership.organization_id))];
  const [organizationResult, locationResult, locationMembershipResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, status")
      .in("id", organizationIds)
      .eq("status", "active"),
    supabase
      .from("locations")
      .select("id, organization_id, name, is_active")
      .in("organization_id", organizationIds)
      .eq("is_active", true),
    supabase
      .from("location_memberships")
      .select("organization_id, location_id, user_id, is_primary")
      .eq("user_id", userId)
      .in("organization_id", organizationIds),
  ]);

  if (
    organizationResult.error ||
    locationResult.error ||
    locationMembershipResult.error
  ) {
    console.error("[workspace-session] organization scope query failed", {
      organization: organizationResult.error?.message ?? null,
      location: locationResult.error?.message ?? null,
      locationMembership: locationMembershipResult.error?.message ?? null,
    });
    return { status: "data_error", identity };
  }

  const scopeInput = {
    userId,
    memberships,
    organizations: (organizationResult.data ?? []) as WorkspaceOrganizationRow[],
    locations: (locationResult.data ?? []) as WorkspaceLocationRow[],
    locationMemberships: (locationMembershipResult.data ?? []) as WorkspaceLocationMembershipRow[],
  };
  const scopes = deriveWorkspaceScopes(scopeInput);
  const scope = selectWorkspaceScope({
    ...scopeInput,
    preference: await preferencePromise,
  });

  if (!scope) return { status: "no_access", identity };
  if (!scope.activeLocation) return { status: "no_location", identity };
  const [persona, capabilityResult] = await Promise.all([
    resolveWorkspacePersona(
      supabase,
      scope.organization.id,
      userId,
      scope.locations.map((location) => location.id),
    ),
    supabase.rpc("effective_capabilities", {
      p_organization_id: scope.organization.id,
      p_location_id: scope.activeLocation.id,
    }),
  ]);
  if (capabilityResult.error) {
    console.error("[workspace-session] effective capability query failed", {
      organizationId: scope.organization.id,
      locationId: scope.activeLocation.id,
      error: capabilityResult.error.message,
    });
    return { status: "data_error", identity };
  }
  const capabilities = normalizeOperationalCapabilities(capabilityResult.data);

  return {
    status: "ready",
    context: {
      mode: "live",
      identity: {
        userId,
        displayName: identity.displayName,
        email,
        aal: normalizeAssuranceLevel(claims.aal),
      },
      organization: scope.organization,
      activeLocation: scope.activeLocation,
      locations: scope.locations,
      availableWorkspaces: toWorkspaceChoices(scopes),
      membershipId: scope.membership.id,
      role: scope.membership.role,
      organizationWide:
        scope.membership.role === "owner" || scope.membership.role === "admin",
      capabilities,
      ...(persona ? { persona } : {}),
    },
  };
}
