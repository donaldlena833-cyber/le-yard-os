import { churchSandwichBenchRecipes, churchSandwichBread } from "@/lib/kitchen/church-sandwich-bench";

type Evidence = {
  ingredientKey: string;
  status: "pending" | "hold" | "reviewed";
  revision: number;
};

export function ChurchSandwichEvidenceOverview({ rows }: { rows: readonly Evidence[] }) {
  const byIngredient = new Map(rows.map((row) => [row.ingredientKey, row]));

  return (
    <details className="rounded-xl border border-[var(--line)] p-3 sm:p-4">
      <summary className="focus-ring cursor-pointer rounded text-sm font-semibold">Sandwich evidence by recipe</summary>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Match the current packs and recipe to these ingredient revisions. Use the chef’s signed matrix and check the POS tile before answering allergy requests.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {churchSandwichBenchRecipes.map((recipe) => {
          const ingredients = [churchSandwichBread, ...recipe.portions.map(({ ingredient }) => ingredient)];
          const records = ingredients.map((ingredient) => ({ ingredient, evidence: byIngredient.get(ingredient) }));
          const pending = records.filter(({ evidence }) => !evidence || evidence.status === "pending").map(({ ingredient }) => ingredient);
          const held = records.filter(({ evidence }) => evidence?.status === "hold").map(({ ingredient }) => ingredient);
          const reviewed = records.filter(({ evidence }) => evidence?.status === "reviewed");
          return (
            <div key={recipe.key} className="min-w-0 rounded-lg border border-[var(--line)] p-3">
              <dt className="text-sm font-semibold">{recipe.name}</dt>
              <dd className="mt-1 space-y-1 text-xs text-[var(--ink-soft)]">
                <p>{reviewed.length} of {ingredients.length} ingredient records reviewed</p>
                {held.length > 0 && <p className="font-semibold text-[var(--warning)]">Hold · {held.join(", ")}</p>}
                {pending.length > 0 && <p>Pending · {pending.join(", ")}</p>}
                {reviewed.length > 0 && <p>Reviewed revisions · {reviewed.map(({ ingredient, evidence }) => `${ingredient} r${evidence?.revision}`).join(", ")}</p>}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
