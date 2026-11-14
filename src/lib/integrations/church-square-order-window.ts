import { z } from "zod";

export const churchSquareOrderWindowPath = "/api/workspace/church-square-orders";
export const churchSquareOrderWindowHours = 24;
export const churchSquareOrderWindowLimit = 50;

export const churchSquareOrderWindowResponse = z.object({
  checkedAt: z.iso.datetime(),
  hasMore: z.boolean(),
  orders: z.array(z.object({
    reference: z.string().min(1).max(10),
    source: z.enum(["DOORDASH", "UBER_EATS", "GRUBHUB", "SQUARE_ONLINE", "SQUARE_POS", "SQUARE_INVOICES", "UNKNOWN"]),
    status: z.enum(["OPEN", "COMPLETED", "CANCELED", "DRAFT", "UNKNOWN"]),
    updatedAt: z.iso.datetime({ offset: true }),
    totalCents: z.number().int().safe().nullable(),
  })).max(churchSquareOrderWindowLimit),
});

export type ChurchSquareOrderWindowResponse = z.infer<typeof churchSquareOrderWindowResponse>;
