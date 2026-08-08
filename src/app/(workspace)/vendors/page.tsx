import type { Metadata } from "next";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { VendorsWorkspace } from "@/components/vendors/vendors-workspace";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  if (isDemoMode) return <VendorsWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  if (resolution.context.role === "employee") redirect("/today");
  return <LiveInventoryWorkspace key={resolution.context.activeLocation.id} workspace={resolution.context} result={await loadLiveInventory(resolution.context)} initialTab="vendors" title="Vendors & prices" description={`Purchasing, current prices, and open orders for ${resolution.context.activeLocation.name}.`} />;
}
