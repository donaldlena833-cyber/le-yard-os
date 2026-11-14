"use server";

import { revalidatePath } from "next/cache";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction } from "@/data/execute";
import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchIngredientEvidence, saveChurchIngredientEvidenceInput } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

export async function saveChurchSandwichIngredientEvidenceAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.ingredient-evidence.save",
    schema: saveChurchIngredientEvidenceInput,
    input,
    run: async (context, evidence) => {
      const session = await resolveWorkspaceSession();
      assertCondition(session.status === "ready" &&
        session.context.identity.userId === context.actor.userId &&
        canReadChurchIngredientEvidence(session.context) &&
        session.context.capabilities.includes("recipe.manage"),
      "forbidden", "Church Street recipe management access is required.");

      const { data, error } = await context.supabase.rpc("save_church_ingredient_evidence", {
        p_request_id: evidence.requestId,
        p_location_id: session.context.activeLocation.id,
        p_ingredient_key: evidence.ingredientKey,
        p_expected_revision: evidence.expectedRevision,
        p_status: evidence.status,
        p_supplier_sku: evidence.supplierSku,
        p_source_reference: evidence.sourceReference,
        p_allergen_notes: evidence.allergenNotes,
        p_cross_contact_notes: evidence.crossContactNotes,
        p_storage_rule: evidence.storageRule,
        p_opened_rule: evidence.openedRule,
        p_prepped_rule: evidence.preppedRule,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "Ingredient evidence could not be saved.");
      const parsed = churchIngredientEvidence.safeParse(data);
      assertCondition(parsed.success, "database", "The saved ingredient evidence could not be loaded.");
      return parsed.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}
