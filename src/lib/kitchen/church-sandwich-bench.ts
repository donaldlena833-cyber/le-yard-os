export const churchSandwichRecipeKeys = ["parisien", "verger", "bellecour", "bleu", "rustique", "figaro"] as const;
export type ChurchSandwichRecipeKey = typeof churchSandwichRecipeKeys[number];

export type ChurchSandwichBenchRecipe = {
  key: ChurchSandwichRecipeKey;
  name: string;
  portions: readonly { ingredient: string; grams: number }[];
  accent: string;
  build: string;
  seconds: number;
};

export const churchSandwichBread = "10-inch baguette";

export const churchSandwichBenchRecipes: readonly ChurchSandwichBenchRecipe[] = [
  {
    key: "parisien",
    name: "Le Parisien",
    portions: [
      { ingredient: "French-style ham", grams: 72 },
      { ingredient: "cultured butter", grams: 16 },
    ],
    accent: "Classic jambon-beurre with full New York deli-style folds",
    build: "Spread butter across the crumb, then lay thin slices of ham in loose folds from end to end.",
    seconds: 60,
  },
  {
    key: "verger",
    name: "Le Verger",
    portions: [
      { ingredient: "Brie", grams: 45 },
      { ingredient: "apple", grams: 40 },
      { ingredient: "walnuts", grams: 14 },
      { ingredient: "honey", grams: 8 },
    ],
    accent: "Classic Brie and apple with coarse walnuts and a light honey finish",
    build: "Lay Brie along the crumb, overlap thin apple slices, then scatter coarsely chopped walnuts and drizzle lightly with honey.",
    seconds: 90,
  },
  {
    key: "bellecour",
    name: "Le Bellecour",
    portions: [
      { ingredient: "Brie", grams: 45 },
      { ingredient: "roasted red peppers", grams: 38 },
      { ingredient: "cornichons", grams: 18 },
      { ingredient: "Dijon", grams: 10 },
    ],
    accent: "Bistro Brie with the snap of lengthwise deli pickles",
    build: "Spread Dijon, layer Brie and well-drained peppers, then lay drained cornichons cut lengthwise along the baguette.",
    seconds: 90,
  },
  {
    key: "bleu",
    name: "Le Bleu",
    portions: [
      { ingredient: "Danish blue cheese", grams: 38 },
      { ingredient: "apple", grams: 42 },
      { ingredient: "arugula", grams: 10 },
      { ingredient: "honey", grams: 8 },
      { ingredient: "pistachios", grams: 13 },
    ],
    accent: "Classic blue cheese and apple with an apple-forward crunch and coarse pistachios",
    build: "Distribute the blue cheese evenly, layer apple along the crumb, then finish with arugula, honey and coarsely chopped pistachios.",
    seconds: 90,
  },
  {
    key: "rustique",
    name: "Le Rustique",
    portions: [
      { ingredient: "Coppa", grams: 58 },
      { ingredient: "roasted red peppers", grams: 32 },
      { ingredient: "cornichons", grams: 18 },
      { ingredient: "Dijon", grams: 10 },
      { ingredient: "arugula", grams: 12 },
    ],
    accent: "Loose folds of deli-cut coppa and a sharper pickle bite",
    build: "Spread Dijon, lay thin coppa in loose folds, add well-drained peppers and lengthwise cornichons from end to end, then tuck in the arugula.",
    seconds: 90,
  },
  {
    key: "figaro",
    name: "Le Figaro",
    portions: [
      { ingredient: "Prosciutto", grams: 55 },
      { ingredient: "Brie", grams: 42 },
      { ingredient: "fig preserves", grams: 12 },
      { ingredient: "arugula", grams: 14 },
    ],
    accent: "Sweet-salty bistro build with a peppery arugula finish",
    build: "Spread a thin layer of fig preserves over the crumb, layer Brie and loose prosciutto folds, then tuck in the arugula.",
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
