"use server";

import { revalidatePath } from "next/cache";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction } from "@/data/execute";
import { canManageChurchSandwichRegisterChecks } from "@/data/read-models/church-sandwich-register-check.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { readChurchSquareAllergenCatalog } from "@/lib/integrations/church-square-allergen-diagnostic.server";
import { churchSandwichRegisterCheck, recordChurchSandwichRegisterCheckInput } from "@/lib/kitchen/church-sandwich-register-check";
import { createAdminClient } from "@/lib/supabase/admin";

export async function recordChurchSandwichRegisterCheckAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.sandwich-register-check.record",
    schema: recordChurchSandwichRegisterCheckInput,
    input,
    run: async (context, check) => {
      const session = await resolveWorkspaceSession();
      assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId &&
        canManageChurchSandwichRegisterChecks(session.context),
      "forbidden", "Church Street recipe management access is required.");

      const scope = {
        p_actor_id: context.actor.userId,
        p_location_id: session.context.activeLocation.id,
        p_request_id: check.requestId,
      };
      const database = createAdminClient();
      // Check the exact Church assignment and recover an earlier receipt before the external read.
      const receipt = await database.rpc("get_church_sandwich_register_check_receipt", scope)
        .abortSignal(AbortSignal.timeout(5_000));
      if (receipt.error) throwDatabaseError(receipt.error, "The register check could not be confirmed.");
      if (receipt.data !== null) {
        const previous = churchSandwichRegisterCheck.safeParse(receipt.data);
        assertCondition(previous.success, "database", "The earlier register check could not be confirmed.");
        const recorded = previous.data;
        assertCondition(recorded.id === check.requestId && recorded.recipeKey === check.recipeKey &&
          recorded.formulaRevision === check.formulaRevision && recorded.squareItemId === check.squareItemId &&
          recorded.squareCatalogVersion === check.squareCatalogVersion && recorded.outcome === check.outcome &&
          recorded.device === check.device && recorded.reference === check.reference,
        "stale", "This request already recorded a different register check.");
        return recorded;
      }

      const catalog = await readChurchSquareAllergenCatalog();
      const item = catalog.items.find(({ key }) => key === check.recipeKey);
      assertCondition(item?.status === "matched" && item.itemId === check.squareItemId && item.variationIds.length > 0 &&
        item.catalogVersion === check.squareCatalogVersion,
      "stale", "The Square item or catalog version changed. Reload the catalog and check the register again.");
      assertCondition(check.outcome === "unavailable" || item.allergens.status === "configured" ||
        (item.allergens.status === "empty" && check.outcome !== "matched"),
      "conflict", "A match requires readable Square allergen tags. Refresh the Square catalog before recording this check.");

      const { data, error } = await database.rpc("record_church_sandwich_register_check", {
        ...scope,
        p_recipe_key: check.recipeKey,
        p_formula_revision: check.formulaRevision,
        p_square_item_id: check.squareItemId,
        p_square_catalog_version: check.squareCatalogVersion,
        p_outcome: check.outcome,
        p_device: check.device,
        p_reference: check.reference,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Church Street register check could not be recorded.");
      const recorded = churchSandwichRegisterCheck.safeParse(data);
      assertCondition(recorded.success, "database", "The recorded register check could not be confirmed.");
      return recorded.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}
