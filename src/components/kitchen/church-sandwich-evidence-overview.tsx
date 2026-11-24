import { StatusPill } from "@/components/ui/status-pill";
import { churchSandwichBenchRecipes, churchSandwichBread } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import { matchesChurchSandwichFormulaEvidence } from "@/lib/kitchen/church-sandwich-formula-evidence";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type Evidence = Pick<ChurchIngredientEvidence, "ingredientKey" | "status" | "revision">;
const linkStyle = "focus-ring rounded font-semibold underline underline-offset-2";

export function ChurchSandwichEvidenceOverview({ rows, formulas, canManage }: {
  rows: readonly Evidence[];
  formulas: readonly ChurchSandwichFormula[] | null;
  canManage: boolean;
}) {
  const byIngredient = new Map(rows.map((row) => [row.ingredientKey, row]));
  const byRecipe = new Map(formulas?.map((formula) => [formula.recipeKey, formula]));

  return (
    <section aria-labelledby="church-sandwich-evidence-heading" className="mt-3 rounded-xl border border-[var(--line)] p-3 sm:p-4">
      <h3 id="church-sandwich-evidence-heading" className="scroll-mt-24 text-sm font-semibold">Sandwich evidence by recipe</h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Review the exact supplier labels and sign the measured build for each sandwich. Before service, check the batch deadline and verify the actual POS tile.</p>
      {formulas === null && <p role="status" className="mt-2 text-sm text-[var(--ink-soft)]">Recipe sign-offs are unavailable. Reload Kitchen to try again.</p>}
      <nav aria-label="Sandwich evidence checks" className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <a href="#church-sandwich-components" className={linkStyle}>Supplier label records</a>
        {formulas !== null && <a href="#sandwich-approval-title" className={linkStyle}>Chef sign-off</a>}
        <a href="#church-batch-queue-heading" className={linkStyle}>Open batches</a>
        {canManage && formulas !== null && <a href="#square-allergen-panel-title" className={linkStyle}>Square allergen check</a>}
      </nav>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {churchSandwichBenchRecipes.map((recipe) => {
          const formula = byRecipe.get(recipe.key);
          const signed = matchesChurchSandwichFormulaEvidence(formula, byIngredient);
          const ingredients = [churchSandwichBread, ...recipe.portions.map(({ ingredient }) => ingredient)];
          const records = ingredients.map((ingredient) => ({ ingredient, evidence: byIngredient.get(ingredient) }));
          const pending = records.filter(({ evidence }) => !evidence || evidence.status === "pending").map(({ ingredient }) => ingredient);
          const held = records.filter(({ evidence }) => evidence?.status === "hold").map(({ ingredient }) => ingredient);
          const reviewed = records.filter(({ evidence }) => evidence?.status === "reviewed");
          return (
            <div key={recipe.key} className="min-w-0 rounded-lg border border-[var(--line)] p-3">
              <dt className="text-sm font-semibold">{recipe.name}</dt>
              <dd className="mt-1 space-y-1 text-xs text-[var(--ink-soft)]">
                {formula && signed ? <StatusPill tone="positive" size="sm">Current signed recipe r{formula.revision}</StatusPill>
                  : formula ? <StatusPill tone="warning" size="sm">Recipe needs re-signoff</StatusPill>
                  : formulas !== null && <StatusPill size="sm">Chef sign-off pending</StatusPill>}
                <p>{reviewed.length} of {ingredients.length} ingredient records reviewed</p>
                {held.length > 0 && <p className="font-semibold text-[var(--warning)]">Hold · {held.join(", ")}</p>}
                {pending.length > 0 && <p>Pending · {pending.join(", ")}</p>}
                {reviewed.length > 0 && <p>Reviewed revisions · {reviewed.map(({ ingredient, evidence }) => `${ingredient} r${evidence?.revision}`).join(", ")}</p>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
