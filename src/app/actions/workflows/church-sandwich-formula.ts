"use server";

import { revalidatePath } from "next/cache";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction } from "@/data/execute";
import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSandwichFormula, saveChurchSandwichFormulaInput } from "@/lib/kitchen/church-sandwich-formula";

export async function saveChurchSandwichFormulaAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.sandwich-formula.save",
    schema: saveChurchSandwichFormulaInput,
    input,
    run: async (context, formula) => {
      const session = await resolveWorkspaceSession();
      assertCondition(session.status === "ready" &&
        session.context.identity.userId === context.actor.userId &&
        canReadChurchIngredientEvidence(session.context) &&
        session.context.capabilities.includes("recipe.manage"),
      "forbidden", "Church Street recipe management access is required.");

      const { data, error } = await context.supabase.rpc("save_church_sandwich_formula", {
        p_request_id: formula.requestId,
        p_location_id: session.context.activeLocation.id,
        p_recipe_key: formula.recipeKey,
        p_expected_revision: formula.expectedRevision,
        p_measurements: formula.measurements,
        p_review_reference: formula.reviewReference,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "Sandwich recipe approval could not be saved.");
      const parsed = churchSandwichFormula.safeParse(data);
      assertCondition(parsed.success, "database", "The signed sandwich recipe could not be loaded.");
      return parsed.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}
