import "server-only";

import { readFailure, readSuccess, type LiveReadResult } from "@/data/read-models/shared";
import { canRequestChurchSquareOrderWindow } from "@/data/read-models/church-square-order-window.server";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchSandwichPackCostList, type ChurchSandwichPackCost } from "@/lib/kitchen/church-sandwich-costing";
import { createClient } from "@/lib/supabase/server";

export function canManageChurchSandwichCosts(workspace: WorkspaceContextValue): boolean {
  return canRequestChurchSquareOrderWindow(workspace) && workspace.capabilities.includes("inventory.price.manage");
}

export async function loadChurchSandwichPackCosts(workspace: WorkspaceContextValue): Promise<LiveReadResult<ChurchSandwichPackCost[]> | null> {
  if (!canManageChurchSandwichCosts(workspace)) return null;
  const unavailable = "Invoice-backed sandwich costs could not be loaded.";
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_church_sandwich_pack_costs", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error?.code === "42501") return null;
    const result = churchSandwichPackCostList.safeParse(data);
    return !error && result.success ? readSuccess(result.data) : readFailure(unavailable);
  } catch {
    return readFailure(unavailable);
  }
}
