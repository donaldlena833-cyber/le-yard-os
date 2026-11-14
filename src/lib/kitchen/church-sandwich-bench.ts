export type ChurchSandwichBenchRecipe = {
  name: string;
  portions: readonly { ingredient: string; grams: number }[];
  accent: string;
  build: string;
  seconds: number;
};

export const churchSandwichBread = "10-inch baguette";

export const churchSandwichBenchRecipes: readonly ChurchSandwichBenchRecipe[] = [
  {
    name: "Le Parisien",
    portions: [
      { ingredient: "French-style ham", grams: 72 },
      { ingredient: "cultured butter", grams: 16 },
    ],
    accent: "Full deli-style loose ham folds",
    build: "Spread butter across the crumb and distribute the loose ham folds to both ends.",
    seconds: 60,
  },
  {
    name: "Le Verger",
    portions: [
      { ingredient: "Brie", grams: 45 },
      { ingredient: "apple", grams: 40 },
      { ingredient: "walnuts", grams: 14 },
      { ingredient: "honey", grams: 8 },
    ],
    accent: "A little more walnut crunch and a lighter honey finish",
    build: "Lay Brie, overlap thin apple slices, distribute walnuts, then drizzle honey.",
    seconds: 90,
  },
  {
    name: "Le Bellecour",
    portions: [
      { ingredient: "Brie", grams: 45 },
      { ingredient: "roasted red peppers", grams: 38 },
      { ingredient: "cornichons", grams: 18 },
      { ingredient: "Dijon", grams: 10 },
    ],
    accent: "Extra pickle snap with drier peppers",
    build: "Spread Dijon, layer Brie and drained peppers, then distribute drained cornichons.",
    seconds: 90,
  },
  {
    name: "Le Bleu",
    portions: [
      { ingredient: "Danish blue cheese", grams: 38 },
      { ingredient: "apple", grams: 42 },
      { ingredient: "arugula", grams: 10 },
      { ingredient: "honey", grams: 8 },
      { ingredient: "pistachios", grams: 13 },
    ],
    accent: "Apple leads with a pistachio crunch",
    build: "Distribute blue cheese and apple, then add arugula, honey and pistachios.",
    seconds: 90,
  },
  {
    name: "Le Rustique",
    portions: [
      { ingredient: "Coppa", grams: 58 },
      { ingredient: "roasted red peppers", grams: 32 },
      { ingredient: "cornichons", grams: 18 },
      { ingredient: "Dijon", grams: 10 },
      { ingredient: "arugula", grams: 12 },
    ],
    accent: "Fuller deli folds and a brighter pickle bite",
    build: "Spread Dijon, fold coppa along the crumb, then add drained peppers, cornichons and arugula.",
    seconds: 90,
  },
  {
    name: "Le Figaro",
    portions: [
      { ingredient: "Prosciutto", grams: 55 },
      { ingredient: "Brie", grams: 42 },
      { ingredient: "fig preserves", grams: 12 },
      { ingredient: "arugula", grams: 14 },
    ],
    accent: "A peppery green finish with a modest fig spread",
    build: "Spread fig preserves, layer Brie and loose prosciutto folds, then tuck the arugula inside.",
    seconds: 90,
  },
];

export const churchSandwichComponents = [
  churchSandwichBread,
  ...new Set(churchSandwichBenchRecipes.flatMap((recipe) =>
    recipe.portions.map(({ ingredient }) => ingredient),
  )),
];

export function sandwichFillingGrams(recipe: ChurchSandwichBenchRecipe): number {
  return recipe.portions.reduce((total, portion) => total + portion.grams, 0);
}

export function sandwichGramsText(recipe: ChurchSandwichBenchRecipe): string {
  return recipe.portions.map(({ ingredient, grams }) => `${ingredient} ${grams} g`).join(", ");
}
