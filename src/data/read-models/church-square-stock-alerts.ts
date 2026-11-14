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

export async function readChurchSquareStockAlerts(locationId: string) {
  const client = await createClient();
  const { data, error } = await client.rpc("list_church_square_stock_alerts", { p_location_id: locationId });
  if (error?.code === "42501") return { status: "denied" } as const;
  if (error) return { status: "unavailable" } as const;
  const result = z.array(alertSchema).safeParse(data);
  return result.success
    ? { status: "ready", alerts: result.data } as const
    : { status: "unavailable" } as const;
}

export const loadChurchSquareStockAlerts = cache(async (locationId: string): Promise<ChurchSquareStockAlert[] | null> => {
  const result = await readChurchSquareStockAlerts(locationId);
  return result.status === "ready" ? result.alerts : null;
});
