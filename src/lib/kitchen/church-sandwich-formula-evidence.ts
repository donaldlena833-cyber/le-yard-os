import { churchSandwichBenchRecipes, churchSandwichBread } from "./church-sandwich-bench";
import type { ChurchSandwichFormula } from "./church-sandwich-formula";
import type { ChurchIngredientEvidence } from "./church-sandwich-ingredient-evidence";

export function matchesChurchSandwichFormulaEvidence(
  formula: ChurchSandwichFormula | undefined,
  byIngredient: ReadonlyMap<string, Pick<ChurchIngredientEvidence, "status" | "revision">>,
): boolean {
  if (!formula?.current) return false;
  const recipe = churchSandwichBenchRecipes.find(({ key }) => key === formula.recipeKey);
  if (!recipe) return false;
  return [churchSandwichBread, ...recipe.portions.map(({ ingredient }) => ingredient)].every((ingredient) => {
    const label = byIngredient.get(ingredient);
    return label?.status === "reviewed" && label.revision === formula.measurements[ingredient]?.evidenceRevision;
  });
}
