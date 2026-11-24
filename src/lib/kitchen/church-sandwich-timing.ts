import { z } from "zod";
import { churchSandwichRecipeKeys } from "./church-sandwich-bench";

const seconds = z.number().int().min(0).max(43_200);
const plainText = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const timingFields = {
  recipeKey: z.enum(churchSandwichRecipeKeys),
  formulaRevision: z.number().int().min(1).max(2_147_483_647).nullable(),
  attempted: z.number().int().min(1).max(200),
  accepted: z.number().int().min(0).max(200),
  crewSize: z.number().int().min(1).max(12),
  prepSeconds: seconds.nullable(),
  buildSeconds: seconds.min(1),
  packSeconds: seconds.nullable(),
  reference: plainText(300),
  note: plainText(500).nullable(),
};
const validCounts = ({ attempted, accepted }: { attempted: number; accepted: number }) => accepted <= attempted;

export const recordChurchSandwichTimingRunInput = z.strictObject({ ...timingFields, requestId: z.uuid() })
  .refine(validCounts, { path: ["accepted"], message: "Accepted sandwiches cannot exceed attempts." });

export const churchSandwichTimingRun = z.object({
  ...timingFields,
  id: z.uuid(),
  recordedAt: z.iso.datetime({ offset: true }),
  recordedByName: z.string().min(1).max(240),
}).refine(validCounts);

export const churchSandwichTimingRunList = z.array(churchSandwichTimingRun).max(30);
export type ChurchSandwichTimingRun = z.infer<typeof churchSandwichTimingRun>;
