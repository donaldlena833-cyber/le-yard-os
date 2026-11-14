"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  measureChurchIngredientBatchAction, recordChurchIngredientBatchAction, recordChurchIngredientBatchFromSourceAction,
  resolveChurchIngredientBatchAction, voidChurchIngredientBatchAction,
} from "@/app/actions/workflows/church-ingredient-batches";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { localDateTimeParts, zonedLocalToIso } from "@/data/read-models/local-time";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { openChurchBatchPrintLabel } from "@/lib/kitchen/church-batch-print-label";
import type { ChurchBatchLabel, ChurchBatchMeasurement } from "@/lib/kitchen/church-ingredient-batches";
import { churchSandwichBread, churchSandwichComponents } from "@/lib/kitchen/church-sandwich-bench";
import { validChurchAvailabilityStock } from "@/lib/kitchen/church-sandwich-availability";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type Props = {
  evidence: readonly ChurchIngredientEvidence[];
  records: readonly ChurchBatchLabel[];
  canRecord: boolean;
  asOf: string;
  queue?: { batches: readonly ChurchBatchLabel[]; total: number } | null;
};

type Outcome = "used_up" | "discarded";

const zone = "America/New_York";
const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const measurementTime = new Intl.DateTimeFormat("en-US", {
  timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});
const quantityLabel = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const field = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal";
const appearance = {
  current: { label: "Recorded label", tone: "positive" },
  recheck: { label: "Supplier recheck needed", tone: "warning" },
  source_recheck: { label: "Source batch needs review", tone: "warning" },
  expired: { label: "Discard time reached", tone: "danger" },
  voided: { label: "Voided", tone: "danger" },
  used_up: { label: "Used up", tone: "neutral" },
  discarded: { label: "Discarded", tone: "neutral" },
} as const;

function easternInput(value: FormDataEntryValue | null) {
  const [date, time] = String(value ?? "").split("T");
  const match = /^(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d{1,3}))?$/.exec(time ?? "");
  if (!date || !match) return null;
  const instant = zonedLocalToIso(date, match[1], zone);
  return instant && match[2] ? instant.replace(".000Z", `.${match[2].padEnd(3, "0")}Z`) : instant;
}

function currentEasternInput() {
  const instant = new Date(Date.now()).toISOString();
  const { date, time } = localDateTimeParts(instant, zone);
  const input = `${date}T${time}:${instant.slice(17, 19)}`;
  return easternInput(input) ? input : "";
}

function localLabel(value: string) {
  return easternTime.format(new Date(value));
}

function isCurrentEvidence(batch: ChurchBatchLabel, evidence?: ChurchIngredientEvidence) {
  return batch.evidenceCurrent && evidence?.status === "reviewed" && evidence.revision === batch.evidenceRevision;
}

function compareMeasurementTimes(left: string, right: string) {
  const fraction = (value: string) => Number((/\.(\d+)/.exec(value)?.[1] ?? "").padEnd(6, "0"));
  return Date.parse(left) - Date.parse(right) || fraction(left) - fraction(right);
}

function latestMeasurement(first?: ChurchBatchMeasurement | null, second?: ChurchBatchMeasurement | null) {
  if (!first || !second) return first ?? second ?? null;
  const observedOrder = compareMeasurementTimes(second.observedAt, first.observedAt);
  const recordedOrder = compareMeasurementTimes(second.recordedAt, first.recordedAt);
  return (observedOrder || recordedOrder) > 0 ? second : first;
}

function mergeBatch(existing: ChurchBatchLabel | undefined, local: ChurchBatchLabel): ChurchBatchLabel {
  if (!existing) return local;
  const merged = {
    ...existing,
    sourceBatch: existing.sourceBatch ?? local.sourceBatch,
    sourceNeedsReview: Boolean(existing.sourceNeedsReview || local.sourceNeedsReview),
    latestMeasurement: latestMeasurement(existing.latestMeasurement, local.latestMeasurement),
  };
  if (existing.voidedAt || existing.disposition) return merged;
  if (local.voidedAt) return { ...merged, voidedAt: local.voidedAt, voidReason: local.voidReason };
  if (local.disposition) return { ...merged, disposition: local.disposition };
  return merged;
}

function activityTime(batch: ChurchBatchLabel) {
  return Date.parse(batch.voidedAt ?? batch.disposition?.resolvedAt ?? batch.recordedAt);
}

function needsSourceReview(record: ChurchBatchLabel, knownBatches: ReadonlyMap<string, ChurchBatchLabel>) {
  if (record.sourceNeedsReview) return true;
  const visited = new Set([record.id]);
  let source = record.sourceBatch;
  while (source) {
    if (visited.has(source.id)) return true;
    visited.add(source.id);
    const batch = knownBatches.get(source.id);
    if (batch?.voidedAt || batch?.disposition?.outcome === "discarded" || batch?.sourceNeedsReview) return true;
    source = batch?.sourceBatch;
  }
  return false;
}

function RecordBatchLabel({ evidence, onSave }: {
  evidence: readonly ChurchIngredientEvidence[];
  onSave: (record: ChurchBatchLabel) => void;
}) {
  const [ingredient, setIngredient] = useState("");
  const [handledAs, setHandledAs] = useState<ChurchBatchLabel["handledAs"]>("opened");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { requestIdFor } = useStableRequestIds();
  const current = evidence.find((row) => row.ingredientKey === ingredient && row.status === "reviewed");
  const rule = handledAs === "opened" ? current?.openedRule : current?.preppedRule;
  const ready = Boolean(current?.supplierSku && current.storageRule && rule);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !ready || saving) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const supplierLot = String(form.get("supplierLot") ?? "").trim();
    const batchCode = String(form.get("batchCode") ?? "").trim();
    const handledAt = easternInput(form.get("handledAt"));
    const discardAt = easternInput(form.get("discardAt"));
    if (!supplierLot || !batchCode || supplierLot.length > 120 || batchCode.length > 120 || /[\p{Cc}\p{Cf}]/u.test(supplierLot + batchCode)) {
      setMessage("Enter the actual supplier lot and a new batch code, up to 120 characters each.");
      return;
    }
    if (!handledAt || !discardAt) {
      setMessage("Enter both Eastern date and time values. Times skipped or repeated during a clock change need review.");
      return;
    }
    const now = Date.now();
    if (Date.parse(handledAt) > now || Date.parse(discardAt) <= now || discardAt <= handledAt) {
      setMessage("Use an actual handling time and a future approved discard time after it.");
      return;
    }
    if (!form.has("confirmed")) {
      setMessage("Confirm that the person in charge verified the pack, lot and discard time.");
      return;
    }
    const payload = { ingredientKey: ingredient, evidenceRevision: current.revision, supplierLot, batchCode, handledAs, handledAt, discardAt };
    setSaving(true);
    setMessage("");
    try {
      const result = await recordChurchIngredientBatchAction({ ...payload, requestId: requestIdFor("record", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSave(result.data);
        formElement.reset();
        setIngredient("");
        setHandledAs("opened");
        setMessage(`Batch ${result.data.batchCode} recorded.`);
      } else {
        setMessage("message" in result ? result.message : "The label could not be recorded. Refresh Kitchen and try again.");
      }
    } catch {
      setMessage("The label could not be recorded. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="mt-3 border-t border-[var(--line)] pt-3">
      <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Record a batch label</summary>
      <form aria-label="Record Kitchen batch label" className="mt-3" onSubmit={(event) => void submit(event)} noValidate>
        <fieldset disabled={saving} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold">
              Ingredient
              <select className={field} value={ingredient} onChange={(event) => setIngredient(event.target.value)} required>
                <option value="">Choose a reviewed ingredient</option>
                {churchSandwichComponents.map((name) => <option value={name} key={name} disabled={!evidence.some((row) => row.ingredientKey === name && row.status === "reviewed")}>{name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Handling
              <select className={field} value={handledAs} onChange={(event) => setHandledAs(event.target.value as ChurchBatchLabel["handledAs"])}>
                <option value="opened">Opened</option><option value="prepped">Prepped</option>
              </select>
            </label>
          </div>
          {current && (
            <div className="space-y-1 break-words text-xs text-[var(--ink-soft)]">
              <p>Reviewed supplier label r{current.revision} · {current.supplierSku} · {current.sourceReference}</p>
              <p className="whitespace-pre-wrap">Storage · {current.storageRule}</p>
              <p className="whitespace-pre-wrap">{handledAs === "opened" ? "After opening" : "After prep"} · {rule}</p>
            </div>
          )}
          {current && ready && (
            <fieldset key={`${current.ingredientKey}:${current.revision}:${handledAs}`} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold">Supplier lot<input className={field} name="supplierLot" maxLength={120} autoComplete="off" required /></label>
                <label className="block text-xs font-semibold">Batch code<input className={field} name="batchCode" maxLength={120} autoComplete="off" required /></label>
                <label className="block text-xs font-semibold">{handledAs === "opened" ? "Opened at" : "Prepped at"} (Eastern)<input className={field} name="handledAt" type="datetime-local" required /></label>
                <label className="block text-xs font-semibold">Discard by (Eastern)<input className={field} name="discardAt" type="datetime-local" required /></label>
              </div>
              <p className="text-xs text-[var(--ink-soft)]">Use the earliest applicable discard time from the original package and the opening or prep rule. If the ingredient comes from a recorded batch, open its label and choose Prep from this batch.</p>
              <label className="flex items-start gap-2 text-sm"><input className="mt-1" name="confirmed" type="checkbox" required /><span>The person in charge verified the product, lot and discard time against the current label and handling rule.</span></label>
              <Button size="sm" type="submit">{saving ? "Recording…" : "Record verified label"}</Button>
            </fieldset>
          )}
          {current && !ready && <p className="text-xs text-[var(--ink-soft)]">Complete the supplier storage and handling rules before recording a label.</p>}
        </fieldset>
        <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
      </form>
    </details>
  );
}

function BatchLabelRow({ record, evidence, now, canRecord, canResolve, onSave, onMeasure, onRefresh }: {
  record: ChurchBatchLabel;
  evidence?: ChurchIngredientEvidence;
  now: number;
  canRecord: boolean;
  canResolve: boolean;
  onSave: (record: ChurchBatchLabel) => void;
  onMeasure: (measurement: ChurchBatchMeasurement) => void;
  onRefresh: () => void;
}) {
  const [command, setCommand] = useState<"void" | "measure" | "prep" | Outcome | null>(null);
  const [earlierDeadline, setEarlierDeadline] = useState(false);
  const [measurementBaseline, setMeasurementBaseline] = useState<string | null>(null);
  const [initialObservedAt, setInitialObservedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const printPreview = useRef<Window | null>(null);
  const { requestIdFor } = useStableRequestIds();
  const current = isCurrentEvidence(record, evidence);
  const discard = Date.parse(record.discardAt);
  const expired = now >= discard;
  const unresolved = !record.voidedAt && !record.disposition;
  const sourceNeedsReview = record.sourceNeedsReview === true;
  const usable = unresolved && current && !expired && !sourceNeedsReview;
  const canMeasure = canRecord && usable;
  const canPrepFrom = canRecord && usable && Boolean(evidence?.preppedRule);
  const canPrint = canRecord && usable;
  const measurement = record.latestMeasurement;
  const latestId = measurement?.id ?? null;
  const isBread = record.ingredientKey === churchSandwichBread;
  const unit = isBread ? "each" : "g";
  const status = appearance[record.voidedAt ? "voided" : record.disposition?.outcome
    ?? (expired ? "expired" : sourceNeedsReview ? "source_recheck" : current ? "current" : "recheck")];

  useEffect(() => {
    return () => {
      printPreview.current?.close();
      printPreview.current = null;
    };
  }, [canPrint]);

  function printLabel() {
    if (!canPrint || Date.now() >= discard) {
      setMessage("The batch label now needs review. Refresh it before printing.");
      return;
    }
    printPreview.current?.close();
    printPreview.current = openChurchBatchPrintLabel(record);
    setMessage(printPreview.current ? "" : "The print preview could not open. Allow pop-ups for Operations and try again.");
  }

  async function recordFromSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const submittedAt = Date.now();
    if (!canPrepFrom || submittedAt >= discard) {
      setMessage("The source batch now needs review. Refresh its label before recording prep.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const batchCode = String(form.get("batchCode") ?? "").trim();
    const handledAt = easternInput(form.get("handledAt"));
    const discardAt = earlierDeadline ? easternInput(form.get("discardAt")) : record.discardAt;
    if (!batchCode || Array.from(batchCode).length > 120 || /[\p{Cc}\p{Cf}]/u.test(batchCode)) {
      setMessage("Enter a new batch code of up to 120 characters.");
      return;
    }
    if (!handledAt || !discardAt) {
      setMessage("Enter the actual Eastern prep time and any earlier deadline. Times skipped or repeated during a clock change need review.");
      return;
    }
    if (compareMeasurementTimes(handledAt, record.handledAt) < 0 || Date.parse(handledAt) > submittedAt
      || Date.parse(discardAt) <= submittedAt || compareMeasurementTimes(discardAt, handledAt) <= 0
      || (earlierDeadline && compareMeasurementTimes(discardAt, record.discardAt) >= 0)) {
      setMessage("Use an actual prep time since the source was handled and a future discard time no later than the source deadline.");
      return;
    }
    if (!form.has("confirmed")) {
      setMessage("Confirm that the person in charge approved the source and discard deadline.");
      return;
    }
    const payload = { sourceBatchId: record.id, batchCode, handledAt, discardAt };
    setBusy(true);
    setMessage("");
    try {
      const result = await recordChurchIngredientBatchFromSourceAction({
        ...payload, requestId: requestIdFor(`prep:${record.id}`, payload),
      });
      if (result.ok && result.mode === "live" && result.persisted && result.data.sourceBatch?.id === record.id) {
        onSave(result.data);
        setCommand(null);
        setMessage(`Prep batch ${result.data.batchCode} recorded. Attach its label and remeasure any product remaining in the source.`);
      } else {
        setMessage("message" in result ? result.message : "The prep label could not be confirmed. Refresh the batch and try again.");
        if (!result.ok && (result.code === "stale" || result.code === "conflict")) onRefresh();
      }
    } catch {
      setMessage("The prep label could not be confirmed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function recordMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!canMeasure || Date.now() >= discard || measurementBaseline !== latestId) {
      setMessage("The batch or its latest measurement changed. Review it before taking another measurement.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const amount = String(form.get("quantity") ?? "").trim();
    const quantity = Number(amount);
    if (!(isBread ? /^\d+$/.test(amount) : /^\d+(\.\d{1,3})?$/.test(amount)) || !validChurchAvailabilityStock(record.ingredientKey, quantity)) {
      setMessage(isBread ? "Enter a whole baguette count from 0 to 1,000,000." : "Enter net grams from 0 to 1,000,000 with up to three decimals.");
      return;
    }
    const observedAt = easternInput(form.get("observedAt"));
    if (!observedAt) {
      setMessage("Enter the actual Eastern observation time. Times skipped or repeated during a clock change need review.");
      return;
    }
    const observation = Date.parse(observedAt);
    if (observation < Date.parse(record.handledAt) || observation > Date.now()) {
      setMessage("Use an observation time since the batch was opened or prepped, through now.");
      return;
    }
    if (measurement && compareMeasurementTimes(observedAt, measurement.observedAt) < 0) {
      setMessage("The observation cannot be earlier than the last measurement shown. Check the time or take a new reading.");
      return;
    }
    const payload = { batchId: record.id, expectedLatestId: measurementBaseline, quantity, observedAt };
    setBusy(true);
    setMessage("");
    try {
      const result = await measureChurchIngredientBatchAction({ ...payload, requestId: requestIdFor(`measurement:${record.id}`, payload) });
      if (result.ok && result.mode === "live" && result.persisted && result.data.batchId === record.id) {
        onMeasure(result.data);
        setCommand(null);
        setMessage("Batch measurement recorded.");
      } else if (!result.ok && (result.code === "stale" || result.code === "conflict")) {
        setCommand(null);
        setMessage("The batch or its latest measurement changed. Check the latest label before taking another measurement.");
        onRefresh();
      } else {
        setMessage("message" in result ? result.message : "The batch measurement could not be confirmed.");
      }
    } catch {
      setMessage("The batch measurement could not be confirmed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function voidRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecord || !unresolved || busy) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason || reason.length > 240 || /[\p{Cc}\p{Cf}]/u.test(reason) || !form.has("confirmed")) {
      setMessage("Enter a reason of up to 240 characters and confirm the physical label has been removed.");
      return;
    }
    const payload = { batchId: record.id, reason };
    setBusy(true);
    setMessage("");
    try {
      const result = await voidChurchIngredientBatchAction({ ...payload, requestId: requestIdFor(record.id, payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSave(result.data);
        setCommand(null);
        setMessage("Batch label voided. Use a new batch code if you re-record this batch.");
      } else {
        setMessage("message" in result ? result.message : "The batch label could not be voided.");
      }
    } catch {
      setMessage("The batch label could not be voided. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveRecord(outcome: Outcome) {
    if (!canResolve || !unresolved || busy) return;
    if (outcome === "used_up" && (!usable || Date.now() >= discard)) {
      setCommand(null);
      setMessage("Used up requires an active batch with current supplier and source evidence.");
      return;
    }
    const payload = { batchId: record.id, outcome };
    setBusy(true);
    setMessage("");
    try {
      const result = await resolveChurchIngredientBatchAction({ ...payload, requestId: requestIdFor(`resolve:${record.id}`, payload) });
      if (result.ok && result.mode === "live" && result.persisted && result.data.disposition?.outcome === outcome) {
        onSave(result.data);
        setCommand(null);
      } else {
        setMessage("message" in result ? result.message : "The batch outcome could not be confirmed. Refresh Kitchen and try again.");
      }
    } catch {
      setMessage("The batch outcome could not be confirmed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="py-2">
      <summary className="focus-ring cursor-pointer rounded-md py-2 text-sm">
        <span className="ml-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 align-middle">
          <span className="break-words font-semibold">{record.ingredientKey} · {record.batchCode}</span>
          <StatusPill tone={status.tone} size="sm">{status.label}</StatusPill>
          <span className="text-xs text-[var(--ink-soft)]">Discard by <time dateTime={record.discardAt}>{localLabel(record.discardAt)}</time></span>
        </span>
      </summary>
      <div className="mt-1 space-y-2 break-words pb-3 text-xs text-[var(--ink-soft)]">
        <p>Supplier lot {record.supplierLot} · {record.supplierSku} · label r{record.evidenceRevision}</p>
        {record.sourceBatch && <p>Prepped from batch {record.sourceBatch.batchCode} · Source discard by{" "}
          <time dateTime={record.sourceBatch.discardAt}>{localLabel(record.sourceBatch.discardAt)}</time>.</p>}
        {unresolved && sourceNeedsReview && <p className="font-semibold">Hold this batch. The source or an earlier batch in its history was voided or discarded.</p>}
        <p>{record.handledAs === "opened" ? "Opened" : "Prepped"} <time dateTime={record.handledAt}>{localLabel(record.handledAt)}</time>.</p>
        <p className="whitespace-pre-wrap">Storage · {record.storageRule}</p>
        <p className="whitespace-pre-wrap">Recorded rule · {record.handlingRule}</p>
        <p>Recorded by {record.recordedByName} · <time dateTime={record.recordedAt}>{localLabel(record.recordedAt)}</time>.</p>
        {measurement && (
          <p>
            {usable ? "Last measured remaining" : "Historical measurement"} · {quantityLabel.format(measurement.quantity)} {unit} · <time dateTime={measurement.observedAt}>{measurementTime.format(new Date(measurement.observedAt))}</time> · recorded by {measurement.recordedByName}.
          </p>
        )}
        {!current && !record.disposition && <p>Recheck the current supplier label and the physical batch before use.</p>}
        {record.voidedAt && <p className="whitespace-pre-wrap">Voided <time dateTime={record.voidedAt}>{localLabel(record.voidedAt)}</time> · {record.voidReason}</p>}
        {record.disposition && <p>{appearance[record.disposition.outcome].label} recorded by {record.disposition.resolvedByName} · <time dateTime={record.disposition.resolvedAt}>{localLabel(record.disposition.resolvedAt)}</time>.</p>}
        {unresolved && command === null && (canResolve || canRecord) && (
          <div className="flex flex-wrap gap-2">
            {canMeasure && <Button variant="secondary" size="sm" onClick={() => { setMeasurementBaseline(latestId); setInitialObservedAt(currentEasternInput()); setCommand("measure"); setMessage(""); }}>Measure remaining</Button>}
            {canPrepFrom && <Button variant="secondary" size="sm" onClick={() => { setEarlierDeadline(false); setCommand("prep"); setMessage(""); }}>Prep from this batch</Button>}
            {canPrint && <Button variant="secondary" size="sm" onClick={printLabel}>Print label</Button>}
            {canResolve && usable && <Button variant="secondary" size="sm" onClick={() => setCommand("used_up")}>Record used up</Button>}
            {canResolve && <Button variant="secondary" size="sm" onClick={() => setCommand("discarded")}>Record discard</Button>}
            {canRecord && <Button variant="quiet" size="sm" onClick={() => setCommand("void")}>Void label</Button>}
          </div>
        )}
        {command === "prep" && (
          <form aria-label={`Prep from ${record.batchCode}`} className="space-y-2" onSubmit={(event) => void recordFromSource(event)} noValidate>
            <fieldset disabled={busy || !canPrepFrom} className="space-y-2">
              <p>The new batch carries forward supplier lot {record.supplierLot} and label r{record.evidenceRevision}. Source discard by{" "}
                <time dateTime={record.discardAt}>{localLabel(record.discardAt)}</time>.</p>
              <p className="whitespace-pre-wrap">After prep · {evidence?.preppedRule}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block font-semibold">New batch code<input className={field} name="batchCode" required maxLength={120} autoComplete="off" /></label>
                <label className="block font-semibold">Prepped at (Eastern)<input className={field} name="handledAt" type="datetime-local" step={1} required /></label>
                <label className="block font-semibold">Discard deadline
                  <select className={field} value={earlierDeadline ? "earlier" : "source"} onChange={(event) => setEarlierDeadline(event.target.value === "earlier")}>
                    <option value="source">Use source deadline</option><option value="earlier">Enter an earlier deadline</option>
                  </select>
                </label>
                {earlierDeadline && <label className="block font-semibold">Earlier discard by (Eastern)<input className={field} name="discardAt" type="datetime-local" step={1} required /></label>}
              </div>
              <label className="flex items-start gap-2 text-sm"><input className="mt-1" name="confirmed" type="checkbox" required /><span>The person in charge checked this source against the physical label and approved the earliest applicable discard deadline.</span></label>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="submit" disabled={busy || !canPrepFrom}>{busy ? "Recording…" : "Record prep batch"}</Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setCommand(null); setMessage(""); }}>Cancel</Button>
            </div>
          </form>
        )}
        {canRecord && unresolved && command === "measure" && (
          <form aria-label={`Measure remaining for ${record.batchCode}`} onSubmit={(event) => void recordMeasurement(event)} noValidate className="space-y-2">
            <p>{!canMeasure || latestId !== measurementBaseline ? "The batch or its latest measurement changed. Cancel and review the latest label before measuring again." : "Measure this batch only. Count whole baguettes or weigh usable filling without the container. Check the observation time and enter 0 only for a confirmed empty batch."}</p>
            <fieldset disabled={busy || !canMeasure || latestId !== measurementBaseline} className="grid gap-2 sm:grid-cols-2">
              <label className="block font-semibold">Remaining quantity ({unit})<input className={field} name="quantity" inputMode={isBread ? "numeric" : "decimal"} autoComplete="off" required maxLength={11} /></label>
              <label className="block font-semibold">Observed at (Eastern)<input className={field} name="observedAt" type="datetime-local" step={1} required defaultValue={initialObservedAt} /></label>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" type="submit" disabled={busy || !canMeasure || latestId !== measurementBaseline}>{busy ? "Recording…" : "Record measurement"}</Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setCommand(null); setMessage(""); }}>Cancel</Button>
            </div>
          </form>
        )}
        {canResolve && unresolved && (command === "used_up" || command === "discarded") && (
          <div className="space-y-2">
            <p>{command === "discarded" ? "Confirm after discarding this physical batch."
              : !usable ? "Used up requires an active batch with current supplier and source evidence."
              : "Confirm this batch was fully used before the discard time."}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant={command === "discarded" ? "danger" : "primary"} size="sm"
                disabled={busy || (command === "used_up" && !usable)} onClick={() => void resolveRecord(command)}>
                {busy ? "Recording…" : command === "discarded" ? "Confirm discard" : "Confirm used up"}
              </Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setCommand(null); setMessage(""); }}>Cancel</Button>
            </div>
          </div>
        )}
        {canRecord && unresolved && command === "void" && (
          <form aria-label={`Void label ${record.batchCode}`} onSubmit={(event) => void voidRecord(event)} noValidate>
            <fieldset disabled={busy} className="space-y-2">
              <label className="block font-semibold">Reason for voiding<input className={field} name="reason" required maxLength={240} /></label>
              <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" name="confirmed" required /><span>I removed the previous physical label. I’ll use a new batch code for a replacement.</span></label>
              <div className="flex flex-wrap gap-2"><Button variant="danger" size="sm" type="submit">{busy ? "Voiding…" : "Confirm void"}</Button><Button variant="quiet" size="sm" onClick={() => { setCommand(null); setMessage(""); }}>Cancel</Button></div>
            </fieldset>
          </form>
        )}
        <p role="status">{message}</p>
      </div>
    </details>
  );
}

export function ChurchBatchLabelsPanel({ evidence, records, canRecord, asOf, queue }: Props) {
  const { refresh } = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [clock, setClock] = useState(() => Date.parse(asOf));
  const [changes, setChanges] = useState<Record<string, ChurchBatchLabel>>({});
  const [measurements, setMeasurements] = useState<Record<string, ChurchBatchMeasurement>>({});
  const [resolutionMessage, setResolutionMessage] = useState("");

  const byIngredient = new Map(evidence.map((row) => [row.ingredientKey, row]));
  const byId = new Map(records.map((row) => [row.id, row]));
  for (const row of Object.values(changes)) byId.set(row.id, mergeBatch(byId.get(row.id), row));
  const batches = [...byId.values()].sort((left, right) => activityTime(right) - activityTime(left));
  const queueById = new Map(queue?.batches.map((row) => [row.id, mergeBatch(byId.get(row.id), row)]));
  const closedInQueue = [...queueById.values()].filter((row) => row.voidedAt || row.disposition).length;
  const additionalOpen = Object.values(changes).filter((row) => !queueById.has(row.id) && !row.voidedAt && !row.disposition
    && !records.some((prior) => prior.id === row.id));
  const unresolved = [...queueById.values(), ...additionalOpen].filter((row) => !row.voidedAt && !row.disposition)
    .sort((left, right) => Date.parse(left.discardAt) - Date.parse(right.discardAt));
  const visibleQueue = unresolved.slice(0, 50);
  const knownBatches = new Map([...byId, ...queueById]);
  const visibleQueueIds = new Set(visibleQueue.map((row) => row.id));
  const queueTotal = Math.max(unresolved.length, (queue?.total ?? 0) - closedInQueue + additionalOpen.length);
  const now = Math.max(clock, Date.parse(asOf));
  const activity = (queue ? batches.filter((row) => !visibleQueueIds.has(row.id)) : batches).slice(0, 50);
  const nextDeadline = [...visibleQueue, ...activity].reduce((soonest, row) => {
    const deadline = Date.parse(row.discardAt);
    return !row.voidedAt && !row.disposition && deadline > now ? Math.min(soonest, deadline) : soonest;
  }, Infinity);
  useEffect(() => {
    if (!Number.isFinite(nextDeadline)) return;
    const updateClock = () => setClock(Date.now());
    const timer = window.setTimeout(updateClock, Math.min(15_000, nextDeadline - now));
    window.addEventListener("focus", updateClock);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", updateClock);
    };
  }, [nextDeadline, now]);
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  function saved(row: ChurchBatchLabel) {
    setChanges((previous) => {
      const current = previous[row.id];
      return { ...previous, [row.id]: mergeBatch(current, row) };
    });
    if (row.disposition) setResolutionMessage(`Batch ${row.batchCode} recorded as ${row.disposition.outcome === "discarded" ? "discarded" : "used up"}.`);
    if (row.voidedAt || row.disposition?.outcome === "discarded") startRefresh(refresh);
    setClock(Date.now());
  }

  function measured(receipt: ChurchBatchMeasurement) {
    setMeasurements((previous) => ({ ...previous, [receipt.batchId]: latestMeasurement(previous[receipt.batchId], receipt) ?? receipt }));
  }

  function renderBatch(record: ChurchBatchLabel, canResolve: boolean) {
    const latest = latestMeasurement(record.latestMeasurement, measurements[record.id]);
    return <BatchLabelRow key={record.id} record={{ ...record, latestMeasurement: latest, sourceNeedsReview: needsSourceReview(record, knownBatches) }} evidence={byIngredient.get(record.ingredientKey)}
      now={now} canRecord={canRecord} canResolve={canResolve} onSave={saved} onMeasure={measured} onRefresh={() => startRefresh(refresh)} />;
  }

  return (
    <section aria-labelledby="church-batch-labels-heading" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="church-batch-labels-heading" className="text-lg font-semibold">Batch labels</h2>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Record the exact supplier lot, handling time and discard time for Church Street batches. Verify the reviewed supplier label and attach the label to the physical container.</p>
      {canRecord && <RecordBatchLabel evidence={evidence} onSave={saved} />}
      {resolutionMessage && <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{resolutionMessage}</p>}
      {queue !== undefined && (
        <section className="mt-4 border-t border-[var(--line)] pt-3" aria-labelledby="church-batch-queue-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="church-batch-queue-heading" className="text-sm font-semibold">Open batches by discard time</h3>
            <Button variant="quiet" size="sm" disabled={refreshing} onClick={() => startRefresh(refresh)}>{refreshing ? "Refreshing…" : "Refresh list"}</Button>
          </div>
          {queue === null ? <p className="mt-2 text-xs text-[var(--ink-soft)]">The batch queue could not be loaded. Refresh Kitchen to try again.</p> : (
            <>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">{queueTotal === 0 ? "No open batches." : `${queueTotal} open ${queueTotal === 1 ? "batch" : "batches"}. Earliest deadline first.`}</p>
              {queueTotal > visibleQueue.length && <p className="mt-1 text-xs text-[var(--ink-soft)]">Showing {visibleQueue.length} of {queueTotal}. Refresh Kitchen to see more after recording outcomes.</p>}
              <div className="mt-1 divide-y divide-[var(--line)]">
                {visibleQueue.map((record) => renderBatch(record, canRecord))}
              </div>
            </>
          )}
        </section>
      )}
      <section className="mt-4 border-t border-[var(--line)] pt-3" aria-labelledby="church-batch-activity-heading">
        <h3 id="church-batch-activity-heading" className="text-sm font-semibold">Recent batch label activity</h3>
        {activity.length === 0 ? <p className="mt-2 text-xs text-[var(--ink-soft)]">No other recent batch labels.</p> : (
          <div className="mt-1 divide-y divide-[var(--line)]">
            {activity.map((record) => renderBatch(record, canRecord && queue !== undefined))}
          </div>
        )}
      </section>
    </section>
  );
}
