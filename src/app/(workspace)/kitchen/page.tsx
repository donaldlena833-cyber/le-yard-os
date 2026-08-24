import type { Metadata } from "next";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { LivePrepWorkspace } from "@/components/prep/live-prep-workspace";
import { PageFrame } from "@/components/ui/page-frame";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { loadLivePrep } from "@/data/read-models/prep";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  if (isDemoMode) return <KitchenWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  requireWorkspaceRouteAccess("/kitchen", resolution.context);
  const [prepResult, inventoryResult] = await Promise.all([
    loadLivePrep(resolution.context),
    loadLiveInventory(resolution.context),
  ]);
  return (
    <>
      <PageFrame width="full" className="max-w-[1400px] pb-0">
        <LivePrepWorkspace
          key={`prep-${resolution.context.activeLocation.id}`}
          workspace={resolution.context}
          result={prepResult}
        />
      </PageFrame>
      <LiveInventoryWorkspace
        key={resolution.context.activeLocation.id}
        workspace={resolution.context}
        result={inventoryResult}
        initialTab="recipes"
        title="Kitchen recipes & portion cost"
        description={`Measured recipes and ingredient costing for ${resolution.context.activeLocation.name}.`}
      />
    </>
  );
}
