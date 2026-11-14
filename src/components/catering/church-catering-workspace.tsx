"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import {
  attachChurchSquareCateringInvoiceAction,
  createChurchSquareCateringJobAction,
  detachChurchSquareCateringInvoiceAction,
  listChurchSquareCateringJobsAction,
  saveChurchSquareCateringPackedPortionsAction,
  saveChurchSquareCateringProductionPlanAction,
  updateChurchSquareCateringJobAction,
} from "@/app/actions/workflows/church-square-catering-jobs";
import { lookupChurchSquareCateringInvoiceAction } from "@/app/actions/workflows/church-square-catering";
import { ChurchCateringIntake } from "@/components/catering/church-catering-intake";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { localDateKey } from "@/data/read-models/local-time";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import {
  cateringJobStageTransitions,
  cateringPackedPortionsReference,
  cateringPrepPortionMaximum,
  cateringPrepPortionsSchema,
  emptyCateringPrepPortions,
  type CateringJob,
  type CateringJobStage,
  type CateringPrepPortions,
} from "@/lib/integrations/church-square-catering-jobs";
import { churchSandwichBenchRecipes, churchSandwichRecipeKeys } from "@/lib/kitchen/church-sandwich-bench";

type VerifiedInvoice = Extract<Awaited<ReturnType<typeof lookupChurchSquareCateringInvoiceAction>>, { mode: "live" }>["data"];
type InvoiceFacts = Pick<VerifiedInvoice, "invoiceReference" | "orderReference" | "status" | "serviceDate" | "updatedAt" | "deposit">;

const stageLabels: Record<CateringJobStage, string> = {
  inquiry: "Inquiry", quoted: "Quoted", confirmed: "Confirmed", completed: "Completed", canceled: "Canceled",
};
const depositLabels: Record<InvoiceFacts["deposit"]["state"], string> = {
  not_requested: "No deposit requested",
  unknown: "Deposit status unavailable",
  unpaid: "Deposit awaiting payment",
  partial: "Deposit partially paid",
  satisfied: "Square records the requested deposit as paid",
  review_required: "Deposit needs review in Square",
};
const fieldClass = "focus-ring block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-60";
const labelClass = "grid min-w-0 gap-1 text-xs font-semibold";
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function portionTotal(portions: CateringPrepPortions) {
  return churchSandwichRecipeKeys.reduce((total, key) => total + portions[key], 0);
}

function canPublishForDate(serviceDate: string) {
  return serviceDate >= localDateKey(new Date(), "America/New_York");
}

function canRecordPackedPortions(job: CateringJob) {
  return job.stage === "confirmed" && Boolean(job.prepPublishedAt)
    && job.serviceDate === localDateKey(new Date(), "America/New_York");
}

function CalendarDate({ value }: { value: string }) {
  return <time dateTime={value}>{date.format(new Date(value))}</time>;
}

function InvoiceSummary({ invoice }: { invoice: InvoiceFacts }) {
  const { completedCents, dueCents, state } = invoice.deposit;
  return (
    <div className="space-y-1 text-sm">
      <p>Invoice ending <span className="font-mono">{invoice.invoiceReference}</span> · order ending <span className="font-mono">{invoice.orderReference}</span></p>
      <p className="flex flex-wrap gap-x-2">
        <span className="capitalize">{invoice.status.toLowerCase().replaceAll("_", " ")}</span>
        <span>· {depositLabels[state]}</span>
      </p>
      {(completedCents !== null || dueCents !== null) && (
        <p className="tabular-nums">
          {completedCents !== null && <span>{money.format(completedCents / 100)} recorded</span>}
          {completedCents !== null && dueCents !== null && " · "}
          {dueCents !== null && <span>{money.format(dueCents / 100)} requested</span>}
        </p>
      )}
      <p className="text-xs text-[var(--ink-soft)]">
        Square service date {invoice.serviceDate ? <CalendarDate value={invoice.serviceDate} /> : "unavailable"} · Square updated{" "}
        <time dateTime={invoice.updatedAt}>{time.format(new Date(invoice.updatedAt))} ET</time>
      </p>
    </div>
  );
}

function NewCateringJob({ onSaved, disabled }: { onSaved: (job: CateringJob) => void; disabled: boolean }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { requestIdFor, rotateRequestId } = useStableRequestIds();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const payload = {
      title: String(fields.get("title") ?? "").trim(),
      serviceDate: String(fields.get("serviceDate") ?? ""),
      stage: "inquiry" as const,
    };
    setSaving(true);
    setMessage("");
    try {
      const result = await createChurchSquareCateringJobAction({ ...payload, requestId: requestIdFor("create-job", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        form.reset();
        rotateRequestId("create-job");
        onSaved(result.data);
        setMessage("Catering job created.");
      } else {
        setMessage("message" in result ? result.message : "The job could not be created.");
      }
    } catch {
      setMessage("The job could not be created. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="new-catering-job" className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="new-catering-job" className="text-lg font-semibold">New catering job</h2>
      <form onSubmit={(event) => void create(event)} className="mt-3">
        <fieldset disabled={saving || disabled} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] sm:items-end">
          <label className={labelClass}>
            Internal event name
            <input name="title" className={fieldClass} required maxLength={120} autoComplete="off" aria-describedby="catering-title-help" />
          </label>
          <label className={labelClass}>
            Service date
            <input name="serviceDate" className={fieldClass} type="date" min="2000-01-01" max="2100-12-31" required />
          </label>
          <Button type="submit" variant="primary" size="sm">{saving ? "Creating…" : "Create inquiry"}</Button>
        </fieldset>
        <p id="catering-title-help" className="mt-2 text-xs text-[var(--ink-soft)]">Use a short event label. Keep customer names and contact details in Square.</p>
      </form>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
    </section>
  );
}

function CateringPortionEditor({ job, active, blocked, saving, unsavedJob, packed, message, onSave }: {
  job: CateringJob;
  active: boolean;
  blocked: boolean;
  saving: boolean;
  unsavedJob: boolean;
  packed: boolean;
  message: string;
  onSave: (portions: CateringPrepPortions, publish: boolean) => Promise<void>;
}) {
  const [fields, setFields] = useState(() => Object.fromEntries(
    churchSandwichRecipeKeys.map((key) => [key, String(job.portions[key])]),
  ));
  const parsed = cateringPrepPortionsSchema.safeParse(Object.fromEntries(
    churchSandwichRecipeKeys.map((key) => [key, fields[key].trim() === "" ? NaN : Number(fields[key])]),
  ));
  const changed = churchSandwichRecipeKeys.some((key) => Number(fields[key]) !== job.portions[key]);
  const total = parsed.success ? portionTotal(parsed.data) : null;
  const totalSaved = portionTotal(job.portions);
  const isUpcoming = canPublishForDate(job.serviceDate);
  const canPublish = job.stage === "confirmed" && isUpcoming && Boolean(total);
  const descriptionId = `catering-prep-${job.id}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const publish = submitter instanceof HTMLButtonElement && submitter.value === "publish";
    if (blocked || !active || unsavedJob || packed || !parsed.success || !(publish ? canPublish && (changed || !job.prepPublishedAt) : changed)) return;
    void onSave(parsed.data, publish);
  }

  if (!active && totalSaved === 0) return null;
  return (
    <details className="mt-2 border-t border-[var(--line)] pt-2">
      <summary className="focus-ring cursor-pointer rounded-md py-1 text-sm font-semibold">
        Kitchen portions · {totalSaved === 0 ? "No plan" : `${totalSaved} ${job.prepPublishedAt ? "published" : active ? "in draft" : "in closed plan"}`}
      </summary>
      <p id={descriptionId} className="mt-2 text-xs text-[var(--ink-soft)]">Plan whole sandwiches for kitchen prep. Published portions appear as the service date enters Kitchen’s seven-day view. Update invoices and stock counts separately.</p>
      {job.prepPublishedAt && (
        <p className="mt-2 text-xs font-semibold">Published to Kitchen <time dateTime={job.prepPublishedAt}>{time.format(new Date(job.prepPublishedAt))} ET</time></p>
      )}
      {packed && <p className="mt-2 text-xs text-[var(--ink-soft)]">The Kitchen plan is locked while it has packed portions. Review the pack list before correcting the packed counts.</p>}
      <form onSubmit={submit} aria-describedby={descriptionId} className="mt-2 space-y-3">
        <fieldset disabled={!active || blocked || unsavedJob || packed} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <legend className="sr-only">Sandwich portions</legend>
          {churchSandwichBenchRecipes.map(({ key, name }) => (
            <label key={key} className={labelClass}>
              {name}
              <input aria-invalid={parsed.success || /^\d+$/.test(fields[key]) && Number(fields[key]) <= cateringPrepPortionMaximum ? undefined : true}
                className={`${fieldClass} tabular-nums`} type="number" min={0} max={cateringPrepPortionMaximum} step={1}
                inputMode="numeric" required value={fields[key]}
                onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
            </label>
          ))}
        </fieldset>
        {active && !packed && <>
          <p className="text-xs font-medium">{total === null ? `Enter a whole quantity from 0 to ${cateringPrepPortionMaximum} for each sandwich.` : `${total} ${total === 1 ? "sandwich" : "sandwiches"} in this plan.`}</p>
          {unsavedJob && <p className="text-xs text-[var(--ink-soft)]">Save your job changes before editing kitchen portions.</p>}
          {job.stage !== "confirmed" && <p className="text-xs text-[var(--ink-soft)]">Confirm the job before publishing to Kitchen.</p>}
          {job.stage === "confirmed" && !isUpcoming && <p className="text-xs text-[var(--ink-soft)]">Publishing is available through the service date.</p>}
          {changed && job.prepPublishedAt && <p className="text-xs text-[var(--ink-soft)]">Saving changed quantities as a draft removes the current Kitchen handoff.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={blocked || unsavedJob || !parsed.success || !changed}>Save portion draft</Button>
            <Button type="submit" value="publish" variant="primary" size="sm" disabled={blocked || unsavedJob || !canPublish || (!changed && Boolean(job.prepPublishedAt))}>Publish to Kitchen</Button>
          </div>
        </>}
      </form>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{saving ? "Saving kitchen portions…" : message}</p>
    </details>
  );
}

function CateringPackedPortions({ job, blocked, saving, unsavedJob, message, onSave }: {
  job: CateringJob;
  blocked: boolean;
  saving: boolean;
  unsavedJob: boolean;
  message: string;
  onSave: (portions: CateringPrepPortions, reference: string) => Promise<void>;
}) {
  const canRecord = canRecordPackedPortions(job);
  const published = portionTotal(job.portions);
  const packed = job.packedPortions ?? emptyCateringPrepPortions;
  const packedTotal = portionTotal(packed);
  const [entry, setEntry] = useState<{ revision: number; draft: Partial<Record<keyof CateringPrepPortions, string>>; reference: string }>();
  const { draft, reference } = entry?.revision === job.revision ? entry : { draft: {}, reference: "" };
  const parsed = cateringPrepPortionsSchema.safeParse(Object.fromEntries(
    churchSandwichRecipeKeys.map((key) => [key, draft[key] === undefined ? packed[key] : /^\d+$/.test(draft[key]) ? Number(draft[key]) : NaN]),
  ));
  const parsedReference = cateringPackedPortionsReference.safeParse(reference);
  const counts = parsed.success ? parsed.data : null;
  const validCounts = counts !== null && churchSandwichRecipeKeys.every((key) => counts[key] <= job.portions[key]);
  const changed = counts !== null && churchSandwichRecipeKeys.some((key) => counts[key] !== packed[key]);
  const canSave = canRecord && !blocked && !unsavedJob && validCounts && changed && parsedReference.success;
  const descriptionId = `catering-packed-${job.id}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || !counts || !parsedReference.success) return;
    void onSave(counts, parsedReference.data);
  }

  if (!canRecord && packedTotal === 0) return null;
  return (
    <details className="mt-2 border-t border-[var(--line)] pt-2">
      <summary className="focus-ring cursor-pointer rounded-md py-1 text-sm font-semibold">
        {canRecord ? "Record packed portions" : "Packed portion record"} · {packedTotal} packed · {published - packedTotal} {canRecord ? "still to build" : "not packed"}
      </summary>
      <p id={descriptionId} className="mt-2 text-xs text-[var(--ink-soft)]">
        {canRecord ? "Count sandwiches already assembled, packed, checked against the pack list and set aside for this job. Enter updated totals, including any corrections. Record pickup or delivery separately."
          : "Packed counts were recorded against this plan. Packing can be recorded on the service date while the plan is published and the job is confirmed."}
      </p>
      <form onSubmit={submit} aria-describedby={descriptionId} className="mt-2 space-y-3">
        <fieldset disabled={!canRecord || blocked || unsavedJob} className="min-w-0 space-y-3">
          <legend className="sr-only">Packed portions</legend>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <caption className="sr-only">Saved counts and packed portion entry</caption>
              <thead className="border-b border-[var(--line)] text-[var(--ink-soft)]">
                <tr>
                  <th scope="col" className="py-2 pr-2">Sandwich</th>
                  <th scope="col" className="py-2 pr-2">Planned</th>
                  <th scope="col" className="py-2 pr-2">Packed</th>
                  <th scope="col" className="py-2 pr-2">{canRecord ? "Still to build" : "Not packed"}</th>
                  {canRecord && <th scope="col" className="py-2">New packed total</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {churchSandwichBenchRecipes.filter(({ key }) => job.portions[key] > 0).map(({ key, name }) => (
                  <tr key={key}>
                    <th scope="row" className="py-2 pr-2 font-medium">{name}</th><td className="py-2 pr-2">{job.portions[key]}</td><td className="py-2 pr-2">{packed[key]}</td>
                    <td className="py-2 pr-2">{job.portions[key] - packed[key]}</td>
                    {canRecord && <td className="w-24 py-1"><input type="number" required min={0} max={job.portions[key]} step={1} inputMode="numeric"
                      aria-label={`Packed total for ${name}`} value={draft[key] ?? String(packed[key])} className={fieldClass}
                      onChange={(event) => setEntry({ revision: job.revision, reference, draft: { ...draft, [key]: event.target.value } })} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canRecord && <div className="max-w-sm space-y-1">
            <label className={labelClass}>Pack-list reference
              <input required maxLength={120} autoComplete="off" value={reference} className={fieldClass} aria-describedby={`${descriptionId}-reference`}
                onChange={(event) => setEntry({ revision: job.revision, draft, reference: event.target.value })} />
            </label>
            <p id={`${descriptionId}-reference`} className="text-xs text-[var(--ink-soft)]">Use a short internal reference. Leave out guest names and contact details.</p>
          </div>}
        </fieldset>
        {canRecord && <>
          {!validCounts && <p className="text-xs text-[var(--ink-soft)]">Use whole quantities from zero through the planned count for each sandwich.</p>}
          {unsavedJob && <p className="text-xs text-[var(--ink-soft)]">Save or undo the job edits before recording packed portions.</p>}
          <Button type="submit" variant="primary" size="sm" disabled={!canSave}>{saving ? "Recording…" : "Save packed totals"}</Button>
        </>}
      </form>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
    </details>
  );
}

function CateringJobCard({ job, onSaved, refreshing }: { job: CateringJob; onSaved: (job: CateringJob) => void; refreshing: boolean }) {
  const [title, setTitle] = useState(job.title);
  const [serviceDate, setServiceDate] = useState(job.serviceDate);
  const [stage, setStage] = useState(job.stage);
  const [invoiceId, setInvoiceId] = useState("");
  const [verified, setVerified] = useState<VerifiedInvoice>();
  const [busy, setBusy] = useState<"save" | "verify" | "attach" | "detach" | "prep" | "packed" | null>(null);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [jobMessage, setJobMessage] = useState("");
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const [prepMessage, setPrepMessage] = useState("");
  const [packedMessage, setPackedMessage] = useState("");
  const { requestIdFor } = useStableRequestIds();
  const invoice = job.invoice;
  const active = job.stage !== "completed" && job.stage !== "canceled";
  const blocked = Boolean(busy) || refreshing;
  const matchingDate = verified?.serviceDate === job.serviceDate;
  const matchingLink = !invoice || (verified?.invoiceReference === invoice.invoiceReference && verified.orderReference === invoice.orderReference);
  const changes = title.trim() !== job.title || serviceDate !== job.serviceDate || stage !== job.stage;
  const hasPackedPortions = portionTotal(job.packedPortions ?? emptyCateringPrepPortions) > 0;
  const stageOptions = cateringJobStageTransitions[job.stage].filter((next) => !hasPackedPortions || next === job.stage || next === "completed" || next === "canceled");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || !changes || (hasPackedPortions && (serviceDate !== job.serviceDate || !stageOptions.includes(stage)))) return;
    const payload = { jobId: job.id, expectedRevision: job.revision, title: title.trim(), serviceDate, stage };
    setBusy("save");
    setJobMessage("");
    try {
      const result = await updateChurchSquareCateringJobAction({ ...payload, requestId: requestIdFor("save-job", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSaved(result.data);
        setTitle(result.data.title);
        setServiceDate(result.data.serviceDate);
        setStage(result.data.stage);
        if (result.data.serviceDate !== job.serviceDate) setVerified(undefined);
        setJobMessage("Catering job saved.");
      } else {
        setJobMessage("message" in result ? result.message : "The job could not be saved.");
      }
    } catch {
      setJobMessage("The job could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || !invoiceId.trim()) return;
    setBusy("verify");
    setVerified(undefined);
    setInvoiceMessage("");
    try {
      const result = await lookupChurchSquareCateringInvoiceAction({ invoiceId: invoiceId.trim() });
      if (result.ok && result.mode === "live") {
        setVerified(result.data);
        setInvoiceMessage("Square verified this invoice for Church Street.");
      } else {
        setInvoiceMessage("message" in result ? result.message : "The invoice could not be verified.");
      }
    } catch {
      setInvoiceMessage("The invoice could not be verified. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function attach() {
    if (!verified || blocked || !matchingDate || !matchingLink || changes || (!invoice && !active)) return;
    const payload = {
      jobId: job.id, expectedRevision: job.revision, invoiceId: invoiceId.trim(), invoiceUpdatedAt: verified.updatedAt,
    };
    setBusy("attach");
    setInvoiceMessage("Rechecking Square…");
    try {
      const result = await attachChurchSquareCateringInvoiceAction({ ...payload, requestId: requestIdFor("attach-invoice", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSaved(result.data);
        setVerified(undefined);
        setInvoiceId("");
        setInvoiceMessage(invoice ? "Linked invoice updated." : "Verified invoice attached to this job.");
      } else {
        if (!result.ok && result.code === "stale") setVerified(undefined);
        setInvoiceMessage("message" in result ? result.message : "The invoice could not be attached.");
      }
    } catch {
      setInvoiceMessage("The invoice could not be attached. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function detach() {
    if (!invoice || !active || !confirmDetach || blocked) return;
    const payload = { jobId: job.id, expectedRevision: job.revision, expectedInvoiceReference: invoice.invoiceReference };
    setBusy("detach");
    setInvoiceMessage("");
    try {
      const result = await detachChurchSquareCateringInvoiceAction({ ...payload, requestId: requestIdFor("detach-invoice", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSaved(result.data);
        setVerified(undefined);
        setInvoiceId("");
        setInvoiceMessage("Invoice detached from this catering job.");
      } else {
        setInvoiceMessage("message" in result ? result.message : "The invoice could not be detached.");
      }
    } catch {
      setInvoiceMessage("The invoice could not be detached. Try again.");
    } finally {
      setConfirmDetach(false);
      setBusy(null);
    }
  }

  async function savePreparation(portions: CateringPrepPortions, publish: boolean) {
    if (blocked || changes || !active || hasPackedPortions || (publish && (job.stage !== "confirmed" || !canPublishForDate(job.serviceDate)))) return;
    const payload = { jobId: job.id, expectedRevision: job.revision, portions, publish };
    setBusy("prep");
    setPrepMessage("");
    try {
      const result = await saveChurchSquareCateringProductionPlanAction({ ...payload, requestId: requestIdFor("save-prep", payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        onSaved(result.data);
        setPrepMessage(publish ? "Portions published to Kitchen." : "Portion draft saved.");
      } else {
        setPrepMessage("message" in result ? result.message : "The kitchen portions could not be saved.");
      }
    } catch {
      setPrepMessage("The kitchen portions could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function savePackedPreparation(packedPortions: CateringPrepPortions, reference: string) {
    if (blocked || changes || !canRecordPackedPortions(job)) return;
    const payload = { jobId: job.id, expectedRevision: job.revision, packedPortions, reference };
    setBusy("packed");
    setPackedMessage("");
    try {
      const result = await saveChurchSquareCateringPackedPortionsAction({ ...payload, requestId: requestIdFor("save-packed", payload) });
      if (result.ok && result.mode === "live" && result.persisted && result.data.id === job.id) {
        onSaved(result.data);
        setPackedMessage("Packed portion totals recorded.");
        return;
      }
      setPackedMessage(!result.ok && result.code === "stale" ? "The catering job changed. Refresh jobs and check the latest counts before recording." :
        "message" in result ? result.message : "The packed totals could not be recorded.");
    } catch {
      setPackedMessage("The packed totals could not be recorded. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article aria-labelledby={`catering-job-${job.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h3 id={`catering-job-${job.id}`} className="break-words text-base font-semibold">{job.title}</h3>
      <p className="mt-1 break-words text-xs text-[var(--ink-soft)]">
        <CalendarDate value={job.serviceDate} /> · {stageLabels[job.stage]} · Owner {job.ownerName}
      </p>
      <div className="mt-3">
        {invoice ? <InvoiceSummary invoice={invoice} /> : <p className="text-sm text-[var(--ink-soft)]">No Square invoice attached.</p>}
        {invoice?.linkNeedsReview && <p className="mt-1 text-sm font-medium text-[var(--warning)]">Review the linked invoice in Square before making prep or staffing decisions.</p>}
        {invoice?.serviceDateMismatch && <p className="mt-1 text-sm font-medium text-[var(--warning)]">The Square service date differs from the job date. Review the date in Square.</p>}
      </div>
      <details className="mt-3 border-t border-[var(--line)] pt-2">
        <summary className="focus-ring cursor-pointer rounded-md py-1 text-sm font-semibold">Edit job</summary>
        <form onSubmit={(event) => void save(event)} className="mt-2">
          <fieldset disabled={blocked || !active} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_minmax(7rem,auto)_auto] sm:items-end">
            <label className={labelClass}>
              Internal event name
              <input className={fieldClass} required maxLength={120} value={title} autoComplete="off" aria-describedby="catering-title-help" onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className={labelClass}>
              Service date
              <input className={fieldClass} type="date" min="2000-01-01" max="2100-12-31" required disabled={Boolean(invoice) || hasPackedPortions || !active} value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
            </label>
            <label className={labelClass}>
              Stage
              <select className={fieldClass} value={stage} onChange={(event) => setStage(event.target.value as CateringJobStage)}>
                {stageOptions.map((value) => <option key={value} value={value}>{stageLabels[value]}</option>)}
              </select>
            </label>
            <Button type="submit" variant="secondary" size="sm" disabled={!changes}>{busy === "save" ? "Saving…" : "Save job"}</Button>
          </fieldset>
          {invoice && <p className="mt-2 text-xs text-[var(--ink-soft)]">The job date is locked while an invoice is linked.</p>}
          {hasPackedPortions && active && <p className="mt-2 text-xs text-[var(--ink-soft)]">Packed portions lock the service date and Kitchen plan. You can still complete or cancel the job.</p>}
          {job.prepPublishedAt && (serviceDate !== job.serviceDate || stage !== job.stage) && <p className="mt-2 text-xs text-[var(--ink-soft)]">
            {stage === "completed" || stage === "canceled" ? "Closing this job removes its remaining portions from Kitchen. Any packed amounts stay in the job record." : "Saving a new service date or stage removes the current Kitchen handoff."}
          </p>}
        </form>
        <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{jobMessage}</p>
      </details>
      <CateringPortionEditor job={job} active={active} blocked={blocked} saving={busy === "prep"}
        unsavedJob={changes} packed={hasPackedPortions} message={prepMessage} onSave={savePreparation} />
      <CateringPackedPortions job={job} blocked={blocked} saving={busy === "packed"}
        unsavedJob={changes} message={packedMessage} onSave={savePackedPreparation} />
      {(invoice || active) && <details className="mt-2 border-t border-[var(--line)] pt-2">
        <summary className="focus-ring cursor-pointer rounded-md py-1 text-sm font-semibold">{invoice ? "Recheck linked invoice" : "Verify and attach invoice"}</summary>
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => void verify(event)}>
          <label className={`${labelClass} flex-1 basis-56`}>
            Exact Square invoice ID
            <input className={`${fieldClass} font-mono`} value={invoiceId} disabled={blocked} required maxLength={192}
              autoComplete="off" spellCheck={false} onChange={(event) => {
                setInvoiceId(event.target.value);
                setVerified(undefined);
                setInvoiceMessage("");
              }} />
          </label>
          <Button type="submit" variant="secondary" size="sm" disabled={blocked}>{busy === "verify" ? "Verifying…" : "Verify invoice"}</Button>
        </form>
        {verified && (
          <div className="mt-2 space-y-2 rounded-xl border border-[var(--line)] p-3">
            <InvoiceSummary invoice={verified} />
            {!matchingDate && <p className="text-sm text-[var(--warning)]">The Square service date must match the saved job date before you can attach this invoice.</p>}
            {!matchingLink && <p className="text-sm text-[var(--warning)]">Enter the Square invoice already linked to this job.</p>}
            {changes && <p className="text-xs text-[var(--ink-soft)]">Save your job changes before updating its invoice.</p>}
            <Button type="button" variant="primary" size="sm" disabled={blocked || !matchingDate || !matchingLink || changes} onClick={() => void attach()}>
              {invoice ? "Update linked invoice" : "Attach verified invoice"}
            </Button>
          </div>
        )}
        {invoice && active && (
          <Button type="button" variant="quiet" size="sm" className="mt-2" disabled={blocked} onClick={() => setConfirmDetach(true)}>Detach invoice</Button>
        )}
      </details>}
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{invoiceMessage}</p>
      {invoice && <ConfirmActionDialog
        open={confirmDetach}
        labelledBy={`detach-catering-invoice-${job.id}`}
        title={`Detach invoice ending ${invoice.invoiceReference}?`}
        description="This removes the link from the catering job. The invoice and payment stay in Square."
        confirmLabel="Detach invoice"
        cancelLabel="Keep invoice linked"
        busy={busy === "detach"}
        confirmDisabled={refreshing}
        onClose={() => setConfirmDetach(false)}
        onConfirm={detach}
      />}
    </article>
  );
}

export function ChurchCateringWorkspace({ initialJobs, showIntake = false }: { initialJobs: CateringJob[] | null; showIntake?: boolean }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const localSaveVersion = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState(initialJobs === null ? "Catering jobs could not be loaded." : "");

  function saveJob(job: CateringJob) {
    localSaveVersion.current += 1;
    setJobs((previous) => {
      if (!previous) return previous;
      const current = previous.find((value) => value.id === job.id);
      if (!current) return [job, ...previous].slice(0, 100);
      return current.revision > job.revision ? previous : previous.map((value) => value.id === job.id ? job : value);
    });
  }

  async function refresh() {
    if (refreshing) return;
    const versionAtRequest = localSaveVersion.current;
    setRefreshing(true);
    setMessage("");
    try {
      const result = await listChurchSquareCateringJobsAction();
      if (result.ok && result.mode === "live") {
        if (localSaveVersion.current === versionAtRequest) {
          setJobs(result.data);
          setRefreshVersion((previous) => previous + 1);
          setMessage("Catering jobs refreshed.");
        } else {
          setMessage("A job changed during the refresh. Refresh again for the latest list.");
        }
      } else {
        if (!result.ok && (result.code === "unauthenticated" || result.code === "forbidden")) setJobs(null);
        setMessage("message" in result ? result.message : "Catering jobs could not be refreshed.");
      }
    } catch {
      setMessage("Catering jobs could not be refreshed. Try again.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1050px] space-y-5">
      {showIntake && <ChurchCateringIntake onConverted={(job) => {
        saveJob(job);
        if (jobs === null) void refresh();
      }} />}
      <NewCateringJob onSaved={saveJob} disabled={jobs === null || refreshing} />
      <section className="space-y-3" aria-labelledby="catering-jobs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="catering-jobs" className="text-lg font-semibold">Church Street jobs</h2>
          <div className="flex items-center gap-3">
            <Link href="/service" className="focus-ring rounded-md text-xs font-semibold underline">Manager Log</Link>
            <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh jobs"}</Button>
          </div>
        </div>
        <p role="status" className="text-xs text-[var(--ink-soft)]">{message}</p>
        {jobs?.length === 0 && <p className="text-sm text-[var(--ink-soft)]">No catering jobs yet.</p>}
        {jobs?.length === 100 && <p className="text-xs text-[var(--ink-soft)]">Showing up to 100 jobs.</p>}
        {jobs?.map((job) => <CateringJobCard key={`${job.id}:${refreshVersion}`} job={job} onSaved={saveJob} refreshing={refreshing} />)}
      </section>
    </div>
  );
}
