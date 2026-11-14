"use client";

import { useState, type FormEvent } from "react";
import { recordChurchSandwichTimingRunAction } from "@/app/actions/workflows/church-sandwich-timing";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { churchSandwichBenchRecipes, type ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchSandwichTimingRun } from "@/lib/kitchen/church-sandwich-timing";

type Props = {
  formulas: readonly ChurchSandwichFormula[];
  runs: readonly ChurchSandwichTimingRun[];
  canRecord: boolean;
};

const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("en-US");
const field = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal tabular-nums";
const label = "block text-xs font-semibold";
const countFields = [
  { key: "attempted", label: "Sandwiches attempted", min: 1, max: 200 },
  { key: "accepted", label: "Sandwiches accepted", min: 0, max: 200 },
  { key: "crewSize", label: "People on the run", min: 1, max: 12 },
] as const;
const phaseFields = [
  { key: "prepSeconds", label: "Prep (seconds)", cue: "First prep action to labeled product in storage and station reset.", required: false },
  { key: "buildSeconds", label: "Build (seconds)", cue: "First build action to completed assembly check.", required: true },
  { key: "packSeconds", label: "Pack (seconds)", cue: "After the assembly check, time wrapping and labeling until ready for handoff.", required: false },
] as const;

function readWhole(form: FormData, key: string, minimum: number, maximum: number, required = true) {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw && !required) return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= minimum && value <= maximum ? value : undefined;
}

function timingText(value: number | null) {
  return value === null ? "Unmeasured" : `${number.format(value)} sec`;
}

function TimingRunForm({ formulas, onSaved }: { formulas: readonly ChurchSandwichFormula[]; onSaved: (run: ChurchSandwichTimingRun) => void }) {
  const [recipeKey, setRecipeKey] = useState<ChurchSandwichRecipeKey | "">("");
  const [basis, setBasis] = useState("bench");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const signed = formulas.find((formula) => formula.recipeKey === recipeKey && formula.current);
  const selectedRevision = signed && basis === String(signed.revision) ? signed.revision : null;
  const validBasis = basis === "bench" || selectedRevision !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const attempted = readWhole(form, "attempted", 1, 200);
    const accepted = readWhole(form, "accepted", 0, 200);
    const crewSize = readWhole(form, "crewSize", 1, 12);
    const prepSeconds = readWhole(form, "prepSeconds", 0, 43_200, false);
    const buildSeconds = readWhole(form, "buildSeconds", 1, 43_200);
    const packSeconds = readWhole(form, "packSeconds", 0, 43_200, false);
    const reference = String(form.get("reference") ?? "").trim();
    const note = String(form.get("note") ?? "").trim() || null;
    if (!recipeKey || !validBasis) {
      setMessage("Choose the sandwich and current recipe basis used for this run.");
      return;
    }
    if (attempted == null || accepted == null || crewSize == null || accepted > attempted) {
      setMessage("Enter 1 to 200 attempted sandwiches, accepted sandwiches up to the attempted count, and 1 to 12 people.");
      return;
    }
    if (prepSeconds === undefined || buildSeconds == null || packSeconds === undefined) {
      setMessage("Enter whole seconds up to 43,200. Build must be at least 1 second. Leave unmeasured prep or pack blank.");
      return;
    }
    if (!reference || reference.length > 300 || (note?.length ?? 0) > 500 || /[\p{Cc}\p{Cf}]/u.test(reference + (note ?? ""))) {
      setMessage("Enter a worksheet or batch reference and keep the optional note on one line.");
      return;
    }
    const input = { recipeKey, formulaRevision: selectedRevision, attempted, accepted, crewSize, prepSeconds, buildSeconds, packSeconds, reference, note };
    setSaving(true);
    setMessage("");
    try {
      const result = await recordChurchSandwichTimingRunAction({ ...input, requestId: requestIdFor("timing-run", input) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSaved(result.data);
        rotateRequestId("timing-run");
        formElement.reset();
        setRecipeKey("");
        setBasis("bench");
        setMessage("Timing run recorded.");
      } else {
        setMessage("message" in result ? result.message : "The timing run could not be confirmed. Try again.");
      }
    } catch {
      setMessage("The timing run could not be confirmed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="mt-3 border-t border-[var(--line)] pt-3">
      <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Record a timing run</summary>
      <form className="mt-3" aria-label="Record sandwich timing run" onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className="space-y-3" disabled={saving}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Sandwich
              <select className={field} value={recipeKey} required onChange={(event) => {
                setRecipeKey(event.target.value as ChurchSandwichRecipeKey | "");
                setBasis("bench");
              }}>
                <option value="">Choose a sandwich</option>
                {churchSandwichBenchRecipes.map(({ key, name }) => <option value={key} key={key}>{name}</option>)}
              </select>
            </label>
            <label className={label}>Recipe basis
              <select className={field} value={validBasis ? basis : ""} onChange={(event) => setBasis(event.target.value)} required>
                {!validBasis && <option value="" disabled>Choose a current recipe basis</option>}
                <option value="bench">Bench rehearsal</option>
                {signed && <option value={String(signed.revision)}>Current signed recipe r{signed.revision}</option>}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {countFields.map(({ key, label: description, min, max }) => <label className={label} key={key}>{description}
              <input className={field} name={key} type="number" inputMode="numeric" min={min} max={max} step={1} required />
            </label>)}
          </div>
          <p className="text-xs text-[var(--ink-soft)]">Enter elapsed whole seconds for the full run. Leave unmeasured prep or pack blank. Enter 0 only for a measured zero.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {phaseFields.map(({ key, label: description, cue, required }) => <div key={key}>
              <label className={label}>{description}
                <input className={field} name={key} type="number" inputMode="numeric" min={required ? 1 : 0} max={43_200} step={1} required={required}
                  aria-describedby={`sandwich-timing-${key}`} />
              </label>
              <p id={`sandwich-timing-${key}`} className="mt-1 text-xs text-[var(--ink-soft)]">{cue}</p>
            </div>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Worksheet or batch reference<input className={field} name="reference" maxLength={300} autoComplete="off" required /></label>
            <label className={label}>Interruptions or next run change (optional)<input className={field} name="note" maxLength={500} autoComplete="off" /></label>
          </div>
          <Button size="sm" type="submit">{saving ? "Recording…" : "Save timing run"}</Button>
        </fieldset>
        <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
      </form>
    </details>
  );
}

export function ChurchSandwichTimingPanel({ formulas, runs, canRecord }: Props) {
  const [savedRuns, setSavedRuns] = useState<ChurchSandwichTimingRun[]>([]);
  const byId = new Map(savedRuns.map((run) => [run.id, run]));
  for (const run of runs) byId.set(run.id, run);
  const history = [...byId.values()].sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt)).slice(0, 30);
  const names = new Map(churchSandwichBenchRecipes.map(({ key, name }) => [key, name]));

  return (
    <section aria-labelledby="church-sandwich-timing-heading" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="church-sandwich-timing-heading" className="text-lg font-semibold">Sandwich timing runs</h2>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Record stopwatch observations for one sandwich and the crew on that run. Use the worksheet reference to repeat the setup and compare like runs.</p>
      {canRecord && <TimingRunForm formulas={formulas} onSaved={(run) => setSavedRuns((previous) => [run, ...previous.filter(({ id }) => id !== run.id)])} />}
      <div className="mt-3 border-t border-[var(--line)] pt-3">
        <h3 className="text-sm font-semibold">Recent timing runs</h3>
        {history.length === 0 ? <p className="mt-1 text-xs text-[var(--ink-soft)]">No timing runs recorded.</p> : (
          <div className="mt-1 divide-y divide-[var(--line)]">
            {history.map((run) => (
              <details key={run.id} className="py-2">
                <summary className="focus-ring cursor-pointer rounded-md text-sm">
                  <span className="ml-1 inline-flex flex-wrap items-center gap-2 align-middle">
                    <span className="font-semibold">{names.get(run.recipeKey)}</span>
                    <StatusPill size="sm">{run.formulaRevision === null ? "Bench rehearsal" : `Signed recipe r${run.formulaRevision}`}</StatusPill>
                    <span className="tabular-nums">{number.format(run.accepted)} of {number.format(run.attempted)} accepted</span>
                  </span>
                </summary>
                <div className="mt-2 space-y-1 break-words pl-4 text-xs text-[var(--ink-soft)]">
                  <p className="tabular-nums">Prep {timingText(run.prepSeconds)} · Build {timingText(run.buildSeconds)} · Pack {timingText(run.packSeconds)}</p>
                  <p>Crew {number.format(run.crewSize)} · Recorded by {run.recordedByName} · <time dateTime={run.recordedAt}>{time.format(new Date(run.recordedAt))} ET</time></p>
                  <p>Reference · {run.reference}</p>
                  {run.note && <p>Run note · {run.note}</p>}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
