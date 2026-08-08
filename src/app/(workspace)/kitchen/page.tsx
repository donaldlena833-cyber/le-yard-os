import type { Metadata } from "next";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  if (isDemoMode) return <KitchenWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  requireWorkspaceRouteAccess("/kitchen", resolution.context);
  return (
    <LiveInventoryWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={await loadLiveInventory(resolution.context)}
      initialTab="recipes"
      title="Kitchen recipes & portion cost"
      description={`Measured recipes and ingredient costing for ${resolution.context.activeLocation.name}.`}
    />
  );
}
