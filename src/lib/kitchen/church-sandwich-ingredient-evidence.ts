import { z } from "zod";
import { churchSandwichComponents } from "./church-sandwich-bench";

export const churchIngredientEvidenceStatuses = ["pending", "hold", "reviewed"] as const;
export type ChurchIngredientEvidenceStatus = typeof churchIngredientEvidenceStatuses[number];

export const churchIngredientEvidenceLimits = {
  supplierSku: 120,
  sourceReference: 300,
  allergenNotes: 1_000,
  crossContactNotes: 1_000,
  storageRule: 1_000,
  openedRule: 1_000,
  preppedRule: 1_000,
} as const;

const ingredientKey = z.enum(churchSandwichComponents);
const status = z.enum(churchIngredientEvidenceStatuses);
const revision = z.number().int().max(2_147_483_647);
const instant = z.iso.datetime({ offset: true });
const evidenceField = (maxlength: number) =>
  z.string().trim().max(maxlength).nullable().transform((value) => value || null);

const evidenceFields = {
  supplierSku: evidenceField(churchIngredientEvidenceLimits.supplierSku),
  sourceReference: evidenceField(churchIngredientEvidenceLimits.sourceReference),
  allergenNotes: evidenceField(churchIngredientEvidenceLimits.allergenNotes),
  crossContactNotes: evidenceField(churchIngredientEvidenceLimits.crossContactNotes),
  storageRule: evidenceField(churchIngredientEvidenceLimits.storageRule),
  openedRule: evidenceField(churchIngredientEvidenceLimits.openedRule),
  preppedRule: evidenceField(churchIngredientEvidenceLimits.preppedRule),
};

export const saveChurchIngredientEvidenceInput = z.strictObject({
  ingredientKey,
  status,
  requestId: z.uuid(),
  expectedRevision: revision.min(0),
  ...evidenceFields,
}).superRefine((value, context) => {
  if (value.status !== "reviewed") return;
  for (const key of Object.keys(evidenceFields) as Array<keyof typeof evidenceFields>) {
    if (value[key] === null) context.addIssue({
      code: "custom", path: [key], message: "Record the evidence or explicitly explain why it does not apply.",
    });
  }
});

export const churchIngredientEvidence = z.object({
  ingredientKey,
  status,
  revision: revision.min(1),
  updatedAt: instant,
  reviewedAt: instant.nullable(),
  reviewerName: z.string().trim().min(1).max(120).nullable(),
  ...evidenceFields,
});
export type ChurchIngredientEvidence = z.infer<typeof churchIngredientEvidence>;

export const churchIngredientEvidenceList = z.array(churchIngredientEvidence)
  .max(churchSandwichComponents.length)
  .refine((rows) => new Set(rows.map(({ ingredientKey }) => ingredientKey)).size === rows.length);
