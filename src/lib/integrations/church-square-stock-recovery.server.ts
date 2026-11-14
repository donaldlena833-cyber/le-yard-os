import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { churchSquareCountConfiguration } from "./church-square-configuration.server";
import { SquareCountClient } from "./square-counts.server";

const mappingIds = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)).max(200)
  .refine((ids) => new Set(ids).size === ids.length);
const recoveryResult = z.object({ applied: z.number().int().nonnegative(), ignored: z.number().int().nonnegative() });
const rpcTimeoutMs = 5_000;

export async function processChurchSquareStockRecovery(): Promise<void> {
  const configuration = churchSquareCountConfiguration();
  if (!configuration) return;

  let step = "load mappings";
  try {
    const db = createAdminClient();
    const scope = { p_merchant_id: configuration.merchantId, p_square_location_id: configuration.locationId };
    const mappings = await db.rpc("service_list_church_square_stock_mappings", scope)
      .abortSignal(AbortSignal.timeout(rpcTimeoutMs));
    const ids = mappingIds.safeParse(mappings.data);
    if (mappings.error || !ids.success) throw new Error("Could not load Church Street Square mappings.");
    if (ids.data.length === 0) return;

    step = "read Square counts";
    const counts = await new SquareCountClient(configuration).retrieveMappedCurrentCounts(ids.data);
    let result = { applied: 0, ignored: 0 };
    if (counts.length > 0) {
      step = "apply counts";
      const inventory = counts.map(({ variationId, quantity, calculatedAt }) => ({ variationId, quantity, calculatedAt }));
      const saved = await db.rpc("service_reconcile_church_square_stock", { ...scope, p_inventory: inventory })
        .abortSignal(AbortSignal.timeout(rpcTimeoutMs));
      const parsed = recoveryResult.safeParse(saved.data);
      if (saved.error || !parsed.success || parsed.data.applied + parsed.data.ignored !== counts.length) {
        throw new Error("Could not confirm Church Street Square stock reconciliation.");
      }
      result = parsed.data;
    }
    console.info("Church Street Square stock checked.", {
      mapped: ids.data.length, observed: counts.length, ...result,
    });
  } catch {
    console.error("Church Street Square stock check incomplete.", step);
  }
}
