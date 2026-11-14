"use server";

import { z } from "zod";
import { assertCondition, WorkflowError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { canReadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import {
  churchSquareCatalogAllergens,
  type ChurchSquareAllergenDiagnostic,
  type ChurchSquareAllergenDiagnosticItem,
} from "@/lib/integrations/church-square-allergen-diagnostic";
import { churchSquareCountConfiguration } from "@/lib/integrations/church-square-configuration.server";
import { SquareCountClient } from "@/lib/integrations/square-counts.server";
import { churchSandwichBenchRecipes } from "@/lib/kitchen/church-sandwich-bench";
import { churchSandwichFormulaList } from "@/lib/kitchen/church-sandwich-formula";

async function readAllergenDiagnostic(context: WorkflowContext): Promise<ChurchSquareAllergenDiagnostic> {
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

  const config = churchSquareCountConfiguration();
  assertCondition(config, "conflict", "The café’s Square connection is unavailable.");

  try {
    const catalog = await new SquareCountClient(config).verifyChurchSandwichCatalog({ includeAllergens: true });
    const byName = new Map(catalog.map((item) => [item.name, item]));
    if (catalog.length !== churchSandwichBenchRecipes.length || byName.size !== catalog.length) {
      throw new Error("Unexpected Square menu rows.");
    }
    const items = churchSandwichBenchRecipes.map(({ key, name }): ChurchSquareAllergenDiagnosticItem => {
      const item = byName.get(name);
      if (!item) throw new Error("Missing Square menu diagnostic row.");
      if (item.status !== "matched") {
        return { key, name, status: item.status, itemId: null, variationIds: [], allergens: null };
      }

      const allergens = churchSquareCatalogAllergens.safeParse(item.allergens);
      return {
        key, name, status: "matched", itemId: item.itemId,
        variationIds: item.variations.map(({ id }) => id),
        allergens: allergens.success ? allergens.data : { status: "unavailable", standard: [], custom: [] },
      };
    });
    return { checkedAt: new Date().toISOString(), items };
  } catch {
    throw new WorkflowError("conflict", "Square could not verify the café’s sandwich allergen fields. Try again.");
  }
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
