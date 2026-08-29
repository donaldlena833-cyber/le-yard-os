import assert from "node:assert/strict";
import test from "node:test";

import { calculateMenuCosts } from "./calculate-menu-cost.mjs";

test("calculates supported batch, portion, and target-price evidence", () => {
  const result = calculateMenuCosts({
    currency: "USD",
    targetFoodCostPercent: 25,
    priceRoundingCents: 100,
    menuItems: [
      {
        name: "Chicken test plate",
        yield: 4,
        menuPriceCents: 1_200,
        ingredients: [
          {
            name: "Chicken",
            quantity: 500,
            unit: "g",
            purchaseQuantity: 1,
            purchaseUnit: "kg",
            purchasePriceCents: 1_200,
            wastePercent: 20,
            source: { label: "Invoice 1", observedAt: "2026-08-28" },
          },
          {
            name: "Oil",
            quantity: 100,
            unit: "ml",
            purchaseQuantity: 1,
            purchaseUnit: "l",
            purchasePriceCents: 1_000,
            source: { label: "Invoice 2", observedAt: "2026-08-28" },
          },
        ],
      },
    ],
  });

  const item = result.menuItems[0];
  assert.equal(item.status, "calculated");
  assert.equal(item.evidenceStatus, "supported");
  assert.equal(item.batchCostCents, 850);
  assert.equal(item.portionCostCents, 213);
  assert.equal(item.foodCostPercent, 17.75);
  assert.equal(item.grossMarginCents, 987);
  assert.equal(item.suggestedMenuPriceCents, 900);
  assert.deepEqual(item.missingInputs, []);
});

test("keeps final totals null when price evidence is missing", () => {
  const result = calculateMenuCosts({
    menuItems: [
      {
        name: "Incomplete plate",
        yield: 2,
        ingredients: [
          {
            name: "Unknown garnish",
            quantity: 2,
            unit: "each",
          },
        ],
      },
    ],
  });

  const item = result.menuItems[0];
  assert.equal(item.status, "incomplete");
  assert.equal(item.knownBatchCostCents, 0);
  assert.equal(item.batchCostCents, null);
  assert.equal(item.portionCostCents, null);
  assert.match(item.missingInputs.join(" "), /Missing purchase price/);
});

test("refuses cross-dimension conversion without explicit evidence", () => {
  const result = calculateMenuCosts({
    menuItems: [
      {
        name: "Density-dependent item",
        yield: 1,
        ingredients: [
          {
            name: "Sauce",
            quantity: 100,
            unit: "g",
            purchaseQuantity: 1,
            purchaseUnit: "l",
            purchasePriceCents: 1_000,
          },
        ],
      },
    ],
  });

  const item = result.menuItems[0];
  assert.equal(item.status, "incomplete");
  assert.match(item.missingInputs.join(" "), /Cannot convert mass unit/);
});

test("rejects impossible waste percentages", () => {
  assert.throws(
    () =>
      calculateMenuCosts({
        menuItems: [
          {
            name: "Impossible item",
            yield: 1,
            ingredients: [
              {
                name: "Ingredient",
                quantity: 1,
                unit: "each",
                wastePercent: 100,
              },
            ],
          },
        ],
      }),
    /must be less than 100/,
  );
});
