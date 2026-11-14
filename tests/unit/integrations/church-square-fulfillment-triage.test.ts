import { expect, it } from "vitest";
import { summarizeChurchSquareFulfillments, type ChurchSquareOrderWatch } from "@/lib/integrations/church-square-order-watch";

type Fulfillment = ChurchSquareOrderWatch["orders"][number]["fulfillments"][number];
const checkedAt = "2026-11-14T18:00:00.000Z";

function row(overrides: Partial<Fulfillment> = {}): Fulfillment {
  return {
    type: "PICKUP", status: "RESERVED", promisedAt: null, readyAt: null,
    handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null, ...overrides,
  };
}

function watch(fulfillments: Fulfillment[]): ChurchSquareOrderWatch {
  return {
    checkedAt, orderCoverageThrough: null, hasMore: false,
    orders: [{ reference: "ticket-1", source: "SQUARE_ONLINE", status: "OPEN", updatedAt: checkedAt, fulfillments }],
  };
}

it("puts each open fulfillment in one window at the exact time boundaries", () => {
  const promised = [
    "2026-11-14T17:59:59.999Z", checkedAt, "2026-11-14T18:00:00.001Z", "2026-11-14T18:15:00.000Z",
    "2026-11-14T18:15:00.001Z", "2026-11-14T18:30:00.000Z", "2026-11-14T18:30:00.001Z",
    "2026-11-14T19:00:00.000Z", "2026-11-14T19:00:00.001Z", null,
  ];
  const buckets = summarizeChurchSquareFulfillments(watch(promised.map((promisedAt) => row({ promisedAt }))));
  expect(buckets.started.rows.map(({ fulfillment }) => fulfillment.promisedAt)).toEqual(promised.slice(0, 2));
  expect(buckets.next15.rows.map(({ fulfillment }) => fulfillment.promisedAt)).toEqual(promised.slice(2, 4));
  expect(buckets.next30.rows.map(({ fulfillment }) => fulfillment.promisedAt)).toEqual(promised.slice(4, 6));
  expect(buckets.next60.rows.map(({ fulfillment }) => fulfillment.promisedAt)).toEqual(promised.slice(6, 8));
  expect(buckets.later.rows.map(({ fulfillment }) => fulfillment.promisedAt)).toEqual(promised.slice(8, 9));
  expect(buckets.unscheduled.rows.map(({ fulfillment }) => fulfillment.promisedAt)).toEqual(promised.slice(9));
});

it("counts fulfillment types and readiness independently and prioritizes tickets awaiting prep", () => {
  const earlier = "2026-11-14T17:56:00.000Z";
  const buckets = summarizeChurchSquareFulfillments(watch([
    row({ promisedAt: earlier, readyAt: earlier }),
    row({ type: "DELIVERY", promisedAt: earlier, status: "PREPARED" }),
    row({ type: "DELIVERY", promisedAt: earlier, status: "PROPOSED" }),
    row({ promisedAt: checkedAt }),
    row({ type: "DELIVERY", promisedAt: null, status: "PROPOSED" }),
  ]));
  expect(buckets.started).toMatchObject({ pickup: { needsPrep: 1, ready: 1 }, delivery: { needsPrep: 1, ready: 1 } });
  expect(buckets.started.rows.map(({ key, ready }) => [key, ready])).toEqual([
    ["ticket-1:0:2", false], ["ticket-1:0:3", false], ["ticket-1:0:0", true], ["ticket-1:0:1", true],
  ]);
  expect(buckets.unscheduled.delivery).toEqual({ needsPrep: 1, ready: 0 });
});
