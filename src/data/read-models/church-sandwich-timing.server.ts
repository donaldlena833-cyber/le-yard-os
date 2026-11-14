import "server-only";

import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchSandwichTimingRunList, type ChurchSandwichTimingRun } from "@/lib/kitchen/church-sandwich-timing";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { createClient } from "@/lib/supabase/server";

export function canRecordChurchSandwichTiming(workspace: WorkspaceContextValue) {
  return canReadChurchIngredientEvidence(workspace) &&
    hasAnyCapability(workspace.capabilities, ["recipe.manage", "prep.manage"]);
}

export async function loadChurchSandwichTimingRuns(workspace: WorkspaceContextValue): Promise<LiveReadResult<ChurchSandwichTimingRun[]> | null> {
  if (!canReadChurchIngredientEvidence(workspace)) return null;
  const unavailable = "Church Street timing runs could not be loaded.";
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_church_sandwich_timing_runs", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error?.code === "42501") return null;
    const runs = churchSandwichTimingRunList.safeParse(data);
    return !error && runs.success ? readSuccess(runs.data) : readFailure(unavailable);
  } catch {
    return readFailure(unavailable);
  }
}
