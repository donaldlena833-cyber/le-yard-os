import type { Metadata } from "next";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Ask Le Yard" };

export default async function AssistantPage() {
  if (!isDemoMode) {
    const resolution = await resolveWorkspaceSession();
    if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
    requireWorkspaceRouteAccess("/assistant", resolution.context);
  }
  return <AssistantWorkspace />;
}
