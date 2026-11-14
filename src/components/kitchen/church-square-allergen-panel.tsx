"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { getChurchSquareAllergenDiagnosticAction } from "@/app/actions/workflows/church-square-allergen-diagnostic";
import { recordChurchSandwichRegisterCheckAction } from "@/app/actions/workflows/church-sandwich-register-check";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import type { ChurchSquareAllergenDiagnostic, ChurchSquareAllergenDiagnosticItem } from "@/lib/integrations/church-square-allergen-diagnostic";
import { churchSandwichBenchRecipes, churchSandwichBread } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import { matchesChurchSandwichFormulaEvidence } from "@/lib/kitchen/church-sandwich-formula-evidence";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";
import type { ChurchSandwichRegisterCheck } from "@/lib/kitchen/church-sandwich-register-check";

type Props = {
  formulas: readonly ChurchSandwichFormula[];
  evidence: readonly ChurchIngredientEvidence[];
  registerChecks: readonly ChurchSandwichRegisterCheck[] | null;
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
const registerOutcomes = {
  matched: { label: "Tile matched", tone: "positive" },
  mismatch: { label: "Tile mismatch", tone: "warning" },
  unavailable: { label: "Tile unavailable", tone: "warning" },
} as const;
const registerField = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal";
type RegisterCheckInput = Pick<ChurchSandwichRegisterCheck, "recipeKey" | "formulaRevision" | "squareItemId" | "squareCatalogVersion" | "outcome" | "device" | "reference">;

function registerCheckStatus(check: ChurchSandwichRegisterCheck, currentFormulaRevision: number | undefined,
  squareChecked: boolean, item: ChurchSquareAllergenDiagnosticItem | undefined) {
  if (check.formulaRevision !== currentFormulaRevision) return { label: "Recipe or labels changed", tone: "warning" } as const;
  if (!squareChecked) return { label: "Recheck Square catalog", tone: "neutral" } as const;
  if (item?.status !== "matched" || !item.catalogVersion || item.variationIds.length === 0) {
    return { label: "Catalog comparison unavailable", tone: "warning" } as const;
  }
  if (check.squareItemId !== item.itemId || check.squareCatalogVersion !== item.catalogVersion) {
    return { label: "Square item or version changed", tone: "warning" } as const;
  }
  if (check.outcome === "matched" && item.allergens.status === "empty") return { label: "Square tags are empty", tone: "warning" } as const;
  if ((check.outcome === "matched" || check.outcome === "mismatch") &&
    item.allergens.status !== "configured" && item.allergens.status !== "empty") {
    return { label: "Catalog comparison unavailable", tone: "warning" } as const;
  }
  return registerOutcomes[check.outcome];
}

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
          {allergens.standard.length > 0 && <div><dt className="font-medium">Standard Square categories</dt><dd>{allergens.standard.join(", ")}</dd></div>}
          {allergens.custom.length > 0 && <div><dt className="font-medium">Exact custom ingredient names</dt><dd>{allergens.custom.join(", ")}</dd></div>}
        </dl>
      ) : <p>{squareDetail[allergens.status]}</p>}
      {item.variationIds.length === 0 && <p className="mt-2">Square returned no active matching Church Street variations.</p>}
      <a href={`https://app.squareup.com/dashboard/items/library/${encodeURIComponent(item.itemId)}`}
        target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-block rounded font-semibold underline underline-offset-2"
        aria-label={`Open ${item.name} in Square Dashboard (new tab)`}>Open item in Square</a>
    </>
  );
}

function RegisterCheckForm({ name, catalogAllergens, recordCheck }: {
  name: string;
  catalogAllergens: Extract<ChurchSquareAllergenDiagnosticItem, { status: "matched" }>["allergens"]["status"];
  recordCheck: (fields: Pick<RegisterCheckInput, "outcome" | "device" | "reference">) => Promise<string | undefined>;
}) {
  const [outcome, setOutcome] = useState<RegisterCheckInput["outcome"] | "">("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const allowMatch = catalogAllergens === "configured";
  const allowMismatch = allowMatch || catalogAllergens === "empty";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const device = String(form.get("device") ?? "").trim();
    const reference = String(form.get("reference") ?? "").trim();
    if (!outcome || !device || !reference || Array.from(device).length > 120 || Array.from(reference).length > 300 ||
      /[\p{Cc}\p{Cf}]/u.test(device + reference)) {
      setMessage("Choose the result and enter the register device and a short evidence or follow-up reference.");
      return;
    }
    if (outcome === "matched" && (!allowMatch || form.get("compared") !== "on")) {
      setMessage("Confirm you compared this physical tile with the current signed recipe and supplier labels.");
      return;
    }
    if (outcome === "mismatch" && !allowMismatch) {
      setMessage("Record an unavailable tile when Square’s allergen fields cannot be read.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const error = await recordCheck({ outcome, device, reference });
      if (error) {
        setMessage(error);
        return;
      }
      formElement.reset();
      setOutcome("");
      setMessage("Register check recorded.");
    } catch {
      setMessage("The register check could not be confirmed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-4" aria-label={`Record the ${name} register check`} onSubmit={(event) => void save(event)} noValidate>
      <fieldset className="space-y-3" disabled={saving}>
        <legend className="mb-2 text-sm font-semibold text-[var(--ink)]">Record this register tile check</legend>
        <p>This result applies to the physical Square tile on the register you enter below. Keep guest or payment details out of the reference.</p>
        {catalogAllergens === "empty" && <p>Square returned an empty allergen field. Record a mismatch or an unavailable tile.</p>}
        {!allowMismatch && <p>Square’s allergen fields could not be verified. Record the check as unavailable.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-semibold">Tile result
            <select className={registerField} value={outcome} required
              onChange={(event) => setOutcome(event.target.value as RegisterCheckInput["outcome"] | "")}>
              <option value="">Choose a result</option>
              {allowMatch && <option value="matched">Matched the signed recipe</option>}
              {allowMismatch && <option value="mismatch">Missing or different tags</option>}
              <option value="unavailable">Tile or allergen details unavailable</option>
            </select>
          </label>
          <label className="block font-semibold">Register device label
            <input className={registerField} name="device" required maxLength={120} autoComplete="off" />
          </label>
        </div>
        <label className="block font-semibold">Evidence or follow-up reference
          <input className={registerField} name="reference" required maxLength={300} autoComplete="off" />
        </label>
        {outcome === "matched" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="compared" required className="mt-1" />
            <span>I checked the physical register tile against the current signed recipe and supplier labels.</span>
          </label>
        )}
        <Button type="submit" size="sm">{saving ? "Saving…" : "Save register check"}</Button>
      </fieldset>
      {message && <p role="status" className="mt-2">{message}</p>}
    </form>
  );
}

export function ChurchSquareAllergenPanel({ formulas, evidence, registerChecks }: Props) {
  const [state, setState] = useState<ReadState>({ status: "idle", message: "" });
  const [savedChecks, setSavedChecks] = useState<ChurchSandwichRegisterCheck[]>([]);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const byRecipe = new Map(formulas.map((formula) => [formula.recipeKey, formula]));
  const byIngredient = new Map(evidence.map((row) => [row.ingredientKey, row]));
  const items = new Map(state.status === "ready" ? state.diagnostic.items.map((item) => [item.key, item]) : []);
  const checks = new Map(registerChecks?.map((check) => [check.recipeKey, check]));
  for (const check of savedChecks) {
    const loaded = checks.get(check.recipeKey);
    if (!loaded || Date.parse(check.recordedAt) > Date.parse(loaded.recordedAt)) checks.set(check.recipeKey, check);
  }

  async function recordCheck(input: RegisterCheckInput) {
    const scope = `church-register-check:${input.recipeKey}`;
    const result = await recordChurchSandwichRegisterCheckAction({ ...input, requestId: requestIdFor(scope, input) });
    if (!result.ok || result.mode !== "live" || !result.persisted) {
      return "message" in result ? result.message : "The register check could not be confirmed. Try again.";
    }
    setSavedChecks((previous) => [result.data, ...previous.filter((check) => check.recipeKey !== input.recipeKey)]);
    rotateRequestId(scope);
  }

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
        Register checks record what an operator saw on a specific device. Record the guest menu display and whether a mock allergy note reached the kitchen separately for each channel.{" "}
        <Link href="/tasks?tab=checklists" className="focus-ring rounded font-semibold underline underline-offset-2">Open Operations Checklists</Link>
      </p>
      {registerChecks === null && <p className="mt-2 text-sm text-[var(--ink-soft)]">Register check records could not be loaded. Reload Kitchen to try again.</p>}
      <div className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {churchSandwichBenchRecipes.map(({ key, name, portions }) => {
          const formula = byRecipe.get(key);
          const keys = [churchSandwichBread, ...portions.map(({ ingredient }) => ingredient)];
          const supplierRows = keys.map((ingredient) => byIngredient.get(ingredient));
          const current = matchesChurchSandwichFormulaEvidence(formula, byIngredient) &&
            supplierRows.every((row) => Boolean(row?.allergenNotes?.trim()) && Boolean(row?.crossContactNotes?.trim()));
          const item = items.get(key);
          const catalogVersion = item?.status === "matched" ? item.catalogVersion : null;
          const canRecordRegister = current && item?.status === "matched" && item.name === name && item.variationIds.length > 0;
          const canRehearse = canRecordRegister &&
            (item.allergens.status === "configured" || item.allergens.status === "empty");
          const lastCheck = checks.get(key);
          const registerStatus = lastCheck && registerCheckStatus(lastCheck, current ? formula?.revision : undefined,
            state.status === "ready", item);
          return (
            <details key={key} className="py-2">
              <summary className="focus-ring cursor-pointer rounded-md py-2 text-sm font-semibold">
                <span className="ml-1 inline-flex flex-wrap items-center gap-2 align-middle">
                  {name}
                  {state.status === "ready" && <StatusPill tone="accent" size="sm">{squareSummary(item)}</StatusPill>}
                  {registerStatus ? <StatusPill tone={registerStatus.tone} size="sm">{registerStatus.label}</StatusPill>
                    : <StatusPill tone="neutral" size="sm">{current ? "Manual comparison pending" : "Supplier comparison pending"}</StatusPill>}
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
              {lastCheck && (
                <div className="mt-2 space-y-1 break-words border-t border-[var(--line)] px-1 pt-3 text-xs text-[var(--ink-soft)]">
                  <h3 className="text-sm font-semibold text-[var(--ink)]">Last register check</h3>
                  <p>{registerOutcomes[lastCheck.outcome].label} · {lastCheck.device} · Signed recipe r{lastCheck.formulaRevision}</p>
                  <p>Recorded by {lastCheck.recordedByName} · <time dateTime={lastCheck.recordedAt}>{localTime.format(new Date(lastCheck.recordedAt))} ET</time></p>
                  <p>Reference · {lastCheck.reference}</p>
                  <p>Square item {lastCheck.squareItemId} · Catalog version {lastCheck.squareCatalogVersion}</p>
                </div>
              )}
              {canRecordRegister && formula && (
                <div className="mb-2 ml-1 mt-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
                  {canRehearse && (
                    <>
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Register checklist</h3>
                      <ol className="mt-2 list-decimal space-y-1 pl-4">
                        <li>On the Church Street register, press and hold the <strong>{item.name}</strong> menu tile. Check the Allergens section against the Square catalog tags above.</li>
                        <li>Compare the tile’s direct allergen details with signed recipe r{formula.revision} and the supplier labels above. Check exact names separately. GLUTEN leaves the grain unspecified, and TREE_NUTS leaves the nut unspecified. Use the label to confirm names such as wheat, walnut or pistachio. {item.allergens.status === "empty" && "Treat an empty field as an unchecked disclosure."}</li>
                        <li>Use the separate supplier cross-contact statements and kitchen procedures. Bring missing tags or mismatches to the person in charge before relying on the tile.</li>
                        <li>Use Square’s item editor where it supports the verified tag. After a catalog change, check that the item description is intact. Recheck the register tile and each public menu against the same signed recipe and supplier labels.</li>
                      </ol>
                    </>
                  )}
                  {!catalogVersion && <p className="mt-2">Square did not return a catalog version for this item. Recheck the catalog before recording.</p>}
                  {catalogVersion && registerChecks !== null && (
                    <RegisterCheckForm key={`${formula.revision}:${item.itemId}:${catalogVersion}:${item.allergens.status}`}
                      name={name} catalogAllergens={item.allergens.status}
                      recordCheck={({ outcome, device, reference }) => recordCheck({
                        recipeKey: key, formulaRevision: formula.revision, squareItemId: item.itemId,
                        squareCatalogVersion: catalogVersion, outcome, device, reference,
                      })} />
                  )}
                </div>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}
