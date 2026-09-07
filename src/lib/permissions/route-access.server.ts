import "server-only";

import { notFound, redirect } from "next/navigation";
import { isWorkspaceRouteAccessible } from "@/components/shell/navigation";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { defaultWorkspacePath } from "@/lib/app-surface";

export function requireWorkspaceRouteAccess(
  pathname: string,
  workspace: WorkspaceContextValue,
): void {
  if (!isWorkspaceRouteAccessible(pathname, workspace)) {
    // A denied default route must terminate, never redirect back to itself.
    if (pathname === defaultWorkspacePath) notFound();
    redirect(defaultWorkspacePath);
  }
}
