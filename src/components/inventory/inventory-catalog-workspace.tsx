"use client";

import { AnimatePresence } from "motion/react";
import {
  ArrowRightLeft,
  Boxes,
  Check,
  CircleAlert,
  CircleDollarSign,
  LoaderCircle,
  MapPin,
  PackageOpen,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Tags,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  configureInventoryCatalogAction,
  recordInventoryItemCostAction,
  submitInventoryCountAction,
} from "@/app/actions/workflows/inventory";
import { Button } from "@/components/ui/button";
import { PermissionAwareAction } from "@/components/permissions/action-permission";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveInventoryCatalog, LiveInventoryModel } from "@/data/read-models/inventory";
import { localDateTimeParts, zonedLocalToIso } from "@/data/read-models/local-time";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { parseInventoryMoneyToCents, parseInventoryQuantity } from "@/lib/inventory/input-parsing";
import { hasCapability } from "@/lib/permissions/capabilities";
import { cn, formatMoney } from "@/lib/utils";
import { InventoryModalFrame } from "./inventory-modal-frame";

type UnitRecord = LiveInventoryCatalog["units"][number];
type ConversionRecord = LiveInventoryCatalog["conversions"][number];
type CategoryRecord = LiveInventoryCatalog["categories"][number];
type VendorRecord = LiveInventoryCatalog["vendors"][number];
type ItemRecord = LiveInventoryCatalog["items"][number];
type VendorItemRecord = LiveInventoryCatalog["vendorItems"][number];
export type RecipeRecord = LiveInventoryCatalog["recipes"][number];

type CatalogDialog =
  | { kind: "unit"; requestId: string; record?: UnitRecord }
  | { kind: "conversion"; requestId: string; record?: ConversionRecord }
  | { kind: "category"; requestId: string; record?: CategoryRecord }
  | { kind: "vendor"; requestId: string; record?: VendorRecord }
  | { kind: "item"; requestId: string; record?: ItemRecord }
  | { kind: "vendor-item"; requestId: string; record?: VendorItemRecord }
  | { kind: "cost"; requestId: string }
  | { kind: "stock"; requestId: string }
  | { kind: "par"; requestId: string }
  | { kind: "recipe"; requestId: string; record?: RecipeRecord };

const emptyCatalog: LiveInventoryCatalog = {
  units: [],
  conversions: [],
  categories: [],
  vendors: [],
  items: [],
  vendorItems: [],
  priceHistory: [],
  pars: [],
  recipes: [],
};

const fieldClass = "h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55";
const textAreaClass = "w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-xs leading-5 outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
      <span>{label}</span>
      {children}
      {hint ? <span className="font-normal leading-4 text-[var(--ink-faint)]">{hint}</span> : null}
    </label>
  );
}

function Toggle({ name, defaultChecked, label = "Active" }: { name: string; defaultChecked: boolean; label?: string }) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs font-semibold text-[var(--ink-soft)]">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function optionalText(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim() || null;
}

function parseDecimal(value: string, places: number, allowZero = false) {
  const clean = value.trim();
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(clean)) return null;
  const parsed = Number(clean);
  if (!Number.isFinite(parsed) || parsed >= 1_000_000_000_000) return null;
  if (allowZero ? parsed < 0 : parsed <= 0) return null;
  return parsed;
}

function localPriceTime(timeZone: string) {
  const parts = localDateTimeParts(new Date().toISOString(), timeZone);
  return `${parts.date}T${parts.time}`;
}

function FormActions({ busy, onClose, pinned = false }: { busy: boolean; onClose: () => void; pinned?: boolean }) {
  return (
    <div className={cn("flex items-center justify-end gap-2 bg-[var(--paper-strong)]/95 backdrop-blur", pinned ? "shrink-0 border-t border-[var(--line)] px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-7 sm:pb-5" : "sticky bottom-0 z-10 -mx-5 -mb-5 border-t border-[var(--line)] px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:-mx-7 sm:px-7 sm:pb-5")}>
      <Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="accent" disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
        Save change
      </Button>
    </div>
  );
}

function ItemCostDialog({
  dialog,
  catalog,
  model,
  workspace,
  busy,
  notice,
  onClose,
  onError,
  onSave,
}: {
  dialog: Extract<CatalogDialog, { kind: "cost" }>;
  catalog: LiveInventoryCatalog;
  model: LiveInventoryModel;
  workspace: WorkspaceContextValue;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onError: (message: string) => void;
  onSave: (input: unknown) => Promise<boolean>;
}) {
  const items = catalog.items.filter((item) => item.isActive);
  const units = catalog.units.filter((unit) => unit.isActive);
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const selectedItem = items.find((item) => item.id === itemId);
  const compatibleIds = new Set(selectedItem ? [selectedItem.baseUnitId] : []);
  for (const conversion of catalog.conversions) {
    if (!conversion.isActive || !selectedItem) continue;
    if (conversion.inventoryItemId && conversion.inventoryItemId !== selectedItem.id) continue;
    if (conversion.fromUnitId === selectedItem.baseUnitId) compatibleIds.add(conversion.toUnitId);
    if (conversion.toUnitId === selectedItem.baseUnitId) compatibleIds.add(conversion.fromUnitId);
  }
  const compatibleUnits = units.filter((unit) => compatibleIds.has(unit.id));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const priceQuantity = parseDecimal(String(form.get("priceQuantity")), 6);
    const unitPriceCents = parseInventoryMoneyToCents(String(form.get("unitPrice")));
    const [priceDate = "", priceTime = ""] = String(form.get("effectiveAt")).split("T");
    const effectiveAt = zonedLocalToIso(priceDate, priceTime, model.timeZone);
    if (priceQuantity === null || unitPriceCents === null || !effectiveAt) {
      onError("Enter a positive cost quantity, valid two-decimal cost, and effective time.");
      return;
    }
    const saved = await onSave({
      requestId: dialog.requestId,
      locationId: workspace.activeLocation.id,
      inventoryItemId: itemId,
      unitId: String(form.get("unitId")),
      priceQuantity,
      unitPriceCents,
      effectiveAt,
      notes: optionalText(form, "notes"),
    });
    if (saved) onClose();
  };

  return (
    <InventoryModalFrame title="Add ingredient unit cost" description="Record a direct cost per gram, ounce, each, or another configured unit. It becomes effective-dated price history without requiring a vendor." labelledBy="catalog-cost-dialog" notice={notice} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="grid gap-5 px-5 py-5 sm:px-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inventory item"><select name="inventoryItemId" required autoFocus value={itemId} onChange={(event) => setItemId(event.target.value)} className={fieldClass}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Cost unit" hint="Only units with a canonical conversion are available."><select name="unitId" required key={itemId} defaultValue={selectedItem?.baseUnitId} className={fieldClass}>{compatibleUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field>
            <Field label="Price quantity" hint="Use 1 for per-unit cost, or 1000 for a cost per kilogram expressed in grams."><input name="priceQuantity" required inputMode="decimal" defaultValue="1" className={fieldClass} /></Field>
            <Field label={`Cost for that quantity · ${model.currencyCode}`}><input name="unitPrice" required inputMode="decimal" className={fieldClass} placeholder="0.00" /></Field>
            <Field label={`Effective time · ${model.timeZone}`}><input name="effectiveAt" type="datetime-local" required defaultValue={localPriceTime(model.timeZone)} className={fieldClass} /></Field>
          </div>
          <Field label="Cost note" hint="Optional source or context for the price history."><textarea name="notes" rows={2} maxLength={2000} className={textAreaClass} placeholder="Opening estimate, market quote, or verified invoice context" /></Field>
          <FormActions busy={busy} onClose={onClose} />
        </div>
      </form>
    </InventoryModalFrame>
  );
}

function OpeningStockDialog({
  dialog,
  model,
  workspace,
  busy,
  notice,
  onClose,
  onError,
  onSave,
}: {
  dialog: Extract<CatalogDialog, { kind: "stock" }>;
  model: LiveInventoryModel;
  workspace: WorkspaceContextValue;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onError: (message: string) => void;
  onSave: (input: unknown) => Promise<boolean>;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = model.items.map((item) => ({
      inventoryItemId: item.id,
      unitId: item.baseUnitId,
      expectedQuantity: item.onHand,
      countedQuantity: parseInventoryQuantity(String(form.get(`stock:${item.id}`)), { allowZero: true }),
      unitCostCents: item.lastUnitCostCents,
      notes: null,
    }));
    if (lines.some((line) => line.countedQuantity === null)) {
      onError("Enter a non-negative stock quantity with no more than four decimal places for every item.");
      return;
    }
    const saved = await onSave({
      submissionId: dialog.requestId,
      locationId: workspace.activeLocation.id,
      countType: "full",
      notes: optionalText(form, "notes") ?? "Manual opening stock entered from Kitchen Setup",
      lines: lines.map((line) => ({ ...line, countedQuantity: line.countedQuantity! })),
    });
    if (saved) onClose();
  };

  return (
    <InventoryModalFrame title="Enter opening stock" description="Enter the current quantity for every tracked item. This creates a pending full count so another authorized manager can approve the ledger adjustment." labelledBy="catalog-stock-dialog" notice={notice} onClose={onClose} layout="task">
      <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7" data-inventory-opening-stock-scroll>
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {model.items.map((item) => <label key={item.id} className="grid grid-cols-[1fr_minmax(7rem,9rem)] items-center gap-4 py-3"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.name}</span><span className="mt-0.5 block text-xs text-[var(--ink-faint)]">Current {item.onHand} {item.unitSymbol}{item.lastUnitCostCents == null ? " · cost missing" : ` · ${formatMoney(item.lastUnitCostCents, model.currencyCode)} / ${item.unitSymbol}`}</span></span><input name={`stock:${item.id}`} required inputMode="decimal" defaultValue={item.onHand} aria-label={`${item.name} opening stock`} className={fieldClass} /></label>)}
          </div>
          <Field label="Count note"><textarea name="notes" rows={2} maxLength={10000} className={`${textAreaClass} mt-4`} placeholder="Optional opening count context" /></Field>
        </div>
        <div className="border-t border-[var(--line)] bg-[var(--paper-strong)] px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-7 sm:pb-4"><FormActions busy={busy} onClose={onClose} /></div>
      </form>
    </InventoryModalFrame>
  );
}

function CatalogMutationDialog({
  dialog,
  catalog,
  model,
  workspace,
  busy,
  notice,
  onClose,
  onError,
  onSave,
}: {
  dialog: CatalogDialog;
  catalog: LiveInventoryCatalog;
  model: LiveInventoryModel;
  workspace: WorkspaceContextValue;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onError: (message: string) => void;
  onSave: (input: unknown) => Promise<boolean>;
}) {
  const activeUnits = catalog.units.filter((unit) => unit.isActive);
  const activeCategories = catalog.categories.filter((category) => category.isActive);
  const activeVendors = catalog.vendors.filter((vendor) => vendor.isActive);
  const activeItems = catalog.items.filter((item) => item.isActive);
  const base = {
    requestId: dialog.requestId,
    workspaceLocationId: workspace.activeLocation.id,
  };
  const submit = async (event: FormEvent<HTMLFormElement>, build: (form: FormData) => unknown) => {
    event.preventDefault();
    const input = build(new FormData(event.currentTarget));
    if (input && await onSave(input)) onClose();
  };

  if (dialog.kind === "unit") {
    const record = dialog.record;
    return (
      <InventoryModalFrame title={record ? "Edit measurement unit" : "Add measurement unit"} description="Units are tenant-scoped. Referenced symbols and dimensions stay stable so ledger evidence remains understandable." labelledBy="catalog-unit-dialog" notice={notice} onClose={onClose}>
        <form onSubmit={(event) => void submit(event, (form) => ({ ...base, command: "unit.save", id: record?.id ?? null, name: String(form.get("name")), symbol: String(form.get("symbol")), dimension: String(form.get("dimension")), isBase: form.get("isBase") === "on", isActive: form.get("isActive") === "on" }))}>
          <div className="grid gap-5 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-3"><Field label="Name"><input name="name" required autoFocus maxLength={120} defaultValue={record?.name} className={fieldClass} placeholder="Ounce" /></Field><Field label="Symbol"><input name="symbol" required maxLength={24} defaultValue={record?.symbol} className={fieldClass} placeholder="oz" /></Field><Field label="Dimension"><select name="dimension" defaultValue={record?.dimension ?? "count"} className={fieldClass}><option value="count">Count</option><option value="mass">Mass</option><option value="volume">Volume</option><option value="length">Length</option></select></Field></div>
            <div className="grid gap-3 sm:grid-cols-2"><Toggle name="isBase" defaultChecked={record?.isBase ?? false} label="Canonical base unit" /><Toggle name="isActive" defaultChecked={record?.isActive ?? true} /></div>
            <FormActions busy={busy} onClose={onClose} />
          </div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "conversion") {
    const record = dialog.record;
    return (
      <InventoryModalFrame title={record ? "Edit unit conversion" : "Add unit conversion"} description="Multiplier means one source unit equals this many destination units. Item-specific conversions must connect directly to that item’s base unit." labelledBy="catalog-conversion-dialog" notice={notice} onClose={onClose}>
        <form onSubmit={(event) => void submit(event, (form) => { const multiplier = parseDecimal(String(form.get("multiplier")), 8); if (multiplier === null) { onError("Multiplier must be positive with no more than eight decimal places."); return null; } return { ...base, command: "conversion.save", id: record?.id ?? null, fromUnitId: String(form.get("fromUnitId")), toUnitId: String(form.get("toUnitId")), inventoryItemId: optionalText(form, "inventoryItemId"), multiplier, isActive: form.get("isActive") === "on" }; })}>
          <div className="grid gap-5 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="From unit"><select name="fromUnitId" required autoFocus defaultValue={record?.fromUnitId} className={fieldClass}>{activeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field><Field label="To unit"><select name="toUnitId" required defaultValue={record?.toUnitId ?? activeUnits[1]?.id} className={fieldClass}>{activeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field><Field label="Multiplier"><input name="multiplier" required inputMode="decimal" defaultValue={record?.multiplier} className={fieldClass} placeholder="16" /></Field><Field label="Item scope" hint="Leave blank for every item in the same dimension."><select name="inventoryItemId" defaultValue={record?.inventoryItemId ?? ""} className={fieldClass}><option value="">General conversion</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
            <Toggle name="isActive" defaultChecked={record?.isActive ?? true} />
            <FormActions busy={busy} onClose={onClose} />
          </div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "category") {
    const record = dialog.record;
    return (
      <InventoryModalFrame title={record ? "Edit category" : "Add category"} description="Categories form a shallow, cycle-safe hierarchy for search and reporting." labelledBy="catalog-category-dialog" notice={notice} onClose={onClose}>
        <form onSubmit={(event) => void submit(event, (form) => ({ ...base, command: "category.save", id: record?.id ?? null, name: String(form.get("name")), parentId: optionalText(form, "parentId"), isActive: form.get("isActive") === "on" }))}>
          <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><input name="name" required autoFocus maxLength={120} defaultValue={record?.name} className={fieldClass} placeholder="Produce" /></Field><Field label="Parent"><select name="parentId" defaultValue={record?.parentId ?? ""} className={fieldClass}><option value="">Top level</option>{activeCategories.filter((category) => category.id !== record?.id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field></div><Toggle name="isActive" defaultChecked={record?.isActive ?? true} /><FormActions busy={busy} onClose={onClose} /></div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "vendor") {
    const record = dialog.record;
    return (
      <InventoryModalFrame title={record ? "Edit vendor" : "Add vendor"} description="Vendor identities are preserved for invoices, orders, and price history. Deactivation replaces deletion." labelledBy="catalog-vendor-dialog" notice={notice} onClose={onClose} width="max-w-4xl">
        <form onSubmit={(event) => void submit(event, (form) => ({ ...base, command: "vendor.save", id: record?.id ?? null, name: String(form.get("name")), accountNumber: optionalText(form, "accountNumber"), contactName: optionalText(form, "contactName"), email: optionalText(form, "email"), phone: optionalText(form, "phone"), paymentTerms: optionalText(form, "paymentTerms"), isActive: form.get("isActive") === "on" }))}>
          <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Vendor name"><input name="name" required autoFocus maxLength={160} defaultValue={record?.name} className={fieldClass} /></Field><Field label="Account number"><input name="accountNumber" maxLength={120} defaultValue={record?.accountNumber ?? ""} className={fieldClass} /></Field><Field label="Contact"><input name="contactName" maxLength={160} defaultValue={record?.contactName ?? ""} className={fieldClass} /></Field><Field label="Email"><input name="email" type="email" maxLength={320} defaultValue={record?.email ?? ""} className={fieldClass} /></Field><Field label="Phone"><input name="phone" type="tel" maxLength={80} defaultValue={record?.phone ?? ""} className={fieldClass} /></Field><Field label="Payment terms"><input name="paymentTerms" maxLength={160} defaultValue={record?.paymentTerms ?? ""} className={fieldClass} placeholder="Net 15" /></Field></div><Toggle name="isActive" defaultChecked={record?.isActive ?? true} /><FormActions busy={busy} onClose={onClose} /></div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "item") {
    const record = dialog.record;
    return (
      <InventoryModalFrame title={record ? "Edit inventory item" : "Add inventory item"} description="Choose one canonical base unit. Once ledger evidence exists, that base cannot change." labelledBy="catalog-item-dialog" notice={notice} onClose={onClose} width="max-w-4xl">
        <form onSubmit={(event) => void submit(event, (form) => ({ ...base, command: "item.save", id: record?.id ?? null, name: String(form.get("name")), sku: optionalText(form, "sku"), description: optionalText(form, "description"), categoryId: optionalText(form, "categoryId"), baseUnitId: String(form.get("baseUnitId")), trackInventory: form.get("trackInventory") === "on", isActive: form.get("isActive") === "on" }))}>
          <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2"><Field label="Item name"><input name="name" required autoFocus maxLength={160} defaultValue={record?.name} className={fieldClass} /></Field><Field label="SKU"><input name="sku" maxLength={120} defaultValue={record?.sku ?? ""} className={fieldClass} /></Field><Field label="Category"><select name="categoryId" defaultValue={record?.categoryId ?? ""} className={fieldClass}><option value="">Uncategorized</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Canonical base unit"><select name="baseUnitId" required defaultValue={record?.baseUnitId} className={fieldClass}>{activeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field></div><Field label="Description"><textarea name="description" rows={3} maxLength={4000} defaultValue={record?.description ?? ""} className={textAreaClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Toggle name="trackInventory" defaultChecked={record?.trackInventory ?? true} label="Track on-hand inventory" /><Toggle name="isActive" defaultChecked={record?.isActive ?? true} /></div><FormActions busy={busy} onClose={onClose} /></div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "vendor-item") {
    const record = dialog.record;
    return (
      <InventoryModalFrame title={record ? "Edit purchase pack" : "Add purchase pack"} description="Connect a vendor’s purchase unit and pack quantity to the item’s canonical stock unit. Every saved price appends dated evidence." labelledBy="catalog-vendor-item-dialog" notice={notice} onClose={onClose} width="max-w-4xl">
        <form onSubmit={(event) => void submit(event, (form) => { const packQuantity = parseInventoryQuantity(String(form.get("packQuantity"))); const priceText = String(form.get("price") ?? "").trim(); const lastPriceCents = priceText ? parseInventoryMoneyToCents(priceText) : null; const [priceDate = "", priceTime = ""] = String(form.get("priceEffectiveAt")).split("T"); const priceEffectiveAt = zonedLocalToIso(priceDate, priceTime, model.timeZone); if (packQuantity === null || (priceText && lastPriceCents === null) || !priceEffectiveAt) { onError("Enter a positive four-decimal pack quantity, optional two-decimal price, and valid effective time."); return null; } return { ...base, command: "vendor_item.save", id: record?.id ?? null, vendorId: String(form.get("vendorId")), inventoryItemId: String(form.get("inventoryItemId")), purchaseUnitId: String(form.get("purchaseUnitId")), vendorSku: optionalText(form, "vendorSku"), packQuantity, lastPriceCents, priceEffectiveAt, isPreferred: form.get("isPreferred") === "on", isActive: form.get("isActive") === "on" }; })}>
          <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Vendor"><select name="vendorId" required autoFocus defaultValue={record?.vendorId} className={fieldClass}>{activeVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></Field><Field label="Inventory item"><select name="inventoryItemId" required defaultValue={record?.inventoryItemId} className={fieldClass}>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Purchase unit"><select name="purchaseUnitId" required defaultValue={record?.purchaseUnitId} className={fieldClass}>{activeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field><Field label="Pack quantity"><input name="packQuantity" required inputMode="decimal" defaultValue={record?.packQuantity ?? 1} className={fieldClass} /></Field><Field label={`Pack price · ${model.currencyCode}`}><input name="price" inputMode="decimal" defaultValue={record?.lastPriceCents == null ? "" : (record.lastPriceCents / 100).toFixed(2)} className={fieldClass} placeholder="0.00" /></Field><Field label={`Price effective · ${model.timeZone}`}><input name="priceEffectiveAt" type="datetime-local" required defaultValue={localPriceTime(model.timeZone)} className={fieldClass} /></Field><Field label="Vendor SKU"><input name="vendorSku" maxLength={120} defaultValue={record?.vendorSku ?? ""} className={fieldClass} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Toggle name="isPreferred" defaultChecked={record?.isPreferred ?? false} label="Preferred purchase option" /><Toggle name="isActive" defaultChecked={record?.isActive ?? true} /></div><FormActions busy={busy} onClose={onClose} /></div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "par") {
    return (
      <InventoryModalFrame title="Set location par" description="Par values are effective-dated. Choose a new date to preserve the earlier operating target." labelledBy="catalog-par-dialog" notice={notice} onClose={onClose}>
        <form onSubmit={(event) => void submit(event, (form) => { const parQuantity = parseInventoryQuantity(String(form.get("parQuantity")), { allowZero: true }); const reorderText = String(form.get("reorderQuantity") ?? "").trim(); const reorderQuantity = reorderText ? parseInventoryQuantity(reorderText, { allowZero: true }) : null; if (parQuantity === null || (reorderText && reorderQuantity === null) || (reorderQuantity !== null && reorderQuantity > parQuantity)) { onError("Par must be non-negative, and reorder quantity cannot exceed par."); return null; } return { ...base, command: "par.set", locationId: String(form.get("locationId")), inventoryItemId: String(form.get("inventoryItemId")), parQuantity, reorderQuantity, effectiveFrom: String(form.get("effectiveFrom")) }; })}>
          <div className="grid gap-5 px-5 py-5 sm:px-7"><div className="grid gap-4 sm:grid-cols-2"><Field label="Location"><select name="locationId" required autoFocus defaultValue={workspace.activeLocation.id} className={fieldClass}>{model.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field><Field label="Item"><select name="inventoryItemId" required className={fieldClass}>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Par quantity"><input name="parQuantity" required inputMode="decimal" className={fieldClass} /></Field><Field label="Reorder quantity"><input name="reorderQuantity" inputMode="decimal" className={fieldClass} /></Field><Field label="Effective from"><input name="effectiveFrom" type="date" required defaultValue={model.date} className={fieldClass} /></Field></div><FormActions busy={busy} onClose={onClose} /></div>
        </form>
      </InventoryModalFrame>
    );
  }

  if (dialog.kind === "cost") {
    return <ItemCostDialog dialog={dialog} catalog={catalog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={onClose} onError={onError} onSave={onSave} />;
  }

  if (dialog.kind === "stock") {
    return <OpeningStockDialog dialog={dialog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={onClose} onError={onError} onSave={onSave} />;
  }

  return <RecipeEditorDialog dialog={dialog} catalog={catalog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={onClose} onError={onError} onSave={onSave} />;
}

export function RecipeEditorDialog({
  dialog,
  catalog,
  model,
  workspace,
  busy,
  notice,
  onClose,
  onError,
  onSave,
}: {
  dialog: Extract<CatalogDialog, { kind: "recipe" }>;
  catalog: LiveInventoryCatalog;
  model: LiveInventoryModel;
  workspace: WorkspaceContextValue;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onError: (message: string) => void;
  onSave: (input: unknown) => Promise<boolean>;
}) {
  const record = dialog.record;
  const units = catalog.units.filter((unit) => unit.isActive);
  const items = catalog.items.filter((item) => item.isActive);
  const initialItem = items[0];
  const [ingredients, setIngredients] = useState(() => (record?.ingredients.length ? record.ingredients : initialItem ? [{ inventoryItemId: initialItem.id, unitId: initialItem.baseUnitId, quantity: 1, wasteFactor: 0 }] : []).map((ingredient) => ({ key: crypto.randomUUID(), inventoryItemId: ingredient.inventoryItemId, unitId: ingredient.unitId, quantity: String(ingredient.quantity), wastePercent: String(ingredient.wasteFactor * 100) })));
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const compatibleUnits = (itemId: string) => {
    const item = itemById.get(itemId);
    if (!item) return [];
    const ids = new Set([item.baseUnitId]);
    for (const conversion of catalog.conversions) {
      if (!conversion.isActive || (conversion.inventoryItemId && conversion.inventoryItemId !== itemId)) continue;
      if (conversion.fromUnitId === item.baseUnitId) ids.add(conversion.toUnitId);
      if (conversion.toUnitId === item.baseUnitId) ids.add(conversion.fromUnitId);
    }
    return units.filter((unit) => ids.has(unit.id));
  };
  const updateIngredient = (key: string, patch: Partial<(typeof ingredients)[number]>) => setIngredients((current) => current.map((ingredient) => ingredient.key === key ? { ...ingredient, ...patch } : ingredient));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const yieldQuantity = parseInventoryQuantity(String(form.get("yieldQuantity")));
    const menuPriceText = String(form.get("menuPrice") ?? "").trim();
    const menuPriceCents = menuPriceText ? parseInventoryMoneyToCents(menuPriceText) : null;
    const parsedIngredients = ingredients.map((ingredient) => ({
      inventoryItemId: ingredient.inventoryItemId,
      unitId: ingredient.unitId,
      quantity: parseDecimal(ingredient.quantity, 6),
      wasteFactor: parseDecimal(ingredient.wastePercent, 4, true),
    }));
    if (yieldQuantity === null || (menuPriceText && menuPriceCents === null) || parsedIngredients.some((ingredient) => ingredient.quantity === null || ingredient.wasteFactor === null || ingredient.wasteFactor >= 100) || new Set(parsedIngredients.map((ingredient) => ingredient.inventoryItemId)).size !== parsedIngredients.length) {
      onError("Use a positive yield, unique ingredients, positive six-decimal quantities, waste from 0–99.9999%, and an optional two-decimal menu price.");
      return;
    }
    const succeeded = await onSave({
      requestId: dialog.requestId,
      workspaceLocationId: workspace.activeLocation.id,
      command: "recipe.save",
      id: record?.id ?? null,
      name: String(form.get("name")),
      yieldQuantity,
      yieldUnitId: String(form.get("yieldUnitId")),
      menuPriceCents,
      isActive: form.get("isActive") === "on",
      ingredients: parsedIngredients.map((ingredient) => ({ ...ingredient, quantity: ingredient.quantity!, wasteFactor: ingredient.wasteFactor! / 100 })),
    });
    if (succeeded) onClose();
  };

  return (
    <InventoryModalFrame title={record ? `Edit ${record.name}` : "Add recipe"} description="Update the yield, menu price, status, and every ingredient in one place." labelledBy="catalog-recipe-dialog" notice={notice} onClose={onClose} width="max-w-5xl" layout="task">
      <form className="flex h-full min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
        <div data-recipe-editor-scroll className="grid min-h-0 flex-1 gap-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Recipe name"><input name="name" required autoFocus maxLength={160} defaultValue={record?.name} className={fieldClass} /></Field><Field label="Yield"><input name="yieldQuantity" required inputMode="decimal" defaultValue={record?.yieldQuantity ?? 1} className={fieldClass} /></Field><Field label="Yield unit"><select name="yieldUnitId" required defaultValue={record?.yieldUnitId} className={fieldClass}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field><Field label={`Menu price · ${model.currencyCode}`}><input name="menuPrice" inputMode="decimal" defaultValue={record?.menuPriceCents == null ? "" : (record.menuPriceCents / 100).toFixed(2)} className={fieldClass} placeholder="0.00" /></Field></div>
            <div className="mt-4 max-w-sm"><Toggle name="isActive" defaultChecked={record?.isActive ?? false} label="Published and active" /></div>
          </section>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-semibold">Ingredients</h4><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Edit the item, measured quantity, unit, or expected waste.</p></div><Button type="button" size="sm" variant="secondary" disabled={!initialItem || busy} onClick={() => setIngredients((current) => [...current, { key: crypto.randomUUID(), inventoryItemId: initialItem!.id, unitId: initialItem!.baseUnitId, quantity: "1", wastePercent: "0" }])}><Plus className="size-3.5" />Add ingredient</Button></div>
            <div className="grid gap-3">
              {ingredients.map((ingredient, index) => <article key={ingredient.key} className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"><div className="mb-3 flex items-center justify-between gap-3"><span className="numeric text-[12px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">Ingredient {index + 1}</span><button type="button" aria-label={`Remove ingredient ${index + 1}`} disabled={busy} onClick={() => setIngredients((current) => current.filter((candidate) => candidate.key !== ingredient.key))} className="focus-ring flex size-10 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><X className="size-4" /></button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_.75fr_.9fr_.65fr]"><Field label="Inventory item"><select aria-label={`Ingredient item ${index + 1}`} value={ingredient.inventoryItemId} onChange={(event) => { const item = itemById.get(event.target.value); updateIngredient(ingredient.key, { inventoryItemId: event.target.value, unitId: item?.baseUnitId ?? "" }); }} className={fieldClass}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Quantity"><input aria-label={`Ingredient quantity ${index + 1}`} inputMode="decimal" value={ingredient.quantity} onChange={(event) => updateIngredient(ingredient.key, { quantity: event.target.value })} className={fieldClass} /></Field><Field label="Unit"><select aria-label={`Ingredient unit ${index + 1}`} value={ingredient.unitId} onChange={(event) => updateIngredient(ingredient.key, { unitId: event.target.value })} className={fieldClass}>{compatibleUnits(ingredient.inventoryItemId).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field><Field label="Waste %"><input aria-label={`Ingredient waste ${index + 1}`} inputMode="decimal" value={ingredient.wastePercent} onChange={(event) => updateIngredient(ingredient.key, { wastePercent: event.target.value })} className={fieldClass} /></Field></div></article>)}
              {!ingredients.length ? <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-5 py-8 text-center"><UtensilsCrossed className="mx-auto size-5 text-[var(--ink-faint)]" /><p className="mt-3 text-sm font-semibold">No ingredients yet</p><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Save this as a draft, or add an inventory item in Setup.</p></div> : null}
            </div>
          </section>
        </div>
        <FormActions busy={busy} onClose={onClose} pinned />
      </form>
    </InventoryModalFrame>
  );
}

function SetupStep({ number, icon, title, detail, action, children }: { number: string; icon: ReactNode; title: string; detail: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-[var(--line)] py-6 md:grid-cols-[7.5rem_1fr]">
      <div><span className="numeric text-xs tracking-[.16em] text-[var(--ink-faint)]">{number}</span><div className="mt-3 flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]">{icon}</div></div>
      <div><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ink-faint)]">{detail}</p></div>{action}</div><div className="mt-4">{children}</div></div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="border-y border-[var(--line)] py-4 text-xs text-[var(--ink-faint)]">{children}</div>;
}

function EditButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="focus-ring flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)] disabled:hidden" aria-label="Edit"><Pencil className="size-3.5" /></button>;
}

export function InventoryCatalogWorkspace({ model, workspace }: { model: LiveInventoryModel; workspace: WorkspaceContextValue }) {
  const catalog = model.catalog ?? emptyCatalog;
  const router = useRouter();
  const [dialog, setDialog] = useState<CatalogDialog | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canConfigureFoundation = workspace.role === "admin" || workspace.role === "owner";
  const canConfigureUnits = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.unit.manage");
  const canConfigureCategories = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.category.manage");
  const canConfigureItems = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.item.manage") || hasCapability(workspace.capabilities, "inventory.catalog.manage");
  const canConfigureVendors = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.vendor.manage");
  const canConfigureVendorItems = canConfigureFoundation || (
    hasCapability(workspace.capabilities, "inventory.vendor.manage")
    && hasCapability(workspace.capabilities, "inventory.price.manage")
  );
  const canConfigureCosts = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.price.manage");
  const canEnterStock = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.count.create");
  const canConfigurePars = canConfigureFoundation || hasCapability(workspace.capabilities, "inventory.par.manage");
  const canConfigureRecipes = canConfigureFoundation || hasCapability(workspace.capabilities, "recipe.manage");
  const canConfigureOperations = canConfigureUnits || canConfigureCategories || canConfigureItems || canConfigureVendors || canConfigureVendorItems || canConfigureCosts || canEnterStock || canConfigurePars || canConfigureRecipes;
  const unitById = new Map(catalog.units.map((unit) => [unit.id, unit]));
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const stockById = new Map(model.items.map((item) => [item.id, item]));
  const vendorById = new Map(catalog.vendors.map((vendor) => [vendor.id, vendor]));
  const locationById = new Map(model.locations.map((location) => [location.id, location]));
  const latestPriceByItem = new Map<string, NonNullable<LiveInventoryCatalog["priceHistory"]>[number]>();
  for (const price of catalog.priceHistory ?? []) {
    if (!latestPriceByItem.has(price.inventoryItemId)) latestPriceByItem.set(price.inventoryItemId, price);
  }
  const open = (
    kind: CatalogDialog["kind"],
    record?: UnitRecord | ConversionRecord | CategoryRecord | VendorRecord | ItemRecord | VendorItemRecord | RecipeRecord,
  ) => {
    setNotice("");
    setDialog({ kind, requestId: crypto.randomUUID(), ...(record ? { record } : {}) } as CatalogDialog);
  };
  const save = async (input: unknown) => {
    setBusy(true);
    setNotice("");
    try {
      const candidate = input as Record<string, unknown>;
      const result = "submissionId" in candidate
        ? await submitInventoryCountAction(input)
        : "unitPriceCents" in candidate && !("command" in candidate)
          ? await recordInventoryItemCostAction(input)
          : await configureInventoryCatalogAction(input);
      if (!result.ok) {
        setNotice(result.message ?? "The inventory setup change could not be saved.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setNotice("The inventory setup change could not be saved. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const action = (label: string, kind: CatalogDialog["kind"], disabled = false, allowed = canConfigureFoundation) => allowed ? <PermissionAwareAction permission={disabled ? { state: "missing_prerequisite", explanation: kind === "recipe" ? "Add a measurement unit first; inventory ingredients can be added after the draft is saved." : "Complete the prior setup step first." } : { state: "allowed" }}>{({ disabled: actionDisabled }) => <Button size="sm" variant="secondary" disabled={actionDisabled} onClick={() => open(kind)}><Plus className="size-3.5" />{label}</Button>}</PermissionAwareAction> : null;

  return (
    <section className="mt-5">
      <div className="flex flex-col justify-between gap-4 pb-5 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2"><Settings2 className="size-4 text-[var(--accent-strong)]" /><span className="text-xs font-semibold tracking-[.14em] text-[var(--accent-strong)] uppercase">Guided setup</span></div><h3 className="mt-3 text-xl font-medium tracking-[-0.04em]">Inventory foundation</h3><p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--ink-faint)]">Start with units, then add products, costs, opening stock, and recipe specs.</p></div><StatusPill tone={canConfigureOperations ? "positive" : "neutral"}>{canConfigureOperations ? "Ready to configure" : "Read only"}</StatusPill></div>
      {!canConfigureOperations ? <div className="mb-5 flex items-start gap-3 rounded-xl bg-[var(--warning-soft)] px-4 py-3 text-xs leading-5 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />Inventory setup is read only for this account.</div> : null}

      <SetupStep number="01" icon={<ArrowRightLeft className="size-4" />} title="Units & conversions" detail="Define the canonical language for count, mass, volume, and length before creating items." action={<div className="flex gap-2">{action("Unit", "unit", false, canConfigureUnits)}{action("Conversion", "conversion", catalog.units.filter((unit) => unit.isActive).length < 2)}</div>}>
        {catalog.units.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.units.map((unit) => <div key={unit.id} className="flex items-center gap-3 py-3"><span className="numeric w-14 text-xs font-semibold">{unit.symbol}</span><span className="min-w-0 flex-1 text-xs">{unit.name}<span className="ml-2 text-xs text-[var(--ink-faint)]">{unit.dimension}{unit.isBase ? " · base" : ""}</span></span><StatusPill tone={unit.isActive ? "positive" : "neutral"}>{unit.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigureUnits} onClick={() => open("unit", unit)} /></div>)}</div> : <EmptyLine>Add the first canonical unit—typically each, ounce, pound, or milliliter.</EmptyLine>}
        {catalog.conversions.length ? <div className="mt-3 divide-y divide-[var(--line)]">{catalog.conversions.map((conversion) => <div key={conversion.id} className="flex items-center gap-3 py-2 text-xs"><span className="numeric flex-1">1 {unitById.get(conversion.fromUnitId)?.symbol ?? "?"} = {conversion.multiplier} {unitById.get(conversion.toUnitId)?.symbol ?? "?"}{conversion.inventoryItemId ? ` · ${itemById.get(conversion.inventoryItemId)?.name ?? "Item specific"}` : ""}</span><StatusPill tone={conversion.isActive ? "positive" : "neutral"}>{conversion.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigureFoundation} onClick={() => open("conversion", conversion)} /></div>)}</div> : null}
      </SetupStep>

      <SetupStep number="02" icon={<Tags className="size-4" />} title="Categories" detail="A stable reporting hierarchy for ingredients, beverages, supplies, and other tracked stock." action={action("Category", "category", false, canConfigureCategories)}>
        {catalog.categories.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.categories.map((category) => <div key={category.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1 text-xs font-semibold">{category.name}<span className="ml-2 text-xs font-normal text-[var(--ink-faint)]">{category.parentId ? `under ${catalog.categories.find((candidate) => candidate.id === category.parentId)?.name ?? "category"}` : "top level"}</span></span><StatusPill tone={category.isActive ? "positive" : "neutral"}>{category.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigureCategories} onClick={() => open("category", category)} /></div>)}</div> : <EmptyLine>Add your first inventory category, or continue with uncategorized products.</EmptyLine>}
      </SetupStep>

      <SetupStep number="03" icon={<PackageOpen className="size-4" />} title="Vendors" detail="Keep purchasing contacts and terms tied to durable vendor identities." action={action("Vendor", "vendor", false, canConfigureVendors)}>
        {catalog.vendors.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.vendors.map((vendor) => <div key={vendor.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{vendor.name}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{[vendor.contactName, vendor.paymentTerms, vendor.accountNumber].filter(Boolean).join(" · ") || "No contact details"}</span></span><StatusPill tone={vendor.isActive ? "positive" : "neutral"}>{vendor.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigureVendors} onClick={() => open("vendor", vendor)} /></div>)}</div> : <EmptyLine>Add a vendor before configuring purchase packs or creating orders.</EmptyLine>}
      </SetupStep>

      <SetupStep number="04" icon={<Boxes className="size-4" />} title="Inventory items" detail="Every item gets one canonical base unit. Tracking can be paused without erasing its ledger history." action={action("Item", "item", !catalog.units.some((unit) => unit.isActive), canConfigureItems)}>
        {catalog.items.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.items.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.name}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{item.sku || "No SKU"} · base {unitById.get(item.baseUnitId)?.symbol ?? "?"} · {item.trackInventory ? "tracked" : "not tracked"}</span></span><StatusPill tone={item.isActive ? "positive" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigureItems} onClick={() => open("item", item)} /></div>)}</div> : <EmptyLine>Create units first, then add the restaurant’s real inventory items.</EmptyLine>}
      </SetupStep>

      <SetupStep number="05" icon={<CircleDollarSign className="size-4" />} title="Unit costs & opening stock" detail="Price an ingredient directly per gram, ounce, each, or another configured unit. Enter current stock as an auditable full count." action={<div className="flex flex-wrap gap-2">{action("Unit cost", "cost", !catalog.items.some((item) => item.isActive) || !catalog.units.some((unit) => unit.isActive), canConfigureCosts)}{action("Opening stock", "stock", !model.items.length, canEnterStock)}</div>}>
        {catalog.items.some((item) => item.isActive) ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.items.filter((item) => item.isActive).map((item) => { const price = latestPriceByItem.get(item.id); const stock = stockById.get(item.id); return <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 text-xs sm:grid-cols-[1fr_.7fr_.7fr]"><span className="font-semibold">{item.name}</span><span className="numeric text-right sm:text-left">{price ? `${formatMoney(price.unitPriceCents, model.currencyCode)} / ${price.priceQuantity} ${unitById.get(price.unitId)?.symbol ?? "unit"}` : "Cost missing"}</span><span className="numeric hidden text-[var(--ink-faint)] sm:block">{stock ? `${stock.onHand} ${stock.unitSymbol} on hand` : "Not stock-tracked"}</span></div>; })}</div> : <EmptyLine>Create an inventory item before adding a direct unit cost or opening stock.</EmptyLine>}
      </SetupStep>

      <SetupStep number="06" icon={<PackageOpen className="size-4" />} title="Purchase packs & vendor prices" detail="Optionally map how each vendor sells an item. Vendor prices remain separate, effective-dated evidence." action={action("Purchase pack", "vendor-item", !catalog.vendors.some((vendor) => vendor.isActive) || !catalog.items.some((item) => item.isActive) || !catalog.units.some((unit) => unit.isActive), canConfigureVendorItems)}>
        {catalog.vendorItems.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.vendorItems.map((vendorItem) => <div key={vendorItem.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{vendorById.get(vendorItem.vendorId)?.name ?? "Vendor"} · {itemById.get(vendorItem.inventoryItemId)?.name ?? "Item"}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{vendorItem.packQuantity} {unitById.get(vendorItem.purchaseUnitId)?.symbol ?? "unit"}{vendorItem.vendorSku ? ` · ${vendorItem.vendorSku}` : ""}{vendorItem.isPreferred ? " · preferred" : ""}</span></span><span className="numeric text-xs font-semibold">{vendorItem.lastPriceCents == null ? "—" : formatMoney(vendorItem.lastPriceCents, model.currencyCode)}</span><StatusPill tone={vendorItem.isActive ? "positive" : "neutral"}>{vendorItem.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigureVendorItems} onClick={() => open("vendor-item", vendorItem)} /></div>)}</div> : <EmptyLine>Purchase packs become available after an active vendor, item, unit, and canonical conversion exist.</EmptyLine>}
      </SetupStep>

      <SetupStep number="07" icon={<MapPin className="size-4" />} title="Location pars" detail="Effective-dated targets let the kitchen carry the right amount without overwriting prior periods." action={action("Set par", "par", !catalog.items.some((item) => item.isActive) || !model.locations.length, canConfigurePars)}>
        {catalog.pars.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.pars.map((par) => <div key={par.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-xs sm:grid-cols-[1fr_.6fr_.6fr_auto]"><span className="font-semibold">{itemById.get(par.inventoryItemId)?.name ?? "Inventory item"}<span className="ml-2 text-xs font-normal text-[var(--ink-faint)]">{locationById.get(par.locationId)?.name ?? "Location"}</span></span><span className="numeric hidden sm:block">Par {par.parQuantity}</span><span className="numeric hidden sm:block">Reorder {par.reorderQuantity ?? "—"}</span><span className="text-xs text-[var(--ink-faint)]">from {par.effectiveFrom}</span></div>)}</div> : <EmptyLine>No location targets have been set.</EmptyLine>}
      </SetupStep>

      <SetupStep number="08" icon={<UtensilsCrossed className="size-4" />} title="Recipes & ingredients" detail="Recipes version on every save. Ingredient costs resolve from the direct unit prices or vendor price history above." action={action("Recipe", "recipe", !catalog.units.some((unit) => unit.isActive), canConfigureRecipes)}>
        {catalog.recipes.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.recipes.map((recipe) => <div key={recipe.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{recipe.name}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">Yields {recipe.yieldQuantity} {unitById.get(recipe.yieldUnitId)?.symbol ?? "unit"} · {recipe.ingredients.length} ingredients{recipe.ingredients.length ? "" : " · costing incomplete"}</span></span><span className="numeric text-xs font-semibold">{recipe.menuPriceCents == null ? "—" : formatMoney(recipe.menuPriceCents, model.currencyCode)}</span><StatusPill tone={recipe.isActive ? "positive" : "neutral"}>{recipe.isActive ? "Published" : "Draft"}</StatusPill><EditButton disabled={!canConfigureRecipes} onClick={() => open("recipe", recipe)} /></div>)}</div> : <EmptyLine>Create a recipe draft now. Inventory ingredients and prices can be added later.</EmptyLine>}
      </SetupStep>

      <div className="mt-2 flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/45 px-4 py-3 text-xs leading-5 text-[var(--accent-strong)]"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Catalog writes are actor-derived, tenant-checked, and idempotent. Direct browser inserts, updates, and deletes are revoked.</div>
      <AnimatePresence>{dialog ? <CatalogMutationDialog key={`${dialog.kind}:${dialog.requestId}`} dialog={dialog} catalog={catalog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={() => { if (!busy) setDialog(null); }} onError={setNotice} onSave={save} /> : null}</AnimatePresence>
    </section>
  );
}
