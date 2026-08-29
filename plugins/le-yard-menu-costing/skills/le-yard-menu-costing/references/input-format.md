# Structured menu-costing input

Use the bundled calculator when recipe and purchase evidence can be represented as JSON.

```json
{
  "currency": "USD",
  "targetFoodCostPercent": 28,
  "priceRoundingCents": 100,
  "menuItems": [
    {
      "name": "Example dish",
      "yield": 4,
      "menuPriceCents": 2400,
      "ingredients": [
        {
          "name": "Example ingredient",
          "quantity": 500,
          "unit": "g",
          "purchaseQuantity": 1,
          "purchaseUnit": "kg",
          "purchasePriceCents": 1299,
          "wastePercent": 10,
          "source": {
            "label": "Invoice 1042",
            "observedAt": "2026-08-28"
          }
        }
      ]
    }
  ]
}
```

## Fields

- Money is integer minor units: cents for USD.
- `yield` is the number of sellable portions in the batch.
- `quantity` and `unit` describe the usable recipe amount.
- `purchaseQuantity`, `purchaseUnit`, and `purchasePriceCents` describe the priced pack or quoted quantity.
- `wastePercent` increases the as-purchased quantity needed to reach the usable recipe amount. Use `0` when recipe quantity is already as-purchased.
- `source.label` and `source.observedAt` preserve price provenance. The calculator can compute without them but marks the price evidence unverified.
- `menuPriceCents` is optional. Without it, food-cost percentage and gross margin remain unavailable.
- A menu item may override the root `targetFoodCostPercent` and `priceRoundingCents`.

Supported units are `g`, `kg`, `oz`, `lb`, `ml`, `l`, `fl-oz`, `gal`, `each`, and `dozen`. The calculator converts only within mass, volume, or count. It never invents density or piece-weight conversions.

## Run

```bash
node scripts/calculate-menu-cost.mjs input.json
```

From the skill directory, pass `-` to read JSON from standard input. The output is JSON. `batchCostCents`, `portionCostCents`, and decision metrics are `null` until every ingredient has compatible quantity and price evidence; `knownBatchCostCents` remains available as a clearly partial subtotal.
