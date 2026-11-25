import type { ChurchSandwichBenchRecipe } from "./church-sandwich-bench";

export const churchSandwichStandard = {
  locationId: "f6d58776-66b5-408e-bb8f-3855710b3b22",
  approvedBy: "Donald Lena",
  approvedOn: "2026-11-25",
} as const;

export const churchSandwichSizes = [6, 10] as const;
export type ChurchSandwichSize = typeof churchSandwichSizes[number];

export function churchSandwichPortionGrams(lunchGrams: number, size: ChurchSandwichSize) {
  return Math.round(lunchGrams * size / 10);
}

const breadQuote = {
  vendor: "Bread Story",
  loafDollars: 2.62,
  deliveryDollars: 20,
  assumedLoavesPerDelivery: 25,
  portionsPerLoaf: { 6: 3, 10: 2 },
} as const;
const meatQuote = {
  vendor: "The Meats Guy",
  quotedOn: "Nov. 19",
  dollarsPerPound: new Map([
    ["French-style ham", 19.98],
    ["Prosciutto", 21.98],
  ]),
} as const;
const gramsPerPound = 453.59237;

export const churchSandwichQuoteSources = { bread: breadQuote, meat: meatQuote };

export function estimateChurchSandwichCost(recipe: ChurchSandwichBenchRecipe, size: ChurchSandwichSize) {
  const bread = (breadQuote.loafDollars + breadQuote.deliveryDollars / breadQuote.assumedLoavesPerDelivery)
    / breadQuote.portionsPerLoaf[size];
  let subtotal = bread;
  const missing: string[] = [];
  for (const { ingredient, grams } of recipe.portions) {
    const rate = meatQuote.dollarsPerPound.get(ingredient);
    if (rate === undefined) {
      missing.push(ingredient);
    } else {
      subtotal += churchSandwichPortionGrams(grams, size) / gramsPerPound * rate;
    }
  }
  return { subtotal, missing };
}
