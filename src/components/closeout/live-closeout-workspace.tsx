"use client";

import {
  ArrowDownToLine,
  Calculator,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  Plus,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, type FormEvent, useContext, useRef, useState } from "react";
import {
  approveCloseoutAction,
  createCloseoutUploadUrlAction,
  finalizeCloseoutUploadAction,
  submitCloseoutAction,
} from "@/app/actions/workflows/closeout";
import {
  approveTipRunAction,
  calculateTipRunAction,
  exportTipPayrollAction,
  prepareTipRunAction,
} from "@/app/actions/workflows/tips";
import { createPrivateFileDownloadUrlAction } from "@/app/actions/workflows/files";
import { TipPolicyConfiguration } from "@/components/closeout/tip-policy-configuration";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveCloseout,
  LiveCloseoutModel,
  LiveTipRun,
} from "@/data/read-models/closeout";
import type { TipPolicyConfigurationModel } from "@/data/read-models/financial-configuration";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { validatePrivateFile } from "@/lib/storage/private-files";
import { createClient } from "@/lib/supabase/client";
import { cn, formatMoney as formatCurrency } from "@/lib/utils";

type Draft = {
  businessDate: string;
  shiftLabel: string;
  grossSales: string;
  netSales: string;
  cashSales: string;
  cardSales: string;
  expectedCash: string;
  actualCash: string;
  covers: string;
  comps: string;
  voids: string;
  serviceCharges: string;
  cardTips: string;
  cashTips: string;
  notes: string;
};

const CurrencyCodeContext = createContext("USD");

function blankDraft(date: string): Draft {
  return {
    businessDate: date,
    shiftLabel: "Dinner",
    grossSales: "",
    netSales: "",
    cashSales: "",
    cardSales: "",
    expectedCash: "",
    actualCash: "",
    covers: "",
    comps: "0.00",
    voids: "0.00",
    serviceCharges: "0.00",
    cardTips: "0.00",
    cashTips: "0.00",
    notes: "",
  };
}

function cents(value: string, allowNegative = false): number | null {
  const normalized = value.trim().replaceAll(",", "");
  const pattern = allowNegative ? /^-?\d+(?:\.\d{0,2})?$/ : /^\d+(?:\.\d{0,2})?$/;
  if (!pattern.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) return null;
  return negative ? -result : result;
}

function moneyInput(value: number | null) {
  if (value === null) return "";
  const negative = value < 0;
  const absolute = Math.abs(value);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function draftFromCloseout(closeout: LiveCloseout): Draft {
  return {
    businessDate: closeout.businessDate,
    shiftLabel: closeout.shiftLabel,
    grossSales: moneyInput(closeout.grossSalesCents),
    netSales: moneyInput(closeout.netSalesCents),
    cashSales: moneyInput(closeout.cashSalesCents),
    cardSales: moneyInput(closeout.cardSalesCents),
    expectedCash: moneyInput(closeout.expectedCashCents),
    actualCash: moneyInput(closeout.actualCashCents),
    covers: String(closeout.covers),
    comps: moneyInput(closeout.compsCents),
    voids: moneyInput(closeout.voidsCents),
    serviceCharges: moneyInput(closeout.serviceChargesCents),
    cardTips: moneyInput(closeout.cardTipsCents),
    cashTips: moneyInput(closeout.cashTipsCents),
    notes: closeout.notes ?? "",
  };
}

const closeoutTone: Record<string, "neutral" | "warning" | "positive" | "danger"> = {
  pending: "warning",
  in_review: "warning",
  approved: "positive",
  rejected: "danger",
};

const tipTone: Record<string, "neutral" | "warning" | "positive"> = {
  draft: "neutral",
  calculated: "warning",
  approved: "positive",
  exported: "positive",
};

function MoneyField({
  label,
  name,
  value,
  disabled,
  allowNegative = false,
  onChange,
}: {
  label: string;
  name: keyof Draft;
  value: string;
  disabled: boolean;
  allowNegative?: boolean;
  onChange: (name: keyof Draft, value: string) => void;
}) {
  const currencyCode = useContext(CurrencyCodeContext);
  const valid = value === "" || cents(value, allowNegative) !== null;
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-4 border-t border-[var(--line)] py-3 first:border-t-0">
      <span className="text-[13px] font-semibold">{label}</span>
      <span className={cn("flex h-10 items-center rounded-xl border bg-[var(--paper-strong)] px-3", valid ? "border-[var(--line)]" : "border-[var(--danger)]")}>
        <span className="mr-1 text-xs font-semibold text-[var(--ink-faint)]">{currencyCode}</span>
        <input aria-label={label} inputMode="decimal" value={value} disabled={disabled} onChange={(event) => onChange(name, event.target.value)} className="numeric min-w-0 flex-1 bg-transparent text-right text-xs font-semibold outline-none" />
      </span>
    </label>
  );
}

function TipRunDetail({ run }: { run: LiveTipRun }) {
  const currencyCode = useContext(CurrencyCodeContext);
  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Distributable" value={formatCurrency(run.distributableCents, currencyCode)} detail="Tips only" />
        <Metric label="Allocated" value={formatCurrency(run.allocatedCents, currencyCode)} detail="Cent reconciled" />
        <Metric label="Participants" value={String(run.participants.length)} detail={`${run.participants.filter((item) => item.eligible).length} eligible`} />
        <Metric label="Service charge" value={formatCurrency(run.sources.filter((source) => source.sourceType === "service_charge").reduce((sum, source) => sum + source.amountCents, 0), currencyCode)} detail="Tracked separately" />
      </div>
      <div className="mt-6 overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">
        {run.allocations.map((allocation) => {
          const explanation = allocation.explanation;
          return (
            <div key={allocation.id} className="grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--line)] px-4 py-4 first:border-t-0 sm:grid-cols-[1fr_120px_120px]">
              <div><p className="text-xs font-semibold">{allocation.employeeName}</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">{String(explanation.method ?? run.method ?? "policy")} · {String(explanation.worked_minutes ?? "—")} minutes · remainder rank {allocation.remainderRank ?? "—"}</p></div>
              <span className="numeric hidden text-right text-xs text-[var(--ink-faint)] sm:block">{formatCurrency(allocation.baseAmountCents, currencyCode)} base</span>
              <span className="numeric text-right text-xs font-semibold">{formatCurrency(allocation.finalAmountCents, currencyCode)}</span>
            </div>
          );
        })}
        {!run.allocations.length ? <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">Calculate this run to create deterministic allocations.</p> : null}
      </div>
    </div>
  );
}

export function LiveCloseoutWorkspace({
  workspace,
  result,
  policyConfigurationResult,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveCloseoutModel>;
  policyConfigurationResult: LiveReadResult<TipPolicyConfigurationModel>;
}) {
  const router = useRouter();
  const model = result.ok ? result.data : null;
  const formatMoney = (value: number) =>
    formatCurrency(value, model?.currencyCode ?? "USD");
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: model?.timeZone ?? "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const initialCloseout = model?.closeouts[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialCloseout?.id ?? null);
  const [draft, setDraft] = useState<Draft>(
    initialCloseout ? draftFromCloseout(initialCloseout) : blankDraft(model?.date ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [policyVersionId, setPolicyVersionId] = useState(
    model?.policies.find((policy) => policy.method !== null)?.id ?? "",
  );
  const selected = model?.closeouts.find((closeout) => closeout.id === selectedId) ?? null;
  const tipRun = model?.tipRuns.find((run) => run.closeoutId === selectedId) ?? null;
  const locked = Boolean(selected);

  if (!result.ok || !model) {
    return <PageFrame><section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center"><CircleAlert className="mx-auto size-6 text-[var(--warning)]" /><h2 className="mt-4 text-xl font-medium">Closeout unavailable</h2><p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">Management access and tenant-scoped financial records are required.</p></section></PageFrame>;
  }

  function updateDraft(name: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function selectCloseout(closeout: LiveCloseout) {
    setSelectedId(closeout.id);
    setDraft(draftFromCloseout(closeout));
    setMessage("");
  }

  function newCloseout() {
    if (!model) return;
    setSelectedId(null);
    setDraft(blankDraft(model.date));
    setMessage("");
  }

  async function perform(
    action: Promise<{ ok: boolean; message?: string }>,
    success: string,
    onSuccess?: () => void,
  ) {
    setBusy(true);
    setMessage("");
    const response = await action;
    setBusy(false);
    if (!response.ok) {
      setMessage(response.message ?? "The financial action could not be completed.");
      return false;
    }
    onSuccess?.();
    setMessage(success);
    router.refresh();
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = {
      grossSalesCents: cents(draft.grossSales),
      netSalesCents: cents(draft.netSales),
      cashSalesCents: cents(draft.cashSales),
      cardSalesCents: cents(draft.cardSales),
      expectedCashCents: cents(draft.expectedCash, true),
      actualCashCents: draft.actualCash.trim() ? cents(draft.actualCash, true) : null,
      compsCents: cents(draft.comps),
      voidsCents: cents(draft.voids),
      serviceChargesCents: cents(draft.serviceCharges),
      cardTipsCents: cents(draft.cardTips),
      cashTipsCents: cents(draft.cashTips),
    };
    const covers = /^\d+$/.test(draft.covers) ? Number(draft.covers) : null;
    const requiredValues = [
      parsed.grossSalesCents,
      parsed.netSalesCents,
      parsed.cashSalesCents,
      parsed.cardSalesCents,
      parsed.expectedCashCents,
      parsed.compsCents,
      parsed.voidsCents,
      parsed.serviceChargesCents,
      parsed.cardTipsCents,
      parsed.cashTipsCents,
    ];
    if (requiredValues.some((value) => value === null) || covers === null) {
      setMessage("Complete every required amount and cover count with valid values.");
      return;
    }
    const requestPayload = {
      locationId: workspace.activeLocation.id,
      businessDate: draft.businessDate,
      shiftLabel: draft.shiftLabel,
      ...parsed,
      covers,
      notes: draft.notes.trim() || null,
    };
    const requestScope = "closeout.submit";
    const requestId = requestIdFor(requestScope, requestPayload);
    const response = await submitCloseoutAction({
      submissionId: requestId,
      ...requestPayload,
    });
    if (!response.ok) {
      setMessage(response.message);
      return;
    }
    rotateRequestId(requestScope);
    setSelectedId(requestId);
    setMessage("Closeout submitted for independent approval.");
    router.refresh();
  }

  async function openAttachment(attachment: LiveCloseout["attachments"][number]) {
    const response = await createPrivateFileDownloadUrlAction({ bucket: "closeouts", objectPath: attachment.storagePath, downloadFileName: attachment.fileName });
    if (!response.ok || !("data" in response)) {
      setMessage(response.ok ? "The private attachment is unavailable." : response.message);
      return;
    }
    window.open(response.data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function uploadAttachment(file: File) {
    if (!selected) return;
    const validation = validatePrivateFile("closeouts", file.type, file.size);
    if (!validation.ok || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      setMessage(validation.message ?? "Choose a PDF, JPEG, PNG, or WebP closeout document.");
      return;
    }
    setBusy(true);
    setMessage("Preparing a private closeout upload…");
    const uploadScope = `closeout.attachment:${selected.id}`;
    const uploadPayload = {
      closeoutId: selected.id,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      lastModified: file.lastModified,
    };
    const uploadId = requestIdFor(uploadScope, uploadPayload);
    const prepared = await createCloseoutUploadUrlAction({
      uploadId,
      closeoutId: selected.id,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!prepared.ok || !("data" in prepared)) {
      setBusy(false);
      setMessage(prepared.ok ? "The private upload could not start." : prepared.message);
      return;
    }
    const supabase = createClient();
    const uploaded = await supabase.storage
      .from("closeouts")
      .uploadToSignedUrl(prepared.data.objectPath, prepared.data.token, file, {
        contentType: file.type,
      });
    if (uploaded.error) {
      setBusy(false);
      setMessage("The private file transfer did not finish. Retry the upload.");
      return;
    }
    const finalized = await finalizeCloseoutUploadAction({
      closeoutId: selected.id,
      objectPath: prepared.data.objectPath,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    setBusy(false);
    if (!finalized.ok) {
      setMessage(finalized.message);
      return;
    }
    setMessage("Closeout evidence stored privately and bound to this record.");
    rotateRequestId(uploadScope);
    router.refresh();
  }

  async function exportPayroll(run: LiveTipRun) {
    setBusy(true);
    setMessage("");
    const exportScope = `tips.export:${run.id}`;
    const response = await exportTipPayrollAction({
      requestId: requestIdFor(exportScope, { tipRunId: run.id }),
      tipRunId: run.id,
    });
    setBusy(false);
    if (!response.ok || !("data" in response)) {
      setMessage(response.ok ? "The audited payroll export was unavailable." : response.message);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([response.data.csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = response.data.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    rotateRequestId(exportScope);
    setMessage("Audited payroll-support CSV generated from the locked tip run.");
    router.refresh();
  }

  const actualCash = cents(draft.actualCash, true);
  const expectedCash = cents(draft.expectedCash, true);
  const cashVariance = actualCash !== null && expectedCash !== null ? actualCash - expectedCash : null;
  const paymentTotal = (cents(draft.cashSales) ?? 0) + (cents(draft.cardSales) ?? 0);
  const paymentDifference = paymentTotal - (cents(draft.netSales) ?? 0);

  return (
    <CurrencyCodeContext.Provider value={model.currencyCode}>
    <PageFrame width="full" className="max-w-[1700px]">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="flex items-center gap-2"><StatusPill tone="positive" dot>Connected</StatusPill><span className="text-xs text-[var(--ink-faint)]">Human approval · immutable locks</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Closeout & tips</h2><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Sales, cash, source-separated tips, and payroll support for {workspace.activeLocation.name}.</p></div><Button variant="accent" onClick={newCloseout}><Plus className="size-4" />New closeout</Button></header>

      <div className="mt-7 grid gap-10 xl:grid-cols-[260px_minmax(0,1fr)_minmax(340px,.8fr)]">
        <aside><SectionHeading eyebrow="History" title="Recent closeouts" detail={`${model.closeouts.length} visible records`} /><div className="space-y-2">{model.closeouts.map((closeout) => <button key={closeout.id} onClick={() => selectCloseout(closeout)} className={cn("focus-ring w-full rounded-[16px] border p-4 text-left", selectedId === closeout.id ? "border-[var(--accent)] bg-[var(--accent-soft)]/35" : "border-[var(--line)] bg-[var(--paper-strong)]")}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{closeout.shiftLabel}</span><StatusPill tone={closeoutTone[closeout.status] ?? "neutral"}>{closeout.status}</StatusPill></div><p className="numeric mt-2 text-xs text-[var(--ink-faint)]">{closeout.businessDate} · {formatMoney(closeout.netSalesCents)}</p></button>)}{!model.closeouts.length ? <p className="rounded-[16px] border border-[var(--line)] p-5 text-xs text-[var(--ink-faint)]">No connected closeouts yet.</p> : null}</div></aside>

        <main>
          <div className="flex items-end justify-between gap-3"><SectionHeading eyebrow={locked ? "Submitted record" : "Working form"} title={locked ? `${draft.shiftLabel} · ${draft.businessDate}` : "New end-of-shift closeout"} detail={locked && selected ? `${selected.submittedBy} · ${formatDateTime(selected.submittedAt)}` : "Amounts remain editable until submission"} />{selected ? <StatusPill tone={closeoutTone[selected.status] ?? "neutral"} dot>{selected.status}</StatusPill> : null}</div>
          <form onSubmit={(event) => void submit(event)}>
            <div className="grid gap-x-8 md:grid-cols-2"><label className="py-3"><span className="mb-1.5 block text-xs font-semibold">Business date</span><input required type="date" value={draft.businessDate} disabled={locked} onChange={(event) => updateDraft("businessDate", event.target.value)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xs" /></label><label className="py-3"><span className="mb-1.5 block text-xs font-semibold">Shift label</span><input required maxLength={80} value={draft.shiftLabel} disabled={locked} onChange={(event) => updateDraft("shiftLabel", event.target.value)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xs" /></label></div>
            <div className="mt-3 grid gap-x-8 md:grid-cols-2"><section><SectionHeading title="Sales & covers" /><MoneyField label="Gross sales" name="grossSales" value={draft.grossSales} disabled={locked} onChange={updateDraft} /><MoneyField label="Net sales" name="netSales" value={draft.netSales} disabled={locked} onChange={updateDraft} /><MoneyField label="Cash sales" name="cashSales" value={draft.cashSales} disabled={locked} onChange={updateDraft} /><MoneyField label="Card sales" name="cardSales" value={draft.cardSales} disabled={locked} onChange={updateDraft} /><MoneyField label="Comps" name="comps" value={draft.comps} disabled={locked} onChange={updateDraft} /><MoneyField label="Voids" name="voids" value={draft.voids} disabled={locked} onChange={updateDraft} /><label className="grid grid-cols-[1fr_132px] items-center gap-4 border-t border-[var(--line)] py-3"><span className="text-[13px] font-semibold">Covers</span><input value={draft.covers} disabled={locked} inputMode="numeric" onChange={(event) => updateDraft("covers", event.target.value)} className="numeric h-10 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-right text-xs font-semibold" /></label></section><section><SectionHeading title="Cash & tip sources" /><MoneyField label="Expected cash" name="expectedCash" value={draft.expectedCash} disabled={locked} allowNegative onChange={updateDraft} /><MoneyField label="Actual cash" name="actualCash" value={draft.actualCash} disabled={locked} allowNegative onChange={updateDraft} /><MoneyField label="Card tips" name="cardTips" value={draft.cardTips} disabled={locked} onChange={updateDraft} /><MoneyField label="Cash tips" name="cashTips" value={draft.cashTips} disabled={locked} onChange={updateDraft} /><MoneyField label="Service charges" name="serviceCharges" value={draft.serviceCharges} disabled={locked} onChange={updateDraft} /><div className="mt-4 grid grid-cols-2 divide-x divide-[var(--line)] border-y border-[var(--line)]"><Metric label="Cash variance" value={cashVariance === null ? "—" : formatMoney(cashVariance)} detail="Actual minus expected" /><Metric label="Payment difference" value={formatMoney(paymentDifference)} detail="Cash + card vs net" /></div></section></div>
            <label className="mt-6 block"><span className="mb-1.5 block text-xs font-semibold">Shift notes</span><textarea rows={4} maxLength={10_000} value={draft.notes} disabled={locked} onChange={(event) => updateDraft("notes", event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-xs" /></label>
            {selected ? <section className="mt-5 border-t border-[var(--line)] pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><SectionHeading title="Private evidence" detail="Signed retrieval · terminal lock" />{!["approved", "rejected"].includes(selected.status) ? <><input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); event.currentTarget.value = ""; }} /><Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => attachmentInputRef.current?.click()}><Paperclip className="size-3.5" />Attach evidence</Button></> : null}</div><div className="mt-3 flex flex-wrap gap-2">{selected.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => void openAttachment(attachment)} className="focus-ring flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2 text-xs font-semibold"><FileText className="size-4" />{attachment.fileName}<ArrowDownToLine className="size-3.5 text-[var(--ink-faint)]" /></button>)}{!selected.attachments.length ? <p className="text-xs text-[var(--ink-faint)]">No evidence attached.</p> : null}</div></section> : null}
            {message ? <p role="status" className="mt-5 rounded-xl bg-[var(--canvas)] px-4 py-3 text-xs">{message}</p> : null}
            {!locked ? <div className="mt-6 flex justify-end"><Button type="submit" variant="accent" disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <WalletCards className="size-4" />}Submit closeout</Button></div> : null}
            {selected && ["pending", "in_review"].includes(selected.status) ? <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5"><p className="text-xs text-[var(--ink-faint)]">{selected.submittedByUserId === workspace.identity.userId ? "A different manager must decide this submission." : "Approval permanently locks the closeout evidence."}</p>{selected.submittedByUserId !== workspace.identity.userId ? <div className="flex gap-2"><Button variant="danger" disabled={busy} onClick={() => void perform(approveCloseoutAction({ closeoutId: selected.id, approved: false, note: null }), "Closeout rejected and locked with its original evidence.")}><X className="size-4" />Reject</Button><Button variant="accent" disabled={busy} onClick={() => void perform(approveCloseoutAction({ closeoutId: selected.id, approved: true, note: null }), "Closeout approved and locked.")}><Check className="size-4" />Approve</Button></div> : null}</div> : null}
          </form>
        </main>

        <aside>
          <SectionHeading eyebrow="Payroll support" title="Tip pool" detail="Verified closeout + approved policy + recorded time" />
          {!selected ? <div className="rounded-[18px] border border-[var(--line)] p-6 text-center"><ChevronRight className="mx-auto size-5 text-[var(--ink-faint)]" /><p className="mt-3 text-xs font-semibold">Select a closeout</p></div> : null}
          {selected && !tipRun ? <div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"><div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Calculator className="size-4" /></span><StatusPill tone={selected.status === "approved" ? "positive" : "warning"}>{selected.status === "approved" ? "Ready" : "Closeout approval needed"}</StatusPill></div><h3 className="mt-5 text-sm font-semibold">Prepare from verified records</h3><p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">The database derives tip sources from this closeout and eligible minutes from closed time entries. Browser-entered hours are never accepted.</p><label className="mt-5 block"><span className="mb-1.5 block text-xs font-semibold">Approved policy version</span><select value={policyVersionId} onChange={(event) => setPolicyVersionId(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="">Choose policy</option>{model.policies.map((policy) => <option key={policy.id} value={policy.id} disabled={!policy.method}>{policy.name} · v{policy.version} · {policy.method ?? "unsupported legacy method"}</option>)}</select></label><Button className="mt-4 w-full" variant="accent" disabled={busy || selected.status !== "approved" || !policyVersionId} onClick={() => { const scope = `tips.prepare:${selected.id}`; const payload = { closeoutId: selected.id, policyVersionId }; void perform(prepareTipRunAction({ requestId: requestIdFor(scope, payload), ...payload }), "Tip run prepared from locked closeout and time records.", () => rotateRequestId(scope)); }}><ShieldCheck className="size-4" />Prepare tip run</Button>{!model.policies.some((policy) => policy.method) ? <p className="mt-3 text-xs text-[var(--warning)]">No approved, effective hours-based policy is configured.</p> : null}</div> : null}
          {tipRun ? <><div className="flex items-center justify-between gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-4"><div><div className="flex items-center gap-2"><StatusPill tone={tipTone[tipRun.status] ?? "neutral"} dot>{tipRun.status}</StatusPill>{tipRun.lockedAt ? <LockKeyhole className="size-4 text-[var(--positive)]" /> : null}</div><p className="mt-2 text-xs font-semibold">{tipRun.policyName} · v{tipRun.policyVersion}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{tipRun.method ?? "Unsupported legacy method"} · {tipRun.calculationVersion}</p></div></div><TipRunDetail run={tipRun} /><div className="mt-5 flex flex-wrap justify-end gap-2">{tipRun.status === "draft" ? <Button variant="accent" disabled={busy} onClick={() => void perform(calculateTipRunAction({ tipRunId: tipRun.id }), "Tip run reconciled to the cent; review allocations before approval.")}><Calculator className="size-4" />Calculate</Button> : null}{tipRun.status === "calculated" && tipRun.createdByUserId !== workspace.identity.userId ? <Button variant="accent" disabled={busy} onClick={() => void perform(approveTipRunAction({ tipRunId: tipRun.id }), "Tip run approved and permanently locked.")}><LockKeyhole className="size-4" />Approve & lock</Button> : null}{tipRun.status === "calculated" && tipRun.createdByUserId === workspace.identity.userId ? <p className="text-xs text-[var(--warning)]">A different manager must approve this run.</p> : null}{tipRun.status === "approved" && (workspace.role === "owner" || workspace.role === "admin") ? <Button variant="accent" disabled={busy} onClick={() => void exportPayroll(tipRun)}><ArrowDownToLine className="size-4" />Payroll CSV</Button> : null}</div></> : null}
          <div className="mt-6 flex gap-3 border-t border-[var(--line)] pt-5 text-xs leading-4 text-[var(--ink-faint)]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" /><p>Le Yard OS supports payroll calculations and exports. It never files taxes or transmits payroll without an approved provider integration.</p></div>
        </aside>
      </div>
      <TipPolicyConfiguration
        workspace={workspace}
        result={policyConfigurationResult}
      />
    </PageFrame>
    </CurrencyCodeContext.Provider>
  );
}
