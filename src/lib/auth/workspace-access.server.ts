import "server-only";
import { createHash } from "node:crypto";
import type { WorkspaceContextValue } from "./workspace-context";

/** Fingerprints current server-derived authorization, not names or JWT expiry. */
export function workspaceAccessRevision(context: WorkspaceContextValue): string {
  const locations = (items: WorkspaceContextValue["locations"]) => items
    .map(item => [item.organizationId, item.id, item.timeZone ?? null])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify({
    userId: context.identity.userId,
    membershipId: context.membershipId,
    organizationId: context.organization.id,
    locationId: context.activeLocation.id,
    role: context.role,
    persona: context.persona ?? null,
    activeJob: context.activeJob ?? null,
    timeZone: context.activeLocation.timeZone ?? null,
    organizationWide: context.organizationWide,
    capabilities: [...new Set(context.capabilities)].sort(),
    locations: locations(context.locations),
    choices: context.availableWorkspaces.map(choice => ({
      membershipId: choice.membershipId, organizationId: choice.organization.id,
      role: choice.role, organizationWide: choice.organizationWide, persona: choice.persona ?? null,
      locations: locations(choice.locations),
    })).sort((left, right) => left.membershipId.localeCompare(right.membershipId)),
  })).digest("hex");
}
