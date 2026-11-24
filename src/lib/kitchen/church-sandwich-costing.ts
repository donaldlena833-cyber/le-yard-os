import { z } from "zod";
import { churchSandwichBenchRecipes, churchSandwichBread, churchSandwichComponents } from "./church-sandwich-bench";
import type { ChurchSandwichFormula } from "./church-sandwich-formula";
import { matchesChurchSandwichFormulaEvidence } from "./church-sandwich-formula-evidence";
import type { ChurchIngredientEvidence } from "./church-sandwich-ingredient-evidence";

const costInputs = {
  ingredientKey: z.enum(churchSandwichComponents),
  evidenceRevision: z.number().int().min(1).max(2_147_483_647),
  packQuantity: z.number().positive().max(1_000_000).refine(value => Math.round(value * 1000) / 1000 === value),
  packCostCents: z.number().int().min(1).max(100_000_000),
  invoiceDate: z.iso.date(),
  invoiceReference: z.string().trim().min(1).regex(/^[^\p{Cc}\p{Cf}]+$/u).refine(value => Array.from(value).length <= 160),
};
const wholeBread = ({ ingredientKey, packQuantity }: { ingredientKey: string; packQuantity: number }) =>
  ingredientKey !== churchSandwichBread || Number.isInteger(packQuantity);

export const recordChurchSandwichPackCostInput = z.strictObject({ ...costInputs, requestId: z.uuid() })
  .refine(wholeBread, { path: ["packQuantity"], message: "Use a whole count for baguettes." });
export const churchSandwichPackCost = z.object({
  ...costInputs,
  invoiceReference: z.string().min(1).refine(value => Array.from(value).length <= 160)
    .transform(value => value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim() || "Reference unavailable"),
  supplierSku: z.string().trim().min(1).max(120),
  recordedAt: z.iso.datetime({ offset: true }),
}).refine(wholeBread, { path: ["packQuantity"] });
export const churchSandwichPackCostList = z.array(churchSandwichPackCost).max(churchSandwichComponents.length)
  .refine(rows => new Set(rows.map(row => row.ingredientKey)).size === rows.length);
export type ChurchSandwichPackCost = z.infer<typeof churchSandwichPackCost>;

type SandwichCost = {
  key: ChurchSandwichFormula["recipeKey"];
  name: string;
  status: "needs_recipe" | "needs_costs" | "costed" | "unavailable";
  missingIngredients: string[];
  totalCents: number | null;
};

export function summarizeChurchSandwichCosts(
  formulas: readonly ChurchSandwichFormula[], evidence: readonly ChurchIngredientEvidence[], costs: readonly ChurchSandwichPackCost[],
): SandwichCost[] {
  const currentEvidence = new Map(evidence.map(row => [row.ingredientKey, row]));
  const costsByIngredient = new Map(costs.map(row => [row.ingredientKey, row]));
  const recipes = new Map(formulas.map(formula => [formula.recipeKey, formula]));
  // Multiply every term as an exact rational in thousandths of a gram or unit.
  // Round once, after the ingredients are combined, even near a half-cent.
  const milli = (value: number) => BigInt(Math.round(value * 1000));
  return churchSandwichBenchRecipes.map(({ key, name, portions }) => {
    const formula = recipes.get(key);
    const missingIngredients: string[] = [];
    if (!formula || !matchesChurchSandwichFormulaEvidence(formula, currentEvidence)) {
      return { key, name, status: "needs_recipe", missingIngredients, totalCents: null };
    }
    let numerator = BigInt(0);
    let denominator = BigInt(1);
    for (const ingredient of [churchSandwichBread, ...portions.map(({ ingredient }) => ingredient)]) {
      const measurement = formula.measurements[ingredient];
      const cost = costsByIngredient.get(ingredient);
      const label = currentEvidence.get(ingredient);
      if (!measurement || !cost || cost.evidenceRevision !== measurement.evidenceRevision || cost.supplierSku !== label?.supplierSku) {
        missingIngredients.push(ingredient);
        continue;
      }
      const ingredientNumerator = BigInt(cost.packCostCents) * milli(measurement.quantity) * milli(measurement.measuredInput);
      const ingredientDenominator = milli(cost.packQuantity) * milli(measurement.measuredUsable);
      numerator = numerator * ingredientDenominator + ingredientNumerator * denominator;
      denominator *= ingredientDenominator;
    }
    if (missingIngredients.length) return { key, name, status: "needs_costs", missingIngredients, totalCents: null };
    const roundedCents = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
    if (roundedCents > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { key, name, status: "unavailable", missingIngredients, totalCents: null };
    }
    return { key, name, status: "costed", missingIngredients, totalCents: Number(roundedCents) };
  });
}
