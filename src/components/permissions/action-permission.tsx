import type { ReactNode } from "react";

export type ActionPermissionState =
  | "allowed"
  | "missing_capability"
  | "missing_location_scope"
  | "mfa_required"
  | "missing_prerequisite"
  | "workflow_unavailable"
  | "read_only";

export interface ActionPermission {
  state: ActionPermissionState;
  explanation?: string;
}

const defaultExplanation: Record<Exclude<ActionPermissionState, "allowed">, string> = {
  missing_capability: "Your assigned job role does not include this action.",
  missing_location_scope: "This action is not assigned at the active location.",
  mfa_required: "Verify with multi-factor authentication to continue.",
  missing_prerequisite: "Complete the required setup first.",
  workflow_unavailable: "The connected workflow is not configured.",
  read_only: "This view is read only.",
};

export function permissionExplanation(permission: ActionPermission): string | undefined {
  if (permission.state === "allowed") return undefined;
  return permission.explanation ?? defaultExplanation[permission.state];
}

export function PermissionAwareAction({
  permission,
  children,
}: {
  permission: ActionPermission;
  children: (options: { disabled: boolean; explanation?: string }) => ReactNode;
}) {
  const explanation = permissionExplanation(permission);
  return <span className="inline-flex" title={explanation}>{children({ disabled: permission.state !== "allowed", explanation })}</span>;
}
