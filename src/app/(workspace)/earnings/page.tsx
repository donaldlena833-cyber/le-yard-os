import type { Metadata } from "next";
import { EarningsWorkspace } from "@/components/earnings/earnings-workspace";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Earnings" };

export default async function EarningsPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/earnings", resolution.context);
  return <EarningsWorkspace />;
}
