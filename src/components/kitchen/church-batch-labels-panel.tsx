"use client";

import { useEffect, useState, type FormEvent } from "react";
import { recordChurchIngredientBatchAction, voidChurchIngredientBatchAction } from "@/app/actions/workflows/church-ingredient-batches";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { zonedLocalToIso } from "@/data/read-models/local-time";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import type { ChurchBatchLabel } from "@/lib/kitchen/church-ingredient-batches";
import { churchSandwichComponents } from "@/lib/kitchen/church-sandwich-bench";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

type Props = {
  evidence: readonly ChurchIngredientEvidence[];
  records: readonly ChurchBatchLabel[];
  canRecord: boolean;
  asOf: string;
};

const zone = "America/New_York";
const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const field = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-normal";
const appearance = {
  current: { label: "Recorded label", tone: "positive" },
  recheck: { label: "Supplier recheck needed", tone: "warning" },
  expired: { label: "Discard time reached", tone: "danger" },
  voided: { label: "Voided", tone: "danger" },
} as const;

function easternInput(value: FormDataEntryValue | null) {
  const [date, time] = String(value ?? "").split("T");
  return date && time ? zonedLocalToIso(date, time, zone) : null;
}

function localLabel(value: string) {
  return easternTime.format(new Date(value));
}

function isCurrentEvidence(batch: ChurchBatchLabel, evidence?: ChurchIngredientEvidence) {
  return batch.evidenceCurrent && evidence?.status === "reviewed" && evidence.revision === batch.evidenceRevision;
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
              <p className="text-xs text-[var(--ink-soft)]">Use the earliest applicable discard time from the original package, the opening or prep rule, and any source batch. Carry that earlier time forward when repacking or prepping.</p>
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

function BatchLabelRow({ record, evidence, now, canRecord, onSave }: {
  record: ChurchBatchLabel;
  evidence?: ChurchIngredientEvidence;
  now: number;
  canRecord: boolean;
  onSave: (record: ChurchBatchLabel) => void;
}) {
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { requestIdFor } = useStableRequestIds();
  const current = isCurrentEvidence(record, evidence);
  const discard = Date.parse(record.discardAt);
  const expired = now >= discard;
  const status = appearance[record.voidedAt ? "voided" : expired ? "expired" : current ? "current" : "recheck"];

  async function voidRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecord || record.voidedAt || busy) return;
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
        setVoiding(false);
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
        <p>{record.handledAs === "opened" ? "Opened" : "Prepped"} <time dateTime={record.handledAt}>{localLabel(record.handledAt)}</time>.</p>
        <p className="whitespace-pre-wrap">Storage · {record.storageRule}</p>
        <p className="whitespace-pre-wrap">Recorded rule · {record.handlingRule}</p>
        <p>Recorded by {record.recordedByName} · <time dateTime={record.recordedAt}>{localLabel(record.recordedAt)}</time>.</p>
        {!current && <p>Recheck the current supplier label and the physical batch before use.</p>}
        {record.voidedAt && <p className="whitespace-pre-wrap">Voided <time dateTime={record.voidedAt}>{localLabel(record.voidedAt)}</time> · {record.voidReason}</p>}
        {canRecord && !record.voidedAt && !voiding && <Button variant="quiet" size="sm" onClick={() => setVoiding(true)}>Void label</Button>}
        {canRecord && !record.voidedAt && voiding && (
          <form aria-label={`Void label ${record.batchCode}`} onSubmit={(event) => void voidRecord(event)} noValidate>
            <fieldset disabled={busy} className="space-y-2">
              <label className="block font-semibold">Reason for voiding<input className={field} name="reason" required maxLength={240} /></label>
              <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" name="confirmed" required /><span>I removed the previous physical label. I’ll use a new batch code for a replacement.</span></label>
              <div className="flex flex-wrap gap-2"><Button variant="danger" size="sm" type="submit">{busy ? "Voiding…" : "Confirm void"}</Button><Button variant="quiet" size="sm" onClick={() => { setVoiding(false); setMessage(""); }}>Cancel</Button></div>
            </fieldset>
          </form>
        )}
        <p role="status">{message}</p>
      </div>
    </details>
  );
}

export function ChurchBatchLabelsPanel({ evidence, records, canRecord, asOf }: Props) {
  const [clock, setClock] = useState(() => Date.parse(asOf));
  const [changes, setChanges] = useState<Record<string, ChurchBatchLabel>>({});
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const byIngredient = new Map(evidence.map((row) => [row.ingredientKey, row]));
  const byId = new Map(records.map((row) => [row.id, row]));
  for (const row of Object.values(changes)) {
    const existing = byId.get(row.id);
    if (!existing) byId.set(row.id, row);
    else if (row.voidedAt && !existing.voidedAt) {
      byId.set(row.id, { ...existing, voidedAt: row.voidedAt, voidReason: row.voidReason });
    }
  }
  const batches = [...byId.values()].sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt)).slice(0, 50);
  function saved(row: ChurchBatchLabel) {
    setChanges((previous) => {
      if (previous[row.id]?.voidedAt && !row.voidedAt) return previous;
      return { ...previous, [row.id]: row };
    });
    setClock(Date.now());
  }

  return (
    <section aria-labelledby="church-batch-labels-heading" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="church-batch-labels-heading" className="text-lg font-semibold">Batch labels</h2>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Record the exact supplier lot, handling time and discard time for Church Street batches. Verify the reviewed supplier label and attach the label to the physical container.</p>
      {canRecord && <RecordBatchLabel evidence={evidence} onSave={saved} />}
      {batches.length === 0 ? <p className="mt-3 text-xs text-[var(--ink-soft)]">No batch labels in this view.</p> : (
        <div className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {batches.map((record) => <BatchLabelRow key={record.id} record={record} evidence={byIngredient.get(record.ingredientKey)} now={Math.max(clock, Date.parse(asOf))} canRecord={canRecord} onSave={saved} />)}
        </div>
      )}
    </section>
  );
}
