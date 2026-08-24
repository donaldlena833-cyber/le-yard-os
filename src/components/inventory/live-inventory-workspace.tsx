"use client";

import { AnimatePresence, motion } from "motion/react";
import {
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
  reviewDeliveryExceptionsAction,
  reviewPurchaseOrderAction,
  reviewInventoryTransferAction,
  reviewWasteRecordAction,
  submitInventoryCountAction,
  submitWasteRecordAction,
} from "@/app/actions/workflows/inventory";
import { ObjectActionBar } from "@/components/actions/object-action-bar";
import { useConnectivity } from "@/components/providers/connectivity-provider";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  InventoryCatalogWorkspace,
  RecipeEditorDialog,
  type RecipeRecord,
} from "@/components/inventory/inventory-catalog-workspace";
import { InventoryModalFrame } from "@/components/inventory/inventory-modal-frame";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import {
  Metric,
  PageFrame,
  PageHeader,
  SectionHeading,
} from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type {
  LiveInventoryCount,
  LiveInventoryModel,
  LiveInventoryTransfer,
  LivePurchaseOrder,
  LiveWasteRecord,
} from "@/data/read-models/inventory";
import {
  localDateTimeParts,
  zonedLocalToIso,
} from "@/data/read-models/local-time";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  resolveWorkMode,
  type ActionResolutionContext,
} from "@/lib/actions/action-registry";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";
import { hasCapability } from "@/lib/permissions/capabilities";
import {
  parseInventoryMoneyToCents,
  parseInventoryQuantity,
} from "@/lib/inventory/input-parsing";
import {
  createInventoryCountDraft,
  readInventoryCountDraft,
} from "@/lib/inventory/count-draft";
import { getCommandAvailability } from "@/lib/connectivity/command-availability";
import { cn, formatMoney } from "@/lib/utils";

type Tab =
  | "stock"
  | "count"
  | "orders"
  | "transfers"
  | "vendors"
  | "recipes"
  | "waste"
  | "catalog";

function localDraftGet(key: string) {
  try {
    return window.localStorage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function localDraftSet(key: string, value: string) {
  try {
    window.localStorage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

function localDraftRemove(key: string) {
  try {
    window.localStorage?.removeItem?.(key);
  } catch {
    // A blocked storage API must not block the live count workflow.
  }
}

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

const inventoryRealtimeBindings = [
  { table: "inventory_counts", scope: "location" },
  { table: "inventory_transactions", scope: "location" },
  { table: "purchase_orders", scope: "location" },
  { table: "deliveries", scope: "location" },
  { table: "waste_records", scope: "location" },
  { table: "inventory_transfers", scope: "organization" },
] satisfies readonly RealtimeInvalidationBinding[];

const statusTone: Record<
  string,
  "neutral" | "positive" | "warning" | "danger"
> = {
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
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(
    value,
  );
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

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <ReadState
      compact
      state="empty"
      title={title}
      description={detail}
      icon={icon}
      className="rounded-none border-x-0 shadow-none"
    />
  );
}

function CountDialog({
  model,
  values,
  notes,
  notice,
  busy,
  networkAvailable,
  onValueChange,
  onNotesChange,
  onClose,
  onSaveClose,
  onDiscard,
  onSubmit,
}: {
  model: LiveInventoryModel;
  values: Record<string, string>;
  notes: string;
  notice: string;
  busy: boolean;
  networkAvailable: boolean;
  onValueChange: (itemId: string, value: string) => void;
  onNotesChange: (value: string) => void;
  onClose: () => void;
  onSaveClose: () => void;
  onDiscard: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const completed = model.items.filter((item) =>
    values[item.id]?.trim(),
  ).length;
  return (
    <ModalFrame
      title="Full inventory count"
      description="Enter every active tracked item in its base unit. This is a blind count: expected stock and variance are revealed only to the independent reviewer."
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
          <StatusPill
            tone={completed === model.items.length ? "positive" : "warning"}
            dot
          >
            {completed === model.items.length
              ? "Ready to submit"
              : "Count in progress"}
          </StatusPill>
        </div>
        <div
          data-inventory-count-scroll
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1.3fr)_minmax(112px,.7fr)] gap-4 border-b border-[var(--line)] bg-[var(--paper-strong)] px-7 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase sm:grid">
            <span>Item</span>
            <span>Counted</span>
          </div>
          {model.items.map((item) => {
            const raw = values[item.id] ?? "";
            return (
              <div
                data-inventory-count-row
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(112px,.7fr)] sm:gap-4 sm:px-7"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{item.name}</p>
                  <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
                    {item.category} · {item.unitSymbol}
                  </p>
                </div>
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
                  onChange={(event) =>
                    onValueChange(item.id, event.target.value)
                  }
                  className="numeric h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-right text-sm font-semibold outline-none transition-colors focus:border-[var(--accent)]"
                />
              </div>
            );
          })}
          <div className="grid gap-4 px-4 py-5 sm:px-7">
            <label>
              <span className="mb-1.5 block text-xs font-semibold">
                Count note
              </span>
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
              <span>
                Submitting creates a pending count only. On-hand stock changes
                after a different manager approves it. This device saves the
                unfinished draft automatically.
              </span>
            </div>
            {notice ? (
              <div
                aria-live="polite"
                className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] px-3.5 py-3 text-xs leading-4 text-[var(--warning)]"
              >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {notice}
              </div>
            ) : null}
          </div>
        </div>
        <div
          data-inventory-count-actions
          className="flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--paper-strong)] px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-10px_28px_rgba(25,28,24,.08)] sm:justify-end sm:px-7 sm:py-4"
        >
          <Button
            className="flex-1 sm:flex-none"
            variant="quiet"
            disabled={busy}
            onClick={onDiscard}
          >
            Discard draft
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            variant="quiet"
            disabled={busy}
            onClick={onSaveClose}
          >
            Save & close
          </Button>
          <Button
            className="flex-[1.6] sm:flex-none"
            type="submit"
            variant="accent"
            disabled={busy || !networkAvailable || completed !== model.items.length}
            aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
            title={!networkAvailable ? "Reconnect before submitting this count." : undefined}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ClipboardCheck className="size-4" />
            )}
            Submit for review
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}

function CountDraftDismissDialog({
  open,
  busy,
  onContinue,
  onDiscard,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  onContinue: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onContinue}
      labelledBy="inventory-count-draft-dismiss-title"
      role="alertdialog"
      initialFocusSelector="[data-count-draft-continue]"
      position="responsive-sheet"
      className="max-w-lg rounded-b-none sm:rounded-[22px]"
    >
      <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
        <h2 id="inventory-count-draft-dismiss-title" className="text-lg font-semibold">
          Leave this count?
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-faint)]">
          Choose whether to keep the unfinished count on this device, discard it,
          or continue counting. No inventory has changed.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button
          data-count-draft-continue
          variant="secondary"
          disabled={busy}
          onClick={onContinue}
        >
          Continue counting
        </Button>
        <Button variant="danger" disabled={busy} onClick={onDiscard}>
          Discard & close
        </Button>
        <Button variant="accent" disabled={busy} onClick={onSave}>
          Save draft & close
        </Button>
      </div>
    </Modal>
  );
}

function ReviewDialog({
  count,
  model,
  currentUserId,
  note,
  notice,
  busy,
  networkAvailable,
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
  networkAvailable: boolean;
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
        <StatusPill
          tone={statusTone[count.status] ?? "neutral"}
          dot={isPending}
        >
          {sentenceCase(count.status)}
        </StatusPill>
        <span className="text-xs text-[var(--ink-faint)]">
          {count.lines.length} recorded lines
        </span>
      </div>
      <div className="max-h-[46svh] overflow-auto">
        <div className="sticky top-0 z-10 grid min-w-[590px] grid-cols-[1.2fr_.55fr_.55fr_.55fr] gap-4 border-b border-[var(--line)] bg-[var(--paper-strong)] px-5 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase sm:px-7">
          <span>Item</span>
          <span>Expected</span>
          <span>Counted</span>
          <span>Variance</span>
        </div>
        {count.lines.map((line) => {
          const item = itemById.get(line.inventoryItemId);
          const variance =
            line.expectedQuantity === null
              ? null
              : line.countedQuantity - line.expectedQuantity;
          return (
            <div
              key={line.id}
              className="grid min-w-[590px] grid-cols-[1.2fr_.55fr_.55fr_.55fr] items-center gap-4 border-b border-[var(--line)] px-5 py-3 sm:px-7"
            >
              <div>
                <p className="text-xs font-semibold">
                  {item?.name ?? "Inventory item"}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {item?.unitSymbol ?? "unit"}
                </p>
              </div>
              <span className="numeric text-xs text-[var(--ink-faint)]">
                {line.expectedQuantity === null
                  ? "—"
                  : quantityLabel(line.expectedQuantity)}
              </span>
              <span className="numeric text-xs font-semibold">
                {quantityLabel(line.countedQuantity)}
              </span>
              <span
                className={cn(
                  "numeric text-xs font-semibold",
                  variance === null || variance === 0
                    ? "text-[var(--ink-faint)]"
                    : variance < 0
                      ? "text-[var(--danger)]"
                      : "text-[var(--positive)]",
                )}
              >
                {variance === null ? "—" : quantityLabel(variance)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 px-5 py-5 sm:px-7">
        {count.notes ? (
          <div>
            <p className="text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">
              Counter note
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
              {count.notes}
            </p>
          </div>
        ) : null}
        {isPending ? (
          <>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">
                Reviewer note
              </span>
              <textarea
                rows={3}
                maxLength={2_000}
                value={note}
                disabled={busy || !networkAvailable || isOwnCount}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Optional decision context"
                className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-55"
              />
            </label>
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl p-3.5 text-xs leading-4",
                isOwnCount
                  ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                  : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]",
              )}
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                {isOwnCount
                  ? "You submitted this count. A different manager must review it."
                  : "Approval posts one append-only count adjustment per changed item. Rejection leaves on-hand stock unchanged."}
              </span>
            </div>
            {notice ? (
              <div
                aria-live="polite"
                className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] px-3.5 py-3 text-xs leading-4 text-[var(--warning)]"
              >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {notice}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="quiet" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || !networkAvailable || isOwnCount}
                aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
                onClick={() => onDecision(false)}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                Reject
              </Button>
              <Button
                variant="accent"
                disabled={busy || !networkAvailable || isOwnCount}
                aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
                onClick={() => onDecision(true)}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Approve & post
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3.5 text-xs leading-4 text-[var(--ink-faint)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>
              {count.approvedBy && count.approvedAt
                ? `${sentenceCase(count.status)} by ${count.approvedBy} on ${dateTimeLabel(count.approvedAt, model.timeZone)}.`
                : "This review is complete and its evidence is locked."}
            </span>
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

type InventoryMutationDialog =
  | { kind: "purchase-order"; requestId: string }
  | {
      kind: "purchase-order-review";
      requestId: string;
      order: LivePurchaseOrder;
    }
  | { kind: "delivery"; requestId: string; order: LivePurchaseOrder }
  | { kind: "delivery-exception-review"; requestId: string; postingRequestId: string; delivery: LiveInventoryModel["deliveries"][number] }
  | { kind: "waste"; requestId: string; itemId?: string }
  | { kind: "waste-review"; requestId: string; record: LiveWasteRecord }
  | { kind: "transfer"; requestId: string; itemId?: string }
  | {
      kind: "transfer-review";
      requestId: string;
      transfer: LiveInventoryTransfer;
    };

interface MutationLineDraft {
  key: string;
  inventoryItemId: string;
  unitId: string;
  quantity: string;
  acceptedQuantity: string;
  unitPrice: string;
  exceptionKind: "none" | "damaged" | "rejected" | "substituted" | "missing" | "unexpected" | "short" | "over";
  exceptionNote: string;
}

interface DeliveryPostingReview {
  deliveredAt: string;
  invoiceNumber: string | null;
  notes: string | null;
  lines: Array<{
    inventoryItemId: string;
    unitId: string;
    quantity: number;
    acceptedQuantity: number;
    unitPriceCents: number;
    lotCode: null;
    expiresOn: null;
    exceptionKind: MutationLineDraft["exceptionKind"];
    exceptionNote: string | null;
  }>;
}

const inventoryFieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-55";
const inventoryTextAreaClass =
  "w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-55";

function InventoryField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold">{label}</span>
      {children}
    </label>
  );
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
        <div>
          <p className="text-xs font-semibold">Line items</p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            Units are limited to this tenant’s verified base units and
            conversions.
          </p>
        </div>
        {onAdd ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || !model.items.length}
            onClick={onAdd}
          >
            <Plus className="size-3.5" />
            Add line
          </Button>
        ) : null}
      </div>
      <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {lines.map((line, index) => {
          const units = compatibleUnits(model, line.inventoryItemId);
          return (
            <div
              key={line.key}
              className="grid gap-3 py-4 lg:grid-cols-[1.2fr_.65fr_.55fr_.55fr_auto] lg:items-end"
            >
              <InventoryField label="Item">
                <select
                  aria-label={`Item ${index + 1}`}
                  value={line.inventoryItemId}
                  disabled={busy || mode === "delivery"}
                  onChange={(event) => {
                    const item = model.items.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    onChange(line.key, {
                      inventoryItemId: event.target.value,
                      unitId: item?.baseUnitId ?? "",
                    });
                  }}
                  className={inventoryFieldClass}
                >
                  {model.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </InventoryField>
              <InventoryField label="Unit">
                <select
                  aria-label={`Unit ${index + 1}`}
                  value={line.unitId}
                  disabled={busy || mode === "delivery"}
                  onChange={(event) =>
                    onChange(line.key, { unitId: event.target.value })
                  }
                  className={inventoryFieldClass}
                >
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.symbol})
                    </option>
                  ))}
                </select>
              </InventoryField>
              <InventoryField
                label={
                  mode === "delivery"
                    ? "Delivered"
                    : mode === "transfer"
                      ? "Send"
                      : "Quantity"
                }
              >
                <input
                  aria-label={`${mode === "transfer" ? "Send" : mode === "delivery" ? "Delivered" : "Order"} quantity ${index + 1}`}
                  required
                  inputMode="decimal"
                  value={line.quantity}
                  disabled={busy}
                  onChange={(event) =>
                    onChange(line.key, {
                      quantity: event.target.value,
                      ...(mode === "delivery"
                        ? { acceptedQuantity: event.target.value }
                        : {}),
                    })
                  }
                  className={inventoryFieldClass}
                />
              </InventoryField>
              {mode === "transfer" ? (
                <span className="hidden lg:block" />
              ) : mode === "delivery" ? (
                <InventoryField label="Accepted">
                  <input
                    aria-label={`Accepted quantity ${index + 1}`}
                    required
                    inputMode="decimal"
                    value={line.acceptedQuantity}
                    disabled={busy}
                    onChange={(event) =>
                      onChange(line.key, {
                        acceptedQuantity: event.target.value,
                      })
                    }
                    className={inventoryFieldClass}
                  />
                </InventoryField>
              ) : (
                <InventoryField label="Unit price">
                  <input
                    aria-label={`Unit price ${index + 1}`}
                    required
                    inputMode="decimal"
                    value={line.unitPrice}
                    disabled={busy}
                    onChange={(event) =>
                      onChange(line.key, { unitPrice: event.target.value })
                    }
                    className={inventoryFieldClass}
                    placeholder="0.00"
                  />
                </InventoryField>
              )}
              {mode === "delivery" ? (
                <InventoryField label="Unit price">
                  <input
                    aria-label={`Delivered unit price ${index + 1}`}
                    required
                    inputMode="decimal"
                    value={line.unitPrice}
                    disabled={busy}
                    onChange={(event) =>
                      onChange(line.key, { unitPrice: event.target.value })
                    }
                    className={inventoryFieldClass}
                  />
                </InventoryField>
              ) : onRemove && lines.length > 1 ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  disabled={busy}
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => onRemove(line.key)}
                >
                  <X className="size-4" />
                </Button>
              ) : (
                <span className="hidden lg:block" />
              )}
              {mode === "delivery" ? (
                <div className="grid gap-3 lg:col-span-5 lg:grid-cols-[.65fr_1.85fr]">
                  <InventoryField label="Receiving condition">
                    <select
                      aria-label={`Receiving condition ${index + 1}`}
                      value={line.exceptionKind}
                      disabled={busy}
                      onChange={(event) =>
                        onChange(line.key, {
                          exceptionKind: event.target.value as MutationLineDraft["exceptionKind"],
                          exceptionNote: event.target.value === "none" ? "" : line.exceptionNote,
                        })
                      }
                      className={inventoryFieldClass}
                    >
                      <option value="none">Matches order</option>
                      <option value="short">Short</option>
                      <option value="over">Over</option>
                      <option value="damaged">Damaged</option>
                      <option value="rejected">Rejected</option>
                      <option value="substituted">Substituted</option>
                      <option value="missing">Missing</option>
                      <option value="unexpected">Unexpected</option>
                    </select>
                  </InventoryField>
                  <InventoryField label="Exception evidence">
                    <input
                      aria-label={`Receiving exception note ${index + 1}`}
                      required={line.exceptionKind !== "none"}
                      maxLength={2_000}
                      value={line.exceptionNote}
                      disabled={busy || line.exceptionKind === "none"}
                      placeholder={line.exceptionKind === "none" ? "No exception" : "Describe damage, substitution, or quantity discrepancy"}
                      onChange={(event) => onChange(line.key, { exceptionNote: event.target.value })}
                      className={inventoryFieldClass}
                    />
                  </InventoryField>
                </div>
              ) : null}
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
  networkAvailable,
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
  networkAvailable: boolean;
  notice: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  onError: (message: string) => void;
  onRun: (
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) => Promise<boolean>;
}) {
  const selectedItemId =
    dialog.kind === "waste" || dialog.kind === "transfer"
      ? dialog.itemId
      : undefined;
  const firstItem =
    model.items.find((item) => item.id === selectedItemId) ?? model.items[0];
  const now = localDateTimeParts(new Date().toISOString(), model.timeZone);
  const order = dialog.kind === "delivery" ? dialog.order : null;
  const [lines, setLines] = useState<MutationLineDraft[]>(() => {
    if (order) {
      return order.lines
        .map((line) => ({
          ...line,
          remaining: Math.max(0, line.quantity - line.receivedQuantity),
        }))
        .filter((line) => line.remaining > 0)
        .map((line) => ({
          key: line.id,
          inventoryItemId: line.inventoryItemId,
          unitId: line.unitId,
          quantity: quantityInputValue(line.remaining),
          acceptedQuantity: quantityInputValue(line.remaining),
          unitPrice: (line.unitPriceCents / 100).toFixed(2),
          exceptionKind: "none" as const,
          exceptionNote: "",
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
        exceptionKind: "none" as const,
        exceptionNote: "",
      }));
    }
    return firstItem
      ? [
          {
            key: crypto.randomUUID(),
            inventoryItemId: firstItem.id,
            unitId: firstItem.baseUnitId,
            quantity: "",
            acceptedQuantity: "",
            unitPrice: "",
            exceptionKind: "none",
            exceptionNote: "",
          },
        ]
      : [];
  });
  const [wasteItemId, setWasteItemId] = useState(firstItem?.id ?? "");
  const [deliveryReview, setDeliveryReview] = useState<DeliveryPostingReview | null>(null);

  function updateLine(key: string, patch: Partial<MutationLineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }
  function addLine() {
    if (!firstItem) return;
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        inventoryItemId: firstItem.id,
        unitId: firstItem.baseUnitId,
        quantity: "",
        acceptedQuantity: "",
        unitPrice: "",
        exceptionKind: "none",
        exceptionNote: "",
      },
    ]);
  }
  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }
  function parsedLineValues(mode: "order" | "delivery" | "transfer") {
    const parsed = lines.map((line) => ({
      ...line,
      parsedQuantity: parseInventoryQuantity(line.quantity),
      parsedAccepted:
        mode === "delivery"
          ? parseInventoryQuantity(line.acceptedQuantity, { allowZero: true })
          : null,
      parsedPrice:
        mode === "transfer" ? null : parseInventoryMoneyToCents(line.unitPrice),
    }));
    if (
      parsed.some(
        (line) =>
          line.parsedQuantity === null ||
          (mode === "delivery" &&
            (line.parsedAccepted === null ||
              line.parsedAccepted > line.parsedQuantity!)) ||
          (mode !== "transfer" && line.parsedPrice === null),
      )
    ) {
      onError(
        "Use positive quantities with up to four decimals and money with up to two decimals. Accepted quantity cannot exceed delivered quantity.",
      );
      return null;
    }
    return parsed;
  }

  if (dialog.kind === "purchase-order-review") {
    const reviewOrder = dialog.order;
    const own = reviewOrder.createdByUserId === workspace.identity.userId;
    const decide = async (approve: boolean, form: HTMLFormElement) => {
      const note = String(new FormData(form).get("note") || "") || null;
      const succeeded = await onRun(
        approve
          ? "Purchase order independently approved and unlocked for receiving."
          : "Purchase order rejected and cancelled; it cannot be received.",
        () =>
          reviewPurchaseOrderAction({
            requestId: dialog.requestId,
            purchaseOrderId: reviewOrder.id,
            approve,
            note,
          }),
      );
      if (succeeded) onClose();
    };
    return (
      <ModalFrame
        title="Review purchase order"
        description={`${reviewOrder.vendorName} · ${reviewOrder.poNumber} · created by ${reviewOrder.createdBy}.`}
        labelledBy="purchase-order-review-dialog"
        notice={notice}
        onClose={onClose}
        returnFocus={returnFocus}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void decide(true, event.currentTarget);
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="grid grid-cols-2 divide-x divide-[var(--line)] border-y border-[var(--line)]">
              <Metric
                label="Total"
                value={formatMoney(reviewOrder.totalCents, model.currencyCode)}
                detail={`${reviewOrder.lineCount} lines`}
              />
              <Metric
                label="Expected"
                value={dateLabel(reviewOrder.expectedOn)}
                detail={reviewOrder.vendorName}
              />
            </div>
            <InventoryField label="Review note">
              <textarea
                name="note"
                rows={4}
                maxLength={2_000}
                disabled={busy || !networkAvailable || own}
                className={inventoryTextAreaClass}
              />
            </InventoryField>
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl p-3 text-xs leading-4",
                own
                  ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                  : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]",
              )}
            >
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              {own
                ? "You created this order. A different approver must review it."
                : "Approval unlocks receiving. Rejection cancels the order. Both decisions remain in the audit trail."}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy || !networkAvailable || own}
                onClick={(event) =>
                  void decide(false, event.currentTarget.form!)
                }
              >
                Reject & cancel
              </Button>
              <Button type="submit" variant="accent" disabled={busy || !networkAvailable || own} aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}>
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Approve for receiving
              </Button>
            </div>
          </div>
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "delivery-exception-review") {
    const delivery = dialog.delivery;
    const own = delivery.receivedByUserId === workspace.identity.userId;
    const decide = async (approve: boolean, form: HTMLFormElement) => {
      const succeeded = await onRun(
        approve
          ? "Receiving exceptions approved; the corrective delivery posted once."
          : "Receiving exceptions rejected; disputed stock was not posted.",
        () => reviewDeliveryExceptionsAction({
          requestId: dialog.requestId,
          postingRequestId: dialog.postingRequestId,
          deliveryId: delivery.id,
          approve,
          note: String(new FormData(form).get("note") || "") || null,
        }),
      );
      if (succeeded) onClose();
    };
    return (
      <ModalFrame
        title="Review receiving exceptions"
        description={`${delivery.vendorName}${delivery.poNumber ? ` · ${delivery.poNumber}` : ""} · received by ${delivery.receivedBy}.`}
        labelledBy="delivery-exception-review-dialog"
        notice={notice}
        onClose={onClose}
      >
        <form onSubmit={(event) => { event.preventDefault(); void decide(true, event.currentTarget); }}>
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {(delivery.exceptions ?? []).map((exception) => (
                <div key={`${exception.inventoryItemId}:${exception.kind}`} className="grid gap-1 py-3 text-xs sm:grid-cols-[1fr_auto]">
                  <span><strong>{exception.itemName}</strong> · {sentenceCase(exception.kind)}</span>
                  <span className="numeric">Proposed {quantityLabel(exception.proposedAcceptedQuantity)} {exception.unitSymbol}</span>
                  <span className="text-[var(--ink-faint)] sm:col-span-2">{exception.note}</span>
                </div>
              ))}
            </div>
            <InventoryField label="Review note">
              <textarea name="note" rows={3} maxLength={2_000} disabled={busy || own} className={inventoryTextAreaClass} />
            </InventoryField>
            <div className={cn("rounded-xl p-3 text-xs", own ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>
              {own ? "A different authorized receiver must review your exception evidence." : "Approval creates a separate linked corrective delivery. Rejection preserves zero posted quantity for every exception line."}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button variant="danger" disabled={busy || !networkAvailable || own} onClick={(event) => void decide(false, event.currentTarget.form!)}>Reject</Button>
              <Button type="submit" variant="accent" disabled={busy || !networkAvailable || own} aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}>Approve & post correction</Button>
            </div>
          </div>
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "purchase-order") {
    return (
      <ModalFrame
        returnFocus={returnFocus}
        title="Create purchase order"
        description="Create an internal, tenant-scoped order. This records the order but does not transmit it to the vendor."
        labelledBy="purchase-order-dialog"
        notice={notice}
        onClose={onClose}
        width="max-w-5xl"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = parsedLineValues("order");
            if (!parsed) return;
            const form = new FormData(event.currentTarget);
            const taxCents = parseInventoryMoneyToCents(
              String(form.get("tax") ?? ""),
            );
            const shippingCents = parseInventoryMoneyToCents(
              String(form.get("shipping") ?? ""),
            );
            if (taxCents === null || shippingCents === null)
              return onError(
                "Tax and shipping must be non-negative amounts with up to two decimals.",
              );
            const succeeded = await onRun(
              "Purchase order created. It is ready for receiving; no vendor message was sent.",
              () =>
                createPurchaseOrderAction({
                  requestId: dialog.requestId,
                  locationId: workspace.activeLocation.id,
                  vendorId: String(form.get("vendorId")),
                  poNumber: String(form.get("poNumber")),
                  orderedOn: String(form.get("orderedOn") || "") || null,
                  expectedOn: String(form.get("expectedOn") || "") || null,
                  taxCents,
                  shippingCents,
                  notes: String(form.get("notes") || "") || null,
                  lines: parsed.map((line) => ({
                    inventoryItemId: line.inventoryItemId,
                    unitId: line.unitId,
                    quantity: line.parsedQuantity!,
                    unitPriceCents: line.parsedPrice!,
                    notes: null,
                  })),
                }),
            );
            if (succeeded) onClose();
          }}
        >
          <div className="grid gap-5 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <InventoryField label="Vendor">
                <select
                  name="vendorId"
                  required
                  autoFocus
                  className={inventoryFieldClass}
                >
                  {model.vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </InventoryField>
              <InventoryField label="PO number">
                <input
                  name="poNumber"
                  required
                  maxLength={80}
                  placeholder="e.g. PO-20260801-01"
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label="Ordered on">
                <input
                  name="orderedOn"
                  type="date"
                  defaultValue={model.date}
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label="Expected on">
                <input
                  name="expectedOn"
                  type="date"
                  min={model.date}
                  className={inventoryFieldClass}
                />
              </InventoryField>
            </div>
            <InventoryLineEditor
              model={model}
              lines={lines}
              busy={busy}
              mode="order"
              onChange={updateLine}
              onAdd={addLine}
              onRemove={removeLine}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <InventoryField label={`Tax · ${model.currencyCode}`}>
                <input
                  name="tax"
                  inputMode="decimal"
                  defaultValue="0.00"
                  required
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label={`Shipping · ${model.currencyCode}`}>
                <input
                  name="shipping"
                  inputMode="decimal"
                  defaultValue="0.00"
                  required
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label="Order note">
                <input
                  name="notes"
                  maxLength={4_000}
                  className={inventoryFieldClass}
                />
              </InventoryField>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Subtotal is recalculated from exact quantity × integer-cent prices
              in the database. The actor and request evidence are
              server-derived.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                disabled={busy || !networkAvailable || !model.vendors.length || !lines.length}
                aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ShoppingCart className="size-4" />
                )}
                Create order
              </Button>
            </div>
          </div>
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "delivery") {
    const postDelivery = async () => {
      if (!deliveryReview) return;
      const succeeded = await onRun(
        "Delivery received. Accepted quantities and vendor prices were posted once.",
        () =>
          receiveInventoryDeliveryAction({
            requestId: dialog.requestId,
            locationId: workspace.activeLocation.id,
            vendorId: order!.vendorId,
            purchaseOrderId: order!.id,
            ...deliveryReview,
          }),
      );
      if (succeeded) {
        setDeliveryReview(null);
        onClose();
      }
    };
    const reviewTotalCents = deliveryReview?.lines.reduce(
      (sum, line) => sum + Math.round(line.acceptedQuantity * line.unitPriceCents),
      0,
    ) ?? 0;
    return (
      <>
        <ModalFrame
          title="Receive delivery"
          description={`${order!.poNumber} · ${order!.vendorName}. Review the exact accepted quantities and prices before anything posts to stock.`}
          labelledBy="delivery-dialog"
          notice={notice}
          onClose={onClose}
          width="max-w-5xl"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = parsedLineValues("delivery");
              if (!parsed) return;
              const form = new FormData(event.currentTarget);
              const deliveredAt = localInstant(
                String(form.get("deliveredAt")),
                model.timeZone,
              );
              if (!deliveredAt) {
                onError("The delivery time is invalid in the restaurant timezone.");
                return;
              }
              setDeliveryReview({
                deliveredAt,
                invoiceNumber: String(form.get("invoiceNumber") || "") || null,
                notes: String(form.get("notes") || "") || null,
                lines: parsed.map((line) => ({
                  inventoryItemId: line.inventoryItemId,
                  unitId: line.unitId,
                  quantity: line.parsedQuantity!,
                  acceptedQuantity: line.parsedAccepted!,
                  unitPriceCents: line.parsedPrice!,
                  lotCode: null,
                  expiresOn: null,
                  exceptionKind: line.exceptionKind,
                  exceptionNote: line.exceptionNote.trim() || null,
                })),
              });
            }}
          >
            <div className="grid gap-5 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-3">
              <InventoryField label={`Delivered · ${model.timeZone}`}>
                <input
                  name="deliveredAt"
                  type="datetime-local"
                  required
                  defaultValue={`${now.date}T${now.time}`}
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label="Invoice number">
                <input
                  name="invoiceNumber"
                  maxLength={120}
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label="Receiving note">
                <input
                  name="notes"
                  maxLength={4_000}
                  className={inventoryFieldClass}
                />
              </InventoryField>
            </div>
            <InventoryLineEditor
              model={model}
              lines={lines}
              busy={busy}
              mode="delivery"
              onChange={updateLine}
            />
            <div className="flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/55 p-3 text-xs leading-4 text-[var(--accent-strong)]">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Matching lines post once. Any damaged, short, rejected, substituted,
              or otherwise exceptional line posts zero until a different authorized
              receiver reviews its evidence and approves a linked corrective delivery.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                disabled={busy || !lines.length}
              >
                <ClipboardCheck className="size-4" />
                Review delivery
              </Button>
            </div>
            </div>
          </form>
        </ModalFrame>
        <ConfirmActionDialog
          open={Boolean(deliveryReview)}
          labelledBy="delivery-posting-review-title"
          title="Post this delivery to stock?"
          description="This is the final posting boundary. Confirm the accepted quantities, unit prices, invoice, and exception evidence below."
          confirmLabel="Confirm & post delivery"
          confirmVariant="accent"
          busy={busy}
          confirmDisabled={!networkAvailable}
          onClose={() => setDeliveryReview(null)}
          onConfirm={postDelivery}
        >
          {deliveryReview ? (
            <div className="space-y-4 text-xs">
              <dl className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--canvas)] p-3">
                <div><dt className="text-[var(--ink-faint)]">Purchase order</dt><dd className="mt-1 font-semibold">{order!.poNumber}</dd></div>
                <div><dt className="text-[var(--ink-faint)]">Vendor</dt><dd className="mt-1 font-semibold">{order!.vendorName}</dd></div>
                <div><dt className="text-[var(--ink-faint)]">Delivered</dt><dd className="mt-1 font-semibold">{dateTimeLabel(deliveryReview.deliveredAt, model.timeZone)}</dd></div>
                <div><dt className="text-[var(--ink-faint)]">Invoice</dt><dd className="mt-1 font-semibold">{deliveryReview.invoiceNumber ?? "Not provided"}</dd></div>
              </dl>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--line)]">
                {deliveryReview.lines.map((line) => {
                  const item = model.items.find((candidate) => candidate.id === line.inventoryItemId);
                  const unit = model.units.find((candidate) => candidate.id === line.unitId);
                  return (
                    <div key={`${line.inventoryItemId}:${line.unitId}`} className="border-b border-[var(--line)] p-3 last:border-0">
                      <div className="flex items-start justify-between gap-3"><p className="font-semibold">{item?.name ?? "Inventory item"}</p><p className="numeric font-semibold">{formatMoney(Math.round(line.acceptedQuantity * line.unitPriceCents), model.currencyCode)}</p></div>
                      <p className="mt-1 text-[var(--ink-faint)]">Delivered {quantityLabel(line.quantity)} · accepted {quantityLabel(line.acceptedQuantity)} {unit?.symbol ?? item?.unitSymbol ?? "units"} · {formatMoney(line.unitPriceCents, model.currencyCode)} each</p>
                      {line.exceptionKind !== "none" ? <p className="mt-1 text-[var(--warning)]">{sentenceCase(line.exceptionKind)} · {line.exceptionNote ?? "No exception note"}</p> : null}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--line)] pt-3"><span className="font-semibold">Accepted value posting now</span><span className="numeric text-sm font-semibold">{formatMoney(reviewTotalCents, model.currencyCode)}</span></div>
              <p className="leading-5 text-[var(--warning)]">Accepted quantities update on-hand stock immediately after confirmation. Exceptional lines remain zero-posted pending independent review.</p>
            </div>
          ) : null}
        </ConfirmActionDialog>
      </>
    );
  }

  if (dialog.kind === "waste") {
    return (
      <ModalFrame
        title="Record waste"
        description="Submit observed waste for independent review. Stock does not change until a different manager approves it."
        labelledBy="waste-dialog"
        notice={notice}
        onClose={onClose}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const quantity = parseInventoryQuantity(
              String(form.get("quantity")),
            );
            if (quantity === null)
              return onError(
                "Waste quantity must be positive with no more than four decimal places.",
              );
            const occurredAt = localInstant(
              String(form.get("occurredAt")),
              model.timeZone,
            );
            if (!occurredAt)
              return onError(
                "The waste time is invalid in the restaurant timezone.",
              );
            const succeeded = await onRun(
              "Waste submitted. A different manager must approve it before stock changes.",
              () =>
                submitWasteRecordAction({
                  requestId: dialog.requestId,
                  locationId: workspace.activeLocation.id,
                  inventoryItemId: String(form.get("inventoryItemId")),
                  unitId: String(form.get("unitId")),
                  quantity,
                  reasonCode: String(form.get("reasonCode")),
                  occurredAt,
                  notes: String(form.get("notes") || "") || null,
                }),
            );
            if (succeeded) onClose();
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <InventoryField label="Item">
                <select
                  name="inventoryItemId"
                  required
                  autoFocus
                  value={wasteItemId}
                  onChange={(event) => setWasteItemId(event.target.value)}
                  className={inventoryFieldClass}
                >
                  {model.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </InventoryField>
              <InventoryField label="Unit">
                <select
                  key={wasteItemId}
                  name="unitId"
                  required
                  defaultValue={
                    model.items.find((item) => item.id === wasteItemId)
                      ?.baseUnitId
                  }
                  className={inventoryFieldClass}
                >
                  {compatibleUnits(model, wasteItemId).map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.symbol})
                    </option>
                  ))}
                </select>
              </InventoryField>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <InventoryField label="Quantity">
                <input
                  name="quantity"
                  required
                  inputMode="decimal"
                  className={inventoryFieldClass}
                />
              </InventoryField>
              <InventoryField label="Reason">
                <select
                  name="reasonCode"
                  defaultValue="spoilage"
                  className={inventoryFieldClass}
                >
                  <option value="spoilage">Spoilage</option>
                  <option value="overproduction">Overproduction</option>
                  <option value="damage">Damage</option>
                  <option value="quality">Quality</option>
                  <option value="expired">Expired</option>
                  <option value="other">Other</option>
                </select>
              </InventoryField>
              <InventoryField label={`Occurred · ${model.timeZone}`}>
                <input
                  name="occurredAt"
                  type="datetime-local"
                  required
                  defaultValue={`${now.date}T${now.time}`}
                  className={inventoryFieldClass}
                />
              </InventoryField>
            </div>
            <InventoryField label="Observation note">
              <textarea
                name="notes"
                rows={4}
                maxLength={4_000}
                className={inventoryTextAreaClass}
              />
            </InventoryField>
            <div className="flex items-start gap-3 rounded-xl bg-[var(--warning-soft)] p-3 text-xs leading-4 text-[var(--warning)]">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Estimated cost is derived from canonical price evidence. AI may
              suggest waste, but this form requires a human submission and
              another human’s decision.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                disabled={busy || !networkAvailable || !firstItem}
                aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Submit for review
              </Button>
            </div>
          </div>
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "waste-review") {
    const record = dialog.record;
    const own = record.recordedByUserId === workspace.identity.userId;
    const decide = async (approve: boolean, form: HTMLFormElement) => {
      const note = String(new FormData(form).get("note") || "") || null;
      const succeeded = await onRun(
        approve
          ? "Waste approved and the stock decrement was posted once."
          : "Waste rejected; stock was not changed.",
        () =>
          reviewWasteRecordAction({
            requestId: dialog.requestId,
            wasteRecordId: record.id,
            approve,
            note,
          }),
      );
      if (succeeded) onClose();
    };
    return (
      <ModalFrame
        title="Review waste"
        description={`${record.itemName} · ${quantityLabel(record.quantity)} ${record.unitSymbol} · recorded by ${record.recordedBy}.`}
        labelledBy="waste-review-dialog"
        notice={notice}
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void decide(true, event.currentTarget);
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="grid grid-cols-2 divide-x divide-[var(--line)] border-y border-[var(--line)]">
              <Metric
                label="Estimated cost"
                value={
                  record.estimatedCostCents === null
                    ? "Unknown"
                    : formatMoney(record.estimatedCostCents, model.currencyCode)
                }
                detail={sentenceCase(record.reasonCode)}
              />
              <Metric
                label="Observed"
                value={dateTimeLabel(record.occurredAt, model.timeZone)}
                detail={record.notes ?? "No observation note"}
              />
            </div>
            <InventoryField label="Review note">
              <textarea
                name="note"
                rows={4}
                maxLength={2_000}
                disabled={busy || !networkAvailable || own}
                className={inventoryTextAreaClass}
              />
            </InventoryField>
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl p-3 text-xs leading-4",
                own
                  ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                  : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]",
              )}
            >
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              {own
                ? "You recorded this waste. A different manager must review it."
                : "Approval posts a canonical base-unit decrement; rejection leaves stock unchanged. The decision is immutable."}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy || !networkAvailable || own}
                onClick={(event) =>
                  void decide(false, event.currentTarget.form!)
                }
              >
                <X className="size-4" />
                Reject
              </Button>
              <Button type="submit" variant="accent" disabled={busy || !networkAvailable || own} aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}>
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Approve & post
              </Button>
            </div>
          </div>
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "transfer") {
    const destinations = model.locations.filter(
      (location) => location.id !== workspace.activeLocation.id,
    );
    return (
      <ModalFrame
        title="Create transfer"
        description={`Submit stock from ${workspace.activeLocation.name} for independent review at the destination.`}
        labelledBy="transfer-dialog"
        notice={notice}
        onClose={onClose}
        width="max-w-5xl"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = parsedLineValues("transfer");
            if (!parsed) return;
            const form = new FormData(event.currentTarget);
            const succeeded = await onRun(
              "Transfer submitted. A different destination manager must verify received quantities.",
              () =>
                createInventoryTransferAction({
                  requestId: dialog.requestId,
                  fromLocationId: workspace.activeLocation.id,
                  toLocationId: String(form.get("toLocationId")),
                  notes: String(form.get("notes") || "") || null,
                  lines: parsed.map((line) => ({
                    inventoryItemId: line.inventoryItemId,
                    unitId: line.unitId,
                    sentQuantity: line.parsedQuantity!,
                  })),
                }),
            );
            if (succeeded) onClose();
          }}
        >
          <div className="grid gap-5 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <InventoryField label="Destination">
                <select
                  name="toLocationId"
                  required
                  autoFocus
                  className={inventoryFieldClass}
                >
                  {destinations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </InventoryField>
              <InventoryField label="Transfer note">
                <input
                  name="notes"
                  maxLength={4_000}
                  className={inventoryFieldClass}
                />
              </InventoryField>
            </div>
            <InventoryLineEditor
              model={model}
              lines={lines}
              busy={busy}
              mode="transfer"
              onChange={updateLine}
              onAdd={addLine}
              onRemove={removeLine}
            />
            <div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]">
              <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
              This submits a pending transfer only. Stock moves when a different
              manager at the destination confirms actual received quantities.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                disabled={busy || !networkAvailable || !destinations.length || !lines.length}
                aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowRightLeft className="size-4" />
                )}
                Submit transfer
              </Button>
            </div>
          </div>
        </form>
      </ModalFrame>
    );
  }

  const transfer = dialog.transfer;
  const own = transfer.createdByUserId === workspace.identity.userId;
  const atDestination = transfer.toLocationId === workspace.activeLocation.id;
  const decideTransfer = async (approve: boolean, form: HTMLFormElement) => {
    const parsed = approve
      ? lines.map((line) => ({
          ...line,
          receivedQuantity: parseInventoryQuantity(line.acceptedQuantity, {
            allowZero: true,
          }),
        }))
      : [];
    if (
      approve &&
      parsed.some(
        (line) =>
          line.receivedQuantity === null ||
          line.receivedQuantity > Number(line.quantity),
      )
    )
      return onError(
        "Received quantities must be non-negative, use up to four decimals, and cannot exceed sent quantities.",
      );
    const note = String(new FormData(form).get("note") || "") || null;
    const succeeded = await onRun(
      approve
        ? "Transfer received and paired source/destination ledger entries were posted once."
        : "Transfer rejected; no stock movement was posted.",
      () =>
        reviewInventoryTransferAction({
          requestId: dialog.requestId,
          transferId: transfer.id,
          approve,
          note,
          lines: approve
            ? parsed.map((line) => ({
                inventoryItemId: line.inventoryItemId,
                unitId: line.unitId,
                receivedQuantity: line.receivedQuantity!,
              }))
            : [],
        }),
    );
    if (succeeded) onClose();
  };
  return (
    <ModalFrame
      title="Review transfer"
      description={`${transfer.fromLocationName} → ${transfer.toLocationName} · submitted by ${transfer.createdBy}.`}
      labelledBy="transfer-review-dialog"
      notice={notice}
      onClose={onClose}
      width="max-w-4xl"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void decideTransfer(true, event.currentTarget);
        }}
      >
        <div className="grid gap-5 px-5 py-5 sm:px-7">
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {lines.map((line, index) => (
              <div
                key={line.key}
                className="grid grid-cols-[1fr_.5fr_.6fr] items-center gap-4 py-3"
              >
                <div>
                  <p className="text-xs font-semibold">
                    {model.items.find(
                      (item) => item.id === line.inventoryItemId,
                    )?.name ?? "Inventory item"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    Sent {line.quantity}{" "}
                    {model.units.find((unit) => unit.id === line.unitId)
                      ?.symbol ?? "unit"}
                  </p>
                </div>
                <span className="text-xs text-[var(--ink-faint)]">
                  Received
                </span>
                <input
                  aria-label={`Received quantity ${index + 1}`}
                  required
                  inputMode="decimal"
                  value={line.acceptedQuantity}
                  disabled={busy || !networkAvailable || own || !atDestination}
                  onChange={(event) =>
                    updateLine(line.key, {
                      acceptedQuantity: event.target.value,
                    })
                  }
                  className={inventoryFieldClass}
                />
              </div>
            ))}
          </div>
          <InventoryField label="Review note">
            <textarea
              name="note"
              rows={3}
              maxLength={2_000}
              disabled={busy || !networkAvailable || own || !atDestination}
              className={inventoryTextAreaClass}
            />
          </InventoryField>
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl p-3 text-xs leading-4",
              own || !atDestination
                ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                : "bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]",
            )}
          >
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {own
              ? "You created this transfer. A different destination manager must review it."
              : !atDestination
                ? `Switch to ${transfer.toLocationName} to review this transfer.`
                : "The server rechecks source on-hand stock, then posts paired base-unit movements. Short receipt remains visible in the locked line evidence."}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || !networkAvailable || own || !atDestination}
              aria-describedby={!networkAvailable ? "workspace-connectivity-status" : undefined}
              onClick={(event) =>
                void decideTransfer(false, event.currentTarget.form!)
              }
            >
              <X className="size-4" />
              Reject
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={busy || !networkAvailable || own || !atDestination}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Approve & post
            </Button>
          </div>
        </div>
      </form>
    </ModalFrame>
  );
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
  const connectivity = useConnectivity();
  const administrativeWrite =
    workspace.role === "admin" || workspace.role === "owner";
  const can = (capability: Parameters<typeof hasCapability>[1]) =>
    administrativeWrite || hasCapability(workspace.capabilities, capability);
  const canCountCreate = can("inventory.count.create");
  const canCountApprove = can("inventory.count.approve");
  const canPurchase = can("inventory.purchase.create");
  const canPurchaseApprove = can("inventory.purchase.approve");
  const canReceive = can("inventory.receive");
  const canTransferCreate = can("inventory.transfer.create");
  const canTransferApprove = can("inventory.transfer.approve");
  const canWasteCreate = can("inventory.waste.create");
  const canWasteApprove = can("inventory.waste.approve");
  const canManageRecipes = can("recipe.manage");
  const canSeeVendors =
    administrativeWrite ||
    [
      "inventory.vendor.manage",
      "inventory.price.manage",
      "inventory.purchase.create",
      "inventory.purchase.approve",
      "inventory.receive",
    ].some((capability) =>
      hasCapability(
        workspace.capabilities,
        capability as Parameters<typeof hasCapability>[1],
      ),
    );
  const canSeeRecipes =
    administrativeWrite ||
    ["recipe.manage", "prep.manage", "prep.complete", "menu.manage"].some(
      (capability) =>
        hasCapability(
          workspace.capabilities,
          capability as Parameters<typeof hasCapability>[1],
        ),
    );
  const canSeeCatalog =
    administrativeWrite ||
    [
      "inventory.catalog.manage",
      "inventory.par.manage",
      "inventory.vendor.manage",
      "inventory.price.manage",
      "recipe.manage",
    ].some((capability) =>
      hasCapability(
        workspace.capabilities,
        capability as Parameters<typeof hasCapability>[1],
      ),
    );
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === "count") return canCountCreate || canCountApprove;
    if (tab.id === "orders")
      return canPurchase || canPurchaseApprove || canReceive;
    if (tab.id === "transfers") return canTransferCreate || canTransferApprove;
    if (tab.id === "vendors") return canSeeVendors;
    if (tab.id === "recipes") return canSeeRecipes;
    if (tab.id === "waste") return canWasteCreate || canWasteApprove;
    if (tab.id === "catalog") return canSeeCatalog;
    return true;
  });
  const firstTab = visibleTabs.some((tab) => tab.id === initialTab)
    ? initialTab!
    : (visibleTabs[0]?.id ?? "stock");
  const router = useRouter();
  const model = result.ok ? result.data : null;
  const [activeTab, setActiveTab] = useState<Tab>(firstTab);
  const [query, setQuery] = useState("");
  const [countOpen, setCountOpen] = useState(false);
  const [countDismissOpen, setCountDismissOpen] = useState(false);
  const [countSubmissionId, setCountSubmissionId] = useState<string | null>(
    null,
  );
  const [countValues, setCountValues] = useState<Record<string, string>>({});
  const [countNotes, setCountNotes] = useState("");
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemTrigger, setSelectedItemTrigger] =
    useState<HTMLElement | null>(null);
  const [countReviewRequestId, setCountReviewRequestId] = useState<
    string | null
  >(null);
  const [mutationDialog, setMutationDialog] =
    useState<InventoryMutationDialog | null>(null);
  const [recipeDialog, setRecipeDialog] = useState<{
    requestId: string;
    record?: RecipeRecord;
  } | null>(null);
  const [mutationReturnFocus, setMutationReturnFocus] =
    useState<HTMLElement | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const countDraftKey = model
    ? `le-yard:inventory-count-draft:v2:${workspace.organization.id}:${workspace.activeLocation.id}:${workspace.identity.userId}`
    : null;
  const countDraftContext = useMemo(
    () => model
      ? {
          organizationId: workspace.organization.id,
          locationId: workspace.activeLocation.id,
          userId: workspace.identity.userId,
          businessDate: model.date,
          items: model.items,
        }
      : null,
    [model, workspace.activeLocation.id, workspace.identity.userId, workspace.organization.id],
  );
  const networkCommandAvailability = getCommandAvailability(
    "requires_network",
    connectivity.state,
  );

  const realtime = useRealtimeInvalidation({
    enabled: Boolean(model),
    channelName: `inventory-${workspace.activeLocation.id}`,
    bindings: inventoryRealtimeBindings,
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
  });

  useEffect(() => {
    if (!countOpen || !countDraftKey || !countSubmissionId || !countDraftContext) return;
    localDraftSet(
      countDraftKey,
      JSON.stringify(
        createInventoryCountDraft(countDraftContext, {
          submissionId: countSubmissionId,
          values: countValues,
          notes: countNotes,
        }),
      ),
    );
  }, [countDraftContext, countDraftKey, countNotes, countOpen, countSubmissionId, countValues]);

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
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
            {result.message}
          </p>
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
  const missingValueCount = model.items.filter(
    (item) => item.inventoryValueCents === null,
  ).length;
  const belowPar = model.items.filter(
    (item) => item.par !== null && item.onHand < item.par,
  ).length;
  const pendingCounts = model.counts.filter((count) =>
    ["pending", "in_review"].includes(count.status),
  );
  const openOrders = model.orders.filter(
    (order) => !["received", "cancelled"].includes(order.status),
  );
  const latestApprovedCount =
    model.counts.find((count) => count.status === "approved") ?? null;
  const selectedCount =
    model.counts.find((count) => count.id === selectedCountId) ?? null;
  const selectedItem =
    model.items.find((item) => item.id === selectedItemId) ?? null;
  const inventoryActionContext: ActionResolutionContext = {
    role: workspace.role,
    persona: workspace.persona,
    workMode: resolveWorkMode(workspace, workspace.activeJob),
    capabilities: workspace.capabilities,
    servicePhase: "off_hours",
    satisfiedPrerequisites: ["active_workspace", "selected_inventory_item"],
  };

  function openCount() {
    const draftResult = countDraftContext
      ? readInventoryCountDraft(localDraftGet(countDraftKey!), countDraftContext)
      : { status: "none" as const };
    const itemIds = liveModel.items.map((item) => item.id).sort();
    const restoredDraft = draftResult.status === "restored" ? draftResult.draft : null;
    if (draftResult.status !== "none" && draftResult.status !== "restored" && countDraftKey) {
      localDraftRemove(countDraftKey);
    }
    setCountSubmissionId(
      restoredDraft?.submissionId ?? crypto.randomUUID(),
    );
    setCountValues(
      restoredDraft
        ? Object.fromEntries(
            itemIds.map((id) => [
              id,
              restoredDraft.values[id] ?? "",
            ]),
          )
        : Object.fromEntries(itemIds.map((id) => [id, ""])),
    );
    setCountNotes(restoredDraft?.notes ?? "");
    setNotice(
      draftResult.status === "restored"
        ? "Saved count draft restored for this business date and catalog."
        : draftResult.status === "none"
          ? ""
          : draftResult.message,
    );
    setCountDismissOpen(false);
    setCountOpen(true);
  }

  function persistCountDraft(): boolean {
    if (!countDraftKey || !countDraftContext || !countSubmissionId) return false;
    return localDraftSet(
      countDraftKey,
      JSON.stringify(
        createInventoryCountDraft(countDraftContext, {
          submissionId: countSubmissionId,
          values: countValues,
          notes: countNotes,
        }),
      ),
    );
  }

  function hasCountDraftContent(): boolean {
    return countNotes.trim().length > 0 || Object.values(countValues).some((value) => value.trim().length > 0);
  }

  function requestCountClose() {
    if (busy) return;
    if (hasCountDraftContent()) {
      setCountDismissOpen(true);
      return;
    }
    setCountOpen(false);
  }

  function saveCountAndClose() {
    if (!persistCountDraft()) {
      setNotice("This browser could not save the count draft. Keep this window open or copy the values before leaving.");
      setCountDismissOpen(false);
      return;
    }
    setCountDismissOpen(false);
    setCountOpen(false);
    setNotice("Count draft saved on this device for this business date and catalog.");
  }

  function discardCountAndClose() {
    if (countDraftKey) localDraftRemove(countDraftKey);
    setCountDismissOpen(false);
    setCountOpen(false);
    setCountSubmissionId(null);
    setCountValues({});
    setCountNotes("");
    setNotice("Count draft discarded. No stock changed.");
  }

  function openMutationDialog(next: InventoryMutationDialog) {
    setMutationReturnFocus(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );
    setNotice("");
    setMutationDialog(next);
  }

  function openSelectedItemMutation(kind: "waste" | "transfer") {
    if (!selectedItem) return;
    setMutationReturnFocus(selectedItemTrigger);
    setNotice("");
    setSelectedItemId(null);
    setMutationDialog({
      kind,
      requestId: crypto.randomUUID(),
      itemId: selectedItem.id,
    });
  }

  async function submitCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!countSubmissionId) return;
    if (!networkCommandAvailability.available) {
      setNotice(networkCommandAvailability.reason ?? "Reconnect before submitting this count.");
      return;
    }
    const decimal = /^\d+(?:\.\d{1,4})?$/;
    const values = liveModel.items.map(
      (item) => countValues[item.id]?.trim() ?? "",
    );
    if (
      values.some(
        (value) => !decimal.test(value) || Number(value) >= 1_000_000_000_000,
      )
    ) {
      setNotice(
        "Enter every count as a non-negative number with no more than four decimal places.",
      );
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
      if (countDraftKey) localDraftRemove(countDraftKey);
      setActiveTab("count");
      setNotice(
        "Full count submitted. A different manager must review it before stock changes.",
      );
      router.refresh();
    } catch {
      setNotice("The inventory count could not be submitted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decideCount(approve: boolean) {
    if (!selectedCount || !countReviewRequestId) return;
    if (!networkCommandAvailability.available) {
      setNotice(networkCommandAvailability.reason ?? "Reconnect before reviewing this count.");
      return;
    }
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
      setNotice(
        approve
          ? "Count approved and stock adjustments posted."
          : "Count rejected; on-hand stock was not changed.",
      );
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
    if (!networkCommandAvailability.available) {
      setNotice(networkCommandAvailability.reason ?? "Reconnect before running this inventory command.");
      return false;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await action();
      if (!response.ok) {
        setNotice(
          response.message ?? "The inventory action could not be completed.",
        );
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
    if (!networkCommandAvailability.available) {
      setNotice(networkCommandAvailability.reason ?? "Reconnect before saving this recipe.");
      return false;
    }
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
        detail={
          description ??
          `Stock, counts, purchasing, recipes, and waste for ${workspace.activeLocation.name}.`
        }
        status={
          <>
            <StatusPill tone="neutral">Server-backed</StatusPill>
            <span>Ledger-backed · tenant scoped</span>
          </>
        }
        actions={
          <>
            {canPurchase ? (
              <Button
                variant="secondary"
                disabled={!model.items.length || !model.vendors.length}
                onClick={() =>
                  openMutationDialog({
                    kind: "purchase-order",
                    requestId: crypto.randomUUID(),
                  })
                }
              >
                <ShoppingCart className="size-4" />
                New order
              </Button>
            ) : null}
            {canCountCreate ? (
              <Button
                variant="accent"
                disabled={!model.items.length}
                onClick={openCount}
              >
                <ClipboardCheck className="size-4" />
                Start or resume full count
              </Button>
            ) : null}
          </>
        }
      />
      <RealtimeSyncStatus {...realtime} />

      {notice ? (
        <div
          aria-live="polite"
          className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--accent-soft)]/55 px-4 py-3 text-xs leading-4 text-[var(--accent-strong)]"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {notice}
        </div>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Surface variant="raised" className="min-h-36">
          <Metric
            className="px-5 first:pl-5"
            label="Known inventory value"
            value={formatMoney(inventoryValueCents, model.currencyCode)}
            detail={
              missingValueCount
                ? `${missingValueCount} item${missingValueCount === 1 ? "" : "s"} missing base-unit cost`
                : "All tracked items valued"
            }
          />
        </Surface>
        <Surface variant="raised" className="min-h-36">
          <Metric
            className="px-5 first:pl-5"
            label="Below par"
            value={String(belowPar)}
            detail={`${model.items.length} active tracked items`}
            trend={{
              label: belowPar ? "Review" : "At par",
              tone: belowPar ? "negative" : "positive",
            }}
          />
        </Surface>
        <Surface variant="raised" className="min-h-36">
          <Metric
            className="px-5 first:pl-5"
            label="Open orders"
            value={String(openOrders.length)}
            detail={`${model.orders.length} recent purchase orders`}
          />
        </Surface>
        <Surface variant="raised" className="min-h-36">
          <Metric
            className="px-5 first:pl-5"
            label="Pending counts"
            value={String(pendingCounts.length)}
            detail={
              latestApprovedCount
                ? `Last approved ${dateTimeLabel(latestApprovedCount.countedAt, model.timeZone)}`
                : "No approved count yet"
            }
            trend={{
              label: pendingCounts.length ? "Review" : "Clear",
              tone: pendingCounts.length ? "negative" : "positive",
            }}
          />
        </Surface>
      </section>

      <Tabs
        id="inventory"
        label="Inventory sections"
        className="mt-6"
        items={visibleTabs.map((tab) => ({
          value: tab.id,
          label: tab.label,
          badge:
            tab.id === "count" && pendingCounts.length
              ? pendingCounts.length
              : undefined,
        }))}
        value={activeTab}
        onValueChange={setActiveTab}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.14 }}
        >
          <TabPanel id="inventory" value={activeTab}>
            {activeTab === "stock" ? (
              <section className="mt-5">
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <SectionHeading
                    title="On hand"
                    detail="Approved ledger quantities compared with current location par."
                    className="mb-0"
                  />
                  <label className="relative block sm:w-72">
                    <span className="sr-only">Search inventory</span>
                    <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search name, SKU, or category"
                      className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-xs outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                </div>
                {visibleItems.length ? (
                  <div
                    className="overflow-x-auto border-y border-[var(--line)]"
                    tabIndex={0}
                    role="region"
                    aria-label="Inventory on hand table"
                  >
                    <div className="grid min-w-[820px] grid-cols-[1.3fr_.65fr_.55fr_.7fr_.8fr_.7fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">
                      <span>Item</span>
                      <span>On hand</span>
                      <span>Par</span>
                      <span>Status</span>
                      <span>Last movement</span>
                      <span className="text-right">Base cost</span>
                    </div>
                    {visibleItems.map((item) => {
                      const stockStatus =
                        item.par === null
                          ? "unconfigured"
                          : item.reorder !== null && item.onHand <= item.reorder
                            ? "reorder"
                            : item.onHand < item.par
                              ? "below"
                              : "healthy";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-label={`Open ${item.name} inventory details`}
                          onClick={(event) => {
                            setSelectedItemId(item.id);
                            setSelectedItemTrigger(event.currentTarget);
                          }}
                          className="focus-ring grid min-w-[820px] w-full grid-cols-[1.3fr_.65fr_.55fr_.7fr_.8fr_.7fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--paper)]"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                              <Boxes className="size-3.5 text-[var(--ink-faint)]" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold">
                                {item.name}
                              </span>
                              <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">
                                {item.sku || "No SKU"} · {item.category}
                              </span>
                            </span>
                          </span>
                          <span className="numeric text-xs font-semibold">
                            {quantityLabel(item.onHand)}{" "}
                            <span className="font-normal text-[var(--ink-faint)]">
                              {item.unitSymbol}
                            </span>
                          </span>
                          <span className="numeric text-xs text-[var(--ink-faint)]">
                            {item.par === null ? "—" : quantityLabel(item.par)}
                          </span>
                          <span>
                            <StatusPill
                              tone={
                                stockStatus === "healthy"
                                  ? "positive"
                                  : stockStatus === "reorder"
                                    ? "danger"
                                    : stockStatus === "below"
                                      ? "warning"
                                      : "neutral"
                              }
                            >
                              {stockStatus === "healthy"
                                ? "Healthy"
                                : stockStatus === "reorder"
                                  ? "Reorder"
                                  : stockStatus === "below"
                                    ? "Below par"
                                    : "No par"}
                            </StatusPill>
                          </span>
                          <span className="text-xs text-[var(--ink-faint)]">
                            {item.lastMovementAt
                              ? dateTimeLabel(
                                  item.lastMovementAt,
                                  model.timeZone,
                                )
                              : "No ledger movement"}
                          </span>
                          <span className="numeric text-right text-xs">
                            {item.lastUnitCostCents === null
                              ? "—"
                              : `${formatMoney(item.lastUnitCostCents, model.currencyCode)} / ${item.unitSymbol}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Boxes className="size-4" />}
                    title={
                      model.items.length
                        ? "No matching items"
                        : "No tracked inventory yet"
                    }
                    detail={
                      model.items.length
                        ? "Try a different item, SKU, or category."
                        : "Active tracked items will appear here after they are configured."
                    }
                  />
                )}
              </section>
            ) : null}

            {activeTab === "count" ? (
              <section className="mt-5">
                <SectionHeading
                  title="Count history"
                  detail="Pending counts are review evidence and do not affect on-hand stock."
                  action={
                    canCountCreate ? (
                      <Button
                        size="sm"
                        variant="accent"
                        disabled={!model.items.length}
                        onClick={openCount}
                      >
                        <ClipboardCheck className="size-3.5" />
                        New full count
                      </Button>
                    ) : undefined
                  }
                />
                {model.counts.length ? (
                  <div className="border-y border-[var(--line)]">
                    {model.counts.map((count) => {
                      const differentLines = count.lines.filter(
                        (line) =>
                          line.expectedQuantity !== null &&
                          line.countedQuantity !== line.expectedQuantity,
                      ).length;
                      const ownPending =
                        ["pending", "in_review"].includes(count.status) &&
                        count.countedByUserId === workspace.identity.userId;
                      return (
                        <button
                          key={count.id}
                          onClick={() => {
                            setSelectedCountId(count.id);
                            setCountReviewRequestId(crypto.randomUUID());
                            setReviewNote("");
                            setNotice("");
                          }}
                          className="group focus-ring flex w-full items-center gap-4 border-t border-[var(--line)] px-4 py-4 text-left first:border-t-0 hover:bg-[var(--paper)]"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                            <ClipboardList className="size-4 text-[var(--ink-faint)]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">
                              {sentenceCase(count.countType)} count ·{" "}
                              {count.countedBy}
                            </span>
                            <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                              {dateTimeLabel(count.countedAt, model.timeZone)} ·{" "}
                              {count.lines.length} lines · {differentLines}{" "}
                              variances
                              {ownPending ? " · another reviewer required" : ""}
                            </span>
                          </span>
                          <StatusPill
                            tone={statusTone[count.status] ?? "neutral"}
                          >
                            {sentenceCase(count.status)}
                          </StatusPill>
                          <ChevronRight className="size-4 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<ClipboardList className="size-4" />}
                    title="No counts submitted"
                    detail="Start a full count to capture every active tracked item for independent review."
                  />
                )}
              </section>
            ) : null}

            {activeTab === "orders" ? (
              <section className="mt-5">
                <SectionHeading
                  title="Purchase orders"
                  detail="Internal orders with server-derived totals. Vendor transmission remains outside this app until an approved integration is connected."
                  action={
                    canPurchase ? (
                      <Button
                        size="sm"
                        variant="accent"
                        disabled={!model.items.length || !model.vendors.length}
                        onClick={() =>
                          openMutationDialog({
                            kind: "purchase-order",
                            requestId: crypto.randomUUID(),
                          })
                        }
                      >
                        <Plus className="size-3.5" />
                        New order
                      </Button>
                    ) : undefined
                  }
                />
                {model.orders.length ? (
                  <div className="border-y border-[var(--line)]">
                    {model.orders.map((order) => {
                      const orderCanReceive =
                        canReceive &&
                        ["approved", "partially_received"].includes(
                          order.status,
                        ) &&
                        order.lines.length > 0;
                      return (
                        <div
                          key={order.id}
                          className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                            <ShoppingCart className="size-4 text-[var(--ink-faint)]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">
                              {order.vendorName} · {order.poNumber}
                            </span>
                            <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                              Ordered {dateLabel(order.orderedOn)} · expected{" "}
                              {dateLabel(order.expectedOn)} · {order.lineCount}{" "}
                              lines
                            </span>
                          </span>
                          <span className="numeric text-xs font-semibold">
                            {formatMoney(order.totalCents, model.currencyCode)}
                          </span>
                          <StatusPill
                            tone={statusTone[order.status] ?? "neutral"}
                          >
                            {sentenceCase(order.status)}
                          </StatusPill>
                          {canPurchaseApprove &&
                          order.status === "submitted" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                openMutationDialog({
                                  kind: "purchase-order-review",
                                  requestId: crypto.randomUUID(),
                                  order,
                                })
                              }
                            >
                              <ShieldCheck className="size-3.5" />
                              Review
                            </Button>
                          ) : null}
                          {orderCanReceive ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                openMutationDialog({
                                  kind: "delivery",
                                  requestId: crypto.randomUUID(),
                                  order,
                                })
                              }
                            >
                              <Truck className="size-3.5" />
                              Receive
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<ShoppingCart className="size-4" />}
                    title="No purchase orders"
                    detail={
                      model.vendors.length && model.items.length
                        ? "Create an internal order from active tenant vendors and tracked items."
                        : "Active vendors and tracked items are required before an order can be created."
                    }
                  />
                )}
                <div className="mt-8">
                  <SectionHeading
                    title="Delivery history"
                    detail="Accepted quantities, invoice references, and receiving actors. Each delivery posts canonical stock exactly once."
                  />
                </div>
                {model.deliveries.length ? (
                  <div className="border-y border-[var(--line)]">
                    {model.deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className="flex items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                          <Truck className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">
                            {delivery.vendorName}
                            {delivery.poNumber ? ` · ${delivery.poNumber}` : ""}
                          </span>
                          <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                            {dateTimeLabel(
                              delivery.deliveredAt,
                              model.timeZone,
                            )}{" "}
                            · {delivery.lines.length} lines · received by{" "}
                            {delivery.receivedBy}
                            {delivery.invoiceNumber
                              ? ` · ${delivery.invoiceNumber}`
                              : ""}
                          </span>
                        </span>
                        <span className="numeric text-xs font-semibold">
                          {quantityLabel(
                            delivery.lines.reduce(
                              (sum, line) => sum + line.acceptedQuantity,
                              0,
                            ),
                          )}{" "}
                          accepted
                        </span>
                        <StatusPill tone={delivery.exceptionStatus === "pending_review" ? "warning" : delivery.exceptionStatus === "rejected" ? "danger" : "positive"}>
                          {delivery.exceptionStatus === "pending_review" ? "Exception review" : sentenceCase(delivery.exceptionStatus ?? "posted")}
                        </StatusPill>
                        {canReceive && delivery.exceptionStatus === "pending_review" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openMutationDialog({
                              kind: "delivery-exception-review",
                              requestId: crypto.randomUUID(),
                              postingRequestId: crypto.randomUUID(),
                              delivery,
                            })}
                          >
                            <ShieldCheck className="size-3.5" /> Review exceptions
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Truck className="size-4" />}
                    title="No deliveries received"
                    detail="Receive against an open purchase order to post accepted stock and vendor price evidence."
                  />
                )}
              </section>
            ) : null}

            {activeTab === "transfers" ? (
              <section className="mt-5">
                <SectionHeading
                  title="Location transfers"
                  detail="Source submissions require an independent destination decision before paired stock movements post."
                  action={
                    canTransferCreate ? (
                      <Button
                        size="sm"
                        variant="accent"
                        disabled={
                          !model.items.length ||
                          model.locations.filter(
                            (location) =>
                              location.id !== workspace.activeLocation.id,
                          ).length === 0
                        }
                        onClick={() =>
                          openMutationDialog({
                            kind: "transfer",
                            requestId: crypto.randomUUID(),
                          })
                        }
                      >
                        <ArrowRightLeft className="size-3.5" />
                        New transfer
                      </Button>
                    ) : undefined
                  }
                />
                {model.transfers.length ? (
                  <div className="border-y border-[var(--line)]">
                    {model.transfers.map((transfer) => {
                      const pending = transfer.status === "draft";
                      const own =
                        transfer.createdByUserId === workspace.identity.userId;
                      const atDestination =
                        transfer.toLocationId === workspace.activeLocation.id;
                      return (
                        <div
                          key={transfer.id}
                          className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                            <ArrowRightLeft className="size-4 text-[var(--ink-faint)]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">
                              {transfer.fromLocationName} →{" "}
                              {transfer.toLocationName}
                            </span>
                            <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                              {transfer.lines.length} lines · submitted by{" "}
                              {transfer.createdBy} ·{" "}
                              {dateTimeLabel(
                                transfer.createdAt,
                                model.timeZone,
                              )}
                              {pending && own
                                ? " · another reviewer required"
                                : ""}
                            </span>
                          </span>
                          <StatusPill
                            tone={
                              statusTone[transfer.status] ??
                              (pending ? "warning" : "neutral")
                            }
                          >
                            {pending
                              ? "Pending review"
                              : sentenceCase(transfer.status)}
                          </StatusPill>
                          {pending ? (
                            <Button
                              size="sm"
                              variant={
                                atDestination && !own ? "accent" : "secondary"
                              }
                              onClick={() =>
                                openMutationDialog({
                                  kind: "transfer-review",
                                  requestId: crypto.randomUUID(),
                                  transfer,
                                })
                              }
                            >
                              {atDestination && !own
                                ? "Review receipt"
                                : "View"}
                              <ChevronRight className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<ArrowRightLeft className="size-4" />}
                    title="No location transfers"
                    detail={
                      model.locations.length > 1
                        ? "Submit a source-location transfer for destination review."
                        : "No other RLS-visible active location is available as a destination."
                    }
                  />
                )}
              </section>
            ) : null}

            {activeTab === "vendors" ? (
              <section className="mt-5">
                <SectionHeading
                  title="Vendors & prices"
                  detail="Active vendors, stored terms, and the latest recorded food prices."
                />
                {model.vendors.length ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {model.vendors.map((vendor) => {
                      const prices = (model.catalog?.vendorItems ?? []).filter(
                        (item) =>
                          item.vendorId === vendor.id &&
                          item.isActive &&
                          item.lastPriceCents !== null,
                      );
                      return (
                        <div
                          key={vendor.id}
                          className="rounded-[18px] border border-[var(--line)] p-4"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                              <PackageOpen className="size-4 text-[var(--ink-faint)]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">
                                {vendor.name}
                              </p>
                              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                                {[vendor.contactName, vendor.paymentTerms]
                                  .filter(Boolean)
                                  .join(" · ") ||
                                  "No contact or terms recorded"}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ink-soft)]">
                                {vendor.email ? (
                                  <a
                                    className="hover:text-[var(--accent-strong)]"
                                    href={`mailto:${vendor.email}`}
                                  >
                                    {vendor.email}
                                  </a>
                                ) : null}
                                {vendor.phone ? (
                                  <a
                                    className="hover:text-[var(--accent-strong)]"
                                    href={`tel:${vendor.phone}`}
                                  >
                                    {vendor.phone}
                                  </a>
                                ) : null}
                              </div>
                            </div>
                            <StatusPill tone="positive">Active</StatusPill>
                          </div>
                          <div className="mt-4 border-t border-[var(--line)] pt-3">
                            {prices.length ? (
                              prices.map((price) => {
                                const item = model.catalog?.items.find(
                                  (candidate) =>
                                    candidate.id === price.inventoryItemId,
                                );
                                const unit = model.catalog?.units.find(
                                  (candidate) =>
                                    candidate.id === price.purchaseUnitId,
                                );
                                return (
                                  <div
                                    key={price.id}
                                    className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-0"
                                  >
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                                      {item?.name ?? "Inventory item"}
                                    </span>
                                    <span className="numeric text-[13px] font-semibold">
                                      {formatMoney(
                                        price.lastPriceCents!,
                                        model.currencyCode,
                                      )}{" "}
                                      <span className="font-normal text-[var(--ink-faint)]">
                                        /{unit?.symbol ?? "unit"}
                                      </span>
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-xs text-[var(--ink-faint)]">
                                No current item prices recorded.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<PackageOpen className="size-4" />}
                    title="No active vendors"
                    detail="Active vendors in this organization will appear here."
                  />
                )}
              </section>
            ) : null}

            {activeTab === "recipes" ? (
              <section className="mt-5">
                <SectionHeading
                  title="Recipe costing"
                  detail="Edit recipe specs here. Ingredient prices and opening stock remain available in Setup."
                  action={
                    canManageRecipes && model.catalog ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setActiveTab("catalog")}
                        >
                          Costs & stock
                        </Button>
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={
                            !model.catalog.units.some((unit) => unit.isActive)
                          }
                          onClick={() =>
                            setRecipeDialog({ requestId: crypto.randomUUID() })
                          }
                        >
                          <Plus className="size-3.5" />
                          New recipe
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
                {model.recipes.length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {model.recipes.map((recipe) => {
                      const editableRecipe = model.catalog?.recipes.find(
                        (candidate) => candidate.id === recipe.id,
                      );
                      return (
                        <article
                          key={recipe.id}
                          className="group rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 transition hover:border-[var(--line-strong)] hover:bg-[var(--paper-strong)]"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                              <UtensilsCrossed className="size-4 text-[var(--ink-faint)]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-sm font-semibold">
                                {recipe.name}
                              </h4>
                              <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
                                Yields {quantityLabel(recipe.yieldQuantity)}{" "}
                                {recipe.yieldUnit} · {recipe.ingredientCount}{" "}
                                ingredients
                              </p>
                            </div>
                            {canManageRecipes && editableRecipe ? (
                              <button
                                type="button"
                                aria-label={`Edit ${recipe.name}`}
                                onClick={() =>
                                  setRecipeDialog({
                                    requestId: crypto.randomUUID(),
                                    record: editableRecipe,
                                  })
                                }
                                className="focus-ring flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink-faint)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                              >
                                <Pencil className="size-4" />
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4">
                            <div>
                              <p className="text-[12px] text-[var(--ink-faint)]">
                                Batch cost
                              </p>
                              <p className="numeric mt-1 text-sm font-semibold">
                                {recipe.batchCostCents === null
                                  ? "—"
                                  : formatMoney(recipe.batchCostCents, model.currencyCode)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[12px] text-[var(--ink-faint)]">
                                Per portion
                              </p>
                              <p className="numeric mt-1 text-sm font-semibold">
                                {recipe.portionCostCents === null
                                  ? "—"
                                  : formatMoney(recipe.portionCostCents, model.currencyCode)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[12px] text-[var(--ink-faint)]">
                                Menu price
                              </p>
                              <p className="numeric mt-1 text-sm font-semibold">
                                {recipe.menuPriceCents === null
                                  ? "—"
                                  : formatMoney(
                                      recipe.menuPriceCents,
                                      model.currencyCode,
                                    )}
                              </p>
                            </div>
                            <div>
                              <p className="text-[12px] text-[var(--ink-faint)]">
                                Food cost
                              </p>
                              <p className={cn(
                                "numeric mt-1 text-sm font-semibold",
                                recipe.foodCostPercent !== null && recipe.foodCostPercent > 30
                                  ? "text-[var(--warning)]"
                                  : "text-[var(--ink)]",
                              )}>
                                {recipe.foodCostPercent === null
                                  ? "—"
                                  : `${recipe.foodCostPercent.toFixed(1)}%`}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between">
                            <span className="text-[12px] text-[var(--ink-faint)]">
                              Cost coverage
                            </span>
                            <StatusPill
                              tone={
                                recipe.missingCostCount ? "warning" : "positive"
                              }
                            >
                              {recipe.missingCostCount
                                ? `${recipe.missingCostCount} missing`
                                : "Complete"}
                            </StatusPill>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<UtensilsCrossed className="size-4" />}
                    title="No active recipes"
                    detail="Create a recipe draft, then add ingredients when the inventory catalog is ready."
                  />
                )}
              </section>
            ) : null}

            {activeTab === "waste" ? (
              <section className="mt-5">
                <SectionHeading
                  title="Waste log"
                  detail="Observed waste stays pending until a different manager approves or rejects it."
                  action={
                    canWasteCreate ? (
                      <Button
                        size="sm"
                        variant="accent"
                        disabled={!model.items.length}
                        onClick={() =>
                          openMutationDialog({
                            kind: "waste",
                            requestId: crypto.randomUUID(),
                          })
                        }
                      >
                        <Plus className="size-3.5" />
                        Record waste
                      </Button>
                    ) : undefined
                  }
                />
                {model.waste.length ? (
                  <div className="border-y border-[var(--line)]">
                    {model.waste.map((record) => {
                      const pending = ["pending", "in_review"].includes(
                        record.status,
                      );
                      return (
                        <div
                          key={record.id}
                          className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-t-0"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]">
                            <Trash2 className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">
                              {record.itemName} · {record.recordedBy}
                            </span>
                            <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                              {quantityLabel(record.quantity)}{" "}
                              {record.unitSymbol} ·{" "}
                              {sentenceCase(record.reasonCode)} ·{" "}
                              {dateTimeLabel(record.occurredAt, model.timeZone)}
                            </span>
                            {record.notes ? (
                              <span className="mt-1 block truncate text-xs text-[var(--ink-soft)]">
                                {record.notes}
                              </span>
                            ) : null}
                          </span>
                          <span className="numeric text-xs font-semibold">
                            {record.estimatedCostCents === null
                              ? "—"
                              : formatMoney(
                                  record.estimatedCostCents,
                                  model.currencyCode,
                                )}
                          </span>
                          <StatusPill
                            tone={statusTone[record.status] ?? "neutral"}
                          >
                            {sentenceCase(record.status)}
                          </StatusPill>
                          {pending ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                openMutationDialog({
                                  kind: "waste-review",
                                  requestId: crypto.randomUUID(),
                                  record,
                                })
                              }
                            >
                              Review
                              <ChevronRight className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Trash2 className="size-4" />}
                    title="No waste records"
                    detail="Record a factual observation to start an independent review."
                  />
                )}
              </section>
            ) : null}

            {activeTab === "catalog" ? (
              <InventoryCatalogWorkspace model={model} workspace={workspace} />
            ) : null}
          </TabPanel>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {countOpen ? (
          <CountDialog
            key="count"
            model={model}
            values={countValues}
            notes={countNotes}
            notice={notice}
            busy={busy}
            networkAvailable={networkCommandAvailability.available}
            onValueChange={(itemId, value) =>
              setCountValues((current) => ({ ...current, [itemId]: value }))
            }
            onNotesChange={setCountNotes}
            onClose={requestCountClose}
            onSaveClose={saveCountAndClose}
            onDiscard={discardCountAndClose}
            onSubmit={submitCount}
          />
        ) : null}
        <CountDraftDismissDialog
          open={countDismissOpen}
          busy={busy}
          onContinue={() => setCountDismissOpen(false)}
          onDiscard={discardCountAndClose}
          onSave={saveCountAndClose}
        />
        {selectedCount ? (
          <ReviewDialog
            key="review"
            count={selectedCount}
            model={model}
            currentUserId={workspace.identity.userId}
            note={reviewNote}
            notice={notice}
            busy={busy}
            networkAvailable={networkCommandAvailability.available}
            onNoteChange={setReviewNote}
            onClose={() => {
              if (!busy) {
                setSelectedCountId(null);
                setCountReviewRequestId(null);
              }
            }}
            onDecision={(approve) => void decideCount(approve)}
          />
        ) : null}
        {mutationDialog ? (
          <InventoryMutationDialog
            key={`${mutationDialog.kind}:${mutationDialog.requestId}`}
            dialog={mutationDialog}
            workspace={workspace}
            model={model}
            busy={busy}
            networkAvailable={networkCommandAvailability.available}
            notice={notice}
            returnFocus={mutationReturnFocus}
            onClose={() => {
              if (!busy) {
                setMutationDialog(null);
                setMutationReturnFocus(null);
              }
            }}
            onError={setNotice}
            onRun={runMutation}
          />
        ) : null}
        {recipeDialog && model.catalog ? (
          <RecipeEditorDialog
            key={recipeDialog.requestId}
            dialog={{ kind: "recipe", ...recipeDialog }}
            catalog={model.catalog}
            model={model}
            workspace={workspace}
            busy={busy}
            notice={notice}
            onClose={() => {
              if (!busy) setRecipeDialog(null);
            }}
            onError={setNotice}
            onSave={saveRecipe}
          />
        ) : null}
      </AnimatePresence>
      <Drawer
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItemId(null)}
        labelledBy="inventory-item-detail-title"
        width="md"
        returnFocusTarget={selectedItemTrigger}
        className="p-5 sm:p-7"
      >
        {selectedItem ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Inventory item</p>
                <h2
                  id="inventory-item-detail-title"
                  className="mt-2 text-xl font-semibold tracking-[-0.035em]"
                >
                  {selectedItem.name}
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {selectedItem.sku || "No SKU"} · {selectedItem.category}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="quiet"
                aria-label="Close inventory item"
                onClick={() => setSelectedItemId(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <ObjectActionBar
              entity="inventory_item"
              state="tracked"
              context={inventoryActionContext}
              handlers={{
                ...(canWasteCreate
                  ? {
                      "inventory_item.record_waste": () =>
                        openSelectedItemMutation("waste"),
                    }
                  : {}),
                ...(canTransferCreate &&
                model.locations.some(
                  (location) => location.id !== workspace.activeLocation.id,
                )
                  ? {
                      "inventory_item.transfer": () =>
                        openSelectedItemMutation("transfer"),
                    }
                  : {}),
              }}
              icons={{
                "inventory_item.record_waste": <Trash2 className="size-3.5" />,
                "inventory_item.transfer": (
                  <ArrowRightLeft className="size-3.5" />
                ),
              }}
              variants={{
                "inventory_item.record_waste": "secondary",
                "inventory_item.transfer": "quiet",
              }}
              label={`${selectedItem.name} inventory actions`}
              className="mt-6 flex flex-wrap gap-2"
              size="sm"
            />
            <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] text-xs">
              <div className="bg-[var(--paper-strong)] p-4">
                <dt className="text-[var(--ink-faint)]">On hand</dt>
                <dd className="numeric mt-2 text-lg font-semibold">
                  {quantityLabel(selectedItem.onHand)} {selectedItem.unitSymbol}
                </dd>
              </div>
              <div className="bg-[var(--paper-strong)] p-4">
                <dt className="text-[var(--ink-faint)]">Location par</dt>
                <dd className="numeric mt-2 text-lg font-semibold">
                  {selectedItem.par === null
                    ? "Not set"
                    : `${quantityLabel(selectedItem.par)} ${selectedItem.unitSymbol}`}
                </dd>
              </div>
              <div className="bg-[var(--paper-strong)] p-4">
                <dt className="text-[var(--ink-faint)]">Base-unit cost</dt>
                <dd className="numeric mt-2 font-semibold">
                  {selectedItem.lastUnitCostCents === null
                    ? "Unknown"
                    : `${formatMoney(selectedItem.lastUnitCostCents, model.currencyCode)} / ${selectedItem.unitSymbol}`}
                </dd>
              </div>
              <div className="bg-[var(--paper-strong)] p-4">
                <dt className="text-[var(--ink-faint)]">Inventory value</dt>
                <dd className="numeric mt-2 font-semibold">
                  {selectedItem.inventoryValueCents === null
                    ? "Unknown"
                    : formatMoney(
                        selectedItem.inventoryValueCents,
                        model.currencyCode,
                      )}
                </dd>
              </div>
            </dl>
            <section className="mt-7 border-y border-[var(--line)] py-5">
              <SectionHeading
                title="Latest evidence"
                detail="Approved ledger state for this location"
                className="mb-0"
              />
              <p className="mt-4 text-xs text-[var(--ink-faint)]">
                {selectedItem.lastMovementAt
                  ? `Last movement ${dateTimeLabel(selectedItem.lastMovementAt, model.timeZone)}.`
                  : "No approved ledger movement has been recorded yet."}
              </p>
            </section>
          </>
        ) : null}
      </Drawer>
    </PageFrame>
  );
}
