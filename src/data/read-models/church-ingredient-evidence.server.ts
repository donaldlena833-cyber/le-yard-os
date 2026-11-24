import "server-only";

import { readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import { appSurface } from "@/lib/app-surface";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchIngredientEvidenceList, type ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { createClient } from "@/lib/supabase/server";

export function canReadChurchIngredientEvidence(workspace: WorkspaceContextValue): boolean {
  return appSurface === "operations" && workspace.mode === "live" &&
    workspace.serviceSettings?.serviceModel === "counter" &&
    hasAnyCapability(workspace.capabilities, ["recipe.manage", "prep.manage", "prep.complete"]);
}

export async function loadChurchIngredientEvidence(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<ChurchIngredientEvidence[]> | null> {
  if (!canReadChurchIngredientEvidence(workspace)) return null;

  const unavailable = "Ingredient evidence could not be loaded.";
  try {
    const client = await createClient();
    // The RPC verifies the exact active Church tenant/location and operator.
    const { data, error } = await client.rpc("list_church_ingredient_evidence", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error?.code === "42501") return null;
    const parsed = churchIngredientEvidenceList.safeParse(data);
    return !error && parsed.success ? readSuccess(parsed.data) : readFailure(unavailable);
  } catch {
    return readFailure(unavailable);
  }
}
