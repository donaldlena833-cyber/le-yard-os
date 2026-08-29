---
name: le-yard-menu-costing
description: Calculate and review Le Yard recipe, batch, portion, food-cost, and target-price evidence. Use for menu costing or menu engineering when recipes and purchase prices are supplied; never invent missing prices, yields, or unit conversions.
---

# Le Yard Menu Costing

Produce auditable costing that a chef or owner can trace back to exact recipe and price inputs.

## Source hierarchy

Prefer verified Le Yard OS price history or accepted invoice evidence, then a current dated vendor quote, then a current public vendor source, then an explicitly labeled estimate. Preserve the source, observation date, currency, pack, unit, and location. Keep connected records, synthetic demonstrations, and user-entered scenarios visibly separate.

## Costing method

1. Confirm batch yield and whether each recipe quantity is edible-product or as-purchased quantity.
2. Normalize only compatible units: mass with mass, volume with volume, and count with count. Use density or piece-weight conversions only when the user provides the conversion evidence.
3. If recipe quantity is edible-product weight, divide by `1 - waste_percent / 100` to obtain the as-purchased requirement. Use zero waste when the recipe is already specified as purchased.
4. Calculate ingredient cost, known batch subtotal, complete batch cost, portion cost, food-cost percentage, gross margin before other operating costs, and target menu price.
5. Treat tax, freight, labor, packaging, comps, spoilage, and overhead as separate components unless the input explicitly includes them.
6. Refuse a complete total when a price, yield, quantity, or compatible unit is missing. Show the known subtotal and missing inputs instead.

For structured JSON, read [the costing input contract](references/input-format.md) and use `scripts/calculate-menu-cost.mjs`. The script refuses cross-dimension conversions and returns null final totals when inputs are incomplete.

## Deliverable

Return an ingredient evidence table, batch and portion calculation, current menu price comparison, target-price sensitivity, missing-input register, and a short recommendation. Label source freshness and every assumption beside the affected number.

## Boundaries

- Do not infer a vendor, pack, price, yield, or recipe quantity from a similar item.
- A calculated target is decision support, not an approved menu price or accounting profit.
- Do not update Le Yard OS, publish a menu, create a purchase order, or contact a vendor without separate explicit authorization and confirmation.
