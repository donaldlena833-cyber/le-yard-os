import { z } from "zod";
import { churchSandwichRecipeKeys } from "./church-sandwich-bench";

const internalText = (limit: number) => z.string().trim().min(1)
  .refine((value) => Array.from(value).length <= limit && !/[\p{Cc}\p{Cf}]/u.test(value));

const fields = {
  recipeKey: z.enum(churchSandwichRecipeKeys),
  formulaRevision: z.number().int().min(1).max(2_147_483_647),
  squareItemId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  squareCatalogVersion: z.string().regex(/^[1-9][0-9]{0,18}$/),
  outcome: z.enum(["matched", "mismatch", "unavailable"]),
  device: internalText(120),
  reference: internalText(300),
};

export const recordChurchSandwichRegisterCheckInput = z.strictObject({ ...fields, requestId: z.uuid() });
export const churchSandwichRegisterCheck = z.object({
  ...fields,
  id: z.uuid(),
  recordedAt: z.iso.datetime({ offset: true }),
  recordedByName: internalText(120),
});
export const churchSandwichRegisterCheckList = z.array(churchSandwichRegisterCheck)
  .max(churchSandwichRecipeKeys.length)
  .refine((records) => new Set(records.map(({ recipeKey }) => recipeKey)).size === records.length);

export type ChurchSandwichRegisterCheck = z.infer<typeof churchSandwichRegisterCheck>;
