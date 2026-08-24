import type { Metadata } from "next";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/inventory", resolution.context);
  if (resolution.context.mode === "demo") return <InventoryWorkspace />;
  return (
    <LiveInventoryWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={await loadLiveInventory(resolution.context)}
    />
  );
}
