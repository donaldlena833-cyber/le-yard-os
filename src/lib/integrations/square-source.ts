import { z } from "zod";

export const SQUARE_API_VERSION = "2026-09-16" as const;
export const SQUARE_SOURCE_CONTRACT = "square-source-evidence-v1" as const;
const reference = z.string().regex(/^[A-Za-z0-9_-]{1,192}$/);
const instant = z.iso.datetime({ offset: true });
const money = z.object({ amount: z.number().int().safe(), currency: z.string().regex(/^[A-Z]{3}$/) });
const moneyAmounts = z.object({
  total_money: money.optional(), tax_money: money.optional(), discount_money: money.optional(),
  tip_money: money.optional(), service_charge_money: money.optional(),
});
const common = {
  id: reference, location_id: reference, created_at: instant, updated_at: instant,
};
export const squareOrderSchema = z.object({
  ...common, state: z.enum(["OPEN", "COMPLETED", "CANCELED", "DRAFT"]),
  // Square POS-created orders can lack a numeric version. Updated-at remains required.
  version: z.number().int().safe().nonnegative().optional(), closed_at: instant.optional(),
  total_money: money.optional(), total_tax_money: money.optional(), total_discount_money: money.optional(),
  total_tip_money: money.optional(), total_service_charge_money: money.optional(),
  net_amounts: moneyAmounts.optional(), return_amounts: moneyAmounts.optional(),
  tenders: z.array(z.object({ id: reference.optional(), payment_id: reference.optional(),
    type: z.string().max(80), amount_money: money.optional(), tip_money: money.optional(),
  })).max(1000).optional(),
});
export const squarePaymentSchema = z.object({
  ...common, status: z.enum(["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"]),
  order_id: reference.optional(), source_type: z.string().min(1).max(80),
  amount_money: money.optional(), total_money: money.optional(), tip_money: money.optional(), refunded_money: money.optional(),
  approved_money: money.optional(), version_token: z.string().min(1).max(512).optional(),
  is_offline_payment: z.boolean().optional(),
  processing_fee: z.array(z.object({ effective_at: instant.optional(), type: z.string().max(80).optional(),
    amount_money: money,
  })).max(100).optional(),
});
export const squareRefundSchema = z.object({
  ...common, status: z.enum(["PENDING", "COMPLETED", "REJECTED", "FAILED"]),
  payment_id: reference.optional(), order_id: reference.optional(), amount_money: money,
});
export type SquareSourceKind = "order" | "payment" | "refund";
export type SquareSourceFacts = z.infer<typeof squareOrderSchema> | z.infer<typeof squarePaymentSchema> | z.infer<typeof squareRefundSchema>;
export interface SquareSourceSnapshot {
  kind: SquareSourceKind;
  externalId: string;
  sourceUpdatedAt: string;
  objectVersion: number | null;
  facts: SquareSourceFacts;
}

export function parseSquareSource(kind: SquareSourceKind, input: unknown, scope: { locationId: string; currency: string }): SquareSourceSnapshot {
  const facts = kind === "order" ? squareOrderSchema.parse(input)
    : kind === "payment" ? squarePaymentSchema.parse(input) : squareRefundSchema.parse(input);
  if (facts.location_id !== scope.locationId) throw new Error("Square source location does not match the approved mapping.");
  if (Date.parse(facts.updated_at) < Date.parse(facts.created_at)) throw new Error("Square source update predates creation.");
  if ("closed_at" in facts && facts.closed_at && Date.parse(facts.closed_at) < Date.parse(facts.created_at)) throw new Error("Square source closure predates creation.");
  function checkCurrency(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("currency" in value && value.currency !== scope.currency) throw new Error("Square source currency does not match the approved mapping.");
    for (const child of Object.values(value)) checkCurrency(child);
  }
  checkCurrency(facts);
  return { kind, externalId: facts.id, sourceUpdatedAt: facts.updated_at,
    objectVersion: "version" in facts ? facts.version ?? null : null, facts };
}
