"use client";

import {
  Camera,
  Check,
  Download,
  FileSearch,
  GitCompare,
  Link2,
  LoaderCircle,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createPrivateFileDownloadUrlAction } from "@/app/actions/workflows/files";
import {
  createReceiptUploadUrlAction,
  assignReceiptInventoryMatchAction,
  finalizeReceiptUploadAction,
  resolveReceiptDuplicateAction,
  reviewReceiptAction,
  setDeliveryReceiptLinkAction,
  setExpenseReceiptLinkAction,
} from "@/app/actions/workflows/receipts";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { InvoiceInventoryMatches } from "@/components/receipts/invoice-inventory-matches";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import type {
  LiveReceiptOption,
  LiveReceiptReferenceOption,
  LiveReceiptRow,
  LiveReceiptsModel,
} from "@/data/read-models/receipts";
import { useModalDialog } from "@/lib/accessibility/use-modal-dialog";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { createClient } from "@/lib/supabase/client";
import { validatePrivateFile } from "@/lib/storage/private-files";
import { cn, formatMoney } from "@/lib/utils";

type ReviewStatus = "in_review" | "approved" | "rejected";

const statusTone: Record<string, "neutral" | "warning" | "positive" | "danger"> = {
  pending: "neutral",
  in_review: "warning",
  approved: "positive",
  rejected: "danger",
};

function centsFromInput(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function ReceiptInspector({
  receipt,
  vendors,
  categories,
  expenses,
  deliveries,
  inventoryItems,
  referenceWindowSize,
  onClose,
}: {
  receipt: LiveReceiptRow;
  vendors: LiveReceiptOption[];
  categories: LiveReceiptOption[];
  expenses: LiveReceiptReferenceOption[];
  deliveries: LiveReceiptReferenceOption[];
  inventoryItems: { id: string; name: string; sku: string | null }[];
  referenceWindowSize: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const { requestIdFor, rotateRequestId, rotateAllRequestIds } = useStableRequestIds();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [expenseTargetId, setExpenseTargetId] = useState("");
  const [deliveryTargetId, setDeliveryTargetId] = useState("");

  function closeInspector() {
    rotateAllRequestIds();
    onClose();
  }

  useModalDialog({
    dialogRef,
    overlayRef,
    onClose: closeInspector,
    initialFocusSelector: "[data-close-receipt]",
  });

  async function review(status: ReviewStatus) {
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    setBusy(true);
    setMessage("");
    const result = await reviewReceiptAction({
      receiptId: receipt.id,
      reviewStatus: status,
      vendorId: form.get("vendorId") || null,
      expenseCategoryId: form.get("categoryId") || null,
      documentNumber: String(form.get("documentNumber") || "").trim() || null,
      documentDate: String(form.get("documentDate") || "").trim() || null,
      totalCents: centsFromInput(form.get("total")),
      taxCents: centsFromInput(form.get("tax")),
      notes: String(form.get("notes") || "").trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(status === "approved" ? "Receipt approved and locked." : `Receipt marked ${status.replaceAll("_", " ")}.`);
    router.refresh();
  }

  async function openFile(file: LiveReceiptRow["files"][number]) {
    setBusy(true);
    setMessage("");
    const result = await createPrivateFileDownloadUrlAction({
      bucket: "receipts",
      objectPath: file.storagePath,
      downloadFileName: file.fileName,
    });
    setBusy(false);
    if (!result.ok || !("data" in result)) {
      setMessage(result.ok ? "The private file is unavailable." : result.message);
      return;
    }
    window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function resolveDuplicate(
    matchId: string,
    resolution: "duplicate" | "not_duplicate",
  ) {
    setBusy(true);
    setMessage("");
    const scope = `receipt.duplicate.${matchId}`;
    const payload = { matchId, resolution };
    const result = await resolveReceiptDuplicateAction({
      requestId: requestIdFor(scope, payload),
      matchId,
      resolution,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(
      resolution === "duplicate"
        ? "The match is recorded as a duplicate."
        : "The match is recorded as a separate document.",
    );
    rotateRequestId(scope);
    router.refresh();
  }

  async function linkReference(
    kind: "expense" | "delivery",
    targetId: string,
    receiptId: string | null,
  ) {
    if (!targetId) return;
    setBusy(true);
    setMessage("");
    const scope = `receipt.${kind}.link.${targetId}`;
    const payload = { targetId, receiptId };
    const result = kind === "expense"
      ? await setExpenseReceiptLinkAction({
          requestId: requestIdFor(scope, payload),
          targetId,
          receiptId,
        })
      : await setDeliveryReceiptLinkAction({
          requestId: requestIdFor(scope, payload),
          targetId,
          receiptId,
        });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setExpenseTargetId("");
    setDeliveryTargetId("");
    setMessage(receiptId ? `${kind === "expense" ? "Expense" : "Delivery"} linked.` : "Receipt link removed.");
    rotateRequestId(scope);
    router.refresh();
  }

  async function assignInventoryMatch(input: {
    lineKey: string;
    description: string;
    inventoryItemId: string;
    confidence: number;
  }) {
    const scope = `receipt.inventory.match:${receipt.id}:${input.lineKey}`;
    const result = await assignReceiptInventoryMatchAction({
      requestId: requestIdFor(scope, input),
      receiptId: receipt.id,
      ...input,
    });
    if (!result.ok) {
      setMessage(result.message);
      return false;
    }
    rotateRequestId(scope);
    setMessage("Invoice line assigned to inventory. Review it with the receipt before posting a delivery.");
    return true;
  }

  const terminal = receipt.reviewStatus === "approved" || receipt.reviewStatus === "rejected";
  const unresolvedMatches = receipt.duplicateMatches.filter((match) => !match.resolution);
  const linkedExpenses = expenses.filter((expense) => expense.receiptId === receipt.id);
  const linkedDeliveries = deliveries.filter((delivery) => delivery.receiptId === receipt.id);
  const availableExpenses = expenses.filter((expense) => !expense.receiptId);
  const availableDeliveries = deliveries.filter((delivery) => !delivery.receiptId);

  return (
    <aside ref={overlayRef} className="fixed inset-0 z-50 overflow-y-auto bg-black/25 px-3 py-5 backdrop-blur-[3px] sm:px-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeInspector(); }}>
      <section ref={dialogRef} tabIndex={-1} aria-labelledby="receipt-review-title" aria-modal="true" role="dialog" className="ml-auto min-h-full w-full max-w-2xl rounded-[26px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={statusTone[receipt.reviewStatus] ?? "neutral"} dot>{receipt.reviewStatus.replaceAll("_", " ")}</StatusPill>
              {receipt.duplicateCount ? <StatusPill tone="warning">{receipt.duplicateCount} possible duplicate</StatusPill> : null}
            </div>
            <h3 id="receipt-review-title" className="mt-4 text-2xl font-medium tracking-[-0.045em]">Receipt review</h3>
            <p className="mt-1 text-[10px] text-[var(--ink-faint)]">Uploaded {new Date(receipt.createdAt).toLocaleString()}</p>
          </div>
          <Button data-close-receipt variant="quiet" size="icon" aria-label="Close receipt" onClick={closeInspector}><X className="size-4" /></Button>
        </div>

        <form ref={formRef} className="mt-7" onSubmit={(event) => { event.preventDefault(); void review("in_review"); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-[10px] font-semibold">Vendor</span><select name="vendorId" defaultValue={receipt.vendorId ?? ""} disabled={terminal} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="">Unmatched</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
            <label><span className="mb-1.5 block text-[10px] font-semibold">Expense category</span><select name="categoryId" defaultValue={receipt.expenseCategoryId ?? ""} disabled={terminal} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label><span className="mb-1.5 block text-[10px] font-semibold">Document number</span><input name="documentNumber" defaultValue={receipt.documentNumber ?? ""} disabled={terminal} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
            <label><span className="mb-1.5 block text-[10px] font-semibold">Document date</span><input name="documentDate" type="date" defaultValue={receipt.documentDate ?? ""} disabled={terminal} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
            <label><span className="mb-1.5 block text-[10px] font-semibold">Total</span><input name="total" type="number" min="0" step="0.01" defaultValue={receipt.totalCents == null ? "" : (receipt.totalCents / 100).toFixed(2)} disabled={terminal} className="numeric h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
            <label><span className="mb-1.5 block text-[10px] font-semibold">Tax</span><input name="tax" type="number" min="0" step="0.01" defaultValue={receipt.taxCents == null ? "" : (receipt.taxCents / 100).toFixed(2)} disabled={terminal} className="numeric h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
            <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-semibold">Review notes</span><textarea name="notes" rows={3} defaultValue={receipt.notes ?? ""} disabled={terminal} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs" /></label>
          </div>

          <section className="mt-7 border-t border-[var(--line)] pt-6">
            <SectionHeading title="Duplicate review" detail="Resolve every possible match before approval" />
            <div className="mt-3 space-y-2">
              {receipt.duplicateMatches.map((match) => <div key={match.id} className="rounded-xl bg-[var(--canvas)] p-3.5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 text-[10px] font-semibold"><GitCompare className="size-3.5 text-[var(--warning)]" />Receipt {match.possibleDuplicateId.slice(0, 8)}</p><p className="numeric mt-1 text-[9px] text-[var(--ink-faint)]">{Math.round(match.score * 100)}% match · {match.reasons.length ? match.reasons.map((reason) => reason.replaceAll("_", " ")).join(", ") : "No machine reason recorded"}</p></div>{match.resolution ? <StatusPill tone={match.resolution === "duplicate" ? "warning" : "positive"}>{match.resolution.replaceAll("_", " ")}</StatusPill> : <div className="flex gap-2"><Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => void resolveDuplicate(match.id, "not_duplicate")}>Separate</Button><Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void resolveDuplicate(match.id, "duplicate")}>Duplicate</Button></div>}</div></div>)}
              {!receipt.duplicateMatches.length ? <p className="rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] text-[var(--positive)]">No possible duplicate evidence is recorded for this document.</p> : null}
            </div>
          </section>

          <section className="mt-7 border-t border-[var(--line)] pt-6">
            <SectionHeading title="Private files" detail="Signed access expires after 60 seconds" />
            <div className="mt-3 space-y-2">
              {receipt.files.map((file) => <button key={file.id} type="button" onClick={() => void openFile(file)} className="focus-ring flex w-full items-center gap-3 rounded-xl bg-[var(--canvas)] px-3.5 py-3 text-left"><ReceiptText className="size-4 text-[var(--accent-strong)]" /><span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{file.fileName}</span><Download className="size-3.5 text-[var(--ink-faint)]" /></button>)}
              {!receipt.files.length ? <p className="rounded-xl bg-[var(--danger-soft)] px-3.5 py-3 text-[10px] text-[var(--danger)]">No finalized private file is bound to this receipt.</p> : null}
            </div>
          </section>

          {receipt.reviewStatus === "approved" ? <section className="mt-7 border-t border-[var(--line)] pt-6"><SectionHeading title="Accounting links" detail={`All links on this page · latest ${referenceWindowSize} unlinked options`} /><div className="mt-3 space-y-4"><div><p className="text-[10px] font-semibold">Expenses</p>{linkedExpenses.map((expense) => <div key={expense.id} className="mt-2 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2.5"><Link2 className="size-3.5 text-[var(--positive)]" /><span className="min-w-0 flex-1 truncate text-[9px]">{expense.label}</span><Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => void linkReference("expense", expense.id, null)}><Unlink className="size-3.5" />Unlink</Button></div>)}<div className="mt-2 flex gap-2"><select aria-label="Unlinked expense" value={expenseTargetId} onChange={(event) => setExpenseTargetId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[10px]"><option value="">Choose a recent unlinked expense</option>{availableExpenses.map((expense) => <option key={expense.id} value={expense.id}>{expense.label}</option>)}</select><Button type="button" variant="secondary" size="sm" disabled={busy || !expenseTargetId} onClick={() => void linkReference("expense", expenseTargetId, receipt.id)}>Link</Button></div></div><div><p className="text-[10px] font-semibold">Inventory deliveries</p>{linkedDeliveries.map((delivery) => <div key={delivery.id} className="mt-2 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2.5"><Link2 className="size-3.5 text-[var(--positive)]" /><span className="min-w-0 flex-1 truncate text-[9px]">{delivery.label}</span><Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => void linkReference("delivery", delivery.id, null)}><Unlink className="size-3.5" />Unlink</Button></div>)}<div className="mt-2 flex gap-2"><select aria-label="Unlinked inventory delivery" value={deliveryTargetId} onChange={(event) => setDeliveryTargetId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[10px]"><option value="">Choose a recent unlinked delivery</option>{availableDeliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.label}</option>)}</select><Button type="button" variant="secondary" size="sm" disabled={busy || !deliveryTargetId} onClick={() => void linkReference("delivery", deliveryTargetId, receipt.id)}>Link</Button></div></div></div></section> : null}

          <section className="mt-7 border-t border-[var(--line)] pt-6">
            <SectionHeading title="Extraction evidence" detail="Every field remains human-reviewed" />
            {receipt.extractions.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{receipt.extractions.map((extraction) => <div key={extraction.fieldName} className="rounded-xl bg-[var(--canvas)] p-3"><p className="text-[9px] font-semibold text-[var(--ink-faint)]">{extraction.fieldName}</p><p className="mt-1 truncate text-xs font-semibold">{extraction.value}</p><p className="numeric mt-1 text-[9px] text-[var(--ink-faint)]">{extraction.confidence == null ? "Confidence unavailable" : `${Math.round(extraction.confidence * 100)}% confidence`}</p></div>)}</div> : <div className="mt-3 flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/45 p-4 text-[10px] leading-4 text-[var(--accent-strong)]"><Sparkles className="mt-0.5 size-4 shrink-0" /><span>No extraction evidence is stored for this document. This release does not send receipt images to a live model provider.</span></div>}
          </section>

          <InvoiceInventoryMatches
            text={receipt.extractions.map((extraction) => extraction.value).join("; ")}
            catalog={inventoryItems}
            onAssign={assignInventoryMatch}
          />

          {message ? <p role="status" className="mt-5 rounded-xl bg-[var(--canvas)] px-3.5 py-3 text-[10px]">{message}</p> : null}
          {!terminal ? <div className="mt-6 flex flex-wrap justify-end gap-2"><Button type="submit" variant="secondary" disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileSearch className="size-4" />} Save review</Button><Button type="button" variant="danger" disabled={busy || Boolean(unresolvedMatches.length)} onClick={() => void review("rejected")}>Reject</Button><Button type="button" variant="accent" disabled={busy || Boolean(unresolvedMatches.length)} title={unresolvedMatches.length ? "Resolve possible duplicates first" : undefined} onClick={() => void review("approved")}><Check className="size-4" /> Approve and lock</Button></div> : <div className="mt-6 flex items-center gap-2 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] text-[var(--positive)]"><ShieldCheck className="size-4" /> Terminal reviews and their evidence are immutable.</div>}
        </form>
      </section>
    </aside>
  );
}

export function ConnectedReceiptsWorkspace({
  model,
  initialSearch = "",
}: {
  model: LiveReceiptsModel;
  initialSearch?: string;
}) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialSearch);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const { requestIdFor, rotateRequestId } = useStableRequestIds();

  const receipts = model.status === "ready" ? model.receipts : [];
  const filtered = receipts.filter(
    (receipt) => filter === "all" || receipt.reviewStatus === filter,
  );
  const selected = receipts.find((receipt) => receipt.id === selectedId) ?? null;

  async function upload(file: File, source: "camera" | "upload") {
    const validation = validatePrivateFile("receipts", file.type, file.size);
    if (!validation.ok) {
      setMessage(validation.message ?? "Choose a supported receipt file.");
      return;
    }
    setUploading(true);
    setMessage("Preparing a private upload…");
    const uploadPayload = {
      locationId: workspace.activeLocation.id,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      source,
    };
    const receiptId = requestIdFor("receipt.upload", uploadPayload);
    const prepared = await createReceiptUploadUrlAction({
      uploadId: receiptId,
      locationId: workspace.activeLocation.id,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      source,
    });
    if (!prepared.ok || !("data" in prepared)) {
      setUploading(false);
      setMessage(prepared.ok ? "The private upload could not start." : prepared.message);
      return;
    }
    const supabase = createClient();
    const uploaded = await supabase.storage.from("receipts").uploadToSignedUrl(
      prepared.data.objectPath,
      prepared.data.token,
      file,
      { contentType: file.type },
    );
    const finalizePayload = {
      receiptId: prepared.data.receiptId,
      objectPath: prepared.data.objectPath,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const finalized = await finalizeReceiptUploadAction({
      requestId: requestIdFor("receipt.finalize", finalizePayload),
      ...finalizePayload,
    });
    setUploading(false);
    if (!finalized.ok) {
      setMessage(uploaded.error
        ? "The encrypted file transfer did not finish. Retry the same file."
        : finalized.message);
      return;
    }
    rotateRequestId("receipt.upload");
    rotateRequestId("receipt.finalize");
    setMessage("Receipt stored privately and queued for human review.");
    router.refresh();
  }

  function searchReceipts() {
    const normalized = query.trim().slice(0, 120);
    router.replace(normalized ? `/receipts?q=${encodeURIComponent(normalized)}` : "/receipts");
  }

  function pageHref(page: number) {
    const params = new URLSearchParams();
    if (initialSearch) params.set("q", initialSearch);
    if (page > 1) params.set("p", String(page));
    const queryString = params.toString();
    return queryString ? `/receipts?${queryString}` : "/receipts";
  }

  if (model.status !== "ready") {
    return <PageFrame><section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center"><TriangleAlert className="mx-auto size-6 text-[var(--warning)]" /><h2 className="mt-4 text-xl font-medium">{model.status === "forbidden" ? "Management access required" : "Receipts are unavailable"}</h2><p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{model.status === "forbidden" ? "Receipt and invoice records are limited to authorized restaurant management." : "Tenant-scoped receipt records could not be loaded safely. Retry without uploading a duplicate."}</p></section></PageFrame>;
  }

  const reviewCount = receipts.filter((receipt) => ["pending", "in_review"].includes(receipt.reviewStatus)).length;
  const totalCents = receipts.reduce((sum, receipt) => sum + (receipt.totalCents ?? 0), 0);

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2"><StatusPill tone="positive" dot>Connected</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Private storage · human review</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Receipts and invoices</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Capture, verify, search, and safely retrieve location-scoped evidence.</p></div><div className="flex flex-wrap gap-2"><input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, "camera"); event.currentTarget.value = ""; }} /><input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, "upload"); event.currentTarget.value = ""; }} /><Button variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}><Upload className="size-4" /> Upload file</Button><Button variant="accent" disabled={uploading} onClick={() => cameraInputRef.current?.click()}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{uploading ? "Uploading…" : "Use camera"}</Button></div></div>

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0"><Metric label="Page documents" value={String(receipts.length)} detail={`${model.totalCount} matching · page ${model.page} of ${model.totalPages}`} /><Metric label="Page review" value={String(reviewCount)} detail="Pending or in review on this page" /><Metric label="Page total" value={formatMoney(totalCents, model.currencyCode)} detail="Loaded page only" /><Metric label="Page duplicates" value={String(receipts.reduce((sum, receipt) => sum + receipt.duplicateCount, 0))} detail="Unresolved on this page" /></section>

      {message ? <div role="status" className="mt-5 flex items-center gap-3 rounded-xl bg-[var(--accent-soft)]/45 px-4 py-3 text-[10px] text-[var(--accent-strong)]"><Upload className="size-4 shrink-0" />{message}</div> : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><form className="flex w-full gap-2 sm:max-w-md" onSubmit={(event) => { event.preventDefault(); searchReceipts(); }}><label className="relative min-w-0 flex-1"><span className="sr-only">Search receipts and OCR text</span><Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-faint)]" /><input type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents and OCR" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-10 text-xs" /></label><Button type="submit" variant="secondary">Search</Button></form><div className="flex gap-1 overflow-x-auto">{["all", "pending", "in_review", "approved", "rejected"].map((status) => <button key={status} onClick={() => setFilter(status)} className={cn("focus-ring rounded-lg px-3 py-2 text-[10px] font-semibold capitalize", filter === status ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]")}>{status.replaceAll("_", " ")}</button>)}</div></div>

      {initialSearch ? <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-[var(--ink-faint)]"><span>Showing tenant-scoped matches for “{initialSearch}”, including indexed OCR text.</span><button className="focus-ring shrink-0 rounded-lg px-2 py-1 font-semibold text-[var(--accent-strong)]" onClick={() => { setQuery(""); router.replace("/receipts"); }}>Clear search</button></div> : null}

      <section className="mt-5 overflow-hidden rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)]"><div className="hidden grid-cols-[1.2fr_.8fr_.7fr_.65fr_auto] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase sm:grid"><span>Document</span><span>Date</span><span>Total</span><span>Status</span><span /></div>{filtered.map((receipt) => <button key={receipt.id} onClick={() => setSelectedId(receipt.id)} className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-4 text-left first:border-t-0 sm:grid-cols-[1.2fr_.8fr_.7fr_.65fr_auto]"><span className="min-w-0"><span className="block truncate text-xs font-semibold">{receipt.documentNumber || receipt.files[0]?.fileName || "Unnumbered document"}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{receipt.source} · {receipt.files.length} private file{receipt.files.length === 1 ? "" : "s"}{receipt.duplicateCount ? ` · ${receipt.duplicateCount} unresolved match` : ""}</span></span><span className="numeric hidden text-[10px] text-[var(--ink-faint)] sm:block">{receipt.documentDate || new Date(receipt.createdAt).toLocaleDateString("en-US", { timeZone: model.timeZone })}</span><span className="numeric text-xs font-semibold">{receipt.totalCents == null ? "—" : formatMoney(receipt.totalCents, model.currencyCode)}</span><span className="hidden sm:block"><StatusPill tone={statusTone[receipt.reviewStatus] ?? "neutral"}>{receipt.reviewStatus.replaceAll("_", " ")}</StatusPill></span><FileSearch className="size-4 text-[var(--ink-faint)]" /></button>)}{!filtered.length ? <div className="px-6 py-16 text-center"><ReceiptText className="mx-auto size-6 text-[var(--ink-faint)]" /><p className="mt-3 text-xs font-semibold">No receipts match on this page</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">Change the page, search, or local status filter.</p></div> : null}</section>

      <nav aria-label="Receipt pages" className="mt-4 flex items-center justify-between gap-3"><p className="text-[9px] text-[var(--ink-faint)]">Rows {(model.page - 1) * model.pageSize + (receipts.length ? 1 : 0)}–{(model.page - 1) * model.pageSize + receipts.length} of {model.totalCount} matching documents</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={!model.hasPreviousPage} onClick={() => router.replace(pageHref(model.page - 1))}>Previous</Button><Button variant="secondary" size="sm" disabled={!model.hasNextPage} onClick={() => router.replace(pageHref(model.page + 1))}>Next</Button></div></nav>

      {selected ? <ReceiptInspector key={selected.id} receipt={selected} vendors={model.vendors} categories={model.categories} expenses={model.expenses} deliveries={model.deliveries} inventoryItems={model.inventoryItems} referenceWindowSize={model.referenceWindowSize} onClose={() => setSelectedId(null)} /> : null}
    </PageFrame>
  );
}
