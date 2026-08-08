import type { Metadata } from "next";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  if (isDemoMode) return <InventoryWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  requireWorkspaceRouteAccess("/inventory", resolution.context);
  return (
    <LiveInventoryWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={await loadLiveInventory(resolution.context)}
    />
  );
}
