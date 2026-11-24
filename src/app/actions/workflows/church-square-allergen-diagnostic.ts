"use server";

import { z } from "zod";
import { assertCondition } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { readChurchSquareAllergenCatalog } from "@/lib/integrations/church-square-allergen-diagnostic.server";
import { churchSandwichFormulaList } from "@/lib/kitchen/church-sandwich-formula";

async function readAllergenDiagnostic(context: WorkflowContext) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
    && canReadChurchIngredientEvidence(session.context) && session.context.capabilities.includes("recipe.manage"),
  "forbidden", "Church Street recipe management access is required to check the Square catalog.");

  // Use the authenticated Kitchen projection to verify the exact active Church scope before contacting Square.
  const { data, error } = await context.supabase.rpc("list_church_sandwich_formulas", {
    p_location_id: session.context.activeLocation.id,
  }).abortSignal(AbortSignal.timeout(5_000));
  assertCondition(error?.code !== "42501", "forbidden", "Church Street Kitchen access is required.");
  assertCondition(!error && churchSandwichFormulaList.safeParse(data).success,
    "database", "Church Street Kitchen access could not be verified. Try again.");

  return readChurchSquareAllergenCatalog();
}

export async function getChurchSquareAllergenDiagnosticAction() {
  return executeWorkflowAction({
    operation: "church.kitchen.square-allergen-diagnostic",
    schema: z.undefined(),
    input: undefined,
    persists: false,
    run: readAllergenDiagnostic,
  });
}
