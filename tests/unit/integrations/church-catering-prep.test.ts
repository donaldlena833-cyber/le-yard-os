import { describe, expect, it } from "vitest";
import { calculateChurchCateringPrep, churchCateringPrepDays } from "@/lib/kitchen/church-catering-prep";

const day = {
  serviceDate: "2026-11-20",
  jobCount: 2,
  portions: { parisien: 3, verger: 6, bellecour: 0, bleu: 1, rustique: 0, figaro: 0 },
};

describe("Church Street catering prep worksheet", () => {
  it("scales fillings and combines ingredients that multiple recipes share", () => {
    const plan = calculateChurchCateringPrep(day);
    expect(plan).toMatchObject({
      baguettes: 10, assemblySeconds: 810,
      sandwiches: [
        { name: "Le Parisien", quantity: 3 },
        { name: "Le Verger", quantity: 6 },
        { name: "Le Bleu", quantity: 1 },
      ],
    });
    expect(Object.fromEntries(plan.ingredients.map(({ ingredient, grams }) => [ingredient, grams]))).toEqual({
      "French-style ham": 216, "cultured butter": 48, Brie: 270, apple: 282, walnuts: 84,
      honey: 56, "Danish blue cheese": 38, arugula: 10, pistachios: 13,
    });
  });

  it("accepts large site aggregates and strips job-level metadata", () => {
    expect(churchCateringPrepDays.parse([{ ...day, title: "private", portions: { ...day.portions, parisien: 4000 } }])).toEqual([
      { ...day, portions: { ...day.portions, parisien: 4000 } },
    ]);
  });

  it("combines exact signed usable weights across jobs without rounding away a decimal gram", () => {
    const plan = calculateChurchCateringPrep(day, { recipes: [
      { key: "parisien", ingredients: { "10-inch baguette": 1, "French-style ham": 74.5, "cultured butter": 16 } },
      { key: "verger", ingredients: { "10-inch baguette": 1, Brie: 45, apple: 40.001, walnuts: 14, honey: 8 } },
      { key: "bleu", ingredients: { "10-inch baguette": 1, "Danish blue cheese": 38, apple: 43, arugula: 10, honey: 8, pistachios: 13 } },
    ] });
    expect(plan.signed).toMatchObject({ status: "ready", pendingNames: [] });
    expect(plan.signed.ingredients).toContainEqual({ ingredient: "apple", grams: 283.006 });
    expect(plan.signed.ingredients).toContainEqual({ ingredient: "French-style ham", grams: 223.5 });
    expect(plan.ingredients).toContainEqual({ ingredient: "apple", grams: 282 });
  });

  it("withholds a mixed partial shopping list when a published recipe is unsigned", () => {
    const plan = calculateChurchCateringPrep(day, { recipes: [
      { key: "parisien", ingredients: { "10-inch baguette": 1, "French-style ham": 74.5, "cultured butter": 16 } },
    ] });
    expect(plan.signed).toEqual({ status: "pending", pendingNames: ["Le Verger", "Le Bleu"], ingredients: [] });
    expect(plan.baguettes).toBe(10);
    expect(calculateChurchCateringPrep(day, { recipes: null }).signed)
      .toEqual({ status: "unavailable", pendingNames: [], ingredients: [] });
  });

  it("rejects fractional portions, incomplete recipe keys and duplicate dates", () => {
    expect(churchCateringPrepDays.safeParse([{ ...day, portions: { ...day.portions, bleu: 0.5 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([{ ...day, portions: { bleu: 1 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([day, day]).success).toBe(false);
  });
});
