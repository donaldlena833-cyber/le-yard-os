import { describe, expect, it } from "vitest";
import {
  calculateChurchSandwichAvailability,
  churchAvailabilityBenchRecipes,
  validChurchAvailabilityMix,
  validChurchAvailabilityStock,
  type ChurchAvailabilityEvidence,
  type ChurchAvailabilityQuantities,
} from "@/lib/kitchen/church-sandwich-availability";

const trialStock: ChurchAvailabilityQuantities = {
  "10-inch baguette": 10,
  "French-style ham": 720,
  "cultured butter": 160,
  Brie: 450,
  apple: 200,
  walnuts: 140,
  honey: 160,
  "Danish blue cheese": 380,
  arugula: 200,
  pistachios: 130,
};
const trialEvidence: ChurchAvailabilityEvidence = Object.fromEntries(
  Object.keys(trialStock).map((ingredient) => [ingredient, "reviewed"]),
);

function estimate(overrides: Partial<Parameters<typeof calculateChurchSandwichAvailability>[0]> = {}) {
  return calculateChurchSandwichAvailability({
    recipes: churchAvailabilityBenchRecipes, evidence: {}, stock: trialStock, catering: {}, mix: {}, mode: "bench", ...overrides,
  });
}

describe("Church Street sandwich feasibility", () => {
  it("deducts published catering once and treats different sandwiches as competing for shared counts", () => {
    const { rows, mix } = estimate({ catering: { parisien: 3, verger: 1 }, mix: { verger: 2, bleu: 2 } });
    expect(rows.find(({ key }) => key === "parisien")).toMatchObject({ portions: 6, limitingIngredients: ["10-inch baguette"] });
    expect(rows.find(({ key }) => key === "bleu")).toMatchObject({ portions: 3, limitingIngredients: ["apple"] });
    expect(mix.status).toBe("short");
    expect(mix.ingredients).toContainEqual({ ingredient: "apple", required: 204, inStock: 200, shortfall: 4 });
    expect(mix.ingredients).toContainEqual({ ingredient: "10-inch baguette", required: 8, inStock: 10, shortfall: 0 });
  });

  it("checks published catering on its own and blocks extra suggestions if commitments are short", () => {
    const { rows, mix } = estimate({ catering: { verger: 6 } });
    expect(mix.status).toBe("short");
    expect(mix.ingredients).toContainEqual({ ingredient: "apple", required: 240, inStock: 200, shortfall: 40 });
    expect(rows.every(({ portions }) => portions === null)).toBe(true);
    expect(rows[0].blockers).toContainEqual({ ingredient: "apple", reason: "catering_short" });
  });

  it("distinguishes unknown, held, and observed zero, including in bench mode", () => {
    const { rows, mix } = estimate({
      evidence: { pistachios: "hold" },
      stock: { ...trialStock, apple: 0, "cultured butter": undefined },
      mix: { parisien: 1, bleu: 1 },
    });
    expect(rows.find(({ key }) => key === "verger")).toMatchObject({ portions: 0, limitingIngredients: ["apple"] });
    expect(rows[0]).toMatchObject({ portions: null, blockers: [{ ingredient: "cultured butter", reason: "count_needed" }] });
    expect(mix.status).toBe("pending");
    expect(mix.blockers).toContainEqual({ ingredient: "pistachios", reason: "supplier_hold" });
    expect(mix.ingredients).toContainEqual({ ingredient: "apple", required: 42, inStock: 0, shortfall: 42 });
  });

  it("never uses bench defaults for a missing or ambiguous signed recipe", () => {
    const recipes = churchAvailabilityBenchRecipes.filter(({ key }) => key !== "verger");
    const { rows, mix } = estimate({ mode: "approved", recipes, evidence: trialEvidence, catering: { verger: 1 } });
    expect(rows.every(({ portions }) => portions === null)).toBe(true);
    expect(mix.blockers).toContainEqual({ ingredient: null, reason: "recipe_for_catering_pending" });
    expect(mix.status).toBe("pending");
    const duplicate = estimate({ recipes: [...recipes, recipes[0]] });
    expect(duplicate.rows[0].blockers).toContainEqual({ ingredient: null, reason: "recipe_pending" });
  });

  it("requires reviewed supplier rows only for approved scenarios and preserves exact milligrams", () => {
    const recipes = [{ key: "parisien", ingredients: { "10-inch baguette": 1, "cultured butter": 10.001 } }] as const;
    const stock = { "10-inch baguette": 4, "cultured butter": 30.002 };
    const pending = estimate({ mode: "approved", recipes, stock });
    expect(pending.rows[0].blockers).toContainEqual({ ingredient: "cultured butter", reason: "supplier_pending" });
    const checked = estimate({ mode: "approved", recipes, stock, evidence: trialEvidence, mix: { parisien: 3 } });
    expect(checked.rows[0].portions).toBe(2);
    expect(checked.mix.ingredients).toContainEqual({ ingredient: "cultured butter", required: 30.003, inStock: 30.002, shortfall: 0.001 });
  });

  it("validates physical units and mix limits", () => {
    expect(validChurchAvailabilityStock("10-inch baguette", 1.5)).toBe(false);
    expect(validChurchAvailabilityStock("apple", 2.001)).toBe(true);
    expect(validChurchAvailabilityStock("apple", 2.0001)).toBe(false);
    expect(validChurchAvailabilityStock("apple", -1)).toBe(false);
    expect(validChurchAvailabilityMix(1_000)).toBe(false);
  });
});
