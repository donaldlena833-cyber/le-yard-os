import { z } from "zod";

export const churchSquareOrderWatchPath = "/api/workspace/church-square-order-watch";
export const churchSquareOrderWatchLimit = 50;

const timestamp = z.iso.datetime({ offset: true });
const activeFulfillment = z.object({
  type: z.enum(["PICKUP", "DELIVERY"]),
  status: z.enum(["PROPOSED", "RESERVED", "PREPARED"]),
  promisedAt: timestamp.nullable(),
  readyAt: timestamp.nullable(),
  handoffAt: z.null(),
  completedAt: z.null(),
  canceledAt: z.null(),
  rejectedAt: z.null(),
});

export const churchSquareOrderWatchResponse = z.object({
  checkedAt: timestamp,
  orderCoverageThrough: timestamp.nullable(),
  hasMore: z.boolean(),
  orders: z.array(z.object({
    reference: z.string().regex(/^[A-Za-z0-9_:-]{1,10}$/),
    source: z.enum(["DOORDASH", "UBER_EATS", "GRUBHUB", "SQUARE_ONLINE", "SQUARE_POS", "SQUARE_INVOICES", "UNKNOWN"]),
    status: z.literal("OPEN"),
    updatedAt: timestamp,
    fulfillments: z.array(activeFulfillment).min(1).max(100),
  })).max(churchSquareOrderWatchLimit),
});

export type ChurchSquareOrderWatch = z.infer<typeof churchSquareOrderWatchResponse>;
