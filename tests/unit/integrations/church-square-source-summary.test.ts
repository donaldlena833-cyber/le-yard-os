import { describe, expect, it } from "vitest";
import type { ChurchSquareOrderWindowResponse } from "@/lib/integrations/church-square-order-window";
import { summarizeChurchSquareSources } from "@/lib/integrations/church-square-source-summary";

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
