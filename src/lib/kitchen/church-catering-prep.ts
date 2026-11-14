import { z } from "zod";
import {
  churchSandwichBenchRecipes, churchSandwichBread, churchSandwichRecipeKeys,
} from "./church-sandwich-bench";
import type { ChurchAvailabilityRecipe } from "./church-sandwich-availability";

const count = z.number().int().min(0).max(2_147_483_647);
const dailyPortions = z.record(z.enum(churchSandwichRecipeKeys), count);
const day = z.object({
  serviceDate: z.iso.date(),
  portions: dailyPortions,
  jobCount: count.min(1),
});

export const churchCateringPrepDays = z.array(day).max(7).refine((days) =>
  days.every((entry, index) => !index || days[index - 1].serviceDate < entry.serviceDate),
);

export type ChurchCateringPrepDay = z.infer<typeof day>;

type PrepIngredient = { ingredient: string; grams: number };
type SignedPrep = {
  status: "ready" | "pending" | "unavailable";
  pendingNames: string[];
  ingredients: PrepIngredient[];
};

function ingredientList(ingredients: Map<string, number>, scale = 1): PrepIngredient[] {
  return [...ingredients]
    .map(([ingredient, amount]) => ({ ingredient, grams: amount / scale }))
    .sort((left, right) => left.ingredient.localeCompare(right.ingredient, "en-US"));
}

function signedChurchCateringPrep(
  portions: ChurchCateringPrepDay["portions"],
  recipes: readonly ChurchAvailabilityRecipe[] | null,
): SignedPrep {
  if (!recipes) return { status: "unavailable", pendingNames: [], ingredients: [] };
  const byKey = new Map(recipes.map(({ key, ingredients }) => [key, ingredients]));
  const published = churchSandwichBenchRecipes.filter(({ key }) => portions[key] > 0);
  const pendingNames = published.filter(({ key }) => !byKey.has(key)).map(({ name }) => name);
  if (pendingNames.length) return { status: "pending", pendingNames, ingredients: [] };

  const scale = 1_000;
  const totals = new Map<string, number>();
  for (const { key } of published) {
    const recipe = byKey.get(key);
    if (recipe?.[churchSandwichBread] !== 1) return { status: "unavailable", pendingNames: [], ingredients: [] };
    for (const [ingredient, perSandwich] of Object.entries(recipe)) {
      if (ingredient === churchSandwichBread) continue;
      if (perSandwich === undefined || perSandwich <= 0) return { status: "unavailable", pendingNames: [], ingredients: [] };
      const total = (totals.get(ingredient) ?? 0) + Math.round(perSandwich * scale) * portions[key];
      if (!Number.isSafeInteger(total)) return { status: "unavailable", pendingNames: [], ingredients: [] };
      totals.set(ingredient, total);
    }
  }
  return { status: "ready", pendingNames: [], ingredients: ingredientList(totals, scale) };
}

export function calculateChurchCateringPrep(
  { portions }: ChurchCateringPrepDay,
  { recipes = null }: { recipes?: readonly ChurchAvailabilityRecipe[] | null } = {},
) {
  const ingredients = new Map<string, number>();
  let baguettes = 0;
  let assemblySeconds = 0;

  for (const recipe of churchSandwichBenchRecipes) {
    const quantity = portions[recipe.key];
    if (quantity === 0) continue;
    baguettes += quantity;
    assemblySeconds += quantity * recipe.seconds;
    for (const { ingredient, grams } of recipe.portions) {
      ingredients.set(ingredient, (ingredients.get(ingredient) ?? 0) + quantity * grams);
    }
  }

  return {
    baguettes,
    assemblySeconds,
    ingredients: ingredientList(ingredients),
    sandwiches: churchSandwichBenchRecipes.filter((recipe) => portions[recipe.key] > 0)
      .map((recipe) => ({ name: recipe.name, quantity: portions[recipe.key] })),
    signed: signedChurchCateringPrep(portions, recipes),
  };
}
