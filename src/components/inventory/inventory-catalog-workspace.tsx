"use client";

import { AnimatePresence } from "motion/react";
import {
  ArrowRightLeft,
  Boxes,
  Check,
  CircleAlert,
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
import { configureInventoryCatalogAction } from "@/app/actions/workflows/inventory";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveInventoryCatalog, LiveInventoryModel } from "@/data/read-models/inventory";
import { localDateTimeParts, zonedLocalToIso } from "@/data/read-models/local-time";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { parseInventoryMoneyToCents, parseInventoryQuantity } from "@/lib/inventory/input-parsing";
import { formatMoney } from "@/lib/utils";
import { InventoryModalFrame } from "./inventory-modal-frame";

type UnitRecord = LiveInventoryCatalog["units"][number];
type ConversionRecord = LiveInventoryCatalog["conversions"][number];
type CategoryRecord = LiveInventoryCatalog["categories"][number];
type VendorRecord = LiveInventoryCatalog["vendors"][number];
type ItemRecord = LiveInventoryCatalog["items"][number];
type VendorItemRecord = LiveInventoryCatalog["vendorItems"][number];
type RecipeRecord = LiveInventoryCatalog["recipes"][number];

type CatalogDialog =
  | { kind: "unit"; requestId: string; record?: UnitRecord }
  | { kind: "conversion"; requestId: string; record?: ConversionRecord }
  | { kind: "category"; requestId: string; record?: CategoryRecord }
  | { kind: "vendor"; requestId: string; record?: VendorRecord }
  | { kind: "item"; requestId: string; record?: ItemRecord }
  | { kind: "vendor-item"; requestId: string; record?: VendorItemRecord }
  | { kind: "par"; requestId: string }
  | { kind: "recipe"; requestId: string; record?: RecipeRecord };

const emptyCatalog: LiveInventoryCatalog = {
  units: [],
  conversions: [],
  categories: [],
  vendors: [],
  items: [],
  vendorItems: [],
  pars: [],
  recipes: [],
};

const fieldClass = "h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55";
const textAreaClass = "w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-xs leading-5 outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[10px] font-semibold text-[var(--ink-soft)]">
      <span>{label}</span>
      {children}
      {hint ? <span className="font-normal leading-4 text-[var(--ink-faint)]">{hint}</span> : null}
    </label>
  );
}

function Toggle({ name, defaultChecked, label = "Active" }: { name: string; defaultChecked: boolean; label?: string }) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[10px] font-semibold text-[var(--ink-soft)]">
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

function FormActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="accent" disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
        Save change
      </Button>
    </div>
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

  return <RecipeDialog dialog={dialog} catalog={catalog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={onClose} onError={onError} onSave={onSave} />;
}

function RecipeDialog({
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
    <InventoryModalFrame title={record ? "Edit recipe" : "Add recipe"} description="Each save creates an immutable recipe snapshot. Ingredients stay connected to canonical item units for live costing." labelledBy="catalog-recipe-dialog" notice={notice} onClose={onClose} width="max-w-5xl">
      <form onSubmit={(event) => void submit(event)}>
        <div className="grid gap-5 px-5 py-5 sm:px-7">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Recipe name"><input name="name" required autoFocus maxLength={160} defaultValue={record?.name} className={fieldClass} /></Field><Field label="Yield"><input name="yieldQuantity" required inputMode="decimal" defaultValue={record?.yieldQuantity ?? 1} className={fieldClass} /></Field><Field label="Yield unit"><select name="yieldUnitId" required defaultValue={record?.yieldUnitId} className={fieldClass}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></Field><Field label={`Menu price · ${model.currencyCode}`}><input name="menuPrice" inputMode="decimal" defaultValue={record?.menuPriceCents == null ? "" : (record.menuPriceCents / 100).toFixed(2)} className={fieldClass} /></Field></div>
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold text-[var(--ink-soft)]">Ingredients</p><Button type="button" size="sm" variant="secondary" disabled={!initialItem || busy} onClick={() => setIngredients((current) => [...current, { key: crypto.randomUUID(), inventoryItemId: initialItem!.id, unitId: initialItem!.baseUnitId, quantity: "1", wastePercent: "0" }])}><Plus className="size-3.5" />Add ingredient</Button></div>
            <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {ingredients.map((ingredient, index) => <div key={ingredient.key} className="grid gap-3 py-3 sm:grid-cols-[1.2fr_.8fr_.55fr_.55fr_auto]"><Field label={`Item ${index + 1}`}><select aria-label={`Ingredient item ${index + 1}`} value={ingredient.inventoryItemId} onChange={(event) => { const item = itemById.get(event.target.value); updateIngredient(ingredient.key, { inventoryItemId: event.target.value, unitId: item?.baseUnitId ?? "" }); }} className={fieldClass}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Unit"><select aria-label={`Ingredient unit ${index + 1}`} value={ingredient.unitId} onChange={(event) => updateIngredient(ingredient.key, { unitId: event.target.value })} className={fieldClass}>{compatibleUnits(ingredient.inventoryItemId).map((unit) => <option key={unit.id} value={unit.id}>{unit.symbol}</option>)}</select></Field><Field label="Quantity"><input aria-label={`Ingredient quantity ${index + 1}`} inputMode="decimal" value={ingredient.quantity} onChange={(event) => updateIngredient(ingredient.key, { quantity: event.target.value })} className={fieldClass} /></Field><Field label="Waste %"><input aria-label={`Ingredient waste ${index + 1}`} inputMode="decimal" value={ingredient.wastePercent} onChange={(event) => updateIngredient(ingredient.key, { wastePercent: event.target.value })} className={fieldClass} /></Field><button type="button" aria-label={`Remove ingredient ${index + 1}`} disabled={busy} onClick={() => setIngredients((current) => current.filter((candidate) => candidate.key !== ingredient.key))} className="focus-ring mt-5 flex size-9 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><X className="size-4" /></button></div>)}
              {!ingredients.length ? <p className="py-5 text-center text-[10px] text-[var(--ink-faint)]">Inactive recipes may be saved without ingredients. Add one before activating.</p> : null}
            </div>
          </div>
          <Toggle name="isActive" defaultChecked={record?.isActive ?? true} />
          <FormActions busy={busy} onClose={onClose} />
        </div>
      </form>
    </InventoryModalFrame>
  );
}

function SetupStep({ number, icon, title, detail, action, children }: { number: string; icon: ReactNode; title: string; detail: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-[var(--line)] py-6 md:grid-cols-[7.5rem_1fr]">
      <div><span className="numeric text-[9px] tracking-[.16em] text-[var(--ink-faint)]">{number}</span><div className="mt-3 flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]">{icon}</div></div>
      <div><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-2xl text-[10px] leading-5 text-[var(--ink-faint)]">{detail}</p></div>{action}</div><div className="mt-4">{children}</div></div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="border-y border-[var(--line)] py-4 text-[10px] text-[var(--ink-faint)]">{children}</div>;
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
  const roleAllows = workspace.role === "owner" || workspace.role === "admin";
  const canConfigure = workspace.role === "admin" || (workspace.role === "owner" && workspace.identity.aal === "aal2");
  const unitById = new Map(catalog.units.map((unit) => [unit.id, unit]));
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const vendorById = new Map(catalog.vendors.map((vendor) => [vendor.id, vendor]));
  const locationById = new Map(model.locations.map((location) => [location.id, location]));
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
      const result = await configureInventoryCatalogAction(input);
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
  const action = (label: string, kind: CatalogDialog["kind"], disabled = false) => canConfigure ? <Button size="sm" variant="secondary" disabled={disabled} onClick={() => open(kind)}><Plus className="size-3.5" />{label}</Button> : null;

  return (
    <section className="mt-5">
      <div className="flex flex-col justify-between gap-4 pb-5 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2"><Settings2 className="size-4 text-[var(--accent-strong)]" /><span className="text-[9px] font-semibold tracking-[.14em] text-[var(--accent-strong)] uppercase">Dependency-ordered setup</span></div><h3 className="mt-3 text-xl font-medium tracking-[-0.04em]">Inventory foundation</h3><p className="mt-1 max-w-2xl text-[11px] leading-5 text-[var(--ink-faint)]">Start with units, then build the catalog downward. Records deactivate or version; they are not deleted from operational history.</p></div><StatusPill tone={canConfigure ? "positive" : "neutral"}>{canConfigure ? "Owner/Admin writes" : "Read only"}</StatusPill></div>
      {!canConfigure ? <div className="mb-5 flex items-start gap-3 rounded-xl bg-[var(--warning-soft)] px-4 py-3 text-[10px] leading-5 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />{roleAllows ? "Owner changes require a current multi-factor session." : "Only Owners and Admins can change inventory setup."}</div> : null}

      <SetupStep number="01" icon={<ArrowRightLeft className="size-4" />} title="Units & conversions" detail="Define the canonical language for count, mass, volume, and length before creating items." action={<div className="flex gap-2">{action("Unit", "unit")}{action("Conversion", "conversion", catalog.units.filter((unit) => unit.isActive).length < 2)}</div>}>
        {catalog.units.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.units.map((unit) => <div key={unit.id} className="flex items-center gap-3 py-3"><span className="numeric w-14 text-xs font-semibold">{unit.symbol}</span><span className="min-w-0 flex-1 text-xs">{unit.name}<span className="ml-2 text-[9px] text-[var(--ink-faint)]">{unit.dimension}{unit.isBase ? " · base" : ""}</span></span><StatusPill tone={unit.isActive ? "positive" : "neutral"}>{unit.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("unit", unit)} /></div>)}</div> : <EmptyLine>Add the first canonical unit—typically each, ounce, pound, or milliliter.</EmptyLine>}
        {catalog.conversions.length ? <div className="mt-3 divide-y divide-[var(--line)]">{catalog.conversions.map((conversion) => <div key={conversion.id} className="flex items-center gap-3 py-2 text-[10px]"><span className="numeric flex-1">1 {unitById.get(conversion.fromUnitId)?.symbol ?? "?"} = {conversion.multiplier} {unitById.get(conversion.toUnitId)?.symbol ?? "?"}{conversion.inventoryItemId ? ` · ${itemById.get(conversion.inventoryItemId)?.name ?? "Item specific"}` : ""}</span><StatusPill tone={conversion.isActive ? "positive" : "neutral"}>{conversion.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("conversion", conversion)} /></div>)}</div> : null}
      </SetupStep>

      <SetupStep number="02" icon={<Tags className="size-4" />} title="Categories" detail="A stable reporting hierarchy for ingredients, beverages, supplies, and other tracked stock." action={action("Category", "category")}>
        {catalog.categories.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.categories.map((category) => <div key={category.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1 text-xs font-semibold">{category.name}<span className="ml-2 text-[9px] font-normal text-[var(--ink-faint)]">{category.parentId ? `under ${catalog.categories.find((candidate) => candidate.id === category.parentId)?.name ?? "category"}` : "top level"}</span></span><StatusPill tone={category.isActive ? "positive" : "neutral"}>{category.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("category", category)} /></div>)}</div> : <EmptyLine>Categories are optional; items can begin uncategorized.</EmptyLine>}
      </SetupStep>

      <SetupStep number="03" icon={<PackageOpen className="size-4" />} title="Vendors" detail="Keep purchasing contacts and terms tied to durable vendor identities." action={action("Vendor", "vendor")}>
        {catalog.vendors.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.vendors.map((vendor) => <div key={vendor.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{vendor.name}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{[vendor.contactName, vendor.paymentTerms, vendor.accountNumber].filter(Boolean).join(" · ") || "No contact details"}</span></span><StatusPill tone={vendor.isActive ? "positive" : "neutral"}>{vendor.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("vendor", vendor)} /></div>)}</div> : <EmptyLine>Add a vendor before configuring purchase packs or creating orders.</EmptyLine>}
      </SetupStep>

      <SetupStep number="04" icon={<Boxes className="size-4" />} title="Inventory items" detail="Every item gets one canonical base unit. Tracking can be paused without erasing its ledger history." action={action("Item", "item", !catalog.units.some((unit) => unit.isActive))}>
        {catalog.items.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.items.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.name}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{item.sku || "No SKU"} · base {unitById.get(item.baseUnitId)?.symbol ?? "?"} · {item.trackInventory ? "tracked" : "not tracked"}</span></span><StatusPill tone={item.isActive ? "positive" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("item", item)} /></div>)}</div> : <EmptyLine>Create units first, then add the restaurant’s real inventory items.</EmptyLine>}
      </SetupStep>

      <SetupStep number="05" icon={<PackageOpen className="size-4" />} title="Purchase packs & prices" detail="Map how each vendor sells an item. Prices are stored in integer cents and append dated history." action={action("Purchase pack", "vendor-item", !catalog.vendors.some((vendor) => vendor.isActive) || !catalog.items.some((item) => item.isActive) || !catalog.units.some((unit) => unit.isActive))}>
        {catalog.vendorItems.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.vendorItems.map((vendorItem) => <div key={vendorItem.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{vendorById.get(vendorItem.vendorId)?.name ?? "Vendor"} · {itemById.get(vendorItem.inventoryItemId)?.name ?? "Item"}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{vendorItem.packQuantity} {unitById.get(vendorItem.purchaseUnitId)?.symbol ?? "unit"}{vendorItem.vendorSku ? ` · ${vendorItem.vendorSku}` : ""}{vendorItem.isPreferred ? " · preferred" : ""}</span></span><span className="numeric text-xs font-semibold">{vendorItem.lastPriceCents == null ? "—" : formatMoney(vendorItem.lastPriceCents, model.currencyCode)}</span><StatusPill tone={vendorItem.isActive ? "positive" : "neutral"}>{vendorItem.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("vendor-item", vendorItem)} /></div>)}</div> : <EmptyLine>Purchase packs become available after an active vendor, item, unit, and canonical conversion exist.</EmptyLine>}
      </SetupStep>

      <SetupStep number="06" icon={<MapPin className="size-4" />} title="Location pars" detail="Effective-dated targets let each room or kitchen carry the right amount without overwriting prior periods." action={action("Set par", "par", !catalog.items.some((item) => item.isActive) || !model.locations.length)}>
        {catalog.pars.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.pars.map((par) => <div key={par.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-xs sm:grid-cols-[1fr_.6fr_.6fr_auto]"><span className="font-semibold">{itemById.get(par.inventoryItemId)?.name ?? "Inventory item"}<span className="ml-2 text-[9px] font-normal text-[var(--ink-faint)]">{locationById.get(par.locationId)?.name ?? "Location"}</span></span><span className="numeric hidden sm:block">Par {par.parQuantity}</span><span className="numeric hidden sm:block">Reorder {par.reorderQuantity ?? "—"}</span><span className="text-[9px] text-[var(--ink-faint)]">from {par.effectiveFrom}</span></div>)}</div> : <EmptyLine>No location targets have been set.</EmptyLine>}
      </SetupStep>

      <SetupStep number="07" icon={<UtensilsCrossed className="size-4" />} title="Recipes & ingredients" detail="Recipes version on every save, preserving the exact ingredient snapshot behind historical costing." action={action("Recipe", "recipe", !catalog.items.some((item) => item.isActive) || !catalog.units.some((unit) => unit.isActive))}>
        {catalog.recipes.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{catalog.recipes.map((recipe) => <div key={recipe.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{recipe.name}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">Yields {recipe.yieldQuantity} {unitById.get(recipe.yieldUnitId)?.symbol ?? "unit"} · {recipe.ingredients.length} ingredients</span></span><span className="numeric text-xs font-semibold">{recipe.menuPriceCents == null ? "—" : formatMoney(recipe.menuPriceCents, model.currencyCode)}</span><StatusPill tone={recipe.isActive ? "positive" : "neutral"}>{recipe.isActive ? "Active" : "Inactive"}</StatusPill><EditButton disabled={!canConfigure} onClick={() => open("recipe", recipe)} /></div>)}</div> : <EmptyLine>Recipes can be configured after items and compatible units exist.</EmptyLine>}
      </SetupStep>

      <div className="mt-2 flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/45 px-4 py-3 text-[10px] leading-5 text-[var(--accent-strong)]"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Catalog writes are actor-derived, tenant-checked, and idempotent. Direct browser inserts, updates, and deletes are revoked.</div>
      <AnimatePresence>{dialog ? <CatalogMutationDialog key={`${dialog.kind}:${dialog.requestId}`} dialog={dialog} catalog={catalog} model={model} workspace={workspace} busy={busy} notice={notice} onClose={() => { if (!busy) setDialog(null); }} onError={setNotice} onSave={save} /> : null}</AnimatePresence>
    </section>
  );
}
