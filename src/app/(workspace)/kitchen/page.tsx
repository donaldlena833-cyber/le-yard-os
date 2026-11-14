import type { Metadata } from "next";
import { Suspense } from "react";
import { ChurchCateringPrep } from "@/components/kitchen/church-catering-prep";
import { ChurchSandwichAvailabilityPanel } from "@/components/kitchen/church-sandwich-availability-panel";
import { ChurchSandwichRecipeApprovalPanel } from "@/components/kitchen/church-sandwich-recipe-approval-panel";
import { ChurchSquareAllergenPanel } from "@/components/kitchen/church-square-allergen-panel";
import { ChurchSupplierEvidencePanel } from "@/components/kitchen/church-supplier-evidence-panel";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import { LivePrepWorkspace } from "@/components/prep/live-prep-workspace";
import { PageFrame } from "@/components/ui/page-frame";
import { loadLiveInventory } from "@/data/read-models/inventory";
import { loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { loadChurchCateringPrep } from "@/data/read-models/church-catering-prep.server";
import { buildChurchSandwichAvailability } from "@/data/read-models/church-sandwich-availability.server";
import { loadChurchSandwichFormulas } from "@/data/read-models/church-sandwich-formula.server";
import { loadLivePrep } from "@/data/read-models/prep";
import { type WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Kitchen" };

async function ChurchSupplierEvidence({ workspace, data }: {
  workspace: WorkspaceContextValue;
  data: ReturnType<typeof loadChurchIngredientEvidence>;
}) {
  const result = await data;
  if (!result) return null;
  if (!result.ok) return <p className="my-4 text-sm text-[var(--ink-soft)]">Supplier evidence could not be loaded. Reload Kitchen to try again.</p>;

  return <ChurchSupplierEvidencePanel key={workspace.activeLocation.id} initialRows={result.data} canManage={workspace.capabilities.includes("recipe.manage")} />;
}

async function ChurchSandwichPlanning({ workspace, evidence, catering, formulas }: {
  workspace: WorkspaceContextValue;
  evidence: ReturnType<typeof loadChurchIngredientEvidence>;
  catering: ReturnType<typeof loadChurchCateringPrep>;
  formulas: ReturnType<typeof loadChurchSandwichFormulas>;
}) {
  const [ingredientEvidenceResult, cateringPrepResult, formulaResult] = await Promise.all([evidence, catering, formulas]);
  const availability = buildChurchSandwichAvailability(workspace, { ingredientEvidenceResult, cateringPrepResult, formulaResult });
  const location = workspace.activeLocation.id;
  const canManage = workspace.capabilities.includes("recipe.manage");
  return (
    <>
      {formulaResult?.ok && ingredientEvidenceResult?.ok && (
        <ChurchSandwichRecipeApprovalPanel key={location} evidence={ingredientEvidenceResult.data}
          formulas={formulaResult.data} canManage={canManage} />
      )}
      {canManage && formulaResult?.ok && ingredientEvidenceResult?.ok && (
        <ChurchSquareAllergenPanel key={location} evidence={ingredientEvidenceResult.data} formulas={formulaResult.data} />
      )}
      {availability && (availability.ok ? (
        <ChurchSandwichAvailabilityPanel key={`${location}:${availability.data.serviceDate}`} {...availability.data} />
      ) : <p className="my-4 text-sm text-[var(--ink-soft)]">Sandwich availability could not be loaded. Reload Kitchen to try again.</p>)}
    </>
  );
}

export default async function KitchenPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/kitchen", resolution.context);
  if (resolution.context.mode === "demo") return <KitchenWorkspace />;
  const ingredientEvidence = loadChurchIngredientEvidence(resolution.context);
  const cateringPrep = loadChurchCateringPrep(resolution.context);
  const sandwichFormulas = loadChurchSandwichFormulas(resolution.context);
  const [prepResult, inventoryResult] = await Promise.all([
    loadLivePrep(resolution.context),
    loadLiveInventory(resolution.context),
  ]);
  return (
    <>
      <PageFrame width="full" className="max-w-[1400px] pb-0">
        <Suspense fallback={null}><ChurchCateringPrep data={cateringPrep} /></Suspense>
        <Suspense fallback={null}><ChurchSupplierEvidence workspace={resolution.context} data={ingredientEvidence} /></Suspense>
        <Suspense fallback={null}><ChurchSandwichPlanning workspace={resolution.context} evidence={ingredientEvidence} catering={cateringPrep} formulas={sandwichFormulas} /></Suspense>
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
