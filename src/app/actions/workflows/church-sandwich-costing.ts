"use server";

import { revalidatePath } from "next/cache";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction } from "@/data/execute";
import { canManageChurchSandwichCosts } from "@/data/read-models/church-sandwich-costing.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSandwichPackCost, recordChurchSandwichPackCostInput } from "@/lib/kitchen/church-sandwich-costing";

export async function recordChurchSandwichPackCostAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.sandwich-pack-cost.record",
    schema: recordChurchSandwichPackCostInput,
    input,
    run: async (context, cost) => {
      const session = await resolveWorkspaceSession();
      assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
        && canManageChurchSandwichCosts(session.context),
      "forbidden", "Church Street inventory price and financial reports access is required.");

      const { data, error } = await context.supabase.rpc("record_church_sandwich_pack_cost", {
        p_location_id: session.context.activeLocation.id,
        p_request_id: cost.requestId,
        p_ingredient_key: cost.ingredientKey,
        p_evidence_revision: cost.evidenceRevision,
        p_pack_quantity: cost.packQuantity,
        p_pack_cost_cents: cost.packCostCents,
        p_invoice_date: cost.invoiceDate,
        p_invoice_reference: cost.invoiceReference,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The supplier invoice cost could not be recorded.");
      const parsed = churchSandwichPackCost.safeParse(data);
      assertCondition(parsed.success, "database", "The supplier invoice cost could not be read back.");
      return parsed.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}
