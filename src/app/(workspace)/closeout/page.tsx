import type { Metadata } from "next";

import { LiveCloseoutWorkspace } from "@/components/closeout/live-closeout-workspace";
import { CloseoutWorkspace } from "@/components/closeout/closeout-workspace";
import { loadLiveCloseout } from "@/data/read-models/closeout";
import { loadTipPolicyConfiguration } from "@/data/read-models/financial-configuration";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { isTenantFeatureEnabled } from "@/lib/tenant-service";

export const metadata: Metadata = { title: "Closeout" };

export default async function CloseoutPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/closeout", resolution.context);
  if (resolution.context.mode === "demo") return <CloseoutWorkspace />;
  const [result, policyConfigurationResult] = await Promise.all([
    loadLiveCloseout(resolution.context),
    isTenantFeatureEnabled(resolution.context, "tips")
      ? loadTipPolicyConfiguration(resolution.context)
      : null,
  ]);
  return (
    <LiveCloseoutWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={result}
      policyConfigurationResult={policyConfigurationResult}
    />
  );
}
