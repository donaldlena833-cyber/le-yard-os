import "server-only";

import { z } from "zod";
import {
  ChurchSquareOrderClient,
  ChurchSquareOrderReadError,
  churchSquareOrderConfiguration,
} from "./church-square-orders.server";
import { ChurchSquareProjectionError, type ChurchSquareOrder } from "./church-square-order-projection";
import { createAdminClient } from "@/lib/supabase/admin";

const maximumPages = 3;
const maximumOrders = 150;
const maximumFactsBytes = 2 * 1024 * 1024;
const maximumOrderBytes = 500 * 1024;
const rpcTimeoutMs = 5_000;

const claimSchema = z.object({
  lease: z.uuid(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
}).nullable();

type BackfillFailure = "window_too_large" | "provider_unavailable" | "invalid_source";

class BackfillLimitError extends Error {}

async function loadWindow(square: ChurchSquareOrderClient, from: string, to: string) {
  const orders = new Map<string, ChurchSquareOrder>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let bytes = 0;
  for (let page = 0; page < maximumPages; page++) {
    const { orders: next, nextCursor } = await square.searchOrders({ from, to, cursor });
    for (const order of next) {
      const existing = orders.get(order.id);
      const serialized = JSON.stringify(order);
      if (existing) {
        if (JSON.stringify(existing) !== serialized) {
          throw new ChurchSquareOrderReadError("The Square window returned different versions of the same order.", "invalid_response");
        }
        continue;
      }
      const orderBytes = Buffer.byteLength(serialized, "utf8");
      if (orderBytes > maximumOrderBytes) {
        throw new ChurchSquareOrderReadError("A Square order exceeded the storage bounds.", "invalid_response");
      }
      bytes += orderBytes + 8;
      if (bytes + 2 > maximumFactsBytes || orders.size >= maximumOrders) throw new BackfillLimitError();
      orders.set(order.id, order);
    }
    if (!nextCursor) return [...orders.values()];
    if (cursors.has(nextCursor)) throw new ChurchSquareOrderReadError("Square repeated a backfill cursor.", "invalid_response");
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new BackfillLimitError();
}

function failureReason(error: unknown): BackfillFailure {
  if (error instanceof BackfillLimitError || (error instanceof ChurchSquareOrderReadError && error.code === "response_too_large")) {
    return "window_too_large";
  }
  if (error instanceof ChurchSquareProjectionError ||
    (error instanceof ChurchSquareOrderReadError && error.code !== "provider_unavailable")) return "invalid_source";
  return "provider_unavailable";
}

export async function processChurchSquareOrderBackfill(): Promise<void> {
  const config = churchSquareOrderConfiguration();
  if (!config || process.env.LE_YARD_CHURCH_SQUARE_ORDER_BACKFILL_ENABLED?.trim() !== "true") return;

  try {
    const db = createAdminClient();
    const scope = { p_merchant_id: config.merchantId, p_square_location_id: config.locationId };
    const claim = await db.rpc("service_claim_church_square_order_backfill", scope)
      .abortSignal(AbortSignal.timeout(rpcTimeoutMs));
    const result = claimSchema.safeParse(claim.data);
    if (claim.error || !result.success) {
      console.error("Church Street Square order backfill could not claim a window.");
      return;
    }
    if (!result.data) return;
    const { lease, from, to } = result.data;
    const leasedScope = { ...scope, p_lease: lease };

    try {
      const square = new ChurchSquareOrderClient(config);
      const orders = await loadWindow(square, from, to);
      const committed = await db.rpc("service_commit_church_square_order_backfill", {
        ...leasedScope, p_orders: orders,
      }).abortSignal(AbortSignal.timeout(rpcTimeoutMs));
      if (committed.error) {
        if (committed.error.code === "22023" || committed.error.code === "42501") {
          throw new ChurchSquareOrderReadError("The Square backfill scope or payload was invalid.", "invalid_response");
        }
        throw new Error("Church Street Square backfill commit was unavailable.");
      }
      if (committed.data !== true) console.error("Church Street Square order backfill lost its window lease.");
    } catch (error) {
      const reason = failureReason(error);
      const released = await db.rpc("service_release_church_square_order_backfill", {
        ...leasedScope, p_failure: reason,
      }).abortSignal(AbortSignal.timeout(rpcTimeoutMs));
      if (released.error) console.error("Church Street Square order backfill could not release its window lease.");
      console.error("Church Street Square order backfill window incomplete.", reason);
    }
  } catch {
    console.error("Church Street Square order backfill is unavailable.");
  }
}
