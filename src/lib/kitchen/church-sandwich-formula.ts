import { z } from "zod";
import {
  churchSandwichBread,
  churchSandwichBenchRecipes,
  churchSandwichComponents,
  churchSandwichRecipeKeys,
} from "./church-sandwich-bench";

const quantity = (maximum: number) => z.number().positive().max(maximum)
  .refine((value) => Math.round(value * 1_000) / 1_000 === value, "Use up to three decimal places.");
const revision = z.number().int().max(2_147_483_647);
const fields = {
  recipeKey: z.enum(churchSandwichRecipeKeys),
  reviewReference: z.string().trim().min(1).max(300).regex(/^[^\p{Cc}\p{Cf}]+$/u),
  measurements: z.partialRecord(z.enum(churchSandwichComponents), z.strictObject({
    quantity: quantity(2_000),
    evidenceRevision: revision.min(1),
    yieldBasis: z.enum(["whole_each", "weighed_usable_grams"]),
    measuredInput: quantity(1_000_000),
    measuredUsable: quantity(1_000_000),
  })),
};
type FormulaFields = z.infer<z.ZodObject<typeof fields>>;

function validFormula({ recipeKey, measurements }: FormulaFields, context: z.RefinementCtx) {
  const required = churchSandwichBenchRecipes.find(({ key }) => key === recipeKey)?.portions.map(({ ingredient }) => ingredient) ?? [];
  const exactIngredients = [churchSandwichBread, ...required];
  if (Object.keys(measurements).length !== exactIngredients.length) {
    context.addIssue({ code: "custom", path: ["measurements"], message: "Enter the exact ingredients for this sandwich." });
  }
  for (const ingredient of exactIngredients) {
    const entry = measurements[ingredient];
    const isBread = ingredient === churchSandwichBread;
    if (!entry || entry.quantity > entry.measuredUsable || entry.measuredUsable > entry.measuredInput ||
      (isBread ? entry.yieldBasis !== "whole_each" || entry.quantity !== 1 ||
        !Number.isInteger(entry.measuredInput) || !Number.isInteger(entry.measuredUsable) : entry.yieldBasis !== "weighed_usable_grams")) {
      context.addIssue({
        code: "custom", path: ["measurements", ingredient], message: "Check the measured quantities and usable yield.",
      });
    }
  }
}

export const saveChurchSandwichFormulaInput = z.strictObject({
  ...fields,
  requestId: z.uuid(),
  expectedRevision: revision.min(0),
}).superRefine(validFormula);

export const churchSandwichFormula = z.object({
  ...fields,
  revision: revision.min(1),
  reviewedAt: z.iso.datetime({ offset: true }),
  reviewerName: z.string().trim().min(1).max(120),
  current: z.boolean(),
}).superRefine(validFormula);

export const churchSandwichFormulaList = z.array(churchSandwichFormula).max(churchSandwichRecipeKeys.length)
  .refine((rows) => new Set(rows.map(({ recipeKey }) => recipeKey)).size === rows.length);

export type ChurchSandwichFormula = z.infer<typeof churchSandwichFormula>;
export type SaveChurchSandwichFormulaInput = z.infer<typeof saveChurchSandwichFormulaInput>;
