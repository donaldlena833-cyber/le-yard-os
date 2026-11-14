"use client";

import { type FormEvent, useState } from "react";
import { saveChurchSandwichIngredientEvidenceAction } from "@/app/actions/workflows/church-ingredient-evidence";
import { ChurchSandwichEvidenceOverview } from "@/components/kitchen/church-sandwich-evidence-overview";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { churchSandwichComponents } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import {
  churchIngredientEvidenceLimits,
  churchIngredientEvidenceStatuses,
  type ChurchIngredientEvidence,
  type ChurchIngredientEvidenceStatus,
} from "@/lib/kitchen/church-sandwich-ingredient-evidence";

const fields = [
  { key: "supplierSku", label: "Supplier, brand and exact SKU", short: true },
  { key: "sourceReference", label: "Label or supplier document reference", short: true },
  { key: "allergenNotes", label: "Allergens listed by the supplier" },
  { key: "crossContactNotes", label: "Supplier cross-contact statement" },
  { key: "storageRule", label: "Sealed storage and date rules" },
  { key: "openedRule", label: "After-opening storage and discard rules" },
  { key: "preppedRule", label: "After-prep storage and discard rules" },
] as const;
type EvidenceField = typeof fields[number]["key"];
const statusAppearance = {
  pending: { label: "Pending", tone: "neutral" },
  hold: { label: "On hold", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "positive" },
} as const;
const fieldClass = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-sm font-normal";
const reviewTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
});

function IngredientEvidenceRow({ ingredientKey, row, canManage, onSave }: {
  ingredientKey: string;
  row?: ChurchIngredientEvidence;
  canManage: boolean;
  onSave: (saved: ChurchIngredientEvidence) => void;
}) {
  const revision = row?.revision ?? 0;
  const [formRevision, setFormRevision] = useState(revision);
  const [status, setStatus] = useState<ChurchIngredientEvidenceStatus>(row?.status ?? "pending");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Partial<Record<EvidenceField, string>>>({});
  const { requestIdFor } = useStableRequestIds();
  const appearance = statusAppearance[row?.status ?? "pending"];
  const stale = formRevision !== revision;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving || stale) return;
    const form = new FormData(event.currentTarget);
    const evidence = Object.fromEntries(fields.map(({ key }) => [key, String(form.get(key) ?? "").trim() || null])) as Record<EvidenceField, string | null>;
    const missing = status === "reviewed" ? fields.filter(({ key }) => !evidence[key]) : [];
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map(({ key }) => [key, "Add evidence for this field."])));
      setMessage("Complete every evidence field before marking this ingredient reviewed.");
      return;
    }

    const payload = { ingredientKey, expectedRevision: formRevision, status, ...evidence };
    setSaving(true);
    setMessage("");
    setErrors({});
    try {
      const result = await saveChurchSandwichIngredientEvidenceAction({ ...payload, requestId: requestIdFor("ingredient-evidence", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSave(result.data);
        setFormRevision(result.data.revision);
        setStatus(result.data.status);
        setMessage(result.data.status === "reviewed" ? "Supplier evidence reviewed." : "Supplier evidence saved.");
      } else {
        setMessage("message" in result ? result.message : "Supplier evidence could not be saved.");
        if (!result.ok && result.fieldErrors) setErrors(Object.fromEntries(fields.flatMap(({ key }) => {
          const message = result.fieldErrors?.[key]?.[0];
          return message ? [[key, message]] : [];
        })));
      }
    } catch {
      setMessage("Supplier evidence could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="py-2">
      <summary className="focus-ring cursor-pointer rounded-md py-2 text-sm font-medium">
        <span className="ml-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 align-middle">
          <span className="first-letter:uppercase">{ingredientKey}</span>
          <StatusPill tone={appearance.tone} size="sm">{appearance.label}</StatusPill>
        </span>
      </summary>
      <div className="mt-2 pb-3">
        {row?.reviewedAt && <p className="mb-3 text-xs text-[var(--ink-soft)]">
          {row.reviewerName ? `Reviewed by ${row.reviewerName}` : "Reviewed"} · <time dateTime={row.reviewedAt}>{reviewTime.format(new Date(row.reviewedAt))} ET</time>
        </p>}
        {row && !row.reviewedAt && <p className="mb-3 text-xs text-[var(--ink-soft)]">
          Updated <time dateTime={row.updatedAt}>{reviewTime.format(new Date(row.updatedAt))} ET</time>
        </p>}
        {canManage ? (
          <form aria-label={`${ingredientKey} supplier evidence`} onSubmit={(event) => void save(event)}>
            <fieldset key={formRevision} disabled={saving || stale} className="grid gap-3 sm:grid-cols-2">
              {fields.map(({ key, label, ...field }) => {
                const error = errors[key];
                const errorId = `ingredient-${ingredientKey.replaceAll(/[^a-z0-9]/gi, "-")}-${key}-error`;
                const input = {
                  name: key,
                  defaultValue: row?.[key] ?? "",
                  maxLength: churchIngredientEvidenceLimits[key],
                  className: fieldClass,
                  "aria-invalid": error ? true : undefined,
                  "aria-describedby": error ? errorId : undefined,
                };
                return (
                  <div key={key} className="min-w-0 text-xs font-semibold">
                    <label className="block">
                      {label}
                      {"short" in field ? <input type="text" autoComplete="off" {...input} /> : <textarea rows={2} {...input} />}
                    </label>
                    {error && <span id={errorId} className="mt-1 block text-[var(--danger)]">{error}</span>}
                  </div>
                );
              })}
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-32 text-xs font-semibold">
                  Review status
                  <select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value as ChurchIngredientEvidenceStatus)}>
                    {churchIngredientEvidenceStatuses.map((value) => <option key={value} value={value}>{statusAppearance[value].label}</option>)}
                  </select>
                </label>
                <Button type="submit" variant={status === "reviewed" ? "primary" : "secondary"} size="sm">
                  {saving ? "Saving…" : status === "reviewed" ? "Save reviewed evidence" : "Save evidence"}
                </Button>
              </div>
            </fieldset>
            {stale && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
              The saved evidence changed while this form was open.
              <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => {
                setFormRevision(revision);
                setStatus(row?.status ?? "pending");
                setMessage("");
                setErrors({});
              }}>Load saved evidence</Button>
            </div>}
            <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
          </form>
        ) : !row ? (
          <p className="text-sm text-[var(--ink-soft)]">No supplier evidence recorded.</p>
        ) : (
          <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
            {fields.map(({ key, label }) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs font-semibold">{label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-[var(--ink-soft)]">{row[key] ?? "Not recorded"}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

export function ChurchSupplierEvidencePanel({ initialRows, formulas, canManage }: {
  initialRows: readonly ChurchIngredientEvidence[] | null;
  formulas: readonly ChurchSandwichFormula[] | null;
  canManage: boolean;
}) {
  const [savedRows, setSavedRows] = useState<ChurchIngredientEvidence[]>([]);
  const rowsByIngredient = new Map(initialRows?.map((row) => [row.ingredientKey, row]));
  for (const row of savedRows) {
    if ((rowsByIngredient.get(row.ingredientKey)?.revision ?? 0) <= row.revision) rowsByIngredient.set(row.ingredientKey, row);
  }
  const rows = Array.from(rowsByIngredient.values());

  function update(saved: ChurchIngredientEvidence) {
    setSavedRows((previous) => {
      if (previous.some((row) => row.ingredientKey === saved.ingredientKey && row.revision > saved.revision)) return previous;
      return [...previous.filter((row) => row.ingredientKey !== saved.ingredientKey), saved];
    });
  }

  return (
    <section aria-labelledby="supplier-evidence-title" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="supplier-evidence-title" className="text-lg font-semibold">Supplier label evidence</h2>
      {initialRows === null ? (
        <p role="status" className="mt-2 text-sm text-[var(--ink-soft)]">Supplier evidence could not be loaded. Refresh Kitchen to try again.</p>
      ) : (
        <>
          <p className="my-2 text-sm text-[var(--ink-soft)]">Record evidence for the exact product used. Review applies to the recorded SKU and source. Manage customer-facing allergen information separately.</p>
          {canManage && <p className="mt-1 text-xs text-[var(--ink-soft)]">Add the label or supplier document revision. If a field does not apply, record why. When a product changes, reopen the evidence for review.</p>}
          <ChurchSandwichEvidenceOverview rows={rows} formulas={formulas} canManage={canManage} />
          <details id="church-sandwich-components" className="mt-3 scroll-mt-24 border-t border-[var(--line)] pt-3">
            <summary className="focus-ring cursor-pointer rounded-md py-1 text-sm font-semibold">Sandwich components</summary>
            <div className="mt-1 divide-y divide-[var(--line)]">
              {churchSandwichComponents.map((ingredientKey) => (
                <IngredientEvidenceRow key={ingredientKey} ingredientKey={ingredientKey} row={rowsByIngredient.get(ingredientKey)} canManage={canManage} onSave={update} />
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
