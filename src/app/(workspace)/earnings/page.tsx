import type { Metadata } from "next";
import { EarningsWorkspace } from "@/components/earnings/earnings-workspace";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Earnings" };

export default async function EarningsPage() {
  if (!isDemoMode) {
    const resolution = await resolveWorkspaceSession();
    if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
    requireWorkspaceRouteAccess("/earnings", resolution.context);
  }
  return <EarningsWorkspace />;
}
