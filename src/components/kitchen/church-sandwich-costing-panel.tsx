"use client";

import { useState, useTransition, type FormEvent } from "react";
import { recordChurchSandwichPackCostAction } from "@/app/actions/workflows/church-sandwich-costing";
import { Button } from "@/components/ui/button";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { churchSandwichBread } from "@/lib/kitchen/church-sandwich-bench";
import { summarizeChurchSandwichCosts, type ChurchSandwichPackCost } from "@/lib/kitchen/church-sandwich-costing";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type Props = {
  formulas: readonly ChurchSandwichFormula[];
  evidence: readonly ChurchIngredientEvidence[];
  costs: readonly ChurchSandwichPackCost[] | null;
  canRecord?: boolean;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const fieldClass = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal tabular-nums";

function PackCostForm({ evidence }: { evidence: readonly ChurchIngredientEvidence[] }) {
  const [selectedKey, setSelectedKey] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const selected = evidence.find(({ ingredientKey }) => ingredientKey === selectedKey);
  const bread = selected?.ingredientKey === churchSandwichBread;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const quantityText = String(form.get("packQuantity") ?? "").trim();
    const packQuantity = Number(quantityText);
    const price = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(form.get("packPrice") ?? "").trim());
    const packCostCents = price ? Number(price[1]) * 100 + Number((price[2] ?? "").padEnd(2, "0")) : 0;
    const invoiceDate = String(form.get("invoiceDate") ?? "");
    const invoiceReference = String(form.get("invoiceReference") ?? "").trim();
    if (!(bread ? /^\d+$/ : /^\d+(\.\d{1,3})?$/).test(quantityText) || packQuantity <= 0 || packQuantity > 1_000_000) {
      setMessage(bread ? "Enter a positive whole baguette count up to 1,000,000."
        : "Enter a positive weight in grams up to 1,000,000, with up to three decimals.");
      return;
    }
    if (!Number.isSafeInteger(packCostCents) || packCostCents < 1 || packCostCents > 100_000_000) {
      setMessage("Enter a positive pack total in USD up to $1,000,000.00, with up to two decimals.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || !invoiceReference || invoiceReference.length > 160 || /[\p{Cc}\p{Cf}]/u.test(invoiceReference)) {
      setMessage("Enter the invoice date and an invoice line reference up to 160 characters.");
      return;
    }

    const payload = { ingredientKey: selected.ingredientKey, evidenceRevision: selected.revision, packQuantity, packCostCents, invoiceDate, invoiceReference };
    setMessage("");
    startTransition(async () => {
      try {
        const result = await recordChurchSandwichPackCostAction({ ...payload, requestId: requestIdFor(selected.ingredientKey, payload) });
        if (result.ok && result.mode === "live" && result.persisted) {
          rotateRequestId(selected.ingredientKey);
          formElement.reset();
          setSelectedKey("");
          setMessage("Invoice pack cost recorded.");
        } else {
          setMessage("message" in result ? result.message : "The pack cost could not be confirmed. Try again.");
        }
      } catch {
        setMessage("The pack cost could not be confirmed. Try again.");
      }
    });
  }

  if (evidence.length === 0) return <p className="mt-3 text-xs text-[var(--ink-soft)]">Review a supplier label before recording its invoice pack cost.</p>;
  return (
    <details className="mt-3 border-t border-[var(--line)] pt-3">
      <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Record an invoice pack cost</summary>
      <form aria-label="Record an invoice pack cost" className="mt-3" onSubmit={save} noValidate>
        <fieldset disabled={pending} className="space-y-3">
          <label className="block text-xs font-semibold">Reviewed ingredient
            <select className={fieldClass} value={selected?.ingredientKey ?? ""} onChange={(event) => {
              setSelectedKey(event.target.value);
              setMessage("");
            }} required>
              <option value="">Choose an ingredient</option>
              {evidence.map(({ ingredientKey }) => <option value={ingredientKey} key={ingredientKey}>{ingredientKey}</option>)}
            </select>
          </label>
          {selected && (
            <div key={`${selected.ingredientKey}:${selected.revision}`} className="space-y-3">
              <p className="break-words text-xs text-[var(--ink-soft)]">Supplier SKU {selected.supplierSku} · Label revision {selected.revision}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold">{bread ? "Whole baguettes in the purchased pack" : "Purchased pack weight before trim or drain (g)"}
                  <input className={fieldClass} name="packQuantity" inputMode={bread ? "numeric" : "decimal"} maxLength={11} autoComplete="off" required />
                </label>
                <label className="block text-xs font-semibold">Pack total (USD)
                  <input className={fieldClass} name="packPrice" inputMode="decimal" maxLength={10} autoComplete="off" required />
                </label>
                <label className="block text-xs font-semibold">Invoice date
                  <input className={fieldClass} name="invoiceDate" type="date" required />
                </label>
                <label className="block text-xs font-semibold">Invoice line reference
                  <input className={fieldClass} name="invoiceReference" maxLength={160} autoComplete="off" required />
                </label>
              </div>
              <Button type="submit" size="sm">{pending ? "Saving…" : "Save pack cost"}</Button>
            </div>
          )}
        </fieldset>
        <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
      </form>
    </details>
  );
}

export function ChurchSandwichCostingPanel({ formulas, evidence, costs, canRecord = false }: Props) {
  const summaries = costs ? summarizeChurchSandwichCosts(formulas, evidence, costs) : null;
  const reviewed = evidence.filter(({ status, supplierSku }) => status === "reviewed" && supplierSku);
  const currentCosts = costs?.filter((cost) => reviewed.some(({ ingredientKey, revision, supplierSku }) =>
    cost.ingredientKey === ingredientKey && cost.evidenceRevision === revision && cost.supplierSku === supplierSku));

  return (
    <section aria-labelledby="church-sandwich-costing-title" className="my-4 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
      <h2 id="church-sandwich-costing-title" className="text-base font-semibold">Sandwich ingredient costs</h2>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">Per sandwich, from the current signed recipe, measured usable yield and invoice pack costs.</p>
      {summaries ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {summaries.map(({ key, name, status, totalCents, missingIngredients }) => (
            <li key={key} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              <p className="font-semibold">{name}</p>
              {status === "costed" && totalCents !== null && <p className="tabular-nums">{usd.format(totalCents / 100)} per sandwich</p>}
              {status === "needs_recipe" && <p className="text-xs text-[var(--ink-soft)]">Needs a current signed recipe</p>}
              {status === "needs_costs" && <p className="text-xs text-[var(--ink-soft)]">Missing invoice costs for {missingIngredients.join(", ")}</p>}
              {status === "unavailable" && <p className="text-xs text-[var(--ink-soft)]">Check pack quantities and prices</p>}
            </li>
          ))}
        </ul>
      ) : <p role="status" className="mt-3 text-sm text-[var(--ink-soft)]">Invoice pack costs could not be loaded. Refresh Kitchen to try again.</p>}
      {canRecord && <PackCostForm evidence={reviewed} />}
      {currentCosts && currentCosts.length > 0 && (
        <details className="mt-3 border-t border-[var(--line)] pt-3">
          <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Current supplier pack costs</summary>
          <ul className="mt-2 divide-y divide-[var(--line)] text-xs">
            {currentCosts.map((cost) => (
              <li className="space-y-1 break-words py-2" key={`${cost.ingredientKey}:${cost.evidenceRevision}:${cost.recordedAt}`}>
                <p className="font-semibold first-letter:uppercase">{cost.ingredientKey}</p>
                <p className="tabular-nums">{usd.format(cost.packCostCents / 100)} for {quantity.format(cost.packQuantity)} {cost.ingredientKey === churchSandwichBread ? "each" : "g"}</p>
                <p className="text-[var(--ink-soft)]">SKU {cost.supplierSku} · Label revision {cost.evidenceRevision}</p>
                <p className="text-[var(--ink-soft)]">Invoice <time dateTime={cost.invoiceDate}>{cost.invoiceDate}</time> · {cost.invoiceReference}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
