import type { ChurchSquareOrderWindowResponse } from "./church-square-order-window";

type Order = ChurchSquareOrderWindowResponse["orders"][number];
type Fulfillment = Order["fulfillments"][number];

const sources = [
  "SQUARE_POS", "SQUARE_ONLINE", "DOORDASH", "UBER_EATS", "GRUBHUB", "SQUARE_INVOICES", "UNKNOWN",
] as const satisfies readonly Order["source"][];

const orderStatusCount = {
  COMPLETED: "completed",
  CANCELED: "canceled",
  OPEN: "open",
  DRAFT: "draft",
  UNKNOWN: "unknownStatus",
} as const satisfies Record<Order["status"], string>;

type TimingCounts = { fulfillmentCount: number; comparable: number; byTarget: number };

export type ChurchSquareSourceSummary = Record<typeof orderStatusCount[Order["status"]], number> & {
  source: Order["source"];
  orderCount: number;
  rejectedOrders: number;
  pickup: TimingCounts;
  delivery: TimingCounts;
};

function emptyTiming(): TimingCounts {
  return { fulfillmentCount: 0, comparable: 0, byTarget: 0 };
}

function countTiming(counts: TimingCounts, fulfillment: Fulfillment, checkedAtMs: number) {
  counts.fulfillmentCount += 1;
  if (!fulfillment.promisedAt || !fulfillment.handoffAt || fulfillment.rejectedAt || fulfillment.canceledAt
    || fulfillment.status === "FAILED" || fulfillment.status === "CANCELED") return;

  const target = Date.parse(fulfillment.promisedAt);
  const handoff = Date.parse(fulfillment.handoffAt);
  if (!Number.isFinite(target) || !(handoff <= checkedAtMs)) return;

  counts.comparable += 1;
  if (handoff <= target) counts.byTarget += 1;
}

/** Summarize the returned orders and their current Square-reported source within this bounded sample. */
export function summarizeChurchSquareSources({ checkedAt, orders }: ChurchSquareOrderWindowResponse): ChurchSquareSourceSummary[] {
  const bySource = new Map<Order["source"], ChurchSquareSourceSummary>();
  const checkedAtMs = Date.parse(checkedAt);

  for (const order of orders) {
    let row = bySource.get(order.source);
    if (!row) {
      row = {
        source: order.source,
        orderCount: 0, completed: 0, canceled: 0, open: 0, draft: 0, unknownStatus: 0, rejectedOrders: 0,
        pickup: emptyTiming(), delivery: emptyTiming(),
      };
      bySource.set(order.source, row);
    }

    row.orderCount += 1;
    row[orderStatusCount[order.status]] += 1;
    if (order.fulfillments.some(({ rejectedAt }) => rejectedAt !== null)) row.rejectedOrders += 1;

    for (const fulfillment of order.fulfillments) {
      if (fulfillment.type === "PICKUP") countTiming(row.pickup, fulfillment, checkedAtMs);
      if (fulfillment.type === "DELIVERY") countTiming(row.delivery, fulfillment, checkedAtMs);
    }
  }

  return sources.flatMap((source) => {
    const row = bySource.get(source);
    return row ? [row] : [];
  });
}
