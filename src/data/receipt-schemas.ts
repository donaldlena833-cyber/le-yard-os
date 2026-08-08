import { z } from "zod";

const uuid = z.string().uuid();

export const resolveReceiptDuplicateInputSchema = z
  .object({
    requestId: uuid,
    matchId: uuid,
    resolution: z.enum(["duplicate", "not_duplicate"]),
  })
  .strict();

const receiptReferenceLinkSchema = z
  .object({
    requestId: uuid,
    targetId: uuid,
    receiptId: uuid.nullable(),
  })
  .strict();

export const setExpenseReceiptLinkInputSchema = receiptReferenceLinkSchema;
export const setDeliveryReceiptLinkInputSchema = receiptReferenceLinkSchema;

export const assignReceiptInventoryMatchInputSchema = z
  .object({
    requestId: uuid,
    receiptId: uuid,
    lineKey: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    inventoryItemId: uuid,
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

export type ResolveReceiptDuplicateInput = z.infer<
  typeof resolveReceiptDuplicateInputSchema
>;
export type SetReceiptReferenceLinkInput = z.infer<
  typeof receiptReferenceLinkSchema
>;
export type AssignReceiptInventoryMatchInput = z.infer<
  typeof assignReceiptInventoryMatchInputSchema
>;
