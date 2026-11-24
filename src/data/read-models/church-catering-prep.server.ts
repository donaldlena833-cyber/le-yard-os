import "server-only";

import { appSurface } from "@/lib/app-surface";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchCateringPrepDays, type ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { createClient } from "@/lib/supabase/server";

type PrepRead = { state: "ready"; days: ChurchCateringPrepDay[] } | { state: "unavailable" } | null;

export async function loadChurchCateringPrep(workspace: WorkspaceContextValue): Promise<PrepRead> {
  if (appSurface !== "operations" || workspace.mode !== "live" || workspace.serviceSettings?.serviceModel !== "counter"
    || !hasAnyCapability(workspace.capabilities, ["prep.manage", "prep.complete", "recipe.manage"])) return null;

  try {
    const client = await createClient();
    const result = await client.rpc("list_church_catering_prep", {
      p_location_id: workspace.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (result.error?.code === "42501") return null;
    const parsed = churchCateringPrepDays.safeParse(result.data);
    if (result.error || !parsed.success) return { state: "unavailable" };
    return { state: "ready", days: parsed.data };
  } catch {
    return { state: "unavailable" };
  }
}
