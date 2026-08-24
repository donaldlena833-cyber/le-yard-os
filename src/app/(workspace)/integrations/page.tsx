import type { Metadata } from "next";
import { LiveIntegrationsWorkspace } from "@/components/integrations/live-integrations-workspace";
import { IntegrationsWorkspace } from "@/components/integrations/integrations-workspace";
import { loadLiveIntegrations } from "@/data/read-models/integrations";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/integrations", resolution.context);
  if (isDemoMode || resolution.context.mode === "demo") return <IntegrationsWorkspace />;
  return (
    <LiveIntegrationsWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={await loadLiveIntegrations(resolution.context)}
      manualCsvProcessorEnabled={
        process.env.LE_YARD_MANUAL_CSV_PROCESSOR_ENABLED?.trim() === "true"
      }
    />
  );
}
