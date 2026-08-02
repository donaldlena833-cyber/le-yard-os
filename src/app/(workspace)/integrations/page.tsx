import type { Metadata } from "next";
import { LiveIntegrationsWorkspace } from "@/components/integrations/live-integrations-workspace";
import { IntegrationsWorkspace } from "@/components/integrations/integrations-workspace";
import { loadLiveIntegrations } from "@/data/read-models/integrations";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  if (isDemoMode) return <IntegrationsWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  return (
    <LiveIntegrationsWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={await loadLiveIntegrations(resolution.context)}
    />
  );
}
