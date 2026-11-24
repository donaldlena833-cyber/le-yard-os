import { z } from "zod";
import { churchBatchLabelList, churchBatchQueue } from "@/lib/kitchen/church-ingredient-batches";
import { churchIngredientEvidenceList } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

export const churchBatchBoardPath = "/api/workspace/church-kitchen-batches";
export const churchBatchBoardScopeHeader = "X-Church-Batch-Scope";

export const churchBatchBoardResponse = z.object({
  organizationId: z.uuid(),
  locationId: z.uuid(),
  userId: z.uuid(),
  checkedAt: z.iso.datetime({ offset: true }),
  evidence: churchIngredientEvidenceList,
  records: churchBatchLabelList,
  queue: churchBatchQueue,
});

export type ChurchBatchBoardSnapshot = z.infer<typeof churchBatchBoardResponse>;

export type ChurchBatchBoardScope = Pick<ChurchBatchBoardSnapshot, "organizationId" | "locationId" | "userId">;

export function churchBatchBoardScopeValue({ organizationId, locationId, userId }: ChurchBatchBoardScope) {
  return `${organizationId}:${locationId}:${userId}`;
}
