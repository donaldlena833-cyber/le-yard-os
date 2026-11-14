import "server-only";

import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchBatchLabelList, type ChurchBatchLabel } from "@/lib/kitchen/church-ingredient-batches";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { createClient } from "@/lib/supabase/server";

export function canRecordChurchBatchLabels(workspace: WorkspaceContextValue): boolean {
  return canReadChurchIngredientEvidence(workspace) &&
    hasAnyCapability(workspace.capabilities, ["recipe.manage", "prep.manage"]);
}

export async function loadChurchBatchLabels(workspace: WorkspaceContextValue): Promise<LiveReadResult<ChurchBatchLabel[]> | null> {
  if (!canReadChurchIngredientEvidence(workspace)) return null;
  const unavailable = "Church Street batch labels could not be loaded.";
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_church_ingredient_batches", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error?.code === "42501") return null;
    const labels = churchBatchLabelList.safeParse(data);
    return !error && labels.success ? readSuccess(labels.data) : readFailure(unavailable);
  } catch {
    return readFailure(unavailable);
  }
}
