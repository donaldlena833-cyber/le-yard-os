import type { Metadata } from "next";

import { LiveCloseoutWorkspace } from "@/components/closeout/live-closeout-workspace";
import { CloseoutWorkspace } from "@/components/closeout/closeout-workspace";
import { ChurchSquareClosePreview } from "@/components/closeout/church-square-close-preview";
import { churchSquareCloseDates } from "@/data/read-models/church-square-close-preview.server";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
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
  const [result, policyConfigurationResult, showSquarePreview] = await Promise.all([
    loadLiveCloseout(resolution.context),
    isTenantFeatureEnabled(resolution.context, "tips")
      ? loadTipPolicyConfiguration(resolution.context)
      : null,
    verifyChurchSquareOrderWindowScope(resolution.context).catch(() => false),
  ]);
  const { activeLocation, identity } = resolution.context;
  return (
    <LiveCloseoutWorkspace
      key={activeLocation.id}
      workspace={resolution.context}
      result={result}
      policyConfigurationResult={policyConfigurationResult}
      squarePreview={showSquarePreview && <ChurchSquareClosePreview
        key={`${identity.userId}:${activeLocation.id}`}
        locationId={activeLocation.id}
        {...churchSquareCloseDates(new Date())}
      />}
    />
  );
}
