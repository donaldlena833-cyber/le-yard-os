import type { Metadata } from "next";
import { LiveIntegrationsWorkspace } from "@/components/integrations/live-integrations-workspace";
import { IntegrationsWorkspace } from "@/components/integrations/integrations-workspace";
import { loadLiveIntegrations } from "@/data/read-models/integrations";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { squareProductionAccessToken, squareProductionSyncConfiguration } from "@/lib/integrations/square-production.server";
import { resolveRestaurantLocation } from "@/lib/restaurant-location.server";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/integrations", resolution.context);
  if (isDemoMode || resolution.context.mode === "demo") return <IntegrationsWorkspace />;
  const canConfigureSquare = ["owner", "admin"].includes(resolution.context.role);
  const [result, restaurant] = await Promise.all([
    loadLiveIntegrations(resolution.context),
    canConfigureSquare ? resolveRestaurantLocation().catch(() => null) : null,
  ]);
  const isSquarePilotLocation = restaurant?.organizationId === resolution.context.organization.id
    && restaurant.locationId === resolution.context.activeLocation.id;
  return (
    <LiveIntegrationsWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={result}
      squareSetup={isSquarePilotLocation ? (squareProductionAccessToken() ? "ready" : "missing-credential") : undefined}
      squareSyncEnabled={isSquarePilotLocation && Boolean(squareProductionSyncConfiguration())}
      manualCsvProcessorEnabled={
        process.env.LE_YARD_MANUAL_CSV_PROCESSOR_ENABLED?.trim() === "true"
      }
    />
  );
}
