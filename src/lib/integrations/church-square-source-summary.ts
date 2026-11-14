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
export const churchSquareReadySampleMinimum = { median: 5, p90: 10 } as const;

type ReadySample = {
  asapCount: number;
  scheduledCount: number;
  unknownScheduleCount: number;
  acceptedToReadyMs: number[];
  targetComparable: number;
  readyByTarget: number;
};

function emptyReadySample(): ReadySample {
  return {
    asapCount: 0, scheduledCount: 0, unknownScheduleCount: 0, acceptedToReadyMs: [],
    targetComparable: 0, readyByTarget: 0,
  };
}

function countReadiness(sample: ReadySample, fulfillment: Fulfillment, checkedAtMs: number) {
  if ((fulfillment.status !== "PREPARED" && fulfillment.status !== "COMPLETED")
    || fulfillment.rejectedAt || fulfillment.canceledAt) return;

  if (fulfillment.scheduleType === "ASAP") sample.asapCount += 1;
  else if (fulfillment.scheduleType === "SCHEDULED") sample.scheduledCount += 1;
  else sample.unknownScheduleCount += 1;

  const ready = Date.parse(fulfillment.readyAt ?? "");
  if (!(ready <= checkedAtMs)) return;
  const placed = Date.parse(fulfillment.placedAt ?? "");
  const accepted = Date.parse(fulfillment.acceptedAt ?? "");
  const handoff = Date.parse(fulfillment.handoffAt ?? "");
  const completed = Date.parse(fulfillment.completedAt ?? "");
  if (placed > ready || ready > handoff || ready > completed) return;

  if (fulfillment.scheduleType === "ASAP" && accepted <= ready && !(accepted < placed)) {
    sample.acceptedToReadyMs.push(ready - accepted);
  }

  const target = Date.parse((fulfillment.type === "PICKUP" ? fulfillment.promisedAt : fulfillment.courierPickupAt) ?? "");
  if (Number.isFinite(target) && !(target < placed)) {
    sample.targetComparable += 1;
    if (ready <= target) sample.readyByTarget += 1;
  }
}

function summarizeReadySample(sample: ReadySample) {
  const { acceptedToReadyMs, ...coverage } = sample;
  const sorted = acceptedToReadyMs.sort((first, second) => first - second);
  const count = sorted.length;
  const midpoint = Math.floor(count / 2);
  return {
    ...coverage,
    count,
    medianMs: count < churchSquareReadySampleMinimum.median ? null
      : count % 2 === 1 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2,
    p90Ms: count < churchSquareReadySampleMinimum.p90 ? null : sorted[Math.ceil(count * 0.9) - 1],
  };
}

/** Readiness reflects Square status timestamps and the current source hint. */
export function summarizeChurchSquareReadiness({ checkedAt, orders }: ChurchSquareOrderWindowResponse) {
  const bySource = new Map<Order["source"], { pickup: ReadySample; delivery: ReadySample }>();
  const checkedAtMs = Date.parse(checkedAt);
  for (const order of orders) {
    if (order.status !== "OPEN" && order.status !== "COMPLETED") continue;
    for (const fulfillment of order.fulfillments) {
      if (fulfillment.type !== "PICKUP" && fulfillment.type !== "DELIVERY") continue;
      let row = bySource.get(order.source);
      if (!row) {
        row = { pickup: emptyReadySample(), delivery: emptyReadySample() };
        bySource.set(order.source, row);
      }
      countReadiness(fulfillment.type === "PICKUP" ? row.pickup : row.delivery, fulfillment, checkedAtMs);
    }
  }
  return sources.flatMap((source) => {
    const row = bySource.get(source);
    if (!row) return [];
    return (["PICKUP", "DELIVERY"] as const).flatMap((type) => {
      const sample = type === "PICKUP" ? row.pickup : row.delivery;
      return sample.asapCount + sample.scheduledCount + sample.unknownScheduleCount
        ? [{ source, type, ...summarizeReadySample(sample) }] : [];
    });
  });
}

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
