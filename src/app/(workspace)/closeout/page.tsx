import type { Metadata } from "next";

import { LiveCloseoutWorkspace } from "@/components/closeout/live-closeout-workspace";
import { CloseoutWorkspace } from "@/components/closeout/closeout-workspace";
import { loadLiveCloseout } from "@/data/read-models/closeout";
import { loadTipPolicyConfiguration } from "@/data/read-models/financial-configuration";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Closeout & tips" };

export default async function CloseoutPage() {
  if (isDemoMode) return <CloseoutWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  requireWorkspaceRouteAccess("/closeout", resolution.context);
  const [result, policyConfigurationResult] = await Promise.all([
    loadLiveCloseout(resolution.context),
    loadTipPolicyConfiguration(resolution.context),
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
