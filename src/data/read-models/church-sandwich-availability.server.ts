import "server-only";

import type { loadChurchCateringPrep } from "@/data/read-models/church-catering-prep.server";
import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { localDateKey, readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import type { ChurchAvailabilityEvidence, ChurchAvailabilityRecipe } from "@/lib/kitchen/church-sandwich-availability";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type AvailabilityInputs = {
  ingredientEvidenceResult: LiveReadResult<ChurchIngredientEvidence[]> | null;
  cateringPrepResult: Awaited<ReturnType<typeof loadChurchCateringPrep>>;
};

export type ChurchSandwichAvailabilityData = {
  evidence: ChurchAvailabilityEvidence;
  approvedRecipes: ChurchAvailabilityRecipe[];
  catering: ChurchCateringPrepDay | null;
  serviceDate: string;
};

export function buildChurchSandwichAvailability(
  workspace: WorkspaceContextValue,
  { ingredientEvidenceResult, cateringPrepResult }: AvailabilityInputs,
): LiveReadResult<ChurchSandwichAvailabilityData> | null {
  if (!canReadChurchIngredientEvidence(workspace) || !ingredientEvidenceResult || !cateringPrepResult) return null;
  // Both readers return null outside the exact Church Street scope. One successful read
  // confirms that scope even if the other fails transiently.
  if (!ingredientEvidenceResult.ok && cateringPrepResult.state === "unavailable") return null;
  if (!ingredientEvidenceResult.ok || cateringPrepResult.state !== "ready") {
    return readFailure("Sandwich availability could not be loaded. Reload Kitchen to try again.");
  }

  const serviceDate = localDateKey(new Date(), "America/New_York");
  return readSuccess({
    evidence: Object.fromEntries(ingredientEvidenceResult.data.map(({ ingredientKey, status }) => [ingredientKey, status])),
    // Catalog activation and prep completion do not attest to a recipe's measured usable portions.
    approvedRecipes: [],
    catering: cateringPrepResult.days.find((day) => day.serviceDate === serviceDate) ?? null,
    serviceDate,
  });
}
