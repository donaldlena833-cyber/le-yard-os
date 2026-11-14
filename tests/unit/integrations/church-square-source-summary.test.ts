import { describe, expect, it } from "vitest";
import type { ChurchSquareOrderWindowResponse } from "@/lib/integrations/church-square-order-window";
import { summarizeChurchSquareReadiness, summarizeChurchSquareSources } from "@/lib/integrations/church-square-source-summary";

type Order = ChurchSquareOrderWindowResponse["orders"][number];
type Fulfillment = Order["fulfillments"][number];

const checkedAt = "2026-11-14T16:00:00.000Z";
const target = "2026-11-14T09:00:00-05:00";
const beforeTarget = "2026-11-14T13:59:00.000Z";
const afterTarget = "2026-11-14T14:01:00.000Z";

function order(source: Order["source"], status: Order["status"], fulfillments: Fulfillment[] = []): Order {
  return { reference: "1234567890", source, status, updatedAt: checkedAt, totalCents: null, fulfillments };
}

function fulfillment(type: Fulfillment["type"], facts?: Partial<Fulfillment>): Fulfillment {
  return {
    type, status: "COMPLETED", promisedAt: target,
    readyAt: null, handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null,
    ...facts,
  };
}

describe("Church Square source sample", () => {
  it("reports only observed buckets in stable order, including unknown sources and statuses", () => {
    const orders = [
      order("UNKNOWN", "UNKNOWN", [fulfillment("DELIVERY", { handoffAt: beforeTarget })]),
      order("DOORDASH", "OPEN"),
      order("DOORDASH", "DRAFT"),
      order("SQUARE_POS", "COMPLETED"),
      order("DOORDASH", "CANCELED"),
      order("DOORDASH", "COMPLETED"),
      order("DOORDASH", "UNKNOWN"),
      order("SQUARE_INVOICES", "OPEN"),
    ];

    const rows = summarizeChurchSquareSources({ checkedAt, hasMore: true, orders });
    expect(rows.map(({ source, orderCount }) => [source, orderCount])).toEqual([
      ["SQUARE_POS", 1], ["DOORDASH", 5], ["SQUARE_INVOICES", 1], ["UNKNOWN", 1],
    ]);
    expect(rows[1]).toMatchObject({ completed: 1, canceled: 1, open: 1, draft: 1, unknownStatus: 1 });
    expect(rows[3]).toMatchObject({ unknownStatus: 1, delivery: { fulfillmentCount: 1, comparable: 1, byTarget: 1 } });
    expect(summarizeChurchSquareSources({ checkedAt, hasMore: false, orders: [] })).toEqual([]);
  });

  it("counts explicit rejections once per order separately from cancellation and failure", () => {
    const orders = [
      order("UBER_EATS", "CANCELED", [
        fulfillment("PICKUP", { status: "FAILED", rejectedAt: beforeTarget, handoffAt: beforeTarget }),
        fulfillment("DELIVERY", { status: "FAILED", rejectedAt: afterTarget }),
      ]),
      order("UBER_EATS", "OPEN", [fulfillment("DELIVERY", { status: "FAILED", handoffAt: beforeTarget })]),
      order("UBER_EATS", "CANCELED", [fulfillment("PICKUP", { status: "CANCELED", canceledAt: beforeTarget })]),
    ];
    expect(summarizeChurchSquareSources({ checkedAt, hasMore: false, orders })).toEqual([{
      source: "UBER_EATS", orderCount: 3, open: 1, canceled: 2, completed: 0, draft: 0, unknownStatus: 0,
      rejectedOrders: 1,
      pickup: { fulfillmentCount: 2, comparable: 0, byTarget: 0 },
      delivery: { fulfillmentCount: 2, comparable: 0, byTarget: 0 },
    }]);
  });

  it("compares only promised and actual handoff pairs and includes exact target equality", () => {
    const orders = [order("GRUBHUB", "OPEN", [
      fulfillment("PICKUP", { handoffAt: "2026-11-14T14:00:00.000Z" }),
      fulfillment("PICKUP", { handoffAt: afterTarget }),
      fulfillment("PICKUP", { readyAt: beforeTarget, completedAt: beforeTarget }),
      fulfillment("PICKUP", { promisedAt: null, handoffAt: beforeTarget }),
      fulfillment("PICKUP", { handoffAt: "2026-11-14T16:05:00.000Z" }),
      fulfillment("DELIVERY", { handoffAt: beforeTarget }),
      fulfillment("DELIVERY", { handoffAt: afterTarget }),
      fulfillment("DELIVERY", { canceledAt: beforeTarget, handoffAt: beforeTarget }),
      fulfillment("DELIVERY", { status: "CANCELED", handoffAt: beforeTarget }),
      fulfillment("SHIPMENT", { handoffAt: beforeTarget }),
    ])];
    expect(summarizeChurchSquareSources({ checkedAt, hasMore: false, orders })[0]).toMatchObject({
      orderCount: 1,
      pickup: { fulfillmentCount: 5, comparable: 2, byTarget: 1 },
      delivery: { fulfillmentCount: 4, comparable: 2, byTarget: 1 },
    });
  });
});

describe("Church Square readiness sample", () => {
  const acceptedAt = "2026-11-14T08:40:00-05:00";
  const placedAt = "2026-11-14T13:35:00Z";
  const readyAt = "2026-11-14T13:55:00Z";

  it("measures ASAP pairs by source and fulfillment with explicit median and p90 floors", () => {
    const pickup = Array.from({ length: 10 }, (_, minutes) => fulfillment("PICKUP", {
      status: minutes ? "COMPLETED" : "PREPARED", scheduleType: "ASAP", placedAt, acceptedAt,
      readyAt: new Date(Date.parse(acceptedAt) + minutes * 60_000).toISOString(),
    }));
    const delivery = Array.from({ length: 5 }, () => fulfillment("DELIVERY", {
      scheduleType: "ASAP", placedAt, acceptedAt, readyAt, courierPickupAt: beforeTarget,
    }));
    const orders = [
      order("DOORDASH", "OPEN", [...pickup, ...delivery]),
      order("UNKNOWN", "COMPLETED", pickup.slice(0, 4)),
    ];
    expect(summarizeChurchSquareReadiness({ checkedAt, hasMore: true, orders })).toMatchObject([
      { source: "DOORDASH", type: "PICKUP", asapCount: 10, count: 10, medianMs: 270_000, p90Ms: 480_000, readyByTarget: 10 },
      { source: "DOORDASH", type: "DELIVERY", asapCount: 5, count: 5, medianMs: 900_000, p90Ms: null, readyByTarget: 5 },
      { source: "UNKNOWN", type: "PICKUP", asapCount: 4, count: 4, medianMs: null, p90Ms: null },
    ]);
  });

  it("shows gaps without inferring acceptance, readiness, courier targets or schedule", () => {
    const ready = { scheduleType: "ASAP", placedAt, readyAt, acceptedAt } as const;
    const orders = [order("SQUARE_ONLINE", "OPEN", [
      fulfillment("PICKUP", { ...ready, acceptedAt: null }),
      fulfillment("PICKUP", { ...ready, placedAt: afterTarget }),
      fulfillment("PICKUP", { ...ready, acceptedAt: "2026-11-14T13:30:00Z" }),
      fulfillment("PICKUP", { ...ready, acceptedAt: afterTarget }),
      fulfillment("PICKUP", { ...ready, readyAt: "2026-11-14T16:05:00Z", handoffAt: beforeTarget }),
      fulfillment("PICKUP", { ...ready, readyAt: null, handoffAt: beforeTarget }),
      fulfillment("PICKUP", { ...ready, scheduleType: "SCHEDULED", readyAt: afterTarget }),
      fulfillment("PICKUP", { ...ready, scheduleType: undefined }),
      fulfillment("PICKUP", { ...ready, rejectedAt: beforeTarget }),
      fulfillment("PICKUP", { ...ready, status: "RESERVED" }),
      fulfillment("PICKUP", { ...ready, status: "FAILED" }),
      fulfillment("SHIPMENT", ready),
      fulfillment("DELIVERY", { ...ready, courierPickupAt: "2026-11-14T08:55:00-05:00" }),
      fulfillment("DELIVERY", { ...ready, courierPickupAt: null }),
      fulfillment("DELIVERY", { ...ready, courierPickupAt: "2026-11-14T13:20:00Z" }),
      fulfillment("DELIVERY", { ...ready, handoffAt: placedAt, courierPickupAt: beforeTarget }),
      fulfillment("DELIVERY", { ...ready, completedAt: placedAt, courierPickupAt: beforeTarget }),
    ]), order("SQUARE_ONLINE", "CANCELED", [fulfillment("PICKUP", ready)])];
    expect(summarizeChurchSquareReadiness({ checkedAt, hasMore: false, orders })).toMatchObject([
      { type: "PICKUP", asapCount: 6, scheduledCount: 1, unknownScheduleCount: 1, count: 0, targetComparable: 5, readyByTarget: 4 },
      { type: "DELIVERY", asapCount: 5, count: 3, targetComparable: 1, readyByTarget: 1 },
    ]);
  });
});
