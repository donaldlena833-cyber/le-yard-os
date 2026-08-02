import type { WorkspacePreference } from "@/lib/auth/workspace-context";

export const WORKSPACE_PREFERENCE_COOKIE = "ly_workspace_scope";
const preferenceVersion = "v1";
const maximumPreferenceLength = 1_024;

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * This is an opaque HTTP-only preference, not an authorization token. The
 * decoded IDs must always be checked against current authenticated DB scope.
 */
export function encodeWorkspacePreference(value: WorkspacePreference): string {
  return [
    preferenceVersion,
    encodePart(value.userId),
    encodePart(value.organizationId),
    encodePart(value.locationId),
  ].join(":");
}

export function decodeWorkspacePreference(value: string | undefined): WorkspacePreference | null {
  if (!value || value.length > maximumPreferenceLength) return null;
  const [version, rawUserId, rawOrganizationId, rawLocationId, extra] = value.split(":");
  if (
    version !== preferenceVersion ||
    !rawUserId ||
    !rawOrganizationId ||
    !rawLocationId ||
    extra !== undefined
  ) {
    return null;
  }

  const userId = decodePart(rawUserId);
  const organizationId = decodePart(rawOrganizationId);
  const locationId = decodePart(rawLocationId);
  if (!userId || !organizationId || !locationId) return null;
  return { userId, organizationId, locationId };
}
