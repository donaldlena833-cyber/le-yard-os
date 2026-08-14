import type { Metadata } from "next";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { VendorsWorkspace } from "@/components/vendors/vendors-workspace";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  if (isDemoMode) return <VendorsWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  requireWorkspaceRouteAccess("/vendors", resolution.context);
  return <LiveInventoryWorkspace key={resolution.context.activeLocation.id} workspace={resolution.context} result={await loadLiveInventory(resolution.context)} initialTab="vendors" title="Vendors & prices" description={`Purchasing, current prices, and open orders for ${resolution.context.activeLocation.name}.`} />;
}
