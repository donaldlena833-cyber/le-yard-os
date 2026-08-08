import "server-only";

import { redirect } from "next/navigation";
import { isWorkspaceRouteAccessible } from "@/components/shell/navigation";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

export function requireWorkspaceRouteAccess(
  pathname: string,
  workspace: WorkspaceContextValue,
): void {
  if (!isWorkspaceRouteAccessible(pathname, workspace)) redirect("/today");
}
