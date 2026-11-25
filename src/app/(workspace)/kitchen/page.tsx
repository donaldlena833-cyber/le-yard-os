import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChurchCateringPrep } from "@/components/kitchen/church-catering-prep";
import { ChurchBatchBoard } from "@/components/kitchen/church-batch-board";
import { ChurchSandwichAvailabilityPanel } from "@/components/kitchen/church-sandwich-availability-panel";
import { ChurchSandwichCostingPanel } from "@/components/kitchen/church-sandwich-costing-panel";
import { ChurchSandwichRecipeApprovalPanel } from "@/components/kitchen/church-sandwich-recipe-approval-panel";
import { ChurchSandwichQuotedCosts, ChurchSandwichStandardPanel } from "@/components/kitchen/church-sandwich-standard-panel";
import { ChurchSandwichStaffResources } from "@/components/kitchen/church-sandwich-staff-resources";
import { ChurchSandwichTimingPanel } from "@/components/kitchen/church-sandwich-timing-panel";
import { ChurchSquareAllergenPanel } from "@/components/kitchen/church-square-allergen-panel";
import { ChurchSupplierEvidencePanel } from "@/components/kitchen/church-supplier-evidence-panel";
import { KitchenSection } from "@/components/kitchen/kitchen-section";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { LivePrepWorkspace } from "@/components/prep/live-prep-workspace";
import { PageFrame } from "@/components/ui/page-frame";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { canReadChurchIngredientEvidence, loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { canRecordChurchBatchLabels, loadChurchBatchLabels, loadChurchBatchQueue } from "@/data/read-models/church-ingredient-batches.server";
import { loadChurchCateringPrep } from "@/data/read-models/church-catering-prep.server";
import { buildChurchSandwichAvailability } from "@/data/read-models/church-sandwich-availability.server";
import { canManageChurchSandwichCosts, loadChurchSandwichPackCosts } from "@/data/read-models/church-sandwich-costing.server";
import { currentChurchAvailabilityRecipes, loadChurchSandwichFormulas } from "@/data/read-models/church-sandwich-formula.server";
import { loadChurchSandwichRegisterChecks } from "@/data/read-models/church-sandwich-register-check.server";
import { canRecordChurchSandwichTiming, loadChurchSandwichTimingRuns } from "@/data/read-models/church-sandwich-timing.server";
import { loadLivePrep } from "@/data/read-models/prep";
import { churchSandwichStandard } from "@/lib/kitchen/church-sandwich-standard";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Kitchen" };

async function ChurchKitchenTools({ workspace }: { workspace: WorkspaceContextValue }) {
  const checkedAt = new Date().toISOString();
  const [ingredientEvidence, formulas, batchLabels, batchQueue, packCosts, registerChecks, timings, cateringPrep] = await Promise.all([
    loadChurchIngredientEvidence(workspace),
    loadChurchSandwichFormulas(workspace),
    loadChurchBatchLabels(workspace),
    loadChurchBatchQueue(workspace),
    loadChurchSandwichPackCosts(workspace),
    loadChurchSandwichRegisterChecks(workspace),
    loadChurchSandwichTimingRuns(workspace),
    loadChurchCateringPrep(workspace),
  ]);
  const evidence = ingredientEvidence?.ok ? ingredientEvidence.data : null;
  const formulaRows = formulas?.ok ? formulas.data : null;
  const canManageRecipes = workspace.capabilities.includes("recipe.manage");
  const showQuotedCosts = canReadChurchIngredientEvidence(workspace) && canManageChurchSandwichCosts(workspace);
  const scope = {
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
    userId: workspace.identity.userId,
  };
  const showBatchBoard = batchLabels !== null && batchQueue !== null && ingredientEvidence !== null;
  const batchSnapshot = evidence && batchLabels?.ok && batchQueue?.ok
    ? { ...scope, checkedAt, evidence, records: batchLabels.data, queue: batchQueue.data }
    : null;
  const availability = buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult: ingredientEvidence,
    cateringPrepResult: cateringPrep,
    formulaResult: formulas,
  });

  return (
    <>
      {(ingredientEvidence || showBatchBoard) && (
        <KitchenSection title="Supplier labels and batches">
          <div className="space-y-5">
            {ingredientEvidence && <ChurchSupplierEvidencePanel initialRows={evidence} formulas={formulaRows} canManage={canManageRecipes} />}
            {showBatchBoard && <ChurchBatchBoard scope={scope} initial={batchSnapshot} canRecord={canRecordChurchBatchLabels(workspace)} />}
            {evidence && formulaRows && <ChurchSandwichRecipeApprovalPanel evidence={evidence} formulas={formulaRows} canManage={canManageRecipes} />}
          </div>
        </KitchenSection>
      )}

      {(showQuotedCosts || packCosts) && (
        <KitchenSection title="Costs">
          {showQuotedCosts && <ChurchSandwichQuotedCosts />}
          {packCosts && (evidence && formulaRows ? (
            <ChurchSandwichCostingPanel formulas={formulaRows} evidence={evidence} costs={packCosts.ok ? packCosts.data : null} canRecord={packCosts.ok} />
          ) : <p className="text-sm text-[var(--ink-soft)]">Invoice costing needs measured portions and supplier labels.</p>)}
        </KitchenSection>
      )}

      {(availability || (canManageRecipes && evidence && formulaRows)) && (
        <KitchenSection title="Stock and register checks">
          <div className="space-y-6">
            {availability && (availability.ok
              ? <ChurchSandwichAvailabilityPanel key={availability.data.serviceDate} {...availability.data} />
              : <p className="text-sm text-[var(--ink-soft)]">Sandwich availability could not be loaded.</p>)}
            {canManageRecipes && evidence && formulaRows && (
              <ChurchSquareAllergenPanel evidence={evidence} formulas={formulaRows} registerChecks={registerChecks?.ok ? registerChecks.data : null} />
            )}
          </div>
        </KitchenSection>
      )}

      {cateringPrep && (
        <KitchenSection title="Catering prep">
          <ChurchCateringPrep data={cateringPrep} approvedRecipes={evidence && formulaRows
            ? currentChurchAvailabilityRecipes(formulaRows, evidence) : null} />
        </KitchenSection>
      )}

      {(evidence || timings) && (
        <KitchenSection title="Guides and timing">
          {evidence && <ChurchSandwichStaffResources />}
          {timings && (timings.ok
            ? <ChurchSandwichTimingPanel formulas={formulaRows ?? []} runs={timings.data} canRecord={canRecordChurchSandwichTiming(workspace)} />
            : <p className="text-sm text-[var(--ink-soft)]">Timing runs could not be loaded.</p>)}
        </KitchenSection>
      )}
    </>
  );
}

async function ChurchPrep({ workspace }: { workspace: WorkspaceContextValue }) {
  return <LivePrepWorkspace workspace={workspace} result={await loadLivePrep(workspace)} embedded />;
}

export default async function KitchenPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  const { context } = resolution;
  requireWorkspaceRouteAccess("/kitchen", context);
  if (context.mode === "demo") return <KitchenWorkspace />;

  if (context.activeLocation.id === churchSandwichStandard.locationId) {
    const showPrep = context.role === "owner" || context.role === "admin"
      || hasAnyCapability(context.capabilities, ["prep.manage", "prep.complete"]);
    return (
      <PageFrame width="standard" className="pt-3 sm:pt-4">
        <div key={`${context.activeLocation.id}:${context.identity.userId}`} className="border-t border-[var(--line)]">
          {showPrep && (
            <KitchenSection title="Today’s prep" defaultOpen>
              <Suspense fallback={<p role="status" className="text-sm text-[var(--ink-soft)]">Loading prep…</p>}>
                <ChurchPrep workspace={context} />
              </Suspense>
            </KitchenSection>
          )}
          {canReadChurchIngredientEvidence(context) && (
            <KitchenSection title="Sandwich recipes">
              <ChurchSandwichStandardPanel />
            </KitchenSection>
          )}
          <Suspense fallback={<p role="status" className="py-3 text-sm text-[var(--ink-soft)]">Loading kitchen tools…</p>}>
            <ChurchKitchenTools workspace={context} />
          </Suspense>
        </div>
        <Link href="/inventory?tab=recipes#inventory-workspace" className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium underline underline-offset-4">
          Inventory and recipe setup
        </Link>
      </PageFrame>
    );
  }

  const [prepResult, inventoryResult] = await Promise.all([loadLivePrep(context), loadLiveInventory(context)]);
  return (
    <>
      <PageFrame width="full" className="max-w-[1400px] pb-0">
        <LivePrepWorkspace key={`prep-${context.activeLocation.id}`} workspace={context} result={prepResult} />
      </PageFrame>
      <LiveInventoryWorkspace key={context.activeLocation.id} workspace={context} result={inventoryResult} initialTab="recipes"
        title="Kitchen recipes & portion cost" description={`Measured recipes and ingredient costing for ${context.activeLocation.name}.`} />
    </>
  );
}
