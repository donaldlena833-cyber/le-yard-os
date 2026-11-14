import { z } from "zod";
import { churchSquareResourceId } from "./church-square-order-projection";

export const churchSquarePayoutWindowPath = "/api/workspace/church-square-payouts";
export const churchSquarePayoutWindowDays = 7;
export const churchSquarePayoutWindowLimit = 50;
export const churchSquarePayoutEntryLimit = 50;

export function churchSquarePayoutEntriesPath(reference: string) {
  return `${churchSquarePayoutWindowPath}/${encodeURIComponent(reference)}/entries`;
}

const instant = z.iso.datetime({ offset: true });

export const churchSquarePayoutWindowResponse = z.object({
  checkedAt: instant,
  hasMore: z.boolean(),
  payouts: z.array(z.object({
    reference: churchSquareResourceId,
    status: z.enum(["SENT", "FAILED", "PAID", "UNKNOWN"]),
    amountCents: z.number().int().safe().nullable(),
    createdAt: instant,
    updatedAt: instant.nullable(),
    arrivalDate: z.iso.date().nullable(),
  })).max(churchSquarePayoutWindowLimit),
});

export type ChurchSquarePayoutWindowResponse = z.infer<typeof churchSquarePayoutWindowResponse>;

const optionalCents = z.number().int().safe().nullable();
export const churchSquarePayoutEntry = z.object({
  reference: churchSquareResourceId,
  type: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),
  effectiveAt: instant.nullable(),
  grossCents: optionalCents,
  feeCents: optionalCents,
  netCents: optionalCents,
});

export const churchSquarePayoutEntriesResponse = z.object({
  reference: churchSquareResourceId,
  checkedAt: instant,
  payoutType: z.enum(["BATCH", "SIMPLE", "UNKNOWN"]),
  amountCents: optionalCents,
  hasMore: z.boolean(),
  entries: z.array(churchSquarePayoutEntry).max(churchSquarePayoutEntryLimit),
  netTotalCents: optionalCents,
  differenceCents: optionalCents,
});

export type ChurchSquarePayoutEntriesResponse = z.infer<typeof churchSquarePayoutEntriesResponse>;
