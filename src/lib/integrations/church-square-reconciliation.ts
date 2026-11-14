import { z } from "zod";

export const churchSquareReconciliationPath = "/api/workspace/church-square-reconciliation";

const reference = z.string().regex(/^[A-Za-z0-9_:-]{1,10}$/);
const amount = z.number().int().safe().nullable();

export const churchSquareReconciliationResponse = z.object({
  pending: z.number().int().nonnegative().safe(),
  needsReview: z.number().int().nonnegative().safe(),
  orderCoverageThrough: z.iso.datetime({ offset: true }).nullable().optional(),
  resources: z.array(z.object({
    kind: z.enum(["order", "payment", "refund", "invoice"]),
    reference,
    orderReference: reference.nullable(),
    status: z.string().regex(/^[A-Z][A-Z0-9_]{0,49}$/).nullable(),
    amountCents: amount,
    depositState: z.enum(["not_requested", "unknown", "unpaid", "partial", "satisfied", "review_required"]).nullable(),
    depositDueCents: amount,
    depositCompletedCents: amount,
    serviceDate: z.iso.date().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })).max(30),
});

export type ChurchSquareReconciliationResponse = z.infer<typeof churchSquareReconciliationResponse>;
