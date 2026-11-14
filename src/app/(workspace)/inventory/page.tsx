import type { Metadata } from "next";
import { ChurchSquareStockCounts } from "@/components/inventory/church-square-stock-counts";
import { ChurchSquareActivity } from "@/components/inventory/church-square-activity";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { loadChurchSquareCountItems } from "@/data/read-models/church-square-counts";
import { canViewChurchSquareStockAlerts, loadChurchSquareStockAlerts } from "@/data/read-models/church-square-stock-alerts";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareCountConfiguration } from "@/lib/integrations/church-square-configuration.server";
import { churchSquareWebhookConfiguration } from "@/lib/integrations/church-square-webhook.server";
import { hasAnyCapability, KITCHEN_CAPABILITIES } from "@/lib/permissions/capabilities";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Inventory" };
export const maxDuration = 180;

export default async function InventoryPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/inventory", resolution.context);
  if (resolution.context.mode === "demo") return <InventoryWorkspace />;
  const { context } = resolution;
  const counter = context.serviceSettings?.serviceModel === "counter";
  const canCount = ["owner", "admin", "manager"].includes(context.role) || context.capabilities.includes("inventory.count.create");
  const canSeeSquareActivity = counter && ["owner", "admin", "manager"].includes(context.role);
  const canReadInventory = ["owner", "admin"].includes(context.role) || hasAnyCapability(context.capabilities, KITCHEN_CAPABILITIES);
  const alertsEnabled = canViewChurchSquareStockAlerts(context) && Boolean(churchSquareWebhookConfiguration());
  const [result, squareItems, squareAlerts] = await Promise.all([
    canReadInventory || !counter ? loadLiveInventory(context) : null,
    counter && canCount ? loadChurchSquareCountItems(context.activeLocation.id) : null,
    alertsEnabled ? loadChurchSquareStockAlerts(context.activeLocation.id) : null,
  ]);
  return (
    <>
      {squareItems ? <ChurchSquareStockCounts key={context.activeLocation.id}
        items={squareItems} enabled={Boolean(churchSquareCountConfiguration())}
        alerts={squareAlerts}
        scope={{ organizationId: context.organization.id, locationId: context.activeLocation.id }}
        canConfigure={context.role === "owner" || context.role === "admin"} /> : null}
      {canSeeSquareActivity ? <ChurchSquareActivity locationId={context.activeLocation.id} configured={alertsEnabled} /> : null}
      {result ? <LiveInventoryWorkspace key={context.activeLocation.id} workspace={context} result={result} /> : null}
    </>
  );
}
