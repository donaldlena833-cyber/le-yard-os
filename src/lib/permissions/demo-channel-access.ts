import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { ChatChannel } from "@/types";

/**
 * Playground chat uses the same enumeration rule for navigation, selection,
 * history, unread state, search, and posting. A channel that fails this
 * predicate must never be sent to or derived by the demo client.
 */
export function canAccessDemoChannel(
  channel: ChatChannel,
  workspace: WorkspaceContextValue,
): boolean {
  if (channel.organizationId !== workspace.organization.id) return false;

  if (
    channel.locationId &&
    !workspace.locations.some((location) => location.id === channel.locationId)
  ) {
    return false;
  }

  if (channel.visibility === "management" || channel.kind === "management") {
    return (
      ["owner", "admin", "manager"].includes(workspace.role) &&
      (!channel.participantIds.length ||
        channel.participantIds.includes(workspace.identity.userId))
    );
  }

  if (channel.visibility === "participants" || channel.kind === "direct") {
    return channel.participantIds.includes(workspace.identity.userId);
  }

  if (channel.visibility === "location_members") {
    return Boolean(channel.locationId);
  }

  return channel.visibility === "all_members";
}
