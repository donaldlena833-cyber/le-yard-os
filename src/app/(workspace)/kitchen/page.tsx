import type { Metadata } from "next";
import { Suspense } from "react";
import { ChurchCateringPrep } from "@/components/kitchen/church-catering-prep";
import { ChurchBatchLabelsPanel } from "@/components/kitchen/church-batch-labels-panel";
import { ChurchSandwichAvailabilityPanel } from "@/components/kitchen/church-sandwich-availability-panel";
import { ChurchSandwichCostingPanel } from "@/components/kitchen/church-sandwich-costing-panel";
import { ChurchSandwichRecipeApprovalPanel } from "@/components/kitchen/church-sandwich-recipe-approval-panel";
import { ChurchSandwichStaffResources } from "@/components/kitchen/church-sandwich-staff-resources";
import { ChurchSandwichTimingPanel } from "@/components/kitchen/church-sandwich-timing-panel";
import { ChurchSquareAllergenPanel } from "@/components/kitchen/church-square-allergen-panel";
import { ChurchSupplierEvidencePanel } from "@/components/kitchen/church-supplier-evidence-panel";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { LivePrepWorkspace } from "@/components/prep/live-prep-workspace";
import { PageFrame } from "@/components/ui/page-frame";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { canRecordChurchBatchLabels, loadChurchBatchLabels, loadChurchBatchQueue } from "@/data/read-models/church-ingredient-batches.server";
import { loadChurchCateringPrep } from "@/data/read-models/church-catering-prep.server";
import { buildChurchSandwichAvailability } from "@/data/read-models/church-sandwich-availability.server";
import { loadChurchSandwichPackCosts } from "@/data/read-models/church-sandwich-costing.server";
import { currentChurchAvailabilityRecipes, loadChurchSandwichFormulas } from "@/data/read-models/church-sandwich-formula.server";
import { loadChurchSandwichRegisterChecks } from "@/data/read-models/church-sandwich-register-check.server";
import { canRecordChurchSandwichTiming, loadChurchSandwichTimingRuns } from "@/data/read-models/church-sandwich-timing.server";
import { loadLivePrep } from "@/data/read-models/prep";
import { type WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Kitchen" };

async function ChurchStaffResources({ evidence }: { evidence: ReturnType<typeof loadChurchIngredientEvidence> }) {
  const access = await evidence;
  return access?.ok ? <ChurchSandwichStaffResources /> : null;
}

async function ChurchSupplierEvidence({ workspace, data, formulas }: {
  workspace: WorkspaceContextValue;
  data: ReturnType<typeof loadChurchIngredientEvidence>;
  formulas: ReturnType<typeof loadChurchSandwichFormulas>;
}) {
  const result = await data;
  if (!result) return null;
  if (!result.ok) return <p className="my-4 text-sm text-[var(--ink-soft)]">Supplier evidence could not be loaded. Reload Kitchen to try again.</p>;

  const signedRecipes = await formulas;
  return <ChurchSupplierEvidencePanel key={workspace.activeLocation.id} initialRows={result.data}
    formulas={signedRecipes?.ok ? signedRecipes.data : null} canManage={workspace.capabilities.includes("recipe.manage")} />;
}

async function ChurchBatchLabels({ workspace, evidence, labels, queue }: {
  workspace: WorkspaceContextValue;
  evidence: ReturnType<typeof loadChurchIngredientEvidence>;
  labels: ReturnType<typeof loadChurchBatchLabels>;
  queue: ReturnType<typeof loadChurchBatchQueue>;
}) {
  const [ingredientEvidence, batchLabels, openBatches] = await Promise.all([evidence, labels, queue]);
  if (!ingredientEvidence || !batchLabels) return null;
  if (!ingredientEvidence.ok || !batchLabels.ok) {
    return <p className="my-4 text-sm text-[var(--ink-soft)]">Batch labels could not be loaded. Reload Kitchen to try again.</p>;
  }
  return <ChurchBatchLabelsPanel key={workspace.activeLocation.id} evidence={ingredientEvidence.data}
    records={batchLabels.data} queue={openBatches?.ok ? openBatches.data : null}
    asOf={new Date().toISOString()} canRecord={canRecordChurchBatchLabels(workspace)} />;
}

async function ChurchSandwichPlanning({ workspace, evidence, catering, formulas, registerChecks, packCosts }: {
  workspace: WorkspaceContextValue;
  evidence: ReturnType<typeof loadChurchIngredientEvidence>;
  catering: ReturnType<typeof loadChurchCateringPrep>;
  formulas: ReturnType<typeof loadChurchSandwichFormulas>;
  registerChecks: ReturnType<typeof loadChurchSandwichRegisterChecks>;
  packCosts: ReturnType<typeof loadChurchSandwichPackCosts>;
}) {
  const [ingredientEvidenceResult, cateringPrepResult, formulaResult, registerResult, packCostResult] =
    await Promise.all([evidence, catering, formulas, registerChecks, packCosts]);
  const availability = buildChurchSandwichAvailability(workspace, { ingredientEvidenceResult, cateringPrepResult, formulaResult });
  const location = workspace.activeLocation.id;
  const canManage = workspace.capabilities.includes("recipe.manage");
  return (
    <>
      {formulaResult?.ok && ingredientEvidenceResult?.ok && (
        <ChurchSandwichRecipeApprovalPanel key={location} evidence={ingredientEvidenceResult.data}
          formulas={formulaResult.data} canManage={canManage} />
      )}
      {packCostResult && (formulaResult?.ok && ingredientEvidenceResult?.ok ? (
        <ChurchSandwichCostingPanel key={location} formulas={formulaResult.data} evidence={ingredientEvidenceResult.data}
          costs={packCostResult.ok ? packCostResult.data : null} canRecord={packCostResult.ok} />
      ) : <p className="my-4 text-sm text-[var(--ink-soft)]">Signed recipes and supplier labels could not be loaded for costing.</p>)}
      {canManage && formulaResult?.ok && ingredientEvidenceResult?.ok && (
        <ChurchSquareAllergenPanel key={location} evidence={ingredientEvidenceResult.data} formulas={formulaResult.data}
          registerChecks={registerResult?.ok ? registerResult.data : null} />
      )}
      {availability && (availability.ok ? (
        <ChurchSandwichAvailabilityPanel key={`${location}:${availability.data.serviceDate}`} {...availability.data} />
      ) : <p className="my-4 text-sm text-[var(--ink-soft)]">Sandwich availability could not be loaded. Reload Kitchen to try again.</p>)}
    </>
  );
}

async function ChurchSandwichTiming({ workspace, formulas, timing }: {
  workspace: WorkspaceContextValue;
  formulas: ReturnType<typeof loadChurchSandwichFormulas>;
  timing: ReturnType<typeof loadChurchSandwichTimingRuns>;
}) {
  const [records, signedRecipes] = await Promise.all([timing, formulas]);
  if (!records) return null;
  if (!records.ok) {
    return <p className="my-4 text-sm text-[var(--ink-soft)]">Sandwich timing runs could not be loaded. Reload Kitchen to try again.</p>;
  }
  return <ChurchSandwichTimingPanel key={workspace.activeLocation.id} formulas={signedRecipes?.ok ? signedRecipes.data : []}
    runs={records.data} canRecord={canRecordChurchSandwichTiming(workspace)} />;
}

export default async function KitchenPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/kitchen", resolution.context);
  if (resolution.context.mode === "demo") return <KitchenWorkspace />;
  const ingredientEvidence = loadChurchIngredientEvidence(resolution.context);
  const cateringPrep = loadChurchCateringPrep(resolution.context);
  const sandwichFormulas = loadChurchSandwichFormulas(resolution.context);
  const sandwichPackCosts = loadChurchSandwichPackCosts(resolution.context);
  const sandwichTiming = loadChurchSandwichTimingRuns(resolution.context);
  const sandwichRegisterChecks = loadChurchSandwichRegisterChecks(resolution.context);
  const batchLabels = loadChurchBatchLabels(resolution.context);
  const batchQueue = loadChurchBatchQueue(resolution.context);
  const approvedRecipes = Promise.all([sandwichFormulas, ingredientEvidence]).then(([formulas, evidence]) =>
    formulas?.ok && evidence?.ok ? currentChurchAvailabilityRecipes(formulas.data, evidence.data) : null,
  );
  const [prepResult, inventoryResult] = await Promise.all([
    loadLivePrep(resolution.context),
    loadLiveInventory(resolution.context),
  ]);
  return (
    <>
      <PageFrame width="full" className="max-w-[1400px] pb-0">
        <Suspense fallback={null}><ChurchStaffResources evidence={ingredientEvidence} /></Suspense>
        <Suspense fallback={null}><ChurchCateringPrep data={cateringPrep} approvedRecipes={approvedRecipes} /></Suspense>
        <Suspense fallback={null}><ChurchSupplierEvidence workspace={resolution.context} data={ingredientEvidence} formulas={sandwichFormulas} /></Suspense>
        <Suspense fallback={null}><ChurchBatchLabels workspace={resolution.context} evidence={ingredientEvidence} labels={batchLabels} queue={batchQueue} /></Suspense>
        <Suspense fallback={null}><ChurchSandwichPlanning workspace={resolution.context} evidence={ingredientEvidence} catering={cateringPrep} formulas={sandwichFormulas} registerChecks={sandwichRegisterChecks} packCosts={sandwichPackCosts} /></Suspense>
        <Suspense fallback={null}><ChurchSandwichTiming workspace={resolution.context} formulas={sandwichFormulas} timing={sandwichTiming} /></Suspense>
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
