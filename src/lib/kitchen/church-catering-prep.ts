import { z } from "zod";
import { churchSandwichBenchRecipes, churchSandwichRecipeKeys } from "./church-sandwich-bench";

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

export function calculateChurchCateringPrep({ portions }: ChurchCateringPrepDay) {
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
    ingredients: [...ingredients]
      .map(([ingredient, grams]) => ({ ingredient, grams }))
      .sort((left, right) => left.ingredient.localeCompare(right.ingredient, "en-US")),
    sandwiches: churchSandwichBenchRecipes.filter((recipe) => portions[recipe.key] > 0)
      .map((recipe) => ({ name: recipe.name, quantity: portions[recipe.key] })),
  };
}
