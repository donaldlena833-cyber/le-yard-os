import { z } from "zod";
import { churchSandwichRecipeKeys } from "@/lib/kitchen/church-sandwich-bench";

export const churchSquareOrderWindowPath = "/api/workspace/church-square-orders";
export const churchSquareOrderWindowHours = 24;
export const churchSquareOrderWindowLimit = 50;

const fulfillmentTime = z.iso.datetime({ offset: true }).nullable();
const orderSource = z.enum(["DOORDASH", "UBER_EATS", "GRUBHUB", "SQUARE_ONLINE", "SQUARE_POS", "SQUARE_INVOICES", "UNKNOWN"]);
const orderFulfillment = z.object({
  type: z.enum(["PICKUP", "DELIVERY", "SHIPMENT", "UNKNOWN"]),
  status: z.enum(["PROPOSED", "RESERVED", "PREPARED", "COMPLETED", "CANCELED", "FAILED", "UNKNOWN"]),
  promisedAt: fulfillmentTime,
  readyAt: fulfillmentTime,
  handoffAt: fulfillmentTime,
  completedAt: fulfillmentTime,
  canceledAt: fulfillmentTime,
  rejectedAt: fulfillmentTime,
});

const orderCount = z.number().int().min(0).max(churchSquareOrderWindowLimit);
const sandwichMixReady = z.object({
  status: z.literal("ready"),
  evaluatedOrders: orderCount,
  matchedOrders: orderCount,
  ordersWithoutLines: orderCount,
  ordersWithReturns: orderCount,
  excludedMatchedLines: z.number().int().min(0).max(50_000),
  rows: z.array(z.object({
    recipeKey: z.enum(churchSandwichRecipeKeys),
    source: orderSource,
    units: z.number().int().safe().positive(),
    orders: orderCount.positive(),
  })).max(churchSandwichRecipeKeys.length * orderSource.options.length),
});

export type ChurchSquareSandwichMixReady = z.infer<typeof sandwichMixReady>;

export const churchSquareOrderWindowResponse = z.object({
  checkedAt: z.iso.datetime(),
  hasMore: z.boolean(),
  orders: z.array(z.object({
    reference: z.string().min(1).max(10),
    source: orderSource,
    status: z.enum(["OPEN", "COMPLETED", "CANCELED", "DRAFT", "UNKNOWN"]),
    updatedAt: z.iso.datetime({ offset: true }),
    totalCents: z.number().int().safe().nullable(),
    fulfillments: z.array(orderFulfillment).max(100),
  })).max(churchSquareOrderWindowLimit),
  itemMix: z.discriminatedUnion("status", [sandwichMixReady, z.object({ status: z.literal("unavailable") })]).optional(),
});

export type ChurchSquareOrderWindowResponse = z.infer<typeof churchSquareOrderWindowResponse>;

export const churchSquareDemandHorizons = [15, 30, 60] as const;

function emptyFulfillmentDemand() {
  return {
    pastDue: 0,
    noPromisedTime: 0,
    upcoming: { 15: 0, 30: 0, 60: 0 },
  };
}

export function summarizeChurchSquareFulfillmentDemand({ checkedAt, orders }: ChurchSquareOrderWindowResponse) {
  const demand = { PICKUP: emptyFulfillmentDemand(), DELIVERY: emptyFulfillmentDemand() };
  const checkedAtMs = Date.parse(checkedAt);

  for (const order of orders) {
    if (order.status !== "OPEN") continue;
    for (const fulfillment of order.fulfillments) {
      if (fulfillment.type !== "PICKUP" && fulfillment.type !== "DELIVERY") continue;
      if (fulfillment.status !== "PROPOSED" && fulfillment.status !== "RESERVED" && fulfillment.status !== "PREPARED") continue;
      if (fulfillment.handoffAt || fulfillment.completedAt || fulfillment.canceledAt || fulfillment.rejectedAt) continue;

      const counts = demand[fulfillment.type];
      if (!fulfillment.promisedAt) {
        counts.noPromisedTime += 1;
        continue;
      }

      const minutesUntilPromised = (Date.parse(fulfillment.promisedAt) - checkedAtMs) / 60_000;
      if (minutesUntilPromised < 0) {
        counts.pastDue += 1;
        continue;
      }

      for (const minutes of churchSquareDemandHorizons) {
        if (minutesUntilPromised <= minutes) counts.upcoming[minutes] += 1;
      }
    }
  }

  return demand;
}
