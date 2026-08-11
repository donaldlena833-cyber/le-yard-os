"use client";

import { ChefHat, Plus, Save, Scale, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { PageFrame, PageHeader, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";

type Ingredient = { name: string; quantity: number; unit: "g" | "ml" | "each"; costPerUnit: number };
type Recipe = { id: string; name: string; yield: number; yieldUnit: string; active: boolean; ingredients: Ingredient[] };

const starterRecipes: Recipe[] = [
  { id: "filet", name: "Filet au poivre", yield: 1, yieldUnit: "plate", active: true, ingredients: [{ name: "Filet mignon", quantity: 180, unit: "g", costPerUnit: 0.075 }, { name: "Peppercorn sauce", quantity: 90, unit: "ml", costPerUnit: 0.018 }, { name: "Fries", quantity: 140, unit: "g", costPerUnit: 0.009 }] },
  { id: "toast", name: "Tomato toast", yield: 1, yieldUnit: "plate", active: true, ingredients: [{ name: "Roma tomatoes", quantity: 180, unit: "g", costPerUnit: 0.012 }, { name: "Sourdough", quantity: 90, unit: "g", costPerUnit: 0.014 }, { name: "Basil oil", quantity: 12, unit: "ml", costPerUnit: 0.021 }] },
  { id: "beurre", name: "Brown butter beurre blanc", yield: 12, yieldUnit: "oz", active: true, ingredients: [{ name: "Butter", quantity: 340, unit: "g", costPerUnit: 0.014 }, { name: "White wine", quantity: 180, unit: "ml", costPerUnit: 0.009 }, { name: "Shallot", quantity: 45, unit: "g", costPerUnit: 0.011 }] },
];

function recipeCost(recipe: Recipe) {
  return recipe.ingredients.reduce((sum, ingredient) => sum + ingredient.quantity * ingredient.costPerUnit, 0);
}

export function KitchenWorkspace() {
  const workspace = useWorkspaceContext();
  const canEdit = ["owner", "admin", "manager"].includes(workspace.role);
  const [recipes, setRecipes] = useState(starterRecipes);
  const [selectedId, setSelectedId] = useState(starterRecipes[0].id);
  const [notice, setNotice] = useState("");
  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? recipes[0];

  const activeRecipes = useMemo(() => recipes.filter((recipe) => recipe.active), [recipes]);

  function updateIngredient(index: number, quantity: string) {
    const parsed = Math.max(0, Number(quantity) || 0);
    setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => ingredientIndex === index ? { ...ingredient, quantity: parsed } : ingredient) } : recipe));
  }

  function updateIngredientName(index: number, name: string) {
    setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => ingredientIndex === index ? { ...ingredient, name } : ingredient) } : recipe));
  }

  function addIngredient() {
    setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, ingredients: [...recipe.ingredients, { name: `Ingredient ${recipe.ingredients.length + 1}`, quantity: 100, unit: "g", costPerUnit: 0 }] } : recipe));
    setNotice("Ingredient added. Name it and enter the measured amount for one yield.");
  }

  function removeIngredient(index: number) {
    setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, ingredients: recipe.ingredients.filter((_, ingredientIndex) => ingredientIndex !== index) } : recipe));
  }

  function addRecipe() {
    const recipe: Recipe = { id: `recipe-${Date.now()}`, name: "New kitchen recipe", yield: 1, yieldUnit: "plate", active: true, ingredients: [{ name: "Ingredient 1", quantity: 100, unit: "g", costPerUnit: 0 }] };
    setRecipes((current) => [recipe, ...current]);
    setSelectedId(recipe.id);
    setNotice("New recipe added. Add the menu components and exact portions below.");
  }

  function archiveRecipe() {
    setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, active: false } : recipe));
    setNotice(`${selected.name} archived from the active kitchen list.`);
  }

  return (
    <PageFrame width="full" className="max-w-[1400px]">
      <PageHeader
        eyebrow="Kitchen · Main dining room"
        status={<StatusPill tone="positive" dot>Kitchen</StatusPill>}
        title="Recipes & portion cost"
        detail="Define every measurable plate component so purchasing, inventory, and menu costing share one reliable source."
        actions={<Button variant="accent" onClick={addRecipe} disabled={!canEdit}><Plus className="size-4" /> New recipe</Button>}
      />
      {notice ? <p role="status" className="mt-5 rounded-2xl border border-[var(--positive)]/15 bg-[var(--positive-soft)] px-4 py-3 text-sm text-[var(--positive)]">{notice}</p> : null}
      <section className="mt-8 grid gap-8 xl:grid-cols-[.72fr_1.28fr]">
        <div>
          <SectionHeading eyebrow="Active menu specs" title={`${activeRecipes.length} recipes`} detail="Archived recipes remain available to managers for history." />
          <Surface variant="outlined" padding="none" className="overflow-hidden">
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                type="button"
                onClick={() => setSelectedId(recipe.id)}
                aria-pressed={recipe.id === selected.id}
                className={`focus-ring flex min-h-[72px] w-full items-center gap-3 border-t border-[var(--line)] px-4 py-4 text-left transition-colors first:border-0 ${recipe.id === selected.id ? "bg-[var(--accent-soft)]/35" : "hover:bg-[var(--paper)]"}`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><ChefHat className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{recipe.name}</span><span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">Yields {recipe.yield} {recipe.yieldUnit} · {recipe.ingredients.length} measured components</span></span>
                <span className="text-right"><span className="numeric block text-sm font-semibold">${recipeCost(recipe).toFixed(2)}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">portion cost</span></span>
              </button>
            ))}
          </Surface>
        </div>

        <Surface as="article" variant="raised" padding="lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Recipe specification</p>
              <input disabled={!canEdit} aria-label="Recipe name" value={selected.name} onChange={(event) => setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, name: event.target.value } : recipe))} className="mt-3 h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xl font-semibold tracking-[-0.04em] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60 sm:text-2xl" />
              <p className="mt-2 text-sm leading-6 text-[var(--ink-faint)]">Measured components, portions, and current cost for one finished yield.</p>
            </div>
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Scale className="size-5" /></span>
          </div>

          <div className="mt-7 overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">
            <div className="hidden grid-cols-[minmax(0,1fr)_110px_60px_40px] gap-3 bg-[var(--canvas-strong)] px-4 py-3 text-xs font-semibold tracking-[0.1em] text-[var(--ink-faint)] uppercase sm:grid"><span>Component</span><span>Quantity</span><span>Unit</span><span /></div>
            {selected.ingredients.map((ingredient, index) => (
              <div key={`${ingredient.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_48px_44px] items-center gap-3 border-t border-[var(--line)] px-4 py-4 first:border-0 sm:grid-cols-[minmax(0,1fr)_110px_60px_40px] sm:py-3">
                <div className="col-span-3 min-w-0 sm:col-span-1">
                  <input disabled={!canEdit} aria-label={`${ingredient.name} ingredient name`} value={ingredient.name} onChange={(event) => updateIngredientName(index, event.target.value)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm font-semibold outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60" />
                  <p className="mt-1.5 text-xs text-[var(--ink-faint)]">${(ingredient.quantity * ingredient.costPerUnit).toFixed(2)} current cost</p>
                </div>
                <input disabled={!canEdit} aria-label={`${ingredient.name} quantity`} type="number" min="0" step="1" value={ingredient.quantity} onChange={(event) => updateIngredient(index, event.target.value)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-right text-sm font-semibold outline-none focus:border-[var(--accent)] disabled:opacity-60" />
                <span className="text-sm text-[var(--ink-faint)]">{ingredient.unit}</span>
                <button disabled={!canEdit} type="button" aria-label={`Remove ${ingredient.name}`} onClick={() => removeIngredient(index)} className="focus-ring flex size-11 items-center justify-center rounded-xl text-[var(--ink-faint)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-40"><X className="size-4" /></button>
              </div>
            ))}
          </div>

          <Button disabled={!canEdit} variant="secondary" className="mt-4" onClick={addIngredient}><Plus className="size-4" /> Add ingredient</Button>
          <div className="mt-7 flex flex-col gap-4 border-t border-[var(--line)] pt-6 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs text-[var(--ink-faint)]">Estimated portion cost</p><p className="numeric mt-1 text-3xl font-semibold tracking-[-0.05em]">${recipeCost(selected).toFixed(2)}</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="quiet" onClick={archiveRecipe} disabled={!canEdit || !selected.active}><X className="size-4" /> Archive</Button><Button disabled={!canEdit} variant="accent" onClick={() => setNotice(`${selected.name} saved. Inventory cost will recalculate from the latest item prices.`)}><Save className="size-4" /> Save recipe</Button></div>
          </div>
        </Surface>
      </section>
    </PageFrame>
  );
}
