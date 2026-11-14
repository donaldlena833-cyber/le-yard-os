import "server-only";

import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { appSurface } from "@/lib/app-surface";
import { isSquareStockLow } from "@/lib/integrations/square-stock-alerts";

const alertSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  quantity: z.string().max(32).refine(isSquareStockLow),
  calculatedAt: z.iso.datetime({ offset: true }),
  episode: z.uuid(),
});

export type ChurchSquareStockAlert = z.infer<typeof alertSchema>;

export function canViewChurchSquareStockAlerts(workspace: WorkspaceContextValue): boolean {
  return appSurface === "operations" && workspace.mode === "live"
    && workspace.serviceSettings?.serviceModel === "counter"
    && (workspace.role === "owner" || workspace.role === "admin" || workspace.role === "manager"
      || workspace.capabilities.includes("inventory.count.create"));
}

export const loadChurchSquareStockAlerts = cache(async (locationId: string): Promise<ChurchSquareStockAlert[] | null> => {
  const client = await createClient();
  const { data, error } = await client.rpc("list_church_square_stock_alerts", { p_location_id: locationId });
  if (error) return null;
  const result = z.array(alertSchema).safeParse(data);
  return result.success ? result.data : null;
});
