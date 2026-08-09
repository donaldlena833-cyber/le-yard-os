import { describe, expect, it } from "vitest";

import {
  menuCategories,
  menuIngredients,
  menuRecipes,
} from "../../../scripts/data/le-yard-opening-menu-v1.mjs";

describe("Le Yard opening menu recipe specification", () => {
  it("contains the photographed twenty-dish menu with unique names and prices", () => {
    expect(menuRecipes).toHaveLength(20);
    expect(new Set(menuRecipes.map((recipe) => recipe.name)).size).toBe(menuRecipes.length);
    expect(menuRecipes.every((recipe) => Number.isInteger(recipe.menuPriceCents) && recipe.menuPriceCents > 0)).toBe(true);
    expect(new Set(menuRecipes.map((recipe) => recipe.section))).toEqual(
      new Set(["Starters", "To Share", "Sides", "Mains", "Desserts"]),
    );
  });

  it("uses only declared fresh ingredient records with exact gram portions", () => {
    const ingredientNames = new Set(menuIngredients.map((item) => item.name));
    expect(new Set(menuIngredients.map((item) => item.name)).size).toBe(menuIngredients.length);
    expect(menuIngredients.every((item) => menuCategories.includes(item.category))).toBe(true);

    for (const recipe of menuRecipes) {
      expect(recipe.presentation.trim().length).toBeGreaterThan(20);
      expect(recipe.ingredients.length).toBeGreaterThanOrEqual(4);
      expect(new Set(recipe.ingredients.map((entry) => entry.name)).size).toBe(recipe.ingredients.length);
      for (const entry of recipe.ingredients) {
        expect(ingredientNames.has(entry.name)).toBe(true);
        expect(entry.grams).toBeGreaterThan(0);
        expect(entry.wasteFactor).toBeGreaterThanOrEqual(0);
        expect(entry.wasteFactor).toBeLessThan(1);
      }
    }
  });

  it("contains no vendor, par, pack, stock, or price-history assignments", () => {
    const serialized = JSON.stringify({ menuCategories, menuIngredients, menuRecipes }).toLowerCase();
    for (const forbidden of ["vendorid", "vendoritems", "parquantity", "packquantity", "onhand", "pricehistory"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
