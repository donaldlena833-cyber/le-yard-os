"use client";

import { ChefHat, Plus, Save, Scale, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";

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
  const [recipes, setRecipes] = useState(starterRecipes);
  const [selectedId, setSelectedId] = useState(starterRecipes[0].id);
  const [notice, setNotice] = useState("");
  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? recipes[0];

  const activeRecipes = useMemo(() => recipes.filter((recipe) => recipe.active), [recipes]);

  function updateIngredient(index: number, quantity: string) {
    const parsed = Math.max(0, Number(quantity) || 0);
    setRecipes((current) => current.map((recipe) => recipe.id === selected.id ? { ...recipe, ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => ingredientIndex === index ? { ...ingredient, quantity: parsed } : ingredient) } : recipe));
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
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2"><StatusPill tone="positive" dot>Kitchen scope</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Le Yard · Back of house</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Recipes & portion cost</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Define the measurable components of every plate so purchasing and inventory have a reliable cost basis.</p></div><Button variant="accent" size="sm" onClick={addRecipe}><Plus className="size-3.5" /> New recipe</Button></div>
      {notice ? <p role="status" className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] text-[var(--positive)]">{notice}</p> : null}
      <section className="mt-7 grid gap-8 xl:grid-cols-[.72fr_1.28fr]"><div><SectionHeading eyebrow="Active menu specs" title={`${activeRecipes.length} recipes`} detail="Archived recipes remain available to managers for history." /><div className="border-y border-[var(--line)]">{recipes.map((recipe) => <button key={recipe.id} type="button" onClick={() => setSelectedId(recipe.id)} className={`flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 ${recipe.id === selected.id ? "bg-[var(--paper)]" : "hover:bg-[var(--paper)]"}`}><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><ChefHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{recipe.name}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">Yields {recipe.yield} {recipe.yieldUnit} · {recipe.ingredients.length} measured components</span></span><span className="text-right"><span className="numeric block text-xs font-semibold">${recipeCost(recipe).toFixed(2)}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">portion cost</span></span></button>)}</div></div>
        <article className="rounded-[22px] bg-[var(--paper)] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Recipe specification</p><h3 className="mt-3 text-2xl font-medium tracking-[-0.05em]">{selected.name}</h3><p className="mt-2 text-[10px] text-[var(--ink-faint)]">Exact weights for meaningful cost drivers. Salt, pepper, and incidental seasoning can stay out of the costing model.</p></div><Scale className="size-5 text-[var(--accent)]" /></div><div className="mt-7 overflow-hidden border-y border-[var(--line)]"><div className="grid grid-cols-[1fr_100px_55px] gap-3 bg-[var(--canvas-strong)] px-3 py-2.5 text-[9px] font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase"><span>Component</span><span>Quantity</span><span>Unit</span></div>{selected.ingredients.map((ingredient, index) => <div key={`${ingredient.name}-${index}`} className="grid grid-cols-[1fr_100px_55px] items-center gap-3 border-t border-[var(--line)] px-3 py-3"><div><p className="text-[11px] font-semibold">{ingredient.name}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">${(ingredient.quantity * ingredient.costPerUnit).toFixed(2)} current cost</p></div><input aria-label={`${ingredient.name} quantity`} type="number" min="0" step="1" value={ingredient.quantity} onChange={(event) => updateIngredient(index, event.target.value)} className="h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2 text-right text-xs" /><span className="text-[10px] text-[var(--ink-faint)]">{ingredient.unit}</span></div>)}</div><div className="mt-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] text-[var(--ink-faint)]">Estimated portion cost</p><p className="numeric mt-1 text-2xl font-semibold">${recipeCost(selected).toFixed(2)}</p></div><div className="flex gap-2"><Button variant="quiet" size="sm" onClick={archiveRecipe} disabled={!selected.active}><X className="size-3.5" /> Archive</Button><Button variant="accent" size="sm" onClick={() => setNotice(`${selected.name} saved. Inventory cost will recalculate from the latest item prices.`)}><Save className="size-3.5" /> Save recipe</Button></div></div></article>
      </section>
      <div className="mt-8 flex items-start gap-3 rounded-[16px] bg-[var(--accent-soft)]/50 px-4 py-3 text-[10px] leading-4 text-[var(--accent-strong)]"><Scale className="mt-0.5 size-4 shrink-0" /><span>Chef access is limited to Le Yard’s BOH schedule, recipe specs, and inventory context. Payroll, earnings, CRM, receipts, reports, and owner approvals stay outside this workspace.</span></div>
    </PageFrame>
  );
}
