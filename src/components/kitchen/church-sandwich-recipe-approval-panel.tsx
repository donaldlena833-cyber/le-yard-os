"use client";

import { useState, type FormEvent } from "react";
import { saveChurchSandwichFormulaAction } from "@/app/actions/workflows/church-sandwich-formula";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { churchSandwichBenchRecipes, churchSandwichBread, type ChurchSandwichBenchRecipe } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type FormulaMeasurements = ChurchSandwichFormula["measurements"];
type Ingredient = {
  name: string;
  benchQuantity: number;
  evidence?: ChurchIngredientEvidence;
};
type Props = {
  formulas: readonly ChurchSandwichFormula[];
  evidence: readonly ChurchIngredientEvidence[];
  canManage: boolean;
};

const measurementFields = [
  { key: "quantity", label: "Per sandwich" },
  { key: "measuredInput", label: "As received" },
  { key: "measuredUsable", label: "Usable after prep" },
] as const;
const fieldClass = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal tabular-nums";
const localDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const signoffStatus = {
  current: { label: "Current signoff", tone: "positive" },
  outdated: { label: "Recheck required", tone: "warning" },
  pending: { label: "Pending signoff", tone: "neutral" },
} as const;

function readMeasurement(raw: string, whole: boolean, max: number) {
  if (!(whole ? /^\d+$/ : /^\d+(\.\d{1,3})?$/).test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function RecipeSignoffForm({ recipe, ingredients, revision, onSave }: {
  recipe: ChurchSandwichBenchRecipe;
  ingredients: Ingredient[];
  revision: number;
  onSave: (saved: ChurchSandwichFormula) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { requestIdFor } = useStableRequestIds();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const reviewReference = String(form.get("reviewReference") ?? "").trim();
    const measurements: FormulaMeasurements = {};
    const problems: Record<string, string> = {};
    if (!reviewReference || reviewReference.length > 300 || /[\p{Cc}\p{Cf}]/u.test(reviewReference)) {
      problems.reviewReference = "Enter the worksheet reference in 300 characters or fewer.";
    }
    if (!form.has("confirmed")) problems.confirmed = "Confirm the measurements and supplier references for this review.";
    for (const { name, evidence } of ingredients) {
      const bread = name === churchSandwichBread;
      const quantity = bread ? 1 : readMeasurement(values[`${name}:quantity`]?.trim() ?? "", false, 2_000);
      const measuredInput = readMeasurement(values[`${name}:measuredInput`]?.trim() ?? "", bread, 1_000_000);
      const measuredUsable = readMeasurement(values[`${name}:measuredUsable`]?.trim() ?? "", bread, 1_000_000);
      if (!evidence || evidence.status !== "reviewed" || !evidence.supplierSku || !evidence.sourceReference) {
        problems[name] = "Review the exact supplier label in Supplier label evidence first.";
      } else if (quantity === null || measuredInput === null || measuredUsable === null) {
        problems[name] = bread ? "Enter positive whole counts for both bread measurements." : "Enter positive gram weights. Use up to 2,000 g per sandwich and up to three decimals.";
      } else if (quantity > measuredUsable || measuredUsable > measuredInput) {
        problems[name] = "Usable quantity must cover the portion and stay at or below the amount received.";
      } else {
        measurements[name] = { quantity, measuredInput, measuredUsable, evidenceRevision: evidence.revision, yieldBasis: bread ? "whole_each" : "weighed_usable_grams" };
      }
    }
    setErrors(problems);
    if (Object.keys(problems).length) {
      setMessage("Check the highlighted measurements and review fields.");
      return;
    }
    const payload = { recipeKey: recipe.key, expectedRevision: revision, measurements, reviewReference };
    setSaving(true);
    setMessage("");
    try {
      const result = await saveChurchSandwichFormulaAction({ ...payload, requestId: requestIdFor(recipe.key, payload) });
      if (result.ok && result.mode === "live" && result.persisted) onSave(result.data);
      else setMessage("message" in result ? result.message : "The recipe review could not be signed. Reload Kitchen if records have changed.");
    } catch {
      setMessage("The recipe review could not be signed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const ready = ingredients.every(({ evidence }) => evidence?.status === "reviewed" && evidence.supplierSku && evidence.sourceReference);
  if (!ready) return <p className="mt-3 text-xs text-[var(--ink-soft)]">Finish the required supplier label reviews to start signoff.</p>;

  const formPrefix = `recipe-signoff-${recipe.key}`;
  return (
    <form aria-label={`${recipe.name} recipe signoff`} className="mt-4" onSubmit={(event) => void save(event)} noValidate>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="text-sm font-semibold">{revision ? "Measure and sign a new revision" : "Measure and sign the recipe"}</legend>
        <p className="text-xs text-[var(--ink-soft)]">Use whole counts for bread and grams for fillings. Measure each ingredient before and after prep from the same batch. Enter the ready-to-build portion separately.</p>
        {ingredients.map(({ name }, index) => {
          const bread = name === churchSandwichBread;
          const unit = bread ? "each" : "g";
          const input = readMeasurement(values[`${name}:measuredInput`]?.trim() ?? "", bread, 1_000_000);
          const usable = readMeasurement(values[`${name}:measuredUsable`]?.trim() ?? "", bread, 1_000_000);
          const errorId = `${formPrefix}-${index}-error`;
          return (
            <fieldset className="border-t border-[var(--line)] pt-2" key={name}>
              <legend className="pr-2 text-xs font-semibold first-letter:uppercase">{name}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {measurementFields.map(({ key, label }) => (
                  <label className="block text-xs" key={key}>
                    {label} ({unit})
                    {bread && key === "quantity" ? <output className={`${fieldClass} bg-[var(--canvas-strong)]`}>1</output> : (
                      <input className={fieldClass} aria-invalid={Boolean(errors[name]) || undefined} aria-describedby={errors[name] ? errorId : undefined}
                        inputMode={bread ? "numeric" : "decimal"} maxLength={12} autoComplete="off" required
                        value={values[`${name}:${key}`] ?? ""}
                        onChange={(event) => setValues({ ...values, [`${name}:${key}`]: event.target.value })} />
                    )}
                  </label>
                ))}
              </div>
              {input !== null && usable !== null && usable <= input && <p className="mt-1 text-xs text-[var(--ink-soft)]">Measured usable yield {percent.format(usable / input)}</p>}
              {errors[name] && <p id={errorId} className="mt-1 text-xs text-[var(--danger)]">{errors[name]}</p>}
            </fieldset>
          );
        })}
        <label className="block text-xs font-semibold">
          Worksheet or measured batch reference
          <input name="reviewReference" required maxLength={300} className={fieldClass} autoComplete="off"
            aria-invalid={Boolean(errors.reviewReference) || undefined} aria-describedby={errors.reviewReference ? `${formPrefix}-reference-error` : undefined} />
        </label>
        {errors.reviewReference && <p id={`${formPrefix}-reference-error`} className="text-xs text-[var(--danger)]">{errors.reviewReference}</p>}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmed" required className="mt-1" aria-invalid={Boolean(errors.confirmed) || undefined} aria-describedby={errors.confirmed ? `${formPrefix}-confirm-error` : undefined} />
          <span>I confirm these measurements and the reviewed supplier label references shown above.</span>
        </label>
        {errors.confirmed && <p id={`${formPrefix}-confirm-error`} className="text-xs text-[var(--danger)]">{errors.confirmed}</p>}
        <Button type="submit" size="sm">{saving ? "Signing…" : "Sign measured recipe"}</Button>
      </fieldset>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
    </form>
  );
}

function RecipeApprovalRow({ recipe, formula, evidence, canManage, onSave }: {
  recipe: ChurchSandwichBenchRecipe;
  formula?: ChurchSandwichFormula;
  evidence: ReadonlyMap<string, ChurchIngredientEvidence>;
  canManage: boolean;
  onSave: (saved: ChurchSandwichFormula) => void;
}) {
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const ingredients = [
    { ingredient: churchSandwichBread, grams: 1 }, ...recipe.portions,
  ].map(({ ingredient, grams }) => ({ name: ingredient, benchQuantity: grams, evidence: evidence.get(ingredient) }));
  const current = formula?.current && ingredients.every(({ name, evidence }) =>
    evidence?.status === "reviewed" && evidence.revision === formula.measurements[name]?.evidenceRevision,
  );
  const status = signoffStatus[current ? "current" : formula ? "outdated" : "pending"];
  const formKey = [formula?.revision ?? 0, ...ingredients.map(({ evidence }) => `${evidence?.status ?? "pending"}:${evidence?.revision ?? 0}`)].join(";");

  return (
    <details className="py-2">
      <summary className="focus-ring cursor-pointer rounded-md py-2 text-sm font-semibold">
        <span className="ml-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 align-middle">
          {recipe.name}<StatusPill tone={status.tone} size="sm">{status.label}</StatusPill>
        </span>
      </summary>
      {savedRevision && <p role="status" className="my-2 text-xs text-[var(--positive)]">Recipe revision {savedRevision} signed.</p>}
      {formula && (
        <div className="my-2 space-y-1 break-words text-xs text-[var(--ink-soft)]">
          <p>Revision {formula.revision} signed{formula.reviewerName ? ` by ${formula.reviewerName}` : ""} on <time dateTime={formula.reviewedAt}>{localDate.format(new Date(formula.reviewedAt))} ET</time>.</p>
          <p>Worksheet reference · {formula.reviewReference}</p>
          {!current && <p>Review the current supplier labels and remeasure before signing a new revision. The prior signed measurements remain on record.</p>}
        </div>
      )}
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {ingredients.map(({ name, benchQuantity, evidence }) => {
          const signed = formula?.measurements[name];
          const unit = name === churchSandwichBread ? "each" : "g";
          const evidenceLabel = evidence?.status === "reviewed" ? `Reviewed label r${evidence.revision}`
            : evidence?.status === "hold" ? "Supplier label on hold" : "Supplier label review pending";
          const changed = signed && (evidence?.status !== "reviewed" || evidence.revision !== signed.evidenceRevision);
          return (
            <li key={name} className="break-words border-l border-[var(--line)] pl-3 text-xs text-[var(--ink-soft)]">
              <p className="font-semibold first-letter:uppercase">{name} <span className="font-normal">· Bench reference {benchQuantity} {unit}</span></p>
              <p>{evidenceLabel}{evidence?.supplierSku ? ` · ${evidence.supplierSku}` : ""}{evidence?.sourceReference ? ` · ${evidence.sourceReference}` : ""}</p>
              {signed && <p>Signed {number.format(signed.quantity)} {unit} per sandwich · {number.format(signed.measuredUsable)} of {number.format(signed.measuredInput)} {unit} usable ({percent.format(signed.measuredUsable / signed.measuredInput)}) · label r{signed.evidenceRevision}{changed ? " · Recheck this ingredient" : ""}.</p>}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <RecipeSignoffForm key={formKey} recipe={recipe} revision={formula?.revision ?? 0} ingredients={ingredients} onSave={(saved) => {
          setSavedRevision(saved.revision);
          onSave(saved);
        }} />
      )}
    </details>
  );
}

export function ChurchSandwichRecipeApprovalPanel({ formulas, evidence, canManage }: Props) {
  const [localSignoffs, setLocalSignoffs] = useState<Partial<Record<ChurchSandwichFormula["recipeKey"], ChurchSandwichFormula>>>({});
  const byRecipe = new Map(formulas.map((row) => [row.recipeKey, row]));
  for (const row of Object.values(localSignoffs)) {
    if ((byRecipe.get(row.recipeKey)?.revision ?? 0) < row.revision) byRecipe.set(row.recipeKey, row);
  }
  const byIngredient = new Map(evidence.map((row) => [row.ingredientKey, row]));

  return (
    <section aria-labelledby="sandwich-approval-title" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="sandwich-approval-title" className="text-lg font-semibold">Chef signoff for sandwich recipes</h2>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Signed recipes support Kitchen planning. Review the actual product, lot and discard rules in Supplier label evidence. Square setup is separate.</p>
      {!canManage && <p className="mt-2 text-xs text-[var(--ink-soft)]">Recipe management access is required to sign a measured recipe.</p>}
      <div className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {churchSandwichBenchRecipes.map((recipe) => (
          <RecipeApprovalRow key={recipe.key} recipe={recipe} formula={byRecipe.get(recipe.key)} evidence={byIngredient} canManage={canManage}
            onSave={(saved) => setLocalSignoffs((previous) => ({ ...previous, [saved.recipeKey]: saved }))} />
        ))}
      </div>
    </section>
  );
}
