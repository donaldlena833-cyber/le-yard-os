import "server-only";

import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchSandwichFormulaList, type ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import { createClient } from "@/lib/supabase/server";

export async function loadChurchSandwichFormulas(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<ChurchSandwichFormula[]> | null> {
  if (!canReadChurchIngredientEvidence(workspace)) return null;

  const unavailable = "Sandwich recipe approvals could not be loaded.";
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_church_sandwich_formulas", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error?.code === "42501") return null;
    const parsed = churchSandwichFormulaList.safeParse(data);
    return !error && parsed.success ? readSuccess(parsed.data) : readFailure(unavailable);
  } catch {
    return readFailure(unavailable);
  }
}
