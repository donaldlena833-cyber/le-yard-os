import "server-only";

import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchSandwichRegisterCheckList, type ChurchSandwichRegisterCheck } from "@/lib/kitchen/church-sandwich-register-check";
import { createClient } from "@/lib/supabase/server";

export function canManageChurchSandwichRegisterChecks(workspace: WorkspaceContextValue) {
  return canReadChurchIngredientEvidence(workspace) && workspace.capabilities.includes("recipe.manage");
}

export async function loadChurchSandwichRegisterChecks(workspace: WorkspaceContextValue): Promise<LiveReadResult<ChurchSandwichRegisterCheck[]> | null> {
  if (!canManageChurchSandwichRegisterChecks(workspace)) return null;
  const unavailable = "Church Street register checks could not be loaded.";
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_church_sandwich_register_checks", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error?.code === "42501") return null;
    const checks = churchSandwichRegisterCheckList.safeParse(data);
    return !error && checks.success ? readSuccess(checks.data) : readFailure(unavailable);
  } catch {
    return readFailure(unavailable);
  }
}
