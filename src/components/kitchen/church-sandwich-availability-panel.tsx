"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import {
  calculateChurchSandwichAvailability,
  churchAvailabilityBenchRecipes,
  churchAvailabilityIngredients,
  validChurchAvailabilityMix,
  validChurchAvailabilityStock,
  type ChurchAvailabilityEvidence,
  type ChurchAvailabilityIngredient,
  type ChurchAvailabilityMix,
  type ChurchAvailabilityQuantities,
  type ChurchAvailabilityRecipe,
} from "@/lib/kitchen/church-sandwich-availability";
import { churchSandwichBenchRecipes, churchSandwichBread, churchSandwichRecipeKeys, type ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";

type Availability = ReturnType<typeof calculateChurchSandwichAvailability>;
type Blocker = Availability["rows"][number]["blockers"][number];
type Props = {
  approvedRecipes: readonly ChurchAvailabilityRecipe[];
  evidence: ChurchAvailabilityEvidence;
  catering: ChurchCateringPrepDay | null;
  serviceDate: string;
};

const fieldClass = "focus-ring mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal tabular-nums";
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const dateLabel = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
const blockerLabels: Record<Blocker["reason"], string> = {
  recipe_pending: "Approved recipe and yield needed",
  recipe_for_catering_pending: "Approved recipe and yield needed for a published catering job",
  supplier_pending: "Supplier evidence needs review",
  supplier_hold: "Supplier evidence on hold",
  count_needed: "Usable count needed",
  catering_short: "Catering still to build needs more stock",
};
const mixLabels = {
  empty: { label: "No portions to check", tone: "neutral" },
  pending: { label: "Pending", tone: "neutral" },
  feasible: { label: "Fits entered stock", tone: "positive" },
  short: { label: "Short on stock", tone: "warning" },
} as const;

function quantityText(ingredient: ChurchAvailabilityIngredient, quantity: number | null) {
  if (quantity === null) return "Unknown";
  return `${number.format(quantity)} ${ingredient === churchSandwichBread ? "each" : "g"}`;
}

function blockersText(blockers: readonly Blocker[]) {
  const byReason = new Map<Blocker["reason"], string[]>();
  for (const { reason, ingredient } of blockers) {
    const ingredients = byReason.get(reason) ?? [];
    if (ingredient) ingredients.push(ingredient);
    byReason.set(reason, ingredients);
  }
  return [...byReason].map(([reason, ingredients]) => `${blockerLabels[reason]}${ingredients.length ? ` · ${ingredients.join(", ")}` : ""}.`).join(" ");
}

export function ChurchSandwichAvailabilityPanel({ approvedRecipes, evidence, catering, serviceDate }: Props) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const todayCatering = catering?.serviceDate === serviceDate ? catering : null;
  const stockBasis = JSON.stringify([serviceDate, todayCatering?.jobCount ?? 0, churchSandwichRecipeKeys.map((key) =>
    [todayCatering?.portions[key] ?? 0, todayCatering?.packedPortions[key] ?? 0])]);
  const [selectedMode, setMode] = useState<"approved" | "bench" | null>(null);
  const [stockEntry, setStockEntry] = useState<{
    basis: string;
    fields: Partial<Record<ChurchAvailabilityIngredient, string>>;
  }>({ basis: stockBasis, fields: {} });
  const [mixFields, setMixFields] = useState<Partial<Record<ChurchSandwichRecipeKey, string>>>({});
  // Measurements can include ingredients used by a newly packed portion. Clear them before recalculating.
  const sameStockBasis = stockEntry.basis === stockBasis;
  if (!sameStockBasis) setStockEntry({ basis: stockBasis, fields: {} });
  const stockFields = sameStockBasis ? stockEntry.fields : {};
  const mode = selectedMode ?? (approvedRecipes.length ? "approved" : "bench");
  const isRehearsal = mode === "bench";
  const stock: ChurchAvailabilityQuantities = {};
  const mix: ChurchAvailabilityMix = {};
  const invalidStock = new Set<ChurchAvailabilityIngredient>();
  const invalidMix = new Set<ChurchSandwichRecipeKey>();

  for (const ingredient of churchAvailabilityIngredients) {
    const input = stockFields[ingredient]?.trim();
    if (!input) continue;
    const value = Number(input);
    if (/^\d+(\.\d{1,3})?$/.test(input) && validChurchAvailabilityStock(ingredient, value)) stock[ingredient] = value;
    else invalidStock.add(ingredient);
  }
  for (const { key } of churchSandwichBenchRecipes) {
    const input = mixFields[key]?.trim();
    if (!input) continue;
    const value = Number(input);
    if (/^\d+$/.test(input) && validChurchAvailabilityMix(value)) mix[key] = value;
    else invalidMix.add(key);
  }

  const result = calculateChurchSandwichAvailability({
    recipes: isRehearsal ? churchAvailabilityBenchRecipes : approvedRecipes,
    evidence,
    stock,
    catering: todayCatering?.remainingPortions ?? {},
    mix,
    mode,
  });
  const rows = new Map(result.rows.map((row) => [row.key, row]));
  const mixStatus = invalidMix.size > 0 ? mixLabels.pending : mixLabels[result.mix.status];

  return (
    <section aria-labelledby="sandwich-availability-title" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sandwich-availability-title" className="text-lg font-semibold">Sandwich portion feasibility</h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Check Church Street portions against usable stock you measure. Counts are used only in this planning view.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => {
          setStockEntry({ basis: stockBasis, fields: {} });
          startRefresh(() => router.refresh());
        }}>
          {refreshing ? "Refreshing Kitchen…" : "Refresh Kitchen"}
        </Button>
      </div>
      <fieldset className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <legend className="mb-2 text-xs font-semibold">Calculation basis</legend>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="sandwich-availability-mode" checked={!isRehearsal} onChange={() => setMode("approved")} />
          Approved recipes
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="sandwich-availability-mode" checked={isRehearsal} onChange={() => setMode("bench")} />
          Bench rehearsal
        </label>
      </fieldset>
      <p className="mt-2 text-xs text-[var(--ink-soft)]">
        {approvedRecipes.length === 0 && "No approved recipes are available. "}
        {isRehearsal
          ? "Rehearsal uses draft recipes. Review the chef’s approved recipe before planning service. Ingredients on hold stay blocked."
          : "Each approved recipe needs a documented yield, reviewed supplier evidence and usable counts."}
      </p>

      <details className="mt-4 border-t border-[var(--line)] pt-3">
        <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Enter usable stock</summary>
        <div className="my-3">
          <p className="text-sm text-[var(--ink-soft)]">Count whole baguettes and weigh ready-to-use fillings in grams. Include ingredients set aside for catering still to build. Leave unknown quantities blank and enter zero after confirming stock is empty. Refresh Kitchen and recount after packing or changing a plan. Updated catering totals clear entered stock.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {churchAvailabilityIngredients.map((ingredient, index) => {
              const isBread = ingredient === churchSandwichBread;
              const invalid = invalidStock.has(ingredient);
              const errorId = `availability-stock-error-${index}`;
              return (
                <div key={ingredient}>
                  <label className="block text-xs font-semibold">
                    <span className="first-letter:uppercase">{ingredient} ({isBread ? "each" : "g"})</span>
                    <input
                      type="text" inputMode={isBread ? "numeric" : "decimal"} autoComplete="off" maxLength={14} disabled={refreshing}
                      value={stockFields[ingredient] ?? ""}
                      onChange={(event) => setStockEntry({ basis: stockBasis, fields: { ...stockFields, [ingredient]: event.target.value } })}
                      aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className={fieldClass}
                    />
                  </label>
                  {invalid && <p id={errorId} className="mt-1 text-xs text-[var(--danger)]">
                    {isBread ? "Enter a whole count from 0 to 1,000,000." : "Enter 0 to 1,000,000 g with up to three decimals."}
                  </p>}
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <div className="mt-4 border-y border-[var(--line)] py-3">
        <h3 className="text-sm font-semibold">Published catering for <time dateTime={serviceDate}>{dateLabel.format(new Date(`${serviceDate}T00:00:00Z`))}</time></h3>
        {todayCatering ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-soft)]">
            {churchSandwichBenchRecipes.filter(({ key }) => todayCatering.portions[key] > 0).map(({ key, name }) => (
              <li key={key}>
                {name} · {number.format(todayCatering.portions[key])} published · {number.format(todayCatering.packedPortions[key])} packed · {number.format(todayCatering.remainingPortions[key])} still to build
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-xs text-[var(--ink-soft)]">No published catering portions for this service day.</p>}
      </div>

      <div className="mt-4 overflow-x-auto">
        <h3 className="text-sm font-semibold">{isRehearsal ? "Rehearsal limits" : "Stand-alone portion limits"}</h3>
        <p className="my-2 text-xs text-[var(--ink-soft)]" id="availability-capacity-note">
          Individual limits set aside stock for catering still to build. These sandwiches share stock, so use the combined check to plan more than one sandwich.
        </p>
        <table className="w-full text-left text-sm" aria-describedby="availability-capacity-note">
          <caption className="sr-only">Stand-alone sandwich limits after outstanding catering</caption>
          <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
            <tr>
              <th scope="col" className="py-2 pr-3">Sandwich</th>
              <th scope="col" className="py-2 pr-3">Portions</th>
              <th scope="col" className="py-2">Evidence or limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {churchSandwichBenchRecipes.map(({ key, name }) => {
              const row = rows.get(key);
              const portions = row?.portions;
              return (
                <tr className="align-top" key={key}>
                  <th scope="row" className="py-2 pr-3 font-medium">{name}</th>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                    {portions == null ? <StatusPill tone="neutral" size="sm">Pending</StatusPill> : number.format(portions)}
                  </td>
                  <td className="py-2 text-xs text-[var(--ink-soft)]">
                    {row?.blockers.length ? blockersText(row.blockers) : row?.limitingIngredients.join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="mt-4 border-t border-[var(--line)] pt-3">
        <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Check a combined sandwich mix</summary>
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold">Extra café portions</legend>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">Enter up to 999 additional portions per sandwich. Leave these blank to check catering still to build.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {churchSandwichBenchRecipes.map(({ key, name }) => {
              const invalid = invalidMix.has(key);
              const errorId = `availability-mix-error-${key}`;
              return (
                <div key={key}>
                  <label className="block text-xs font-semibold">
                    {name}
                    <input
                      type="text" inputMode="numeric" autoComplete="off" maxLength={8}
                      value={mixFields[key] ?? ""}
                      onChange={(event) => setMixFields({ ...mixFields, [key]: event.target.value })}
                      aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className={fieldClass}
                    />
                  </label>
                  {invalid && <p id={errorId} className="mt-1 text-xs text-[var(--danger)]">Enter a whole number from 0 to 999.</p>}
                </div>
              );
            })}
          </div>
        </fieldset>
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
          <StatusPill tone={mixStatus.tone} size="sm">{isRehearsal ? `Rehearsal · ${mixStatus.label}` : mixStatus.label}</StatusPill>
          {invalidMix.size > 0 ? "Correct the extra portion quantities." : blockersText(result.mix.blockers)}
        </div>
        {invalidMix.size === 0 && result.mix.ingredients.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Ingredients needed for the combined sandwich mix</caption>
              <thead className="border-b border-[var(--line)] text-[var(--ink-soft)]">
                <tr>
                  <th scope="col" className="py-2 pr-3">Ingredient</th>
                  <th scope="col" className="py-2 pr-3">Required</th>
                  <th scope="col" className="py-2 pr-3">Usable stock</th>
                  <th scope="col" className="py-2">Shortfall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] tabular-nums">
                {result.mix.ingredients.map(({ ingredient, required, inStock, shortfall }) => (
                  <tr key={ingredient}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium first-letter:uppercase">{ingredient}</th>
                    <td className="whitespace-nowrap py-2 pr-3">{quantityText(ingredient, required)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{quantityText(ingredient, inStock)}</td>
                    <td className="whitespace-nowrap py-2">{quantityText(ingredient, shortfall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
