import { z } from "zod";

export const churchSquareClosePreviewPath = "/api/workspace/church-square-close-preview";
export const churchSquareClosePreviewDateCount = 7;

const count = z.number().int().nonnegative().safe();
const coverage = z.enum(["complete", "partial", "unavailable"]);

export const churchSquareClosePreviewResponse = z.object({
  date: z.iso.date(),
  checkedAt: z.iso.datetime({ offset: true }),
  window: z.object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    dayEnded: z.boolean(),
  }),
  payments: z.object({
    coverage, observed: count, completed: count, unresolved: count, offline: count,
    missingTotal: count, missingOrder: count, totalCents: count.nullable(), tipCents: count.nullable(),
  }),
  refunds: z.object({
    coverage, observed: count, completed: count, unresolved: count,
    withoutPaymentReference: count, paymentOutsideRead: count, amountCents: count.nullable(),
  }),
  netActivityCents: z.number().int().safe().nullable(),
});

export type ChurchSquareClosePreviewSnapshot = z.infer<typeof churchSquareClosePreviewResponse>;
