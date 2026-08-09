"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Camera,
  Check,
  CircleAlert,
  FileSearch,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  ReceiptText,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoWorkspace } from "@/lib/demo";
import { InvoiceInventoryMatches } from "@/components/receipts/invoice-inventory-matches";
import { formatMoney } from "@/lib/utils";
import type { Receipt } from "@/types";

type UiReceipt = Receipt & { localFileName?: string };

export function ReceiptsWorkspace() {
  const workspace = useWorkspaceContext();
  const [receipts, setReceipts] = useState<UiReceipt[]>(
    demoWorkspace.receipts.filter((receipt) => receipt.locationId === workspace.activeLocation.id),
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UiReceipt | null>(null);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return receipts;
    return receipts.filter((receipt) => {
      const vendor = demoWorkspace.vendors.find((item) => item.id === receipt.vendorId)?.name || "";
      return `${vendor} ${receipt.documentNumber} ${receipt.ocrText} ${receipt.expenseCategory}`.toLowerCase().includes(needle);
    });
  }, [query, receipts]);

  async function onFile(file?: File) {
    if (!file) return;
    setProcessing(true);
    await new Promise((resolve) => window.setTimeout(resolve, 850));
    const uploaded: UiReceipt = {
      ...demoWorkspace.receipts[0],
      id: `local-${Date.now()}`,
      documentNumber: "OCR-PENDING",
      documentDate: "2026-08-01",
      dueDate: null,
      subtotalCents: 12_450,
      taxCents: 1_105,
      totalCents: 13_555,
      purchaseOrderId: null,
      extractionConfidence: 0.84,
      reviewStatus: "needs_review",
      duplicateOfId: null,
      reviewedBy: null,
      ocrText: `Uploaded ${file.name}; invoice lines: Roma tomatoes; Fresh basil; Bread flour; subtotal, tax, and total recognized.`,
      file: {
        ...demoWorkspace.receipts[0].file,
        id: `file-${Date.now()}`,
        fileName: file.name,
        objectPath: `demo/uploads/${file.name}`,
        mediaType: file.type || "application/octet-stream",
        byteSize: file.size,
        uploadedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      localFileName: file.name,
    };
    setReceipts((current) => [uploaded, ...current]);
    setSelected(uploaded);
    setProcessing(false);
  }

  function verifyReceipt(receipt: UiReceipt) {
    const reviewed: UiReceipt = {
      ...receipt,
      reviewStatus: "verified",
      reviewedBy: workspace.identity.userId,
      updatedAt: new Date().toISOString(),
    };
    setReceipts((current) => current.map((item) => (item.id === reviewed.id ? reviewed : item)));
    setSelected(reviewed);
  }

  const needsReview = receipts.filter((receipt) => receipt.reviewStatus === "needs_review");
  const total = receipts.reduce((sum, receipt) => sum + receipt.totalCents, 0);

  return (
    <PageFrame>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Document intelligence</p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Receipts & invoices</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">Private files · signed access · human-reviewed extraction</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} aria-label="Upload receipt or invoice" className="sr-only" type="file" accept="image/*,application/pdf" capture="environment" onChange={(event) => void onFile(event.target.files?.[0])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}><Camera className="size-4" /> Capture</Button>
          <Button variant="accent" onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Upload document</Button>
        </div>
      </div>
      {notice ? <p role="status" className="mt-3 rounded-xl bg-[var(--canvas-strong)] px-3 py-2 text-xs text-[var(--ink-soft)]">{notice}</p> : null}

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="This period" value={formatMoney(total)} detail={`${receipts.length} documents`} />
        <Metric label="Needs review" value={String(needsReview.length)} detail="AI cannot self-approve" trend={{ label: needsReview.length ? "Action" : "Clear", tone: needsReview.length ? "negative" : "positive" }} />
        <Metric label="Extraction confidence" value={receipts.length ? `${Math.round((receipts.reduce((sum, receipt) => sum + receipt.extractionConfidence, 0) / receipts.length) * 100)}%` : "—"} detail={receipts.length ? "Average extracted fields" : "Upload an invoice to begin"} />
        <Metric label="Possible duplicates" value={String(receipts.filter((receipt) => receipt.duplicateOfId).length)} detail="Matched by hash + amount" />
      </section>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vendor, amount, category, or OCR text" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-4 pl-10 text-xs outline-none transition-colors focus:border-[var(--accent)]" />
        </label>
        <div className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"><Sparkles className="size-3.5 text-[var(--accent)]" /> Search reads extracted text, not only filenames.</div>
      </div>

      <section className="mt-5 overflow-hidden border-y border-[var(--line)]">
        <div className="hidden grid-cols-[1.25fr_.8fr_.7fr_.55fr_36px] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase sm:grid">
          <span>Document</span><span>Date & category</span><span>Amount</span><span>Status</span><span />
        </div>
        {filtered.map((receipt) => {
          const vendor = demoWorkspace.vendors.find((item) => item.id === receipt.vendorId);
          return (
            <button key={receipt.id} onClick={() => setSelected(receipt)} className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-4 text-left first:border-0 transition-colors hover:bg-[var(--paper)] sm:grid-cols-[1.25fr_.8fr_.7fr_.55fr_36px] sm:gap-4">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-soft)]"><ReceiptText className="size-4" /></span>
                <span className="min-w-0"><span className="block truncate text-xs font-semibold">{vendor?.name || "Unmatched vendor"}</span><span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">{receipt.documentNumber} · {receipt.file.fileName}</span></span>
              </span>
              <span className="numeric text-right text-xs font-semibold sm:hidden">{formatMoney(receipt.totalCents)}</span>
              <span className="hidden text-xs text-[var(--ink-faint)] sm:block"><span className="block text-[var(--ink-soft)]">{receipt.documentDate}</span><span className="mt-1 capitalize">{receipt.expenseCategory.replaceAll("_", " ")}</span></span>
              <span className="numeric hidden text-xs font-semibold sm:block">{formatMoney(receipt.totalCents)}</span>
              <span className="hidden sm:block"><StatusPill tone={receipt.reviewStatus === "verified" ? "positive" : "warning"} dot>{receipt.reviewStatus === "verified" ? "Verified" : "Review"}</StatusPill></span>
              <MoreHorizontal className="hidden size-4 text-[var(--ink-faint)] sm:block" />
            </button>
          );
        })}
        {!filtered.length ? <div className="px-5 py-12 text-center"><FileSearch className="mx-auto size-6 text-[var(--ink-faint)]" /><p className="mt-3 text-xs font-semibold">No matching documents</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Try a vendor, amount, or phrase from the receipt.</p></div> : null}
      </section>

      <div className="mt-5 flex items-start gap-3 rounded-[16px] bg-[var(--positive-soft)] px-4 py-3 text-xs leading-4 text-[var(--positive)]">
        <Check className="mt-0.5 size-3.5 shrink-0" />
        Files are designed for private Supabase Storage buckets. Production downloads use short-lived signed URLs and every review is written to the audit log.
      </div>

      <AnimatePresence>
        {processing ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="w-full max-w-sm rounded-[22px] bg-[var(--paper-strong)] p-7 text-center shadow-[var(--shadow-float)]"><LoaderCircle className="mx-auto size-6 animate-spin text-[var(--accent)]" /><p className="mt-4 text-sm font-semibold">Reading document</p><p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">Extracting vendor, date, totals, category, and duplicate fingerprint…</p></div>
          </motion.div>
        ) : null}
        {selected ? (
          <motion.div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            <motion.aside className="absolute inset-y-0 right-0 w-[min(94vw,520px)] overflow-y-auto bg-[var(--paper-strong)] p-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:p-7" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 350, damping: 35 }}>
              <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Extraction review</p><h3 className="mt-3 text-xl font-medium tracking-[-0.04em]">{demoWorkspace.vendors.find((item) => item.id === selected.vendorId)?.name || "Unmatched vendor"}</h3><p className="mt-1 text-xs text-[var(--ink-faint)]">{selected.file.fileName}</p></div><Button variant="quiet" size="icon" onClick={() => setSelected(null)}><X className="size-4" /></Button></div>
              <div className="mt-6 flex items-center gap-3 rounded-[15px] bg-[var(--accent-soft)]/55 px-4 py-3"><Sparkles className="size-4 text-[var(--accent-strong)]" /><div className="flex-1"><p className="text-xs font-semibold">AI extraction · {(selected.extractionConfidence * 100).toFixed(0)}% confidence</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Review required before posting</p></div><StatusPill tone={selected.reviewStatus === "verified" ? "positive" : "warning"}>{selected.reviewStatus === "verified" ? "Verified" : "Draft"}</StatusPill></div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {[{ label: "Document number", value: selected.documentNumber || "" }, { label: "Document date", value: selected.documentDate }, { label: "Subtotal", value: (selected.subtotalCents / 100).toFixed(2) }, { label: "Tax", value: (selected.taxCents / 100).toFixed(2) }, { label: "Total", value: (selected.totalCents / 100).toFixed(2) }, { label: "Category", value: selected.expenseCategory.replaceAll("_", " ") }].map((field) => <label key={field.label}><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]">{field.label}</span><input defaultValue={field.value} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs capitalize outline-none focus:border-[var(--accent)]" /></label>)}
              </div>
              <div className="mt-6"><p className="text-xs font-semibold">Recognized text</p><p className="mt-2 rounded-xl bg-[var(--canvas)] p-3 font-mono text-xs leading-4 text-[var(--ink-faint)]">{selected.ocrText}</p></div>
              <InvoiceInventoryMatches text={selected.ocrText} catalog={[]} />
              {selected.duplicateOfId ? <div className="mt-5 flex gap-3 rounded-xl bg-[var(--warning-soft)] p-3 text-xs text-[var(--warning)]"><CircleAlert className="size-4 shrink-0" />Possible duplicate of {selected.duplicateOfId}. Verify before posting.</div> : null}
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-5"><Button variant="secondary" onClick={() => setNotice("Purchase linking will be enabled when the live inventory catalog is connected.")}><Link2 className="size-3.5" /> Link purchase</Button><Button variant="quiet" onClick={() => setNotice("This local preview file is held in the browser until private storage is connected.")}><ArrowUpRight className="size-3.5" /> Open file</Button><Button className="ml-auto" variant="accent" disabled={selected.reviewStatus === "verified"} onClick={() => verifyReceipt(selected)}><Check className="size-3.5" /> {selected.reviewStatus === "verified" ? "Verified" : "Verify fields"}</Button></div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </PageFrame>
  );
}
