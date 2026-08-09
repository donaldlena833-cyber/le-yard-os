import type { AppRole } from "@/types";
import type { TableRow } from "@/types/database.generated";
import type { OperationalCapability } from "@/lib/permissions/capabilities";

export type AssuranceLevel = "aal1" | "aal2";

export interface WorkspaceIdentity {
  userId: string;
  displayName: string;
  email: string | null;
  aal: AssuranceLevel;
}

export interface WorkspaceOrganization {
  id: string;
  name: string;
}

export interface WorkspaceLocation {
  id: string;
  organizationId: string;
  name: string;
  isPrimary: boolean;
}

export interface WorkspaceChoice {
  membershipId: string;
  organization: WorkspaceOrganization;
  locations: readonly WorkspaceLocation[];
  role: AppRole;
  organizationWide: boolean;
  persona?: "chef";
}

/**
 * The only tenant scope allowed to cross the workspace server/client boundary.
 * Live values are selected from the authenticated user's RLS-filtered records.
 */
export interface WorkspaceContextValue {
  mode: "demo" | "live";
  identity: WorkspaceIdentity;
  organization: WorkspaceOrganization;
  activeLocation: WorkspaceLocation;
  locations: readonly WorkspaceLocation[];
  availableWorkspaces: readonly WorkspaceChoice[];
  membershipId: string;
  role: AppRole;
  organizationWide: boolean;
  capabilities: readonly OperationalCapability[];
  persona?: "chef";
}

export type WorkspaceMembershipRow = Pick<
  TableRow<"organization_memberships">,
  "id" | "organization_id" | "user_id" | "role" | "status"
>;

export type WorkspaceOrganizationRow = Pick<
  TableRow<"organizations">,
  "id" | "name" | "status"
>;

export type WorkspaceLocationRow = Pick<
  TableRow<"locations">,
  "id" | "organization_id" | "name" | "is_active"
>;

export type WorkspaceLocationMembershipRow = Pick<
  TableRow<"location_memberships">,
  "organization_id" | "location_id" | "user_id" | "is_primary"
>;

export type WorkspaceProfileRow = Pick<
  TableRow<"profiles">,
  "display_name" | "preferred_name"
>;

export interface WorkspaceScopeSelection {
  membership: WorkspaceMembershipRow;
  organization: WorkspaceOrganization;
  activeLocation: WorkspaceLocation | null;
  locations: WorkspaceLocation[];
}

export interface WorkspacePreference {
  userId: string;
  organizationId: string;
  locationId: string;
}

const roleValues: readonly AppRole[] = ["owner", "admin", "manager", "employee"];

function isAppRole(value: string): value is AppRole {
  return roleValues.includes(value as AppRole);
}

function compareLabelThenId(
  left: { name: string; id: string },
  right: { name: string; id: string },
) {
  const leftName = left.name.normalize("NFKC").toLowerCase();
  const rightName = right.name.normalize("NFKC").toLowerCase();
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function deriveWorkspaceScopes({
  userId,
  memberships,
  organizations,
  locations,
  locationMemberships,
}: {
  userId: string;
  memberships: readonly WorkspaceMembershipRow[];
  organizations: readonly WorkspaceOrganizationRow[];
  locations: readonly WorkspaceLocationRow[];
  locationMemberships: readonly WorkspaceLocationMembershipRow[];
}): WorkspaceScopeSelection[] {
  const organizationById = new Map(
    organizations
      .filter((organization) => organization.status === "active")
      .map((organization) => [organization.id, organization]),
  );

  const activeMemberships = memberships
    .filter(
      (membership) =>
        membership.user_id === userId &&
        membership.status === "active" &&
        isAppRole(membership.role) &&
        organizationById.has(membership.organization_id),
    )
    .sort((left, right) => {
      const leftOrganization = organizationById.get(left.organization_id)!;
      const rightOrganization = organizationById.get(right.organization_id)!;
      return compareLabelThenId(leftOrganization, rightOrganization);
    });

  return activeMemberships.map((membership): WorkspaceScopeSelection => {
    const organization = organizationById.get(membership.organization_id)!;
    const organizationWide = membership.role === "owner" || membership.role === "admin";
    const assignedLocations = new Map(
      locationMemberships
        .filter(
          (locationMembership) =>
            locationMembership.user_id === userId &&
            locationMembership.organization_id === membership.organization_id,
        )
        .map((locationMembership) => [locationMembership.location_id, locationMembership]),
    );

    const accessibleLocations = locations
      .filter(
        (location) =>
          location.organization_id === membership.organization_id &&
          location.is_active &&
          (organizationWide || assignedLocations.has(location.id)),
      )
      .map((location): WorkspaceLocation => ({
        id: location.id,
        organizationId: location.organization_id,
        name: location.name,
        isPrimary: assignedLocations.get(location.id)?.is_primary ?? false,
      }))
      .sort(
        (left, right) =>
          Number(right.isPrimary) - Number(left.isPrimary) || compareLabelThenId(left, right),
      );

    return {
      membership,
      organization: { id: organization.id, name: organization.name },
      activeLocation: accessibleLocations[0] ?? null,
      locations: accessibleLocations,
    };
  });
}

/**
 * Resolves only scopes proven by current database rows. A browser preference
 * can choose among those rows but can never introduce an organization or
 * location. Invalid or stale preferences use the deterministic fallback.
 */
export function selectWorkspaceScope({
  preference,
  ...input
}: {
  userId: string;
  memberships: readonly WorkspaceMembershipRow[];
  organizations: readonly WorkspaceOrganizationRow[];
  locations: readonly WorkspaceLocationRow[];
  locationMemberships: readonly WorkspaceLocationMembershipRow[];
  preference?: WorkspacePreference | null;
}): WorkspaceScopeSelection | null {
  const scopes = deriveWorkspaceScopes(input);
  if (!scopes.length) return null;

  if (preference?.userId === input.userId) {
    const preferredScope = scopes.find(
      (scope) => scope.organization.id === preference.organizationId,
    );
    const preferredLocation = preferredScope?.locations.find(
      (location) => location.id === preference.locationId,
    );
    if (preferredScope && preferredLocation) {
      return { ...preferredScope, activeLocation: preferredLocation };
    }
  }

  return scopes.find((scope) => scope.activeLocation) ?? scopes[0];
}

export function toWorkspaceChoices(
  scopes: readonly WorkspaceScopeSelection[],
): WorkspaceChoice[] {
  return scopes
    .filter(
      (scope): scope is WorkspaceScopeSelection & { activeLocation: WorkspaceLocation } =>
        scope.activeLocation !== null,
    )
    .map((scope) => ({
      membershipId: scope.membership.id,
      organization: scope.organization,
      locations: scope.locations,
      role: scope.membership.role,
      organizationWide:
        scope.membership.role === "owner" || scope.membership.role === "admin",
    }));
}

export function findWorkspaceChoice(
  choices: readonly WorkspaceChoice[],
  organizationId: string,
  locationId: string,
): { choice: WorkspaceChoice; location: WorkspaceLocation } | null {
  const choice = choices.find(
    (candidate) => candidate.organization.id === organizationId,
  );
  const location = choice?.locations.find((candidate) => candidate.id === locationId);
  if (!choice || !location || location.organizationId !== choice.organization.id) {
    return null;
  }
  return { choice, location };
}

export function normalizeAssuranceLevel(value: unknown): AssuranceLevel {
  return value === "aal2" ? "aal2" : "aal1";
}

export function resolveWorkspaceDisplayName({
  profile,
  claimDisplayName,
  email,
}: {
  profile: WorkspaceProfileRow | null;
  claimDisplayName?: unknown;
  email?: unknown;
}): string {
  const profileName = profile?.preferred_name?.trim() || profile?.display_name.trim();
  if (profileName) return profileName;
  if (typeof claimDisplayName === "string" && claimDisplayName.trim()) {
    return claimDisplayName.trim();
  }
  if (typeof email === "string" && email.includes("@")) {
    return email.slice(0, email.indexOf("@"));
  }
  return "Team member";
}

export function invitableRolesForActor(role: AppRole): readonly AppRole[] {
  if (role === "owner") return roleValues;
  if (role === "admin") return ["admin", "manager", "employee"];
  return [];
}

export function canInviteFromWorkspace(
  role: AppRole,
  _aal: AssuranceLevel,
): boolean {
  void _aal;
  return role === "admin" || role === "owner";
}
