import "server-only";

import type { ChurchSandwichRecipeKey } from "../kitchen/church-sandwich-bench";
import type { ChurchSquareOrder } from "./church-square-order-projection";
import type { ChurchSquareSandwichMixReady } from "./church-square-order-window";

type MixRow = ChurchSquareSandwichMixReady["rows"][number];

/** Aggregate qualifying whole units from the deduplicated manual order window. */
export function summarizeChurchSquareSandwichMix(
  orders: readonly ChurchSquareOrder[],
  mappedVariations: ReadonlyMap<string, ChurchSandwichRecipeKey>,
): ChurchSquareSandwichMixReady {
  const summary: ChurchSquareSandwichMixReady = {
    status: "ready", evaluatedOrders: 0, matchedOrders: 0, ordersWithoutLines: 0,
    ordersWithReturns: 0, excludedMatchedLines: 0, rows: [],
  };
  const totals = new Map<string, MixRow>();

  for (const order of orders) {
    if (order.status !== "COMPLETED") continue;
    summary.evaluatedOrders += 1;
    const hasLines = order.lineItemsReported && order.lineItems.length > 0;
    if (!hasLines) summary.ordersWithoutLines += 1;
    if (order.hasReturns) summary.ordersWithReturns += 1;
    if (!hasLines || order.hasReturns) continue;

    const seenIds = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const { id } of order.lineItems) {
      if (id === null) continue;
      if (seenIds.has(id)) duplicateIds.add(id);
      seenIds.add(id);
    }

    const orderRecipes = new Set<ChurchSandwichRecipeKey>();
    for (const line of order.lineItems) {
      const recipeKey = line.variationId ? mappedVariations.get(line.variationId) : undefined;
      if (!recipeKey) continue;

      // The provider bounds digits in each line. All 50 orders with a maximum
      // 1,000 lines could still exceed JavaScript's safe integer range in total.
      const units = /^\d{1,12}(?:\.0{1,10})?$/.test(line.quantity) ? Number(line.quantity) : 0;
      const validItem = (line.itemType === null || line.itemType === "ITEM") && line.hasQuantityUnit === false;
      if (!validItem || units <= 0 || (line.id !== null && duplicateIds.has(line.id))) {
        summary.excludedMatchedLines += 1;
        continue;
      }

      const key = `${recipeKey}:${order.sourceHint}`;
      const row = totals.get(key) ?? { recipeKey, source: order.sourceHint, units: 0, orders: 0 };
      if (!Number.isSafeInteger(row.units + units)) {
        throw new RangeError("Square sandwich quantities exceed the safe reporting range.");
      }
      row.units += units;
      if (!orderRecipes.has(recipeKey)) row.orders += 1;
      orderRecipes.add(recipeKey);
      totals.set(key, row);
    }
    if (orderRecipes.size) summary.matchedOrders += 1;
  }

  summary.rows = [...totals.values()].sort((left, right) => right.units - left.units
    || left.recipeKey.localeCompare(right.recipeKey) || left.source.localeCompare(right.source));
  return summary;
}
