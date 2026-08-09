"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  LoaderCircle,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Truck,
  ArrowRightLeft,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  approveInventoryCountAction,
  configureInventoryCatalogAction,
  createInventoryTransferAction,
  createPurchaseOrderAction,
  receiveInventoryDeliveryAction,
  reviewInventoryTransferAction,
  reviewWasteRecordAction,
  submitInventoryCountAction,
  submitWasteRecordAction,
} from "@/app/actions/workflows/inventory";
import { Button } from "@/components/ui/button";
import {
  InventoryCatalogWorkspace,
  RecipeEditorDialog,
  type RecipeRecord,
} from "@/components/inventory/inventory-catalog-workspace";
import { InventoryModalFrame } from "@/components/inventory/inventory-modal-frame";
import { Metric, PageFrame, PageHeader, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import type {
  LiveInventoryCount,
  LiveInventoryModel,
  LiveInventoryTransfer,
  LivePurchaseOrder,
  LiveWasteRecord,
} from "@/data/read-models/inventory";
import { localDateTimeParts, zonedLocalToIso } from "@/data/read-models/local-time";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/client";
import { hasCapability } from "@/lib/permissions/capabilities";
import {
  parseInventoryMoneyToCents,
  parseInventoryQuantity,
} from "@/lib/inventory/input-parsing";
import { cn, formatMoney } from "@/lib/utils";

type Tab = "stock" | "count" | "orders" | "transfers" | "vendors" | "recipes" | "waste" | "catalog";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "stock", label: "Stock" },
  { id: "count", label: "Counts" },
  { id: "orders", label: "Orders" },
  { id: "transfers", label: "Transfers" },
  { id: "vendors", label: "Vendors" },
  { id: "recipes", label: "Recipes" },
  { id: "waste", label: "Waste" },
  { id: "catalog", label: "Setup" },
];

const statusTone: Record<string, "neutral" | "positive" | "warning" | "danger"> = {
  pending: "warning",
  in_review: "warning",
  approved: "positive",
  received: "positive",
  partially_received: "warning",
  submitted: "warning",
  rejected: "danger",
  cancelled: "danger",
};

function quantityLabel(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function quantityInputValue(value: number) {
  return String(value);
}

function dateTimeLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateLabel(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function sentenceCase(value: string) {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ModalFrame({
  title,
  description,
  labelledBy,
  notice,
  onClose,
  returnFocus,
  children,
  width = "max-w-3xl",
  layout = "scroll",
}: {
  title: string;
  description: string;
  labelledBy: string;
  notice?: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  children: ReactNode;
  width?: string;
  layout?: "scroll" | "task";
}) {
  return (
    <InventoryModalFrame
      title={title}
      description={description}
      labelledBy={labelledBy}
      notice={notice}
      onClose={onClose}
      returnFocus={returnFocus}
      width={width}
      layout={layout}
    >
      {children}
    </InventoryModalFrame>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="border-y border-[var(--line)] px-5 py-14 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-2xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]">
        {icon}
      </span>
      <p className="mt-4 text-xs font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-4 text-[var(--ink-faint)]">{detail}</p>
    </div>
  );
}

function CountDialog({
  model,
  values,
  notes,
  notice,
  busy,
  onValueChange,
  onNotesChange,
  onClose,
  onSubmit,
}: {
  model: LiveInventoryModel;
  values: Record<string, string>;
  notes: string;
  notice: string;
  busy: boolean;
  onValueChange: (itemId: string, value: string) => void;
  onNotesChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const completed = model.items.filter((item) => values[item.id]?.trim()).length;
  return (
    <ModalFrame
      title="Full inventory count"
      description={`Enter every active tracked item in its base unit. Expected quantities are refreshed on the server when the count is submitted.`}
      labelledBy="inventory-count-dialog"
      onClose={onClose}
      width="max-w-4xl"
      layout="task"
    >
      <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--canvas)] px-4 py-3 sm:px-7">
          <span className="text-xs font-semibold text-[var(--ink-soft)]">
            {completed} of {model.items.length} items entered
          </span>
          <StatusPill tone={completed === model.items.length ? "positive" : "warning"} dot>
            {completed === model.items.length ? "Ready to submit" : "Count in progress"}
          </StatusPill>
        </div>
        <div data-inventory-count-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1.3fr)_minmax(72px,.6fr)_minmax(112px,.7fr)_minmax(72px,.6fr)] gap-4 border-b border-[var(--line)] bg-[var(--paper-strong)] px-7 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase sm:grid">
            <span>Item</span><span>Expected</span><span>Counted</span><span>Variance</span>
          </div>
          {model.items.map((item) => {
            const raw = values[item.id] ?? "";
            const counted = raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null;
            const variance = counted === null ? null : counted - item.onHand;
            const varianceLabel = variance === null ? "—" : quantityLabel(variance);
            return (
              <div data-inventory-count-row key={item.id} className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(72px,.6fr)_minmax(112px,.7fr)_minmax(72px,.6fr)] sm:gap-4 sm:px-7">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{item.name}</p>
                  <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
                    {item.category} · {item.unitSymbol}
                  </p>
                  <p className="numeric mt-1.5 text-xs text-[var(--ink-faint)] sm:hidden">
                    Expected {quantityLabel(item.onHand)} {item.unitSymbol} · Variance {varianceLabel}
                  </p>
                </div>
                <span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{quantityLabel(item.onHand)} {item.unitSymbol}</span>
                <input
                  aria-label={`Counted quantity for ${item.name}`}
                  required
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="999999999999.9999"
                  step="0.0001"
                  value={raw}
                  disabled={busy}
                  onChange={(event) => onValueChange(item.id, event.target.value)}
                  className="numeric h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-right text-sm font-semibold outline-none transition-colors focus:border-[var(--accent)]"
                />
                <span className={cn("numeric hidden items-center gap-1 text-xs font-semibold sm:flex", variance === null && "text-[var(--ink-faint)]", variance !== null && variance < 0 && "text-[var(--danger)]", variance !== null && variance > 0 && "text-[var(--positive)]", variance === 0 && "text-[var(--ink-faint)]")}>
                  {variance !== null && variance < 0 ? <ArrowDown className="size-3" /> : null}
                  {variance !== null && variance > 0 ? <ArrowUp className="size-3" /> : null}
                  {varianceLabel}
                </span>
              </div>
            );
          })}
          <div className="grid gap-4 px-4 py-5 sm:px-7">
            <label>
              <span className="mb-1.5 block text-xs font-semibold">Count note</span>
              <textarea
                rows={3}
                maxLength={10_000}
                value={notes}
                disabled={busy}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Optional context for the independent reviewer"
                className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs outline-none focus:border-[var(--accent)]"
              />
            </label>
            <div className="flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/55 p-3.5 text-xs leading-4 text-[var(--accent-strong)]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>Submitting creates a pending count only. On-hand stock changes after a different manager approves it.</span>
            </div>
            {notice ? <div aria-live="polite" className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] px-3.5 py-3 text-xs leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{notice}</div> : null}
          </div>
        </div>
        <div data-inventory-count-actions className="flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--paper-strong)] px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-10px_28px_rgba(25,28,24,.08)] sm:justify-end sm:px-7 sm:py-4">
          <Button className="flex-1 sm:flex-none" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button className="flex-[1.6] sm:flex-none" type="submit" variant="accent" disabled={busy || completed !== model.items.length}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
            Submit for review
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}

function ReviewDialog({
  count,
  model,
  currentUserId,
  note,
  notice,
  busy,
  onNoteChange,
  onClose,
  onDecision,
}: {
  count: LiveInventoryCount;
  model: LiveInventoryModel;
  currentUserId: string;
  note: string;
  notice: string;
  busy: boolean;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onDecision: (approve: boolean) => void;
}) {
  const isOwnCount = count.countedByUserId === currentUserId;
  const isPending = count.status === "pending" || count.status === "in_review";
  const itemById = new Map(model.items.map((item) => [item.id, item]));

  return (
    <ModalFrame
      title="Inventory count review"
      description={`${sentenceCase(count.countType)} count submitted by ${count.countedBy} on ${dateTimeLabel(count.countedAt, model.timeZone)}.`}
      labelledBy="inventory-review-dialog"
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--canvas)] px-5 py-3 sm:px-7">
        <StatusPill tone={statusTone[count.status] ?? "neutral"} dot={isPending}>{sentenceCase(count.status)}</StatusPill>
        <span className="text-xs text-[var(--ink-faint)]">{count.lines.length} recorded lines</span>
      </div>
      <div className="max-h-[46svh] overflow-auto">
        <div className="sticky top-0 z-10 grid min-w-[590px] grid-cols-[1.2fr_.55fr_.55fr_.55fr] gap-4 border-b border-[var(--line)] bg-[var(--paper-strong)] px-5 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase sm:px-7">
          <span>Item</span><span>Expected</span><span>Counted</span><span>Variance</span>
        </div>
        {count.lines.map((line) => {
          const item = itemById.get(line.inventoryItemId);
          const variance = line.expectedQuantity === null ? null : line.countedQuantity - line.expectedQuantity;
          return (
            <div key={line.id} className="grid min-w-[590px] grid-cols-[1.2fr_.55fr_.55fr_.55fr] items-center gap-4 border-b border-[var(--line)] px-5 py-3 sm:px-7">
              <div><p className="text-xs font-semibold">{item?.name ?? "Inventory item"}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{item?.unitSymbol ?? "unit"}</p></div>
              <span className="numeric text-xs text-[var(--ink-faint)]">{line.expectedQuantity === null ? "—" : quantityLabel(line.expectedQuantity)}</span>
              <span className="numeric text-xs font-semibold">{quantityLabel(line.countedQuantity)}</span>
              <span className={cn("numeric text-xs font-semibold", variance === null || variance === 0 ? "text-[var(--ink-faint)]" : variance < 0 ? "text-[var(--danger)]" : "text-[var(--positive)]")}>{variance === null ? "—" : quantityLabel(variance)}</span>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 px-5 py-5 sm:px-7">
        {count.notes ? <div><p className="text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">Counter note</p><p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">{count.notes}</p></div> : null}
        {isPending ? (
          <>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">Reviewer note</span>
              <textarea
                rows={3}
                maxLength={2_000}
                value={note}
                disabled={busy || isOwnCount}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Optional decision context"
                className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-55"
              />
            </label>
            <div className={cn("flex items-start gap-3 rounded-xl p-3.5 text-xs leading-4", isOwnCount ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]")}>
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>{isOwnCount ? "You submitted this count. A different manager must review it." : "Approval posts one append-only count adjustment per changed item. Rejection leaves on-hand stock unchanged."}</span>
            </div>
            {notice ? <div aria-live="polite" className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] px-3.5 py-3 text-xs leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{notice}</div> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button variant="danger" disabled={busy || isOwnCount} onClick={() => onDecision(false)}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <X className="size-4" />}
                Reject
              </Button>
              <Button variant="accent" disabled={busy || isOwnCount} onClick={() => onDecision(true)}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                Approve & post
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3.5 text-xs leading-4 text-[var(--ink-faint)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>{count.approvedBy && count.approvedAt ? `${sentenceCase(count.status)} by ${count.approvedBy} on ${dateTimeLabel(count.approvedAt, model.timeZone)}.` : "This review is complete and its evidence is locked."}</span>
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

type InventoryMutationDialog =
  | { kind: "purchase-order"; requestId: string }
  | { kind: "delivery"; requestId: string; order: LivePurchaseOrder }
  | { kind: "waste"; requestId: string }
  | { kind: "waste-review"; requestId: string; record: LiveWasteRecord }
  | { kind: "transfer"; requestId: string }
  | { kind: "transfer-review"; requestId: string; transfer: LiveInventoryTransfer };

interface MutationLineDraft {
  key: string;
  inventoryItemId: string;
  unitId: string;
  quantity: string;
  acceptedQuantity: string;
  unitPrice: string;
}

const inventoryFieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-55";
const inventoryTextAreaClass =
  "w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-55";

function InventoryField({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="mb-1.5 block text-xs font-semibold">{label}</span>{children}</label>;
}

function compatibleUnits(model: LiveInventoryModel, itemId: string) {
  const item = model.items.find((candidate) => candidate.id === itemId);
  if (!item) return [];
  return model.units.filter((unit) => item.compatibleUnitIds.includes(unit.id));
}

function localInstant(value: string, timeZone: string) {
  const [date, time] = value.split("T");
  return zonedLocalToIso(date ?? "", time ?? "", timeZone);
}

function InventoryLineEditor({
  model,
  lines,
  busy,
  mode,
  onChange,
  onAdd,
  onRemove,
}: {
  model: LiveInventoryModel;
  lines: MutationLineDraft[];
  busy: boolean;
  mode: "order" | "delivery" | "transfer";
  onChange: (key: string, patch: Partial<MutationLineDraft>) => void;
  onAdd?: () => void;
  onRemove?: (key: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold">Line items</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Units are limited to this tenant’s verified base units and conversions.</p></div>
        {onAdd ? <Button type="button" size="sm" variant="secondary" disabled={busy || !model.items.length} onClick={onAdd}><Plus className="size-3.5" />Add line</Button> : null}
      </div>
      <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {lines.map((line, index) => {
          const units = compatibleUnits(model, line.inventoryItemId);
          return (
            <div key={line.key} className="grid gap-3 py-4 lg:grid-cols-[1.2fr_.65fr_.55fr_.55fr_auto] lg:items-end">
              <InventoryField label="Item">
                <select
                  aria-label={`Item ${index + 1}`}
                  value={line.inventoryItemId}
                  disabled={busy || mode === "delivery"}
                  onChange={(event) => {
                    const item = model.items.find((candidate) => candidate.id === event.target.value);
                    onChange(line.key, { inventoryItemId: event.target.value, unitId: item?.baseUnitId ?? "" });
                  }}
                  className={inventoryFieldClass}
                >
                  {model.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </InventoryField>
              <InventoryField label="Unit">
                <select aria-label={`Unit ${index + 1}`} value={line.unitId} disabled={busy || mode === "delivery"} onChange={(event) => onChange(line.key, { unitId: event.target.value })} className={inventoryFieldClass}>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}
                </select>
              </InventoryField>
              <InventoryField label={mode === "delivery" ? "Delivered" : mode === "transfer" ? "Send" : "Quantity"}>
                <input aria-label={`${mode === "transfer" ? "Send" : mode === "delivery" ? "Delivered" : "Order"} quantity ${index + 1}`} required inputMode="decimal" value={line.quantity} disabled={busy} onChange={(event) => onChange(line.key, { quantity: event.target.value, ...(mode === "delivery" ? { acceptedQuantity: event.target.value } : {}) })} className={inventoryFieldClass} />
              </InventoryField>
              {mode === "transfer" ? <span className="hidden lg:block" /> : mode === "delivery" ? (
                <InventoryField label="Accepted"><input aria-label={`Accepted quantity ${index + 1}`} required inputMode="decimal" value={line.acceptedQuantity} disabled={busy} onChange={(event) => onChange(line.key, { acceptedQuantity: event.target.value })} className={inventoryFieldClass} /></InventoryField>
              ) : (
                <InventoryField label="Unit price"><input aria-label={`Unit price ${index + 1}`} required inputMode="decimal" value={line.unitPrice} disabled={busy} onChange={(event) => onChange(line.key, { unitPrice: event.target.value })} className={inventoryFieldClass} placeholder="0.00" /></InventoryField>
              )}
              {mode === "delivery" ? (
                <InventoryField label="Unit price"><input aria-label={`Delivered unit price ${index + 1}`} required inputMode="decimal" value={line.unitPrice} disabled={busy} onChange={(event) => onChange(line.key, { unitPrice: event.target.value })} className={inventoryFieldClass} /></InventoryField>
              ) : onRemove && lines.length > 1 ? (
                <Button type="button" variant="quiet" size="icon" disabled={busy} aria-label={`Remove line ${index + 1}`} onClick={() => onRemove(line.key)}><X className="size-4" /></Button>
              ) : <span className="hidden lg:block" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InventoryMutationDialog({
  dialog,
  workspace,
  model,
  busy,
  notice,
  onClose,
  returnFocus,
  onError,
  onRun,
}: {
  dialog: InventoryMutationDialog;
  workspace: WorkspaceContextValue;
  model: LiveInventoryModel;
  busy: boolean;
  notice: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  onError: (message: string) => void;
  onRun: (
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) => Promise<boolean>;
}) {
  const firstItem = model.items[0];
  const now = localDateTimeParts(new Date().toISOString(), model.timeZone);
  const order = dialog.kind === "delivery" ? dialog.order : null;
  const [lines, setLines] = useState<MutationLineDraft[]>(() => {
    if (order) {
      return order.lines
        .map((line) => ({ ...line, remaining: Math.max(0, line.quantity - line.receivedQuantity) }))
        .filter((line) => line.remaining > 0)
        .map((line) => ({
          key: line.id,
          inventoryItemId: line.inventoryItemId,
          unitId: line.unitId,
          quantity: quantityInputValue(line.remaining),
          acceptedQuantity: quantityInputValue(line.remaining),
          unitPrice: (line.unitPriceCents / 100).toFixed(2),
        }));
    }
    if (dialog.kind === "transfer-review") {
      return dialog.transfer.lines.map((line) => ({
        key: line.id,
        inventoryItemId: line.inventoryItemId,
        unitId: line.unitId,
        quantity: quantityInputValue(line.sentQuantity),
        acceptedQuantity: quantityInputValue(line.sentQuantity),
        unitPrice: "",
      }));
    }
    return firstItem ? [{ key: crypto.randomUUID(), inventoryItemId: firstItem.id, unitId: firstItem.baseUnitId, quantity: "", acceptedQuantity: "", unitPrice: "" }] : [];
  });
  const [wasteItemId, setWasteItemId] = useState(firstItem?.id ?? "");

  function updateLine(key: string, patch: Partial<MutationLineDraft>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }
  function addLine() {
    if (!firstItem) return;
    setLines((current) => [...current, { key: crypto.randomUUID(), inventoryItemId: firstItem.id, unitId: firstItem.baseUnitId, quantity: "", acceptedQuantity: "", unitPrice: "" }]);
  }
  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }
  function parsedLineValues(mode: "order" | "delivery" | "transfer") {
    const parsed = lines.map((line) => ({
      ...line,
      parsedQuantity: parseInventoryQuantity(line.quantity),
      parsedAccepted: mode === "delivery" ? parseInventoryQuantity(line.acceptedQuantity, { allowZero: true }) : null,
      parsedPrice: mode === "transfer" ? null : parseInventoryMoneyToCents(line.unitPrice),
    }));
    if (parsed.some((line) => line.parsedQuantity === null || (mode === "delivery" && (line.parsedAccepted === null || line.parsedAccepted > line.parsedQuantity!)) || (mode !== "transfer" && line.parsedPrice === null))) {
      onError("Use positive quantities with up to four decimals and money with up to two decimals. Accepted quantity cannot exceed delivered quantity.");
      return null;
    }
    return parsed;
  }

  if (dialog.kind === "purchase-order") {
    return <ModalFrame returnFocus={returnFocus} title="Create purchase order" description="Create an internal, tenant-scoped order. This records the order but does not transmit it to the vendor." labelledBy="purchase-order-dialog" notice={notice} onClose={onClose} width="max-w-5xl"><form onSubmit={async (event) => { event.preventDefault(); const parsed = parsedLineValues("order"); if (!parsed) return; const form = new FormData(event.currentTarget); const taxCents = parseInventoryMoneyToCents(String(form.get("tax") ?? "")); const shippingCents = parseInventoryMoneyToCents(String(form.get("shipping") ?? "")); if (taxCents === null || shippingCents === null) return onError("Tax and shipping must be non-negative amounts with up to two decimals."); const succeeded = await onRun("Purchase order created. It is ready for receiving; no vendor message was sent.", () => createPurchaseOrderAction({ requestId: dialog.requestId, locationId: workspace.activeLocation.id, vendorId: String(form.get("vendorId")), poNumber: String(form.get("poNumber")), orderedOn: String(form.get("orderedOn") || "") || null, expectedOn: String(form.get("expectedOn") || "") || null, taxCents, shippingCents, notes: String(form.get("notes") || "") || null, lines: parsed.map((line) => ({ inventoryItemId: line.inventoryItemId, unitId: line.unitId, quantity: line.parsedQuantity!, unitPriceCents: line.parsedPrice!, notes: null })) })); if (succeeded) onClose(); }}>
      <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><InventoryField label="Vendor"><select name="vendorId" required autoFocus className={inventoryFieldClass}>{model.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></InventoryField><InventoryField label="PO number"><input name="poNumber" required maxLength={80} placeholder="e.g. PO-20260801-01" className={inventoryFieldClass} /></InventoryField><InventoryField label="Ordered on"><input name="orderedOn" type="date" defaultValue={model.date} className={inventoryFieldClass} /></InventoryField><InventoryField label="Expected on"><input name="expectedOn" type="date" min={model.date} className={inventoryFieldClass} /></InventoryField></div><InventoryLineEditor model={model} lines={lines} busy={busy} mode="order" onChange={updateLine} onAdd={addLine} onRemove={removeLine} /><div className="grid gap-4 sm:grid-cols-3"><InventoryField label={`Tax · ${model.currencyCode}`}><input name="tax" inputMode="decimal" defaultValue="0.00" required className={inventoryFieldClass} /></InventoryField><InventoryField label={`Shipping · ${model.currencyCode}`}><input name="shipping" inputMode="decimal" defaultValue="0.00" required className={inventoryFieldClass} /></InventoryField><InventoryField label="Order note"><input name="notes" maxLength={4_000} className={inventoryFieldClass} /></InventoryField></div><div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />Subtotal is recalculated from exact quantity × integer-cent prices in the database. The actor and request evidence are server-derived.</div><div className="flex justify-end gap-2"><Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" disabled={busy || !model.vendors.length || !lines.length}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}Create order</Button></div></div>
    </form></ModalFrame>;
  }

  if (dialog.kind === "delivery") {
    return <ModalFrame title="Receive delivery" description={`${order!.poNumber} · ${order!.vendorName}. Accepted quantities post to stock immediately in canonical base units.`} labelledBy="delivery-dialog" notice={notice} onClose={onClose} width="max-w-5xl"><form onSubmit={async (event) => { event.preventDefault(); const parsed = parsedLineValues("delivery"); if (!parsed) return; const form = new FormData(event.currentTarget); const deliveredAt = localInstant(String(form.get("deliveredAt")), model.timeZone); if (!deliveredAt) return onError("The delivery time is invalid in the restaurant timezone."); const succeeded = await onRun("Delivery received. Accepted quantities and vendor prices were posted once.", () => receiveInventoryDeliveryAction({ requestId: dialog.requestId, locationId: workspace.activeLocation.id, vendorId: order!.vendorId, purchaseOrderId: order!.id, deliveredAt, invoiceNumber: String(form.get("invoiceNumber") || "") || null, notes: String(form.get("notes") || "") || null, lines: parsed.map((line) => ({ inventoryItemId: line.inventoryItemId, unitId: line.unitId, quantity: line.parsedQuantity!, acceptedQuantity: line.parsedAccepted!, unitPriceCents: line.parsedPrice!, lotCode: null, expiresOn: null })) })); if (succeeded) onClose(); }}>
      <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-3"><InventoryField label={`Delivered · ${model.timeZone}`}><input name="deliveredAt" type="datetime-local" required defaultValue={`${now.date}T${now.time}`} className={inventoryFieldClass} /></InventoryField><InventoryField label="Invoice number"><input name="invoiceNumber" maxLength={120} className={inventoryFieldClass} /></InventoryField><InventoryField label="Receiving note"><input name="notes" maxLength={4_000} className={inventoryFieldClass} /></InventoryField></div><InventoryLineEditor model={model} lines={lines} busy={busy} mode="delivery" onChange={updateLine} /><div className="flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/55 p-3 text-xs leading-4 text-[var(--accent-strong)]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />The server rejects over-receipt against this PO and derives the base-unit quantity and cost. Receipt-file linking remains a separate evidence-bound action.</div><div className="flex justify-end gap-2"><Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" disabled={busy || !lines.length}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Truck className="size-4" />}Receive delivery</Button></div></div>
    </form></ModalFrame>;
  }

  if (dialog.kind === "waste") {
    return <ModalFrame title="Record waste" description="Submit observed waste for independent review. Stock does not change until a different manager approves it." labelledBy="waste-dialog" notice={notice} onClose={onClose}><form onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const quantity = parseInventoryQuantity(String(form.get("quantity"))); if (quantity === null) return onError("Waste quantity must be positive with no more than four decimal places."); const occurredAt = localInstant(String(form.get("occurredAt")), model.timeZone); if (!occurredAt) return onError("The waste time is invalid in the restaurant timezone."); const succeeded = await onRun("Waste submitted. A different manager must approve it before stock changes.", () => submitWasteRecordAction({ requestId: dialog.requestId, locationId: workspace.activeLocation.id, inventoryItemId: String(form.get("inventoryItemId")), unitId: String(form.get("unitId")), quantity, reasonCode: String(form.get("reasonCode")), occurredAt, notes: String(form.get("notes") || "") || null })); if (succeeded) onClose(); }}>
      <div className="grid gap-4 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2"><InventoryField label="Item"><select name="inventoryItemId" required autoFocus value={wasteItemId} onChange={(event) => setWasteItemId(event.target.value)} className={inventoryFieldClass}>{model.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></InventoryField><InventoryField label="Unit"><select key={wasteItemId} name="unitId" required defaultValue={model.items.find((item) => item.id === wasteItemId)?.baseUnitId} className={inventoryFieldClass}>{compatibleUnits(model, wasteItemId).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></InventoryField></div><div className="grid gap-4 sm:grid-cols-3"><InventoryField label="Quantity"><input name="quantity" required inputMode="decimal" className={inventoryFieldClass} /></InventoryField><InventoryField label="Reason"><select name="reasonCode" defaultValue="spoilage" className={inventoryFieldClass}><option value="spoilage">Spoilage</option><option value="overproduction">Overproduction</option><option value="damage">Damage</option><option value="quality">Quality</option><option value="expired">Expired</option><option value="other">Other</option></select></InventoryField><InventoryField label={`Occurred · ${model.timeZone}`}><input name="occurredAt" type="datetime-local" required defaultValue={`${now.date}T${now.time}`} className={inventoryFieldClass} /></InventoryField></div><InventoryField label="Observation note"><textarea name="notes" rows={4} maxLength={4_000} className={inventoryTextAreaClass} /></InventoryField><div className="flex items-start gap-3 rounded-xl bg-[var(--warning-soft)] p-3 text-xs leading-4 text-[var(--warning)]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />Estimated cost is derived from canonical price evidence. AI may suggest waste, but this form requires a human submission and another human’s decision.</div><div className="flex justify-end gap-2"><Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" disabled={busy || !firstItem}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Submit for review</Button></div></div>
    </form></ModalFrame>;
  }

  if (dialog.kind === "waste-review") {
    const record = dialog.record;
    const own = record.recordedByUserId === workspace.identity.userId;
    const decide = async (approve: boolean, form: HTMLFormElement) => { const note = String(new FormData(form).get("note") || "") || null; const succeeded = await onRun(approve ? "Waste approved and the stock decrement was posted once." : "Waste rejected; stock was not changed.", () => reviewWasteRecordAction({ requestId: dialog.requestId, wasteRecordId: record.id, approve, note })); if (succeeded) onClose(); };
    return <ModalFrame title="Review waste" description={`${record.itemName} · ${quantityLabel(record.quantity)} ${record.unitSymbol} · recorded by ${record.recordedBy}.`} labelledBy="waste-review-dialog" notice={notice} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); void decide(true, event.currentTarget); }}><div className="grid gap-4 px-5 py-5 sm:px-7"><div className="grid grid-cols-2 divide-x divide-[var(--line)] border-y border-[var(--line)]"><Metric label="Estimated cost" value={record.estimatedCostCents === null ? "Unknown" : formatMoney(record.estimatedCostCents, model.currencyCode)} detail={sentenceCase(record.reasonCode)} /><Metric label="Observed" value={dateTimeLabel(record.occurredAt, model.timeZone)} detail={record.notes ?? "No observation note"} /></div><InventoryField label="Review note"><textarea name="note" rows={4} maxLength={2_000} disabled={busy || own} className={inventoryTextAreaClass} /></InventoryField><div className={cn("flex items-start gap-3 rounded-xl p-3 text-xs leading-4", own ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]")}><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{own ? "You recorded this waste. A different manager must review it." : "Approval posts a canonical base-unit decrement; rejection leaves stock unchanged. The decision is immutable."}</div><div className="flex justify-end gap-2"><Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button type="button" variant="danger" disabled={busy || own} onClick={(event) => void decide(false, event.currentTarget.form!)}><X className="size-4" />Reject</Button><Button type="submit" variant="accent" disabled={busy || own}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}Approve & post</Button></div></div></form></ModalFrame>;
  }

  if (dialog.kind === "transfer") {
    const destinations = model.locations.filter((location) => location.id !== workspace.activeLocation.id);
    return <ModalFrame title="Create transfer" description={`Submit stock from ${workspace.activeLocation.name} for independent review at the destination.`} labelledBy="transfer-dialog" notice={notice} onClose={onClose} width="max-w-5xl"><form onSubmit={async (event) => { event.preventDefault(); const parsed = parsedLineValues("transfer"); if (!parsed) return; const form = new FormData(event.currentTarget); const succeeded = await onRun("Transfer submitted. A different destination manager must verify received quantities.", () => createInventoryTransferAction({ requestId: dialog.requestId, fromLocationId: workspace.activeLocation.id, toLocationId: String(form.get("toLocationId")), notes: String(form.get("notes") || "") || null, lines: parsed.map((line) => ({ inventoryItemId: line.inventoryItemId, unitId: line.unitId, sentQuantity: line.parsedQuantity! })) })); if (succeeded) onClose(); }}><div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2"><InventoryField label="Destination"><select name="toLocationId" required autoFocus className={inventoryFieldClass}>{destinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></InventoryField><InventoryField label="Transfer note"><input name="notes" maxLength={4_000} className={inventoryFieldClass} /></InventoryField></div><InventoryLineEditor model={model} lines={lines} busy={busy} mode="transfer" onChange={updateLine} onAdd={addLine} onRemove={removeLine} /><div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]"><ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />This submits a pending transfer only. Stock moves when a different manager at the destination confirms actual received quantities.</div><div className="flex justify-end gap-2"><Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" disabled={busy || !destinations.length || !lines.length}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}Submit transfer</Button></div></div></form></ModalFrame>;
  }

  const transfer = dialog.transfer;
  const own = transfer.createdByUserId === workspace.identity.userId;
  const atDestination = transfer.toLocationId === workspace.activeLocation.id;
  const decideTransfer = async (approve: boolean, form: HTMLFormElement) => { const parsed = approve ? lines.map((line) => ({ ...line, receivedQuantity: parseInventoryQuantity(line.acceptedQuantity, { allowZero: true }) })) : []; if (approve && parsed.some((line) => line.receivedQuantity === null || line.receivedQuantity > Number(line.quantity))) return onError("Received quantities must be non-negative, use up to four decimals, and cannot exceed sent quantities."); const note = String(new FormData(form).get("note") || "") || null; const succeeded = await onRun(approve ? "Transfer received and paired source/destination ledger entries were posted once." : "Transfer rejected; no stock movement was posted.", () => reviewInventoryTransferAction({ requestId: dialog.requestId, transferId: transfer.id, approve, note, lines: approve ? parsed.map((line) => ({ inventoryItemId: line.inventoryItemId, unitId: line.unitId, receivedQuantity: line.receivedQuantity! })) : [] })); if (succeeded) onClose(); };
  return <ModalFrame title="Review transfer" description={`${transfer.fromLocationName} → ${transfer.toLocationName} · submitted by ${transfer.createdBy}.`} labelledBy="transfer-review-dialog" notice={notice} onClose={onClose} width="max-w-4xl"><form onSubmit={(event) => { event.preventDefault(); void decideTransfer(true, event.currentTarget); }}><div className="grid gap-5 px-5 py-5 sm:px-7"><div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{lines.map((line, index) => <div key={line.key} className="grid grid-cols-[1fr_.5fr_.6fr] items-center gap-4 py-3"><div><p className="text-xs font-semibold">{model.items.find((item) => item.id === line.inventoryItemId)?.name ?? "Inventory item"}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Sent {line.quantity} {model.units.find((unit) => unit.id === line.unitId)?.symbol ?? "unit"}</p></div><span className="text-xs text-[var(--ink-faint)]">Received</span><input aria-label={`Received quantity ${index + 1}`} required inputMode="decimal" value={line.acceptedQuantity} disabled={busy || own || !atDestination} onChange={(event) => updateLine(line.key, { acceptedQuantity: event.target.value })} className={inventoryFieldClass} /></div>)}</div><InventoryField label="Review note"><textarea name="note" rows={3} maxLength={2_000} disabled={busy || own || !atDestination} className={inventoryTextAreaClass} /></InventoryField><div className={cn("flex items-start gap-3 rounded-xl p-3 text-xs leading-4", own || !atDestination ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]")}><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{own ? "You created this transfer. A different destination manager must review it." : !atDestination ? `Switch to ${transfer.toLocationName} to review this transfer.` : "The server rechecks source on-hand stock, then posts paired base-unit movements. Short receipt remains visible in the locked line evidence."}</div><div className="flex justify-end gap-2"><Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button type="button" variant="danger" disabled={busy || own || !atDestination} onClick={(event) => void decideTransfer(false, event.currentTarget.form!)}><X className="size-4" />Reject</Button><Button type="submit" variant="accent" disabled={busy || own || !atDestination}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}Approve & post</Button></div></div></form></ModalFrame>;
}

export function LiveInventoryWorkspace({
  workspace,
  result,
  initialTab,
  title = "Inventory",
  description,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveInventoryModel>;
  initialTab?: Tab;
  title?: string;
  description?: string;
}) {
  const administrativeWrite = workspace.role === "admin"
    || workspace.role === "owner";
  const can = (capability: Parameters<typeof hasCapability>[1]) =>
    administrativeWrite || hasCapability(workspace.capabilities, capability);
  const canCountCreate = can("inventory.count.create");
  const canCountApprove = can("inventory.count.approve");
  const canPurchase = can("inventory.purchase.create");
  const canReceive = can("inventory.receive");
  const canTransferCreate = can("inventory.transfer.create");
  const canTransferApprove = can("inventory.transfer.approve");
  const canWasteCreate = can("inventory.waste.create");
  const canWasteApprove = can("inventory.waste.approve");
  const canManageRecipes = can("recipe.manage");
  const canSeeVendors = administrativeWrite || ["inventory.vendor.manage", "inventory.price.manage", "inventory.purchase.create", "inventory.receive"].some((capability) =>
    hasCapability(workspace.capabilities, capability as Parameters<typeof hasCapability>[1]),
  );
  const canSeeRecipes = administrativeWrite || ["recipe.manage", "prep.manage", "prep.complete", "menu.manage"].some((capability) =>
    hasCapability(workspace.capabilities, capability as Parameters<typeof hasCapability>[1]),
  );
  const canSeeCatalog = administrativeWrite || ["inventory.catalog.manage", "inventory.par.manage", "inventory.vendor.manage", "inventory.price.manage", "recipe.manage"].some((capability) =>
    hasCapability(workspace.capabilities, capability as Parameters<typeof hasCapability>[1]),
  );
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === "count") return canCountCreate || canCountApprove;
    if (tab.id === "orders") return canPurchase || canReceive;
    if (tab.id === "transfers") return canTransferCreate || canTransferApprove;
    if (tab.id === "vendors") return canSeeVendors;
    if (tab.id === "recipes") return canSeeRecipes;
    if (tab.id === "waste") return canWasteCreate || canWasteApprove;
    if (tab.id === "catalog") return canSeeCatalog;
    return true;
  });
  const firstTab = visibleTabs.some((tab) => tab.id === initialTab)
    ? initialTab!
    : visibleTabs[0]?.id ?? "stock";
  const router = useRouter();
  const model = result.ok ? result.data : null;
  const [activeTab, setActiveTab] = useState<Tab>(firstTab);
  const [query, setQuery] = useState("");
  const [countOpen, setCountOpen] = useState(false);
  const [countSubmissionId, setCountSubmissionId] = useState<string | null>(null);
  const [countValues, setCountValues] = useState<Record<string, string>>({});
  const [countNotes, setCountNotes] = useState("");
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);
  const [countReviewRequestId, setCountReviewRequestId] = useState<string | null>(null);
  const [mutationDialog, setMutationDialog] = useState<InventoryMutationDialog | null>(null);
  const [recipeDialog, setRecipeDialog] = useState<{ requestId: string; record?: RecipeRecord } | null>(null);
  const [mutationReturnFocus, setMutationReturnFocus] = useState<HTMLElement | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!model) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`inventory-${workspace.activeLocation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_counts",
          filter: `location_id=eq.${workspace.activeLocation.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_transactions",
          filter: `location_id=eq.${workspace.activeLocation.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders", filter: `location_id=eq.${workspace.activeLocation.id}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliveries", filter: `location_id=eq.${workspace.activeLocation.id}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waste_records", filter: `location_id=eq.${workspace.activeLocation.id}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_transfers" },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [model, router, workspace.activeLocation.id]);

  const visibleItems = useMemo(() => {
    if (!model) return [];
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return model.items;
    return model.items.filter((item) =>
      [item.name, item.sku ?? "", item.category].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [model, query]);

  if (!result.ok) {
    return (
      <PageFrame>
        <section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center">
          <CircleAlert className="mx-auto size-6 text-[var(--warning)]" />
          <h2 className="mt-4 text-xl font-medium">Inventory unavailable</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{result.message}</p>
        </section>
      </PageFrame>
    );
  }
  if (!model) return null;
  const liveModel = model;

  const inventoryValueCents = model.items.reduce(
    (sum, item) => sum + (item.inventoryValueCents ?? 0),
    0,
  );
  const missingValueCount = model.items.filter((item) => item.inventoryValueCents === null).length;
  const belowPar = model.items.filter((item) => item.par !== null && item.onHand < item.par).length;
  const pendingCounts = model.counts.filter((count) => ["pending", "in_review"].includes(count.status));
  const openOrders = model.orders.filter((order) => !["received", "cancelled"].includes(order.status));
  const latestApprovedCount = model.counts.find((count) => count.status === "approved") ?? null;
  const selectedCount = model.counts.find((count) => count.id === selectedCountId) ?? null;

  function openCount() {
    setCountSubmissionId(crypto.randomUUID());
    setCountValues(Object.fromEntries(liveModel.items.map((item) => [item.id, ""])));
    setCountNotes("");
    setNotice("");
    setCountOpen(true);
  }

  function openMutationDialog(next: InventoryMutationDialog) {
    setMutationReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setNotice("");
    setMutationDialog(next);
  }

  async function submitCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!countSubmissionId) return;
    const decimal = /^\d+(?:\.\d{1,4})?$/;
    const values = liveModel.items.map((item) => countValues[item.id]?.trim() ?? "");
    if (values.some((value) => !decimal.test(value) || Number(value) >= 1_000_000_000_000)) {
      setNotice("Enter every count as a non-negative number with no more than four decimal places.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await submitInventoryCountAction({
        submissionId: countSubmissionId,
        locationId: workspace.activeLocation.id,
        countType: "full",
        notes: countNotes.trim() || null,
        lines: liveModel.items.map((item) => ({
          inventoryItemId: item.id,
          unitId: item.baseUnitId,
          countedQuantity: Number(countValues[item.id]),
        })),
      });
      if (!response.ok) {
        setNotice(response.message);
        return;
      }
      setCountOpen(false);
      setCountSubmissionId(null);
      setActiveTab("count");
      setNotice("Full count submitted. A different manager must review it before stock changes.");
      router.refresh();
    } catch {
      setNotice("The inventory count could not be submitted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decideCount(approve: boolean) {
    if (!selectedCount || !countReviewRequestId) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await approveInventoryCountAction({
        requestId: countReviewRequestId,
        countId: selectedCount.id,
        approve,
        note: reviewNote.trim() || null,
      });
      if (!response.ok) {
        setNotice(response.message);
        return;
      }
      setSelectedCountId(null);
      setCountReviewRequestId(null);
      setReviewNote("");
      setNotice(approve ? "Count approved and stock adjustments posted." : "Count rejected; on-hand stock was not changed.");
      router.refresh();
    } catch {
      setNotice("The inventory count review could not be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runMutation(
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setBusy(true);
    setNotice("");
    try {
      const response = await action();
      if (!response.ok) {
        setNotice(response.message ?? "The inventory action could not be completed.");
        return false;
      }
      setNotice(successMessage);
      router.refresh();
      return true;
    } catch {
      setNotice("The inventory action could not be completed. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRecipe(input: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const response = await configureInventoryCatalogAction(input);
      if (!response.ok) {
        setNotice(response.message ?? "The recipe could not be saved.");
        return false;
      }
      setNotice("Recipe saved.");
      router.refresh();
      return true;
    } catch {
      setNotice("The recipe could not be saved. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame width="wide">
      <PageHeader
        eyebrow="Food & beverage control"
        title={title}
        detail={description ?? `Stock, counts, purchasing, recipes, and waste for ${workspace.activeLocation.name}.`}
        status={<><StatusPill tone="positive" dot>Connected</StatusPill><span>Ledger-backed · tenant scoped</span></>}
        actions={<>{canPurchase ? <Button variant="secondary" disabled={!model.items.length || !model.vendors.length} onClick={() => openMutationDialog({ kind: "purchase-order", requestId: crypto.randomUUID() })}><ShoppingCart className="size-4" />New order</Button> : null}{canCountCreate ? <Button variant="accent" disabled={!model.items.length} onClick={openCount}><ClipboardCheck className="size-4" />Start full count</Button> : null}</>}
      />

      {notice ? <div aria-live="polite" className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--accent-soft)]/55 px-4 py-3 text-xs leading-4 text-[var(--accent-strong)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{notice}</div> : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Known inventory value" value={formatMoney(inventoryValueCents, model.currencyCode)} detail={missingValueCount ? `${missingValueCount} item${missingValueCount === 1 ? "" : "s"} missing base-unit cost` : "All tracked items valued"} /></Surface>
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Below par" value={String(belowPar)} detail={`${model.items.length} active tracked items`} trend={{ label: belowPar ? "Review" : "At par", tone: belowPar ? "negative" : "positive" }} /></Surface>
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Open orders" value={String(openOrders.length)} detail={`${model.orders.length} recent purchase orders`} /></Surface>
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Pending counts" value={String(pendingCounts.length)} detail={latestApprovedCount ? `Last approved ${dateTimeLabel(latestApprovedCount.countedAt, model.timeZone)}` : "No approved count yet"} trend={{ label: pendingCounts.length ? "Review" : "Clear", tone: pendingCounts.length ? "negative" : "positive" }} /></Surface>
      </section>

      <div role="tablist" aria-label="Inventory sections" className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-[var(--line)]">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            id={`inventory-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`inventory-panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={cn("focus-ring relative min-h-10 shrink-0 px-3 text-[13px] font-semibold transition-colors", activeTab === tab.id ? "text-[var(--ink)]" : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]")}
          >
            {tab.label}{tab.id === "count" && pendingCounts.length ? ` · ${pendingCounts.length}` : ""}
            {activeTab === tab.id ? <motion.span layoutId="live-inventory-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activeTab} id={`inventory-panel-${activeTab}`} role="tabpanel" aria-labelledby={`inventory-tab-${activeTab}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14 }}>
          {activeTab === "stock" ? (
            <section className="mt-5">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <SectionHeading title="On hand" detail="Approved ledger quantities compared with current location par." className="mb-0" />
                <label className="relative block sm:w-72"><span className="sr-only">Search inventory</span><Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, SKU, or category" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-xs outline-none focus:border-[var(--accent)]" /></label>
              </div>
              {visibleItems.length ? (
                <div className="overflow-x-auto border-y border-[var(--line)]" tabIndex={0} role="region" aria-label="Inventory on hand table">
                  <div className="grid min-w-[820px] grid-cols-[1.3fr_.65fr_.55fr_.7fr_.8fr_.7fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Item</span><span>On hand</span><span>Par</span><span>Status</span><span>Last movement</span><span className="text-right">Base cost</span></div>
                  {visibleItems.map((item) => {
                    const stockStatus = item.par === null ? "unconfigured" : item.reorder !== null && item.onHand <= item.reorder ? "reorder" : item.onHand < item.par ? "below" : "healthy";
                    return (
                      <div key={item.id} className="grid min-w-[820px] grid-cols-[1.3fr_.65fr_.55fr_.7fr_.8fr_.7fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 transition-colors hover:bg-[var(--paper)]">
                        <span className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><Boxes className="size-3.5 text-[var(--ink-faint)]" /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{item.name}</span><span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">{item.sku || "No SKU"} · {item.category}</span></span></span>
                        <span className="numeric text-xs font-semibold">{quantityLabel(item.onHand)} <span className="font-normal text-[var(--ink-faint)]">{item.unitSymbol}</span></span>
                        <span className="numeric text-xs text-[var(--ink-faint)]">{item.par === null ? "—" : quantityLabel(item.par)}</span>
                        <span><StatusPill tone={stockStatus === "healthy" ? "positive" : stockStatus === "reorder" ? "danger" : stockStatus === "below" ? "warning" : "neutral"}>{stockStatus === "healthy" ? "Healthy" : stockStatus === "reorder" ? "Reorder" : stockStatus === "below" ? "Below par" : "No par"}</StatusPill></span>
                        <span className="text-xs text-[var(--ink-faint)]">{item.lastMovementAt ? dateTimeLabel(item.lastMovementAt, model.timeZone) : "No ledger movement"}</span>
                        <span className="numeric text-right text-xs">{item.lastUnitCostCents === null ? "—" : `${formatMoney(item.lastUnitCostCents, model.currencyCode)} / ${item.unitSymbol}`}</span>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyState icon={<Boxes className="size-4" />} title={model.items.length ? "No matching items" : "No tracked inventory yet"} detail={model.items.length ? "Try a different item, SKU, or category." : "Active tracked items will appear here after they are configured."} />}
            </section>
          ) : null}

          {activeTab === "count" ? (
            <section className="mt-5">
              <SectionHeading title="Count history" detail="Pending counts are review evidence and do not affect on-hand stock." action={canCountCreate ? <Button size="sm" variant="accent" disabled={!model.items.length} onClick={openCount}><ClipboardCheck className="size-3.5" />New full count</Button> : undefined} />
              {model.counts.length ? (
                <div className="border-y border-[var(--line)]">
                  {model.counts.map((count) => {
                    const differentLines = count.lines.filter((line) => line.expectedQuantity !== null && line.countedQuantity !== line.expectedQuantity).length;
                    const ownPending = ["pending", "in_review"].includes(count.status) && count.countedByUserId === workspace.identity.userId;
                    return (
                      <button key={count.id} onClick={() => { setSelectedCountId(count.id); setCountReviewRequestId(crypto.randomUUID()); setReviewNote(""); setNotice(""); }} className="group focus-ring flex w-full items-center gap-4 border-t border-[var(--line)] px-4 py-4 text-left first:border-t-0 hover:bg-[var(--paper)]">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><ClipboardList className="size-4 text-[var(--ink-faint)]" /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{sentenceCase(count.countType)} count · {count.countedBy}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{dateTimeLabel(count.countedAt, model.timeZone)} · {count.lines.length} lines · {differentLines} variances{ownPending ? " · another reviewer required" : ""}</span></span>
                        <StatusPill tone={statusTone[count.status] ?? "neutral"}>{sentenceCase(count.status)}</StatusPill>
                        <ChevronRight className="size-4 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
                      </button>
                    );
                  })}
                </div>
              ) : <EmptyState icon={<ClipboardList className="size-4" />} title="No counts submitted" detail="Start a full count to capture every active tracked item for independent review." />}
            </section>
          ) : null}

          {activeTab === "orders" ? (
            <section className="mt-5">
              <SectionHeading title="Purchase orders" detail="Internal orders with server-derived totals. Vendor transmission remains outside this app until an approved integration is connected." action={canPurchase ? <Button size="sm" variant="accent" disabled={!model.items.length || !model.vendors.length} onClick={() => openMutationDialog({ kind: "purchase-order", requestId: crypto.randomUUID() })}><Plus className="size-3.5" />New order</Button> : undefined} />
              {model.orders.length ? <div className="border-y border-[var(--line)]">{model.orders.map((order) => { const orderCanReceive = canReceive && ["submitted", "partially_received"].includes(order.status) && order.lines.length > 0; return <div key={order.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><ShoppingCart className="size-4 text-[var(--ink-faint)]" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{order.vendorName} · {order.poNumber}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">Ordered {dateLabel(order.orderedOn)} · expected {dateLabel(order.expectedOn)} · {order.lineCount} lines</span></span><span className="numeric text-xs font-semibold">{formatMoney(order.totalCents, model.currencyCode)}</span><StatusPill tone={statusTone[order.status] ?? "neutral"}>{sentenceCase(order.status)}</StatusPill>{orderCanReceive ? <Button size="sm" variant="secondary" onClick={() => openMutationDialog({ kind: "delivery", requestId: crypto.randomUUID(), order })}><Truck className="size-3.5" />Receive</Button> : null}</div>; })}</div> : <EmptyState icon={<ShoppingCart className="size-4" />} title="No purchase orders" detail={model.vendors.length && model.items.length ? "Create an internal order from active tenant vendors and tracked items." : "Active vendors and tracked items are required before an order can be created."} />}
              <div className="mt-8"><SectionHeading title="Delivery history" detail="Accepted quantities, invoice references, and receiving actors. Each delivery posts canonical stock exactly once." /></div>
              {model.deliveries.length ? <div className="border-y border-[var(--line)]">{model.deliveries.map((delivery) => <div key={delivery.id} className="flex items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Truck className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{delivery.vendorName}{delivery.poNumber ? ` · ${delivery.poNumber}` : ""}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{dateTimeLabel(delivery.deliveredAt, model.timeZone)} · {delivery.lines.length} lines · received by {delivery.receivedBy}{delivery.invoiceNumber ? ` · ${delivery.invoiceNumber}` : ""}</span></span><span className="numeric text-xs font-semibold">{quantityLabel(delivery.lines.reduce((sum, line) => sum + line.acceptedQuantity, 0))} accepted</span><StatusPill tone="positive">Posted</StatusPill></div>)}</div> : <EmptyState icon={<Truck className="size-4" />} title="No deliveries received" detail="Receive against an open purchase order to post accepted stock and vendor price evidence." />}
            </section>
          ) : null}

          {activeTab === "transfers" ? (
            <section className="mt-5">
              <SectionHeading title="Location transfers" detail="Source submissions require an independent destination decision before paired stock movements post." action={canTransferCreate ? <Button size="sm" variant="accent" disabled={!model.items.length || model.locations.filter((location) => location.id !== workspace.activeLocation.id).length === 0} onClick={() => openMutationDialog({ kind: "transfer", requestId: crypto.randomUUID() })}><ArrowRightLeft className="size-3.5" />New transfer</Button> : undefined} />
              {model.transfers.length ? <div className="border-y border-[var(--line)]">{model.transfers.map((transfer) => { const pending = transfer.status === "draft"; const own = transfer.createdByUserId === workspace.identity.userId; const atDestination = transfer.toLocationId === workspace.activeLocation.id; return <div key={transfer.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><ArrowRightLeft className="size-4 text-[var(--ink-faint)]" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{transfer.fromLocationName} → {transfer.toLocationName}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{transfer.lines.length} lines · submitted by {transfer.createdBy} · {dateTimeLabel(transfer.createdAt, model.timeZone)}{pending && own ? " · another reviewer required" : ""}</span></span><StatusPill tone={statusTone[transfer.status] ?? (pending ? "warning" : "neutral")}>{pending ? "Pending review" : sentenceCase(transfer.status)}</StatusPill>{pending ? <Button size="sm" variant={atDestination && !own ? "accent" : "secondary"} onClick={() => openMutationDialog({ kind: "transfer-review", requestId: crypto.randomUUID(), transfer })}>{atDestination && !own ? "Review receipt" : "View"}<ChevronRight className="size-3.5" /></Button> : null}</div>; })}</div> : <EmptyState icon={<ArrowRightLeft className="size-4" />} title="No location transfers" detail={model.locations.length > 1 ? "Submit a source-location transfer for destination review." : "No other RLS-visible active location is available as a destination."} />}
            </section>
          ) : null}

          {activeTab === "vendors" ? (
            <section className="mt-5">
              <SectionHeading title="Vendors & prices" detail="Active vendors, stored terms, and the latest recorded food prices." />
              {model.vendors.length ? <div className="grid gap-4 md:grid-cols-2">{model.vendors.map((vendor) => { const prices = (model.catalog?.vendorItems ?? []).filter((item) => item.vendorId === vendor.id && item.isActive && item.lastPriceCents !== null); return <div key={vendor.id} className="rounded-[18px] border border-[var(--line)] p-4"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><PackageOpen className="size-4 text-[var(--ink-faint)]" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{vendor.name}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{[vendor.contactName, vendor.paymentTerms].filter(Boolean).join(" · ") || "No contact or terms recorded"}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ink-soft)]">{vendor.email ? <a className="hover:text-[var(--accent-strong)]" href={`mailto:${vendor.email}`}>{vendor.email}</a> : null}{vendor.phone ? <a className="hover:text-[var(--accent-strong)]" href={`tel:${vendor.phone}`}>{vendor.phone}</a> : null}</div></div><StatusPill tone="positive">Active</StatusPill></div><div className="mt-4 border-t border-[var(--line)] pt-3">{prices.length ? prices.map((price) => { const item = model.catalog?.items.find((candidate) => candidate.id === price.inventoryItemId); const unit = model.catalog?.units.find((candidate) => candidate.id === price.purchaseUnitId); return <div key={price.id} className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-0"><span className="min-w-0 flex-1 truncate text-xs font-semibold">{item?.name ?? "Inventory item"}</span><span className="numeric text-[13px] font-semibold">{formatMoney(price.lastPriceCents!, model.currencyCode)} <span className="font-normal text-[var(--ink-faint)]">/{unit?.symbol ?? "unit"}</span></span></div>; }) : <p className="text-xs text-[var(--ink-faint)]">No current item prices recorded.</p>}</div></div>; })}</div> : <EmptyState icon={<PackageOpen className="size-4" />} title="No active vendors" detail="Active vendors in this organization will appear here." />}
            </section>
          ) : null}

          {activeTab === "recipes" ? (
            <section className="mt-5">
              <SectionHeading
                title="Recipe costing"
                detail="Edit recipe specs here. Ingredient prices and opening stock remain available in Setup."
                action={canManageRecipes && model.catalog ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setActiveTab("catalog")}>Costs & stock</Button><Button size="sm" variant="accent" disabled={!model.catalog.units.some((unit) => unit.isActive)} onClick={() => setRecipeDialog({ requestId: crypto.randomUUID() })}><Plus className="size-3.5" />New recipe</Button></div> : undefined}
              />
              {model.recipes.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{model.recipes.map((recipe) => { const editableRecipe = model.catalog?.recipes.find((candidate) => candidate.id === recipe.id); return <article key={recipe.id} className="group rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 transition hover:border-[var(--line-strong)] hover:bg-[var(--paper-strong)]"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><UtensilsCrossed className="size-4 text-[var(--ink-faint)]" /></span><div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold">{recipe.name}</h4><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Yields {quantityLabel(recipe.yieldQuantity)} {recipe.yieldUnit} · {recipe.ingredientCount} ingredients</p></div>{canManageRecipes && editableRecipe ? <button type="button" aria-label={`Edit ${recipe.name}`} onClick={() => setRecipeDialog({ requestId: crypto.randomUUID(), record: editableRecipe })} className="focus-ring flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink-faint)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"><Pencil className="size-4" /></button> : null}</div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4"><div><p className="text-[12px] text-[var(--ink-faint)]">Ingredient cost</p><p className="numeric mt-1 text-sm font-semibold">{formatMoney(recipe.knownCostCents, model.currencyCode)}</p></div><div><p className="text-[12px] text-[var(--ink-faint)]">Menu price</p><p className="numeric mt-1 text-sm font-semibold">{recipe.menuPriceCents === null ? "—" : formatMoney(recipe.menuPriceCents, model.currencyCode)}</p></div></div><div className="mt-4 flex items-center justify-between"><span className="text-[12px] text-[var(--ink-faint)]">Cost coverage</span><StatusPill tone={recipe.missingCostCount ? "warning" : "positive"}>{recipe.missingCostCount ? `${recipe.missingCostCount} missing` : "Complete"}</StatusPill></div></article>; })}</div> : <EmptyState icon={<UtensilsCrossed className="size-4" />} title="No active recipes" detail="Create a recipe draft, then add ingredients when the inventory catalog is ready." />}
            </section>
          ) : null}

          {activeTab === "waste" ? (
            <section className="mt-5">
              <SectionHeading title="Waste log" detail="Observed waste stays pending until a different manager approves or rejects it." action={canWasteCreate ? <Button size="sm" variant="accent" disabled={!model.items.length} onClick={() => openMutationDialog({ kind: "waste", requestId: crypto.randomUUID() })}><Plus className="size-3.5" />Record waste</Button> : undefined} />
              {model.waste.length ? <div className="border-y border-[var(--line)]">{model.waste.map((record) => { const pending = ["pending", "in_review"].includes(record.status); return <div key={record.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]"><Trash2 className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{record.itemName} · {record.recordedBy}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{quantityLabel(record.quantity)} {record.unitSymbol} · {sentenceCase(record.reasonCode)} · {dateTimeLabel(record.occurredAt, model.timeZone)}</span>{record.notes ? <span className="mt-1 block truncate text-xs text-[var(--ink-soft)]">{record.notes}</span> : null}</span><span className="numeric text-xs font-semibold">{record.estimatedCostCents === null ? "—" : formatMoney(record.estimatedCostCents, model.currencyCode)}</span><StatusPill tone={statusTone[record.status] ?? "neutral"}>{sentenceCase(record.status)}</StatusPill>{pending ? <Button size="sm" variant="secondary" onClick={() => openMutationDialog({ kind: "waste-review", requestId: crypto.randomUUID(), record })}>Review<ChevronRight className="size-3.5" /></Button> : null}</div>; })}</div> : <EmptyState icon={<Trash2 className="size-4" />} title="No waste records" detail="Record a factual observation to start an independent review." />}
            </section>
          ) : null}

          {activeTab === "catalog" ? (
            <InventoryCatalogWorkspace model={model} workspace={workspace} />
          ) : null}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {countOpen ? <CountDialog key="count" model={model} values={countValues} notes={countNotes} notice={notice} busy={busy} onValueChange={(itemId, value) => setCountValues((current) => ({ ...current, [itemId]: value }))} onNotesChange={setCountNotes} onClose={() => { if (!busy) { setCountOpen(false); setCountSubmissionId(null); } }} onSubmit={submitCount} /> : null}
        {selectedCount ? <ReviewDialog key="review" count={selectedCount} model={model} currentUserId={workspace.identity.userId} note={reviewNote} notice={notice} busy={busy} onNoteChange={setReviewNote} onClose={() => { if (!busy) { setSelectedCountId(null); setCountReviewRequestId(null); } }} onDecision={(approve) => void decideCount(approve)} /> : null}
        {mutationDialog ? <InventoryMutationDialog key={`${mutationDialog.kind}:${mutationDialog.requestId}`} dialog={mutationDialog} workspace={workspace} model={model} busy={busy} notice={notice} returnFocus={mutationReturnFocus} onClose={() => { if (!busy) { setMutationDialog(null); setMutationReturnFocus(null); } }} onError={setNotice} onRun={runMutation} /> : null}
        {recipeDialog && model.catalog ? <RecipeEditorDialog key={recipeDialog.requestId} dialog={{ kind: "recipe", ...recipeDialog }} catalog={model.catalog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={() => { if (!busy) setRecipeDialog(null); }} onError={setNotice} onSave={saveRecipe} /> : null}
      </AnimatePresence>
    </PageFrame>
  );
}
