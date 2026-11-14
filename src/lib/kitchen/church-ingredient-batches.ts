import { z } from "zod";
import { churchSandwichComponents } from "./church-sandwich-bench";

const ingredientKey = z.enum(churchSandwichComponents);
const evidenceRevision = z.number().int().min(1).max(2_147_483_647);
const handledAs = z.enum(["opened", "prepped"]);
const instant = z.iso.datetime({ offset: true });
const identifier = z.string().trim().min(1).max(120).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const postgresText = (maximum: number) => z.string().min(1).refine((value) => Array.from(value).length <= maximum);

export const recordChurchIngredientBatchInput = z.strictObject({
  requestId: z.uuid(),
  ingredientKey,
  evidenceRevision,
  supplierLot: identifier,
  batchCode: identifier,
  handledAs,
  handledAt: instant,
  discardAt: instant,
}).refine(({ handledAt, discardAt }) => Date.parse(discardAt) > Date.parse(handledAt), {
  path: ["discardAt"], message: "Discard time must follow the opened or prepped time.",
});

export const voidChurchIngredientBatchInput = z.strictObject({
  requestId: z.uuid(),
  batchId: z.uuid(),
  reason: z.string().trim().min(1).max(240).regex(/^[^\p{Cc}\p{Cf}]+$/u),
});

export const churchBatchLabel = z.object({
  id: z.uuid(),
  ingredientKey,
  evidenceRevision,
  supplierSku: postgresText(120),
  supplierLot: postgresText(120),
  batchCode: postgresText(120),
  handledAs,
  handledAt: instant,
  discardAt: instant,
  handlingRule: postgresText(1_000),
  storageRule: postgresText(1_000),
  recordedAt: instant,
  recordedByName: postgresText(120),
  evidenceCurrent: z.boolean(),
  voidedAt: instant.nullable(),
  voidReason: postgresText(240).nullable(),
}).refine(({ voidedAt, voidReason }) => Boolean(voidedAt) === Boolean(voidReason));

export const churchBatchLabelList = z.array(churchBatchLabel).max(50)
  .refine((records) => new Set(records.map(({ id }) => id)).size === records.length);
export type ChurchBatchLabel = z.infer<typeof churchBatchLabel>;
