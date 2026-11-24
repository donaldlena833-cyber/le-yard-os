import "server-only";

import { assertCondition, WorkflowError } from "@/data/errors";
import {
  churchSquareCatalogAllergens,
  type ChurchSquareAllergenDiagnostic,
  type ChurchSquareAllergenDiagnosticItem,
} from "@/lib/integrations/church-square-allergen-diagnostic";
import { churchSquareCountConfiguration } from "@/lib/integrations/church-square-configuration.server";
import { SquareCountClient } from "@/lib/integrations/square-counts.server";
import { churchSandwichBenchRecipes } from "@/lib/kitchen/church-sandwich-bench";

export async function readChurchSquareAllergenCatalog(): Promise<ChurchSquareAllergenDiagnostic> {
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
        catalogVersion: item.catalogVersion ?? null,
        variationIds: item.variations.map(({ id }) => id),
        allergens: allergens.success ? allergens.data : { status: "unavailable", standard: [], custom: [] },
      };
    });
    return { checkedAt: new Date().toISOString(), items };
  } catch {
    throw new WorkflowError("conflict", "Square could not verify the café’s sandwich allergen fields. Try again.");
  }
}
