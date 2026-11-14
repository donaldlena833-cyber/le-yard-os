import { describe, expect, it } from "vitest";
import { projectChurchSquareResource, type ChurchSquareOrder } from "@/lib/integrations/church-square-order-projection";
import { summarizeChurchSquareSandwichMix } from "@/lib/integrations/church-square-sandwich-mix.server";
import type { ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";

const variationCodes: ReadonlyMap<string, ChurchSandwichRecipeKey> = new Map([
  ["PARISIEN_REGULAR", "parisien"], ["VERGER_REGULAR", "verger"],
]);
const stamp = "2026-11-14T16:00:00.000Z";

function order(id: string, fields: object): ChurchSquareOrder {
  return projectChurchSquareResource("order", {
    id, location_id: "CHURCH", created_at: stamp, updated_at: stamp, state: "COMPLETED", ...fields,
  }, { locationId: "CHURCH" });
}

function line(uid: string | null, variation: string | null, quantity: string, fields?: object) {
  return { uid, catalog_object_id: variation, quantity, ...fields };
}

describe("Church Street sandwich item mix", () => {
  it("sums exact matched whole quantities and counts each distinct order once per recipe and source", () => {
    const orders = [
      order("A", { source: { name: "DoorDash" }, line_items: [
        line("1", "PARISIEN_REGULAR", "2.000", { item_type: "ITEM", modifiers: [{ catalog_object_id: "VERGER_REGULAR", quantity: "9" }] }),
        line("2", "PARISIEN_REGULAR", "3"),
        line("3", "VERGER_REGULAR", "4.00000"),
        line("4", "UNMAPPED", "5", { name: "Le Parisien" }),
      ] }),
      order("B", { source: { name: "DoorDash" }, line_items: [line("1", "PARISIEN_REGULAR", "1")] }),
      order("C", { source: { name: "Square Online" }, line_items: [line(null, "PARISIEN_REGULAR", "4")] }),
      order("D", { source: { name: "Unrecognized marketplace" }, line_items: [line("1", "VERGER_REGULAR", "1")] }),
      order("E", { source: { name: "Uber Eats" }, line_items: [line("1", null, "2", { name: "Le Verger" })] }),
    ];

    expect(summarizeChurchSquareSandwichMix(orders, variationCodes)).toEqual({
      status: "ready", evaluatedOrders: 5, matchedOrders: 4, ordersWithoutLines: 0,
      ordersWithReturns: 0, excludedMatchedLines: 0, rows: [
        { source: "DOORDASH", recipeKey: "parisien", units: 6, orders: 2 },
        { source: "SQUARE_ONLINE", recipeKey: "parisien", units: 4, orders: 1 },
        { source: "DOORDASH", recipeKey: "verger", units: 4, orders: 1 },
        { source: "UNKNOWN", recipeKey: "verger", units: 1, orders: 1 },
      ],
    });
  });

  it("counts gaps and itemized-returns orders separately and ignores incomplete snapshots", () => {
    const matchingLines = [line("1", "PARISIEN_REGULAR", "10")];
    const orders = [
      order("MISSING", {}),
      order("EMPTY", { line_items: [] }),
      order("RETURN_ONLY", { returns: [{ source_order_id: "REF" }] }),
      order("EXCHANGE", { line_items: matchingLines, returns: [{ source_order_id: "REF" }] }),
      order("OPEN", { state: "OPEN", line_items: matchingLines }),
      order("DRAFT", { state: "DRAFT", line_items: matchingLines }),
      order("CANCELED", { state: "CANCELED", line_items: matchingLines }),
      order("UNKNOWN", { state: "FUTURE_STATE", line_items: matchingLines }),
      order("MONEY_REFUND", { line_items: [line("1", "PARISIEN_REGULAR", "1")], refunds: [{ id: "REFUND" }] }),
    ];

    const summary = summarizeChurchSquareSandwichMix(orders, variationCodes);
    expect(summary).toEqual({
      status: "ready", evaluatedOrders: 5, matchedOrders: 1, ordersWithoutLines: 3,
      ordersWithReturns: 2, excludedMatchedLines: 0,
      rows: [{ source: "UNKNOWN", recipeKey: "parisien", units: 1, orders: 1 }],
    });
    expect(summarizeChurchSquareSandwichMix([], variationCodes)).toEqual({
      status: "ready", evaluatedOrders: 0, matchedOrders: 0, ordersWithoutLines: 0,
      ordersWithReturns: 0, excludedMatchedLines: 0, rows: [],
    });
  });

  it("excludes both copies of a duplicated matched UID, non-item rows and non-whole or zero quantities", () => {
    const orders = [order("A", { line_items: [
      line("DUPLICATE", "PARISIEN_REGULAR", "4"),
      line("DUPLICATE", "VERGER_REGULAR", "4"),
      line("MIXED", "PARISIEN_REGULAR", "4"),
      line("MIXED", "OTHER", "4"),
      line("CUSTOM", "PARISIEN_REGULAR", "2", { item_type: "CUSTOM_AMOUNT" }),
      line("UNRECOGNIZED", "PARISIEN_REGULAR", "2", { item_type: "FUTURE_TYPE" }),
      line("WEIGHTED", "PARISIEN_REGULAR", "2.000", { quantity_unit: { precision: 3 } }),
      line("FRACTION", "PARISIEN_REGULAR", "2.5"),
      line("ZERO", "PARISIEN_REGULAR", "0.00000"),
      line(null, "PARISIEN_REGULAR", "2", { item_type: "ITEM" }),
      line(null, "PARISIEN_REGULAR", "1", { item_type: null, quantity_unit: null }),
    ] })];

    expect(summarizeChurchSquareSandwichMix(orders, variationCodes)).toEqual({
      status: "ready", evaluatedOrders: 1, matchedOrders: 1, ordersWithoutLines: 0,
      ordersWithReturns: 0, excludedMatchedLines: 8,
      rows: [{ source: "UNKNOWN", recipeKey: "parisien", units: 3, orders: 1 }],
    });
  });

  it("sorts equal units by recipe and source regardless of arrival order", () => {
    const orders = [
      order("A", { source: { name: "DoorDash" }, line_items: [line("VERGER", "VERGER_REGULAR", "1")] }),
      order("B", { source: { name: "Square Online" }, line_items: [line("PARISIEN", "PARISIEN_REGULAR", "1")] }),
      order("C", { source: { name: "DoorDash" }, line_items: [line("PARISIEN", "PARISIEN_REGULAR", "1")] }),
    ];
    const summary = summarizeChurchSquareSandwichMix(orders, variationCodes);
    expect(summary.rows.map(({ recipeKey, source }) => [recipeKey, source])).toEqual([
      ["parisien", "DOORDASH"], ["parisien", "SQUARE_ONLINE"], ["verger", "DOORDASH"],
    ]);
    expect(summarizeChurchSquareSandwichMix([...orders].reverse(), variationCodes)).toEqual(summary);
  });

  it("rejects aggregates too large to represent exactly", () => {
    const line_items = Array.from({ length: 1_000 }, (_, index) => line(String(index), "PARISIEN_REGULAR", "999999999999"));
    const orders = Array.from({ length: 10 }, (_, index) => order(`ORDER-${index}`, { line_items }));
    expect(() => summarizeChurchSquareSandwichMix(orders, variationCodes)).toThrow(RangeError);
  });
});
