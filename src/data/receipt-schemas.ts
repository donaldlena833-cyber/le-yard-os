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

export type ResolveReceiptDuplicateInput = z.infer<
  typeof resolveReceiptDuplicateInputSchema
>;
export type SetReceiptReferenceLinkInput = z.infer<
  typeof receiptReferenceLinkSchema
>;
