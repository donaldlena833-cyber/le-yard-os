"use client";

import { useState } from "react";
import { getChurchSquareAllergenDiagnosticAction } from "@/app/actions/workflows/church-square-allergen-diagnostic";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { ChurchSquareAllergenDiagnostic, ChurchSquareAllergenDiagnosticItem } from "@/lib/integrations/church-square-allergen-diagnostic";
import { churchSandwichBenchRecipes, churchSandwichBread } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type Props = {
  formulas: readonly ChurchSandwichFormula[];
  evidence: readonly ChurchIngredientEvidence[];
};
type ReadState =
  | { status: "idle" | "loading" | "error"; message: string }
  | { status: "ready"; diagnostic: ChurchSquareAllergenDiagnostic };

const localTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const squareDetail = {
  empty: "Square returned no native allergen tags for this item.",
  unsupported: "Native allergen tags could not be confirmed for this Square product type.",
  unavailable: "Square’s native allergen fields were unavailable for this item.",
} as const;

function squareSummary(item: ChurchSquareAllergenDiagnosticItem | undefined) {
  if (!item) return "Catalog result unavailable";
  if (item.status === "missing") return "Item missing";
  if (item.status === "ambiguous") return "Multiple item matches";
  if (!item.allergens || item.allergens.status === "unavailable") return "Field unavailable";
  if (item.allergens.status === "unsupported") return "Type unsupported";
  if (item.allergens.status === "empty") return "No native tags";
  const count = item.allergens.standard.length + item.allergens.custom.length;
  return `${count} native ${count === 1 ? "tag" : "tags"}`;
}

function SquareCatalogTags({ item }: { item: ChurchSquareAllergenDiagnosticItem | undefined }) {
  if (!item) return <p>Square catalog check pending.</p>;
  if (item.status === "missing") return <p>Square returned no exact Church Street item match.</p>;
  if (item.status === "ambiguous") return <p>Square returned multiple exact Church Street matches. Review item identity in Square.</p>;
  if (!item.allergens) return <p>Square’s native allergen fields were unavailable for this item.</p>;

  const { allergens } = item;
  return (
    <>
      {allergens.status === "configured" ? (
        <dl className="space-y-1">
          {allergens.standard.length > 0 && <div><dt className="font-medium">Standard tags</dt><dd>{allergens.standard.join(", ")}</dd></div>}
          {allergens.custom.length > 0 && <div><dt className="font-medium">Custom tags</dt><dd>{allergens.custom.join(", ")}</dd></div>}
        </dl>
      ) : <p>{squareDetail[allergens.status]}</p>}
      {item.variationIds.length === 0 && <p className="mt-2">Square returned no active matching Church Street variations.</p>}
      <a href={`https://app.squareup.com/dashboard/items/library/${encodeURIComponent(item.itemId)}`}
        target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-block rounded font-semibold underline underline-offset-2"
        aria-label={`Open ${item.name} in Square Dashboard (new tab)`}>Open item in Square</a>
    </>
  );
}

export function ChurchSquareAllergenPanel({ formulas, evidence }: Props) {
  const [state, setState] = useState<ReadState>({ status: "idle", message: "" });
  const byRecipe = new Map(formulas.map((formula) => [formula.recipeKey, formula]));
  const byIngredient = new Map(evidence.map((row) => [row.ingredientKey, row]));
  const items = new Map(state.status === "ready" ? state.diagnostic.items.map((item) => [item.key, item]) : []);

  async function checkCatalog() {
    if (state.status === "loading") return;
    setState({ status: "loading", message: "Checking the Church Street Square catalog…" });
    try {
      const result = await getChurchSquareAllergenDiagnosticAction();
      if (result.ok && result.mode === "live") setState({ status: "ready", diagnostic: result.data });
      else setState({ status: "error", message: "message" in result ? result.message : "Square tags could not be checked. Try again." });
    } catch {
      setState({ status: "error", message: "Square tags could not be checked. Try again." });
    }
  }

  return (
    <section aria-labelledby="square-allergen-panel-title" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="square-allergen-panel-title" className="text-lg font-semibold">Square allergen check</h2>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Review native Square item tags beside supplier notes for the current signed recipe. Use the reviewed supplier labels and kitchen procedures when answering allergy questions.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" disabled={state.status === "loading"} onClick={() => void checkCatalog()}>
          {state.status === "loading" ? "Checking Square…" : state.status === "idle" ? "Check Square allergen tags" : "Check Square tags again"}
        </Button>
        <p role="status" className="text-xs text-[var(--ink-soft)]">
          {state.status === "ready" ? <>Square catalog checked <time dateTime={state.diagnostic.checkedAt}>{localTime.format(new Date(state.diagnostic.checkedAt))} ET</time>.</> : state.message}
        </p>
      </div>
      <p className="mt-3 text-xs text-[var(--ink-soft)]">
        POS tile and online display checks are pending. On the Church Street register, press and hold the item tile to verify what staff see. Check each ordering channel separately.
      </p>
      <div className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {churchSandwichBenchRecipes.map(({ key, name, portions }) => {
          const formula = byRecipe.get(key);
          const keys = [churchSandwichBread, ...portions.map(({ ingredient }) => ingredient)];
          const supplierRows = keys.map((ingredient) => byIngredient.get(ingredient));
          const current = formula?.current === true && supplierRows.every((row) => row?.status === "reviewed" &&
            formula.measurements[row.ingredientKey]?.evidenceRevision === row.revision &&
            Boolean(row.allergenNotes?.trim()) && Boolean(row.crossContactNotes?.trim()));
          const item = items.get(key);
          return (
            <details key={key} className="py-2">
              <summary className="focus-ring cursor-pointer rounded-md py-2 text-sm font-semibold">
                <span className="ml-1 inline-flex flex-wrap items-center gap-2 align-middle">
                  {name}
                  {state.status === "ready" && <StatusPill tone="accent" size="sm">{squareSummary(item)}</StatusPill>}
                  <StatusPill tone="neutral" size="sm">{current ? "Manual comparison pending" : "Supplier comparison pending"}</StatusPill>
                </span>
              </summary>
              <div className="grid gap-4 px-1 pb-2 pt-2 text-xs sm:grid-cols-2">
                <div className="min-w-0 break-words text-[var(--ink-soft)]">
                  <h3 className="mb-1 text-sm font-semibold text-[var(--ink)]">Square catalog tags</h3>
                  {state.status === "error" ? <p>Square tags are unavailable for this check.</p> : <SquareCatalogTags item={item} />}
                </div>
                <div className="min-w-0 break-words text-[var(--ink-soft)]">
                  <h3 className="mb-1 text-sm font-semibold text-[var(--ink)]">Internal supplier labels</h3>
                  {current && formula ? (
                    <>
                      <p>Signed recipe revision {formula.revision}. Review these supplier statements against the item tags.</p>
                      <ul className="mt-2 divide-y divide-[var(--line)]">
                        {supplierRows.map((row) => row && (
                          <li key={row.ingredientKey} className="space-y-1 py-2">
                            <p className="font-semibold first-letter:uppercase">{row.ingredientKey} · label r{row.revision}</p>
                            {(row.supplierSku || row.sourceReference) && <p>{[row.supplierSku, row.sourceReference].filter(Boolean).join(" · ")}</p>}
                            <dl className="space-y-1">
                              <div><dt className="font-medium">Allergens listed by supplier</dt><dd className="whitespace-pre-wrap">{row.allergenNotes}</dd></div>
                              <div><dt className="font-medium">Supplier cross-contact statement</dt><dd className="whitespace-pre-wrap">{row.crossContactNotes}</dd></div>
                            </dl>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : <p>{formula ? "Recheck the signed recipe against the current reviewed supplier labels before comparing." : "A current signed recipe with reviewed supplier labels is needed for comparison."}</p>}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
