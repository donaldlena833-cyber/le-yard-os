import {
  churchSandwichBenchRecipes,
  churchSandwichBread,
  churchSandwichComponents,
  churchSandwichRecipeKeys,
  type ChurchSandwichRecipeKey,
} from "./church-sandwich-bench";

export const churchAvailabilityIngredients = churchSandwichComponents;
export type ChurchAvailabilityIngredient = typeof churchAvailabilityIngredients[number];
export type ChurchAvailabilityQuantities = Partial<Record<ChurchAvailabilityIngredient, number>>;
export type ChurchAvailabilityMix = Partial<Record<ChurchSandwichRecipeKey, number>>;
export type ChurchAvailabilityEvidence = Partial<Record<ChurchAvailabilityIngredient, "reviewed" | "hold" | "pending">>;
export type ChurchAvailabilityRecipe = {
  key: ChurchSandwichRecipeKey;
  ingredients: ChurchAvailabilityQuantities;
};
export type ChurchAvailabilityBlocker = {
  ingredient: ChurchAvailabilityIngredient | null;
  reason: "recipe_pending" | "recipe_for_catering_pending" | "supplier_pending" | "supplier_hold" | "count_needed" | "catering_short";
};

type IngredientDemand = Map<ChurchAvailabilityIngredient, number>;
type AvailabilityInput = {
  recipes: readonly ChurchAvailabilityRecipe[];
  evidence: ChurchAvailabilityEvidence;
  stock: ChurchAvailabilityQuantities;
  catering: ChurchAvailabilityMix;
  mix: ChurchAvailabilityMix;
  mode: "approved" | "bench";
};
type MixIngredient = {
  ingredient: ChurchAvailabilityIngredient;
  required: number;
  inStock: number | null;
  shortfall: number | null;
};

export const churchAvailabilityBenchRecipes: ChurchAvailabilityRecipe[] = churchSandwichBenchRecipes.map(({ key, portions }) => ({
  key,
  ingredients: { [churchSandwichBread]: 1, ...Object.fromEntries(portions.map(({ ingredient, grams }) => [ingredient, grams])) },
}));

const QUANTITY_SCALE = 1_000;
const maxStock = 1_000_000;
const maxMix = 999;

export function validChurchUsableGrams(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= maxStock
    && Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE === value;
}

export function validChurchAvailabilityStock(ingredient: ChurchAvailabilityIngredient, value: number): boolean {
  return validChurchUsableGrams(value) && (ingredient !== churchSandwichBread || Number.isInteger(value));
}

export function validChurchAvailabilityMix(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maxMix;
}

function recipeDemand(recipe: ChurchAvailabilityRecipe): IngredientDemand | null {
  const entries = Object.entries(recipe.ingredients);
  if (entries.length < 2 || recipe.ingredients[churchSandwichBread] !== 1) return null;
  const demand: IngredientDemand = new Map();
  for (const [ingredient, quantity] of entries) {
    if (quantity === undefined || !churchAvailabilityIngredients.includes(ingredient)
      || !validChurchAvailabilityStock(ingredient, quantity) || quantity <= 0) return null;
    demand.set(ingredient, Math.round(quantity * QUANTITY_SCALE));
  }
  return demand;
}

function addDemand(target: IngredientDemand, source: IngredientDemand, portions: number) {
  if (portions === 0) return;
  for (const [ingredient, quantity] of source) {
    target.set(ingredient, (target.get(ingredient) ?? 0) + quantity * portions);
  }
}

function stockUnits(stock: ChurchAvailabilityQuantities, ingredient: ChurchAvailabilityIngredient) {
  const value = stock[ingredient];
  return value !== undefined && validChurchAvailabilityStock(ingredient, value) ? Math.round(value * QUANTITY_SCALE) : null;
}

function inputBlocker(input: AvailabilityInput, ingredient: ChurchAvailabilityIngredient): ChurchAvailabilityBlocker | null {
  const review = input.evidence[ingredient];
  if (review === "hold") return { ingredient, reason: "supplier_hold" };
  if (review !== "reviewed" && input.mode === "approved") return { ingredient, reason: "supplier_pending" };
  if (stockUnits(input.stock, ingredient) === null) return { ingredient, reason: "count_needed" };
  return null;
}

function distinctBlockers(blockers: ChurchAvailabilityBlocker[]) {
  return [...new Map(blockers.map((blocker) => [`${blocker.reason}:${blocker.ingredient ?? ""}`, blocker])).values()];
}

export function calculateChurchSandwichAvailability(input: AvailabilityInput) {
  const recipes = new Map<ChurchSandwichRecipeKey, IngredientDemand | null>();
  for (const recipe of input.recipes) {
    recipes.set(recipe.key, recipes.has(recipe.key) ? null : recipeDemand(recipe));
  }

  const cateringDemand: IngredientDemand = new Map();
  const combinedDemand: IngredientDemand = new Map();
  const cateringBlockers: ChurchAvailabilityBlocker[] = [];
  const mixRecipeBlockers: ChurchAvailabilityBlocker[] = [];
  let hasDemand = false;

  for (const key of churchSandwichRecipeKeys) {
    const catering = input.catering[key] ?? 0;
    const extra = input.mix[key] ?? 0;
    if (catering === 0 && extra === 0) continue;
    hasDemand = true;
    const recipe = recipes.get(key);
    const extraIsValid = validChurchAvailabilityMix(extra);
    const combined = catering + (extraIsValid ? extra : 0);
    if (!recipe || !Number.isInteger(catering) || catering < 0 || catering > 2_147_483_647
      || [...recipe.values()].some((quantity) => !Number.isSafeInteger(quantity * combined * churchSandwichRecipeKeys.length))) {
      if (catering !== 0) cateringBlockers.push({ ingredient: null, reason: "recipe_for_catering_pending" });
      if (extra !== 0) mixRecipeBlockers.push({ ingredient: null, reason: "recipe_pending" });
      continue;
    }
    addDemand(cateringDemand, recipe, catering);
    addDemand(combinedDemand, recipe, combined);
    if (!extraIsValid) mixRecipeBlockers.push({ ingredient: null, reason: "recipe_pending" });
  }

  const planBlockers = [...cateringBlockers];
  for (const [ingredient, required] of cateringDemand) {
    const blocker = inputBlocker(input, ingredient);
    const available = stockUnits(input.stock, ingredient);
    if (blocker) planBlockers.push(blocker);
    else if (available !== null && available < required) planBlockers.push({ ingredient, reason: "catering_short" });
  }

  const rows = churchSandwichRecipeKeys.map((key) => {
    const recipe = recipes.get(key);
    const blockers = [...planBlockers];
    if (!recipe) blockers.push({ ingredient: null, reason: "recipe_pending" });
    const limits: { ingredient: ChurchAvailabilityIngredient; portions: number }[] = [];
    for (const [ingredient, perSandwich] of recipe ?? []) {
      const blocker = inputBlocker(input, ingredient);
      const available = stockUnits(input.stock, ingredient);
      if (blocker) blockers.push(blocker);
      else if (available !== null) limits.push({
        ingredient,
        portions: Math.max(0, Math.floor((available - (cateringDemand.get(ingredient) ?? 0)) / perSandwich)),
      });
    }

    const portions = blockers.length || !limits.length ? null : Math.min(...limits.map((limit) => limit.portions));
    return {
      key,
      portions,
      blockers: distinctBlockers(blockers),
      limitingIngredients: portions === null ? [] : limits.filter((limit) => limit.portions === portions).map((limit) => limit.ingredient),
    };
  });

  const mixBlockers = [...cateringBlockers, ...mixRecipeBlockers];
  const ingredients: MixIngredient[] = [];
  for (const [ingredient, required] of combinedDemand) {
    const blocker = inputBlocker(input, ingredient);
    if (blocker) mixBlockers.push(blocker);
    const available = stockUnits(input.stock, ingredient);
    const inStock = available === null ? null : available / QUANTITY_SCALE;
    const shortfall = blocker || available === null ? null : Math.max(0, required - available) / QUANTITY_SCALE;
    ingredients.push({ ingredient, required: required / QUANTITY_SCALE, inStock, shortfall });
  }
  const status = !hasDemand ? "empty" : mixBlockers.length ? "pending"
    : ingredients.some((ingredient) => (ingredient.shortfall ?? 0) > 0) ? "short" : "feasible";
  return { rows, mix: { status, blockers: distinctBlockers(mixBlockers), ingredients } } as const;
}
