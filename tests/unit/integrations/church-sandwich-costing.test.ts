import { describe, expect, it } from "vitest";
import { churchSandwichBenchRecipes, churchSandwichBread } from "@/lib/kitchen/church-sandwich-bench";
import {
  recordChurchSandwichPackCostInput, summarizeChurchSandwichCosts, type ChurchSandwichPackCost,
} from "@/lib/kitchen/church-sandwich-costing";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

const at = "2026-11-14T17:00:00Z";
const parisien: ChurchSandwichFormula = {
  recipeKey: "parisien", reviewReference: "test worksheet", current: true, revision: 1,
  reviewerName: "Test chef", reviewedAt: at,
  measurements: {
    [churchSandwichBread]: { quantity: 1, evidenceRevision: 2, yieldBasis: "whole_each", measuredInput: 10, measuredUsable: 9 },
    "French-style ham": { quantity: 72, evidenceRevision: 2, yieldBasis: "weighed_usable_grams", measuredInput: 1_000, measuredUsable: 800 },
    "cultured butter": { quantity: 16, evidenceRevision: 2, yieldBasis: "weighed_usable_grams", measuredInput: 500, measuredUsable: 500 },
  },
};
const evidence: ChurchIngredientEvidence[] = Object.keys(parisien.measurements).map((ingredientKey, index) => ({
  ingredientKey, revision: 2, status: "reviewed", supplierSku: `TEST-${index}`, sourceReference: "test lot label",
  allergenNotes: "test", crossContactNotes: "test", storageRule: "test", openedRule: "test", preppedRule: "test",
  reviewedAt: at, reviewerName: "Test chef", updatedAt: at,
}));
const prices: ChurchSandwichPackCost[] = evidence.map(({ ingredientKey, supplierSku }, index) => ({
  ingredientKey, evidenceRevision: 2, supplierSku: supplierSku!, packQuantity: [12, 1_500, 500][index],
  packCostCents: [1_080, 2_250, 500][index], invoiceDate: "2026-11-13", invoiceReference: "test invoice line", recordedAt: at,
}));
const cost = (formulas = [parisien], labels = evidence, packs = prices) =>
  summarizeChurchSandwichCosts(formulas, labels, packs).find(row => row.key === "parisien");

describe("Church Street signed sandwich ingredient cost", () => {
  it("combines actual as-purchased inputs and usable yields in the signed portions", () => {
    // Bread 100 cents after rejects, ham 135 after trim, butter 16.
    expect(cost()).toMatchObject({ status: "costed", totalCents: 251, missingIngredients: [] });
    expect(summarizeChurchSandwichCosts([parisien], evidence, prices).map(row => row.key)).toEqual(
      churchSandwichBenchRecipes.map(recipe => recipe.key),
    );
  });

  it("withholds an amount until the signed recipe and exact supplier price revisions agree", () => {
    expect(cost([], evidence, prices)).toMatchObject({ status: "needs_recipe", totalCents: null });
    expect(cost([parisien], [{ ...evidence[0], revision: 3 }, ...evidence.slice(1)])).toMatchObject({ status: "needs_recipe", totalCents: null });
    expect(cost([parisien], evidence, [{ ...prices[0], supplierSku: "WRONG" }, prices[1]])).toMatchObject({
      status: "needs_costs", totalCents: null, missingIngredients: [churchSandwichBread, "cultured butter"],
    });
  });

  it("rounds the combined total once and withholds an amount that cannot be serialized exactly", () => {
    expect(cost([parisien], evidence, [
      { ...prices[0], packQuantity: 3, packCostCents: 1 },
      { ...prices[1], packQuantity: 250, packCostCents: 1 },
      { ...prices[2], packQuantity: 50, packCostCents: 1 },
    ])).toMatchObject({ status: "costed", totalCents: 1 });
    const huge: ChurchSandwichFormula = { ...parisien, measurements: { ...parisien.measurements,
      "French-style ham": { ...parisien.measurements["French-style ham"]!, measuredInput: 1_000_000, measuredUsable: 72 },
    } };
    expect(cost([huge], evidence, [prices[0], { ...prices[1], packQuantity: 0.001, packCostCents: 100_000_000 }, prices[2]])).toMatchObject({
      status: "unavailable", totalCents: null,
    });
  });

  it("requires an invoice-backed positive amount, valid day, and whole units for bread", () => {
    const sample = { ingredientKey: churchSandwichBread, evidenceRevision: 2, packQuantity: 12, packCostCents: 1_080,
      invoiceDate: "2026-11-14", invoiceReference: "  Invoice 100 / line 1  ", requestId: "10000000-0000-4000-8000-000000000001" };
    expect(recordChurchSandwichPackCostInput.parse(sample).invoiceReference).toBe("Invoice 100 / line 1");
    for (const fields of [{ packQuantity: 1.5 }, { packCostCents: 0 }, { invoiceDate: "2026-02-30" }, { invoiceReference: " " }]) {
      expect(recordChurchSandwichPackCostInput.safeParse({ ...sample, ...fields }).success).toBe(false);
    }
  });
});
