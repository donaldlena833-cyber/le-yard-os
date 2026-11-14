import { z } from "zod";
import { churchSquareResourceId } from "./church-square-order-projection";

export const churchSquarePayoutWindowPath = "/api/workspace/church-square-payouts";
export const churchSquarePayoutWindowDays = 7;
export const churchSquarePayoutWindowLimit = 50;

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
