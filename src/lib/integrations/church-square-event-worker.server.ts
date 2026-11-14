import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { churchSquareResourceId, churchSquareResourceKind, ChurchSquareProjectionError } from "./church-square-order-projection";
import { ChurchSquareOrderClient, ChurchSquareOrderReadError, churchSquareOrderConfiguration } from "./church-square-orders.server";

const lease = z.object({
  eventId: churchSquareResourceId,
  eventType: z.string(),
  resourceId: churchSquareResourceId,
  lease: z.uuid(),
});

export async function processChurchSquareReceipts(): Promise<void> {
  const config = churchSquareOrderConfiguration();
  if (!config) return;
  try {
    const db = createAdminClient();
    const scope = { p_merchant_id: config.merchantId, p_square_location_id: config.locationId };
    const claimed = await db.rpc("service_claim_church_square_receipts", scope).abortSignal(AbortSignal.timeout(5_000));
    const batch = z.array(lease).max(6).safeParse(claimed.data);
    if (claimed.error || !batch.success) {
      console.error("Church Street Square receipts could not be claimed.");
      return;
    }
    const square = new ChurchSquareOrderClient(config);
    const outcomes = await Promise.allSettled(batch.data.map(async (receipt) => {
      const completion = { ...scope, p_event_id: receipt.eventId, p_lease: receipt.lease };
      const kind = churchSquareResourceKind.parse(receipt.eventType.split(".", 1)[0]);
      const outcome = await square.get(kind, receipt.resourceId).then(
        (facts) => ({ p_facts: facts }),
        (error: unknown) => ({
          p_failure: error instanceof ChurchSquareProjectionError ? error.code
            : error instanceof ChurchSquareOrderReadError && error.code === "scope_mismatch" ? "scope_mismatch"
              : "square_unavailable",
        }),
      );
      const saved = await db.rpc("service_complete_church_square_receipt", { ...completion, ...outcome })
        .abortSignal(AbortSignal.timeout(5_000));
      if (saved.error) throw new Error("Could not finish a Square receipt.");
    }));
    if (outcomes.some((entry) => entry.status === "rejected")) {
      console.error("One or more Church Street Square receipts could not be finalized.");
    }
  } catch {
    console.error("Church Street Square receipt processing is unavailable.");
  }
}
