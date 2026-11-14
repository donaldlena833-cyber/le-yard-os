import { z } from "zod";

export const churchSquareOrderWatchPath = "/api/workspace/church-square-order-watch";
export const churchSquareOrderWatchLimit = 50;

const timestamp = z.iso.datetime({ offset: true });
const portions = z.number().int().min(0);
const cateringLoad = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }),
  z.object({
    status: z.literal("ready"),
    published: portions,
    stillToBuild: portions,
  }).refine(({ published, stillToBuild }) => stillToBuild <= published),
]);
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
  catering: cateringLoad.nullable().optional(),
  orders: z.array(z.object({
    reference: z.string().regex(/^[A-Za-z0-9_:-]{1,10}$/),
    source: z.enum(["DOORDASH", "UBER_EATS", "GRUBHUB", "SQUARE_ONLINE", "SQUARE_POS", "SQUARE_INVOICES", "UNKNOWN"]),
    status: z.literal("OPEN"),
    updatedAt: timestamp,
    fulfillments: z.array(activeFulfillment).min(1).max(100),
  })).max(churchSquareOrderWatchLimit),
});

export type ChurchSquareOrderWatch = z.infer<typeof churchSquareOrderWatchResponse>;

type Fulfillment = z.infer<typeof activeFulfillment>;
export type ChurchSquareFulfillmentRow = {
  reference: string;
  source: ChurchSquareOrderWatch["orders"][number]["source"];
  fulfillment: Fulfillment;
  scheduled: number | null;
  ready: boolean;
  key: string;
};

type ReadinessCounts = { needsPrep: number; ready: number };
type FulfillmentBucket = {
  rows: ChurchSquareFulfillmentRow[];
  pickup: ReadinessCounts;
  delivery: ReadinessCounts;
};

function emptyBucket(): FulfillmentBucket {
  return { rows: [], pickup: { needsPrep: 0, ready: 0 }, delivery: { needsPrep: 0, ready: 0 } };
}

export function summarizeChurchSquareFulfillments({ checkedAt, orders }: ChurchSquareOrderWatch) {
  const checkedTime = Date.parse(checkedAt);
  const minute = 60_000;
  const buckets = {
    started: emptyBucket(),
    next15: emptyBucket(),
    next30: emptyBucket(),
    next60: emptyBucket(),
    later: emptyBucket(),
    unscheduled: emptyBucket(),
  };

  orders.forEach(({ reference, source, fulfillments }, orderIndex) => {
    fulfillments.forEach((fulfillment, index) => {
      if (fulfillment.handoffAt || fulfillment.completedAt || fulfillment.canceledAt || fulfillment.rejectedAt) return;

      const scheduled = fulfillment.promisedAt ? Date.parse(fulfillment.promisedAt) : null;
      const minutesUntil = scheduled === null ? null : (scheduled - checkedTime) / minute;
      const bucket = minutesUntil === null ? buckets.unscheduled
        : minutesUntil <= 0 ? buckets.started
          : minutesUntil <= 15 ? buckets.next15
            : minutesUntil <= 30 ? buckets.next30
              : minutesUntil <= 60 ? buckets.next60 : buckets.later;
      const ready = fulfillment.status === "PREPARED" || fulfillment.readyAt !== null;
      const counts = fulfillment.type === "PICKUP" ? bucket.pickup : bucket.delivery;
      counts[ready ? "ready" : "needsPrep"] += 1;
      bucket.rows.push({ reference, source, fulfillment, scheduled, ready, key: `${reference}:${orderIndex}:${index}` });
    });
  });

  // Check tickets still awaiting prep before pickups and deliveries already marked ready.
  for (const bucket of [buckets.started, buckets.next15, buckets.next30, buckets.next60, buckets.unscheduled]) {
    bucket.rows.sort((left, right) =>
      Number(left.ready) - Number(right.ready) || (left.scheduled ?? 0) - (right.scheduled ?? 0),
    );
  }
  buckets.later.rows.sort((left, right) => (left.scheduled ?? 0) - (right.scheduled ?? 0));
  return buckets;
}
