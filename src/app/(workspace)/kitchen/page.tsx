import type { Metadata } from "next";
import { Suspense } from "react";
import { ChurchCateringPrep } from "@/components/kitchen/church-catering-prep";
import { ChurchSupplierEvidencePanel } from "@/components/kitchen/church-supplier-evidence-panel";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { LivePrepWorkspace } from "@/components/prep/live-prep-workspace";
import { PageFrame } from "@/components/ui/page-frame";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { loadLivePrep } from "@/data/read-models/prep";
import { type WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Kitchen" };

async function ChurchSupplierEvidence({ workspace }: { workspace: WorkspaceContextValue }) {
  const result = await loadChurchIngredientEvidence(workspace);
  if (!result) return null;
  if (!result.ok) return <p className="my-4 text-sm text-[var(--ink-soft)]">Supplier evidence could not be loaded. Reload Kitchen to try again.</p>;

  return <ChurchSupplierEvidencePanel key={workspace.activeLocation.id} initialRows={result.data} canManage={workspace.capabilities.includes("recipe.manage")} />;
}

export default async function KitchenPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/kitchen", resolution.context);
  if (resolution.context.mode === "demo") return <KitchenWorkspace />;
  const [prepResult, inventoryResult] = await Promise.all([
    loadLivePrep(resolution.context),
    loadLiveInventory(resolution.context),
  ]);
  return (
    <>
      <PageFrame width="full" className="max-w-[1400px] pb-0">
        <Suspense fallback={null}><ChurchCateringPrep workspace={resolution.context} /></Suspense>
        <Suspense fallback={null}><ChurchSupplierEvidence workspace={resolution.context} /></Suspense>
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
