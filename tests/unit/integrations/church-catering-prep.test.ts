import { describe, expect, it } from "vitest";
import { calculateChurchCateringPrep, churchCateringPrepDays } from "@/lib/kitchen/church-catering-prep";

const day = {
  serviceDate: "2026-11-20",
  jobCount: 2,
  portions: { parisien: 3, verger: 6, bellecour: 0, bleu: 1, rustique: 0, figaro: 0 },
  packedPortions: { parisien: 0, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
  remainingPortions: { parisien: 3, verger: 6, bellecour: 0, bleu: 1, rustique: 0, figaro: 0 },
};

describe("Church Street catering prep worksheet", () => {
  it("scales fillings and combines ingredients that multiple recipes share", () => {
    const plan = calculateChurchCateringPrep(day);
    expect(plan).toMatchObject({
      published: 10, packed: 0, baguettes: 10, assemblySeconds: 810,
      sandwiches: [
        { name: "Le Parisien", published: 3, packed: 0, remaining: 3 },
        { name: "Le Verger", published: 6, packed: 0, remaining: 6 },
        { name: "Le Bleu", published: 1, packed: 0, remaining: 1 },
      ],
    });
    expect(Object.fromEntries(plan.ingredients.map(({ ingredient, grams }) => [ingredient, grams]))).toEqual({
      "French-style ham": 216, "cultured butter": 48, Brie: 270, apple: 282, walnuts: 84,
      honey: 56, "Danish blue cheese": 38, arugula: 10, pistachios: 13,
    });
  });

  it("accepts large site aggregates and strips job-level metadata", () => {
    const largeDay = { ...day, portions: { ...day.portions, parisien: 4000 }, remainingPortions: { ...day.remainingPortions, parisien: 4000 } };
    expect(churchCateringPrepDays.parse([{ ...largeDay, title: "private" }])).toEqual([largeDay]);
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

  it("calculates only the remainder and skips signoff for fully packed recipes", () => {
    const partial = {
      ...day,
      packedPortions: { ...day.packedPortions, parisien: 3, verger: 5, bleu: 1 },
      remainingPortions: { ...day.packedPortions, verger: 1 },
    };
    const plan = calculateChurchCateringPrep(partial, { recipes: [
      { key: "verger", ingredients: { "10-inch baguette": 1, Brie: 45, apple: 40.001, walnuts: 14, honey: 8 } },
    ] });
    expect(plan).toMatchObject({ published: 10, packed: 9, baguettes: 1, assemblySeconds: 90, signed: { status: "ready" } });
    expect(plan.signed.ingredients).toContainEqual({ ingredient: "apple", grams: 40.001 });
    expect(plan.ingredients).toContainEqual({ ingredient: "apple", grams: 40 });
    expect(plan.ingredients).not.toContainEqual(expect.objectContaining({ ingredient: "French-style ham" }));
    const full = { ...day, packedPortions: day.portions, remainingPortions: day.packedPortions };
    expect(churchCateringPrepDays.safeParse([full]).success).toBe(true);
    expect(calculateChurchCateringPrep(full)).toMatchObject({
      published: 10, packed: 10, baguettes: 0, assemblySeconds: 0,
      signed: { status: "ready", ingredients: [] },
    });
  });

  it("rejects fractional, incomplete or inconsistent portion data and duplicate dates", () => {
    expect(churchCateringPrepDays.safeParse([{ ...day, portions: { ...day.portions, bleu: 0.5 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([{ ...day, portions: { bleu: 1 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([{ ...day, packedPortions: undefined }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([{ ...day, remainingPortions: { ...day.remainingPortions, bleu: 0 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([day, day]).success).toBe(false);
  });
});
