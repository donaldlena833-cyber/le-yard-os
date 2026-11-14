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

  it("rejects fractional portions, incomplete recipe keys and duplicate dates", () => {
    expect(churchCateringPrepDays.safeParse([{ ...day, portions: { ...day.portions, bleu: 0.5 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([{ ...day, portions: { bleu: 1 } }]).success).toBe(false);
    expect(churchCateringPrepDays.safeParse([day, day]).success).toBe(false);
  });
});
