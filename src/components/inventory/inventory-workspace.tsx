"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Check,
  ClipboardCheck,
  PackageOpen,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, PageHeader, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { demoIds, demoWorkspace } from "@/lib/demo";
import { cn, formatMoney } from "@/lib/utils";
import type { InventoryUnit, WasteRecord } from "@/types";

type Tab = "stock" | "count" | "orders" | "vendors" | "recipes" | "waste";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "stock", label: "Stock" },
  { id: "count", label: "Counts" },
  { id: "orders", label: "Orders" },
  { id: "vendors", label: "Vendors" },
  { id: "recipes", label: "Recipes" },
  { id: "waste", label: "Waste" },
];

// Demo mode uses the clearly synthetic fixture catalog. Connected mode has a
// separate data layer and never falls back to these records.
const playgroundInventoryItems = demoWorkspace.inventoryItems.filter((item) =>
  item.locationSettings.some((setting) => setting.locationId === demoIds.locations.garden && setting.active),
);
const playgroundPurchaseOrders = demoWorkspace.purchaseOrders.filter(
  (order) => order.locationId === demoIds.locations.garden,
);
const playgroundVendors = demoWorkspace.vendors;
const playgroundRecipes = demoWorkspace.recipes;
const emptyCountLines: typeof demoWorkspace.inventoryCounts[number]["lines"] = [];

export function InventoryWorkspace() {
  const workspace = useWorkspaceContext();
  const locationId = demoIds.locations.garden;
  const latestCountLines = demoWorkspace.inventoryCounts.find((count) => count.locationId === locationId)?.lines ?? emptyCountLines;
  const [activeTab, setActiveTab] = useState<Tab>("stock");
  const [query, setQuery] = useState("");
  const [countValues, setCountValues] = useState<Record<string, number>>(
    Object.fromEntries(latestCountLines.map((line) => [line.itemId, line.countedQuantity])),
  );
  const [countSubmitted, setCountSubmitted] = useState(false);
  const [waste, setWaste] = useState<WasteRecord[]>(
    demoWorkspace.wasteRecords.filter((record) => record.locationId === locationId),
  );
  const [wasteOpen, setWasteOpen] = useState(false);

  const stockRows = useMemo(
    () =>
      playgroundInventoryItems
        .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
        .map((item) => {
          const line = latestCountLines.find((candidate) => candidate.itemId === item.id);
          const settings = item.locationSettings.find((candidate) => candidate.locationId === locationId);
          const onHand = line?.countedQuantity ?? 0;
          return { item, onHand, par: settings?.parLevel ?? 0, reorder: settings?.reorderPoint ?? 0 };
        }),
    [latestCountLines, locationId, query],
  );

  const inventoryValue = stockRows.reduce(
    (sum, row) => sum + row.onHand * row.item.lastUnitCostCents,
    0,
  );
  const belowPar = stockRows.filter((row) => row.onHand < row.par).length;

  function addWaste(formData: FormData) {
    const itemId = String(formData.get("itemId"));
    const item = playgroundInventoryItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const quantity = Number(formData.get("quantity") || 0);
    const unit = String(formData.get("unit") || item.baseUnit) as InventoryUnit;
    const reason = String(formData.get("reason") || "other") as WasteRecord["reason"];
    setWaste((current) => [
      {
        id: `waste-${Date.now()}`,
        organizationId: demoIds.organization,
        locationId,
        itemId,
        quantity,
        unit,
        valueCents: Math.round(quantity * item.lastUnitCostCents),
        reason,
        recordedBy: workspace.identity.userId,
        occurredAt: new Date().toISOString(),
        note: String(formData.get("note") || ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setWasteOpen(false);
  }

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Food & beverage control"
        title="Inventory"
        detail={`${workspace.activeLocation.name} · Synthetic operational snapshot`}
        status={<StatusPill tone="neutral">Demo data</StatusPill>}
        actions={<>
          <Button variant="secondary" onClick={() => setWasteOpen(true)}><Trash2 className="size-4" /> Record waste</Button>
          <Button variant="secondary" onClick={() => setActiveTab("orders")}><ShoppingCart className="size-4" /> New order</Button>
          <Button variant="accent" onClick={() => setActiveTab("count")}><ClipboardCheck className="size-4" /> Start count</Button>
        </>}
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Inventory value" value={formatMoney(Math.round(inventoryValue))} detail="Latest approved quantities" /></Surface>
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Below par" value={String(belowPar)} detail={`${stockRows.length} tracked items`} trend={{ label: belowPar ? "Reorder" : "Healthy", tone: belowPar ? "negative" : "positive" }} /></Surface>
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Open orders" value={String(playgroundPurchaseOrders.filter((order) => !["received", "cancelled"].includes(order.status)).length)} detail={`${playgroundPurchaseOrders.length} synthetic orders`} /></Surface>
        <Surface variant="raised" className="min-h-36"><Metric className="px-5 first:pl-5" label="Waste · 7d" value={formatMoney(waste.reduce((sum, record) => sum + record.valueCents, 0))} detail={`${waste.length} synthetic records`} /></Surface>
      </section>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-[var(--line)]">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn("focus-ring relative min-h-10 shrink-0 px-3 text-[13px] font-semibold transition-colors", activeTab === tab.id ? "text-[var(--ink)]" : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]")}>
            {tab.label}
            {activeTab === tab.id ? <motion.span layoutId="inventory-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}
          </button>
        ))}
      </div>

      {activeTab === "stock" ? (
        <section className="mt-5">
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <SectionHeading title="On hand" detail="Counted quantity compared with location par" className="mb-0" />
            <label className="relative block sm:w-72"><Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search items" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-xs outline-none focus:border-[var(--accent)]" /></label>
          </div>
          <div className="overflow-x-auto border-y border-[var(--line)]" tabIndex={0} role="region" aria-label="Inventory on hand table">
            <div className="grid min-w-[720px] grid-cols-[1.35fr_.6fr_.6fr_.65fr_.7fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Item</span><span>On hand</span><span>Par</span><span>Status</span><span className="text-right">Unit cost</span></div>
            {stockRows.map(({ item, onHand, par, reorder }) => {
              const status = onHand <= reorder ? "reorder" : onHand < par ? "below" : "healthy";
              return <button key={item.id} className="focus-ring grid min-w-[720px] w-full grid-cols-[1.35fr_.6fr_.6fr_.65fr_.7fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 text-left hover:bg-[var(--paper)]"><span className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><Boxes className="size-3.5 text-[var(--ink-faint)]" /></span><span><span className="block text-xs font-semibold">{item.name}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{item.sku} · {item.category}</span></span></span><span className="numeric text-xs font-semibold">{onHand} <span className="font-normal text-[var(--ink-faint)]">{item.baseUnit}</span></span><span className="numeric text-xs text-[var(--ink-faint)]">{par}</span><span><StatusPill tone={status === "healthy" ? "positive" : status === "reorder" ? "danger" : "warning"}>{status === "healthy" ? "Healthy" : status === "reorder" ? "Reorder" : "Below par"}</StatusPill></span><span className="numeric text-right text-xs">{formatMoney(item.lastUnitCostCents)} / {item.baseUnit}</span></button>;
            })}
          </div>
        </section>
      ) : null}

      {activeTab === "count" ? (
        <section className="mt-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><SectionHeading title="Live count" detail="Expected quantity remains visible; submit for manager approval when complete." className="mb-0" /><StatusPill tone={countSubmitted ? "positive" : "warning"} dot>{countSubmitted ? "Submitted" : "In progress"}</StatusPill></div>
          <div className="mt-4 overflow-x-auto border-y border-[var(--line)]" tabIndex={0} role="region" aria-label="Inventory count form">
            <div className="grid min-w-[680px] grid-cols-[1.3fr_.6fr_.65fr_.65fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Item</span><span>Expected</span><span>Counted</span><span>Variance</span></div>
            {playgroundInventoryItems.map((item) => {
              const line = latestCountLines.find((candidate) => candidate.itemId === item.id);
              const expected = line?.expectedQuantity || 0;
              const counted = countValues[item.id] ?? 0;
              const variance = counted - expected;
              return <div key={item.id} className="grid min-w-[680px] grid-cols-[1.3fr_.6fr_.65fr_.65fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3"><div><p className="text-xs font-semibold">{item.name}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{item.baseUnit}</p></div><span className="numeric text-xs text-[var(--ink-faint)]">{expected}</span><input aria-label={`Counted ${item.name}`} type="number" step="0.1" min="0" value={counted} disabled={countSubmitted} onChange={(event) => { setCountValues((current) => ({ ...current, [item.id]: Number(event.target.value) })); setCountSubmitted(false); }} className="h-9 w-24 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-right text-xs font-semibold outline-none focus:border-[var(--accent)] disabled:opacity-60" /><span className={cn("numeric flex items-center gap-1 text-xs font-semibold", variance < 0 ? "text-[var(--danger)]" : variance > 0 ? "text-[var(--positive)]" : "text-[var(--ink-faint)]")}>{variance < 0 ? <ArrowDown className="size-3" /> : variance > 0 ? <ArrowUp className="size-3" /> : null}{variance.toFixed(1)}</span></div>;
            })}
          </div>
          <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setCountValues(Object.fromEntries(latestCountLines.map((line) => [line.itemId, line.countedQuantity])))}>Reset</Button><Button variant="accent" disabled={countSubmitted} onClick={() => setCountSubmitted(true)}><Check className="size-4" /> {countSubmitted ? "Submitted" : "Submit count"}</Button></div>
        </section>
      ) : null}

      {activeTab === "orders" ? (
        <section className="mt-5"><SectionHeading title="Purchase orders" detail="Create, receive, and match orders to invoices." action={<Button variant="accent" size="sm"><Plus className="size-3.5" /> New order</Button>} /><div className="border-y border-[var(--line)]">{playgroundPurchaseOrders.map((order) => { const vendor = playgroundVendors.find((item) => item.id === order.vendorId); return <button key={order.id} className="focus-ring flex w-full items-center gap-4 border-t border-[var(--line)] px-4 py-4 text-left first:border-0 hover:bg-[var(--paper)]"><span className="flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><Truck className="size-4 text-[var(--ink-faint)]" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{vendor?.name}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{order.orderNumber} · Expected {order.expectedOn} · {order.lines.length} lines</span></span><span className="numeric text-xs font-semibold">{formatMoney(order.totalCents)}</span><StatusPill tone={order.status === "received" ? "positive" : "warning"}>{order.status}</StatusPill></button>; })}{!playgroundPurchaseOrders.length ? <p className="px-4 py-10 text-center text-[13px] text-[var(--ink-faint)]">No purchase orders yet.</p> : null}</div></section>
      ) : null}

      {activeTab === "vendors" ? (
        <section className="mt-5"><SectionHeading title="Vendors" detail="Contacts, terms, and recent price movement." /> <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">{playgroundVendors.map((vendor) => <div key={vendor.id} className="flex items-start gap-3 border-b border-[var(--line)] py-4"><span className="flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><PackageOpen className="size-4 text-[var(--ink-faint)]" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{vendor.name}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{vendor.contactName} · {vendor.paymentTerms}</p><p className="mt-2 text-xs text-[var(--ink-soft)]">{vendor.email}</p></div><StatusPill tone="positive">Active</StatusPill></div>)}{!playgroundVendors.length ? <p className="px-4 py-8 text-center text-[13px] text-[var(--ink-faint)]">No vendors yet.</p> : null}</div></section>
      ) : null}

      {activeTab === "recipes" ? (
        <section className="mt-5"><SectionHeading title="Recipe costing" detail="Current ingredient costs compared with menu price." /><div className="border-y border-[var(--line)]">{playgroundRecipes.map((recipe) => <div key={recipe.id} className="grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--line)] px-4 py-4 first:border-0 sm:grid-cols-[1.2fr_.5fr_.5fr_.5fr]"><div><p className="text-xs font-semibold">{recipe.name}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{recipe.menuCode} · {recipe.ingredients.length} ingredients</p></div><div className="hidden sm:block"><p className="text-xs text-[var(--ink-faint)]">Cost</p><p className="numeric mt-1 text-xs font-semibold">{formatMoney(recipe.costPerYieldCents)}</p></div><div className="hidden sm:block"><p className="text-xs text-[var(--ink-faint)]">Menu price</p><p className="numeric mt-1 text-xs font-semibold">{formatMoney(recipe.menuPriceCents)}</p></div><div className="text-right sm:text-left"><p className="text-xs text-[var(--ink-faint)]">Food cost</p><p className={cn("numeric mt-1 text-xs font-semibold", recipe.foodCostPercentage > 30 ? "text-[var(--warning)]" : "text-[var(--positive)]")}>{recipe.foodCostPercentage.toFixed(1)}%</p></div></div>)}{!playgroundRecipes.length ? <p className="px-4 py-8 text-center text-[13px] text-[var(--ink-faint)]">No recipes yet. Add measured components from Kitchen.</p> : null}</div></section>
      ) : null}

      {activeTab === "waste" ? (
        <section className="mt-5"><SectionHeading title="Waste log" detail="Human-entered adjustments; AI may suggest but never posts them." action={<Button variant="accent" size="sm" onClick={() => setWasteOpen(true)}><Plus className="size-3.5" /> Record waste</Button>} /><div className="border-y border-[var(--line)]">{waste.map((record) => { const item = playgroundInventoryItems.find((candidate) => candidate.id === record.itemId); return <div key={record.id} className="flex items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-0"><span className="flex size-9 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]"><Trash2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{item?.name}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{record.quantity} {record.unit} · {record.reason.replaceAll("_", " ")} · {new Date(record.occurredAt).toLocaleString()}</p></div><span className="numeric text-xs font-semibold">{formatMoney(record.valueCents)}</span></div>; })}{!waste.length ? <p className="px-4 py-8 text-center text-[13px] text-[var(--ink-faint)]">No waste records yet.</p> : null}</div></section>
      ) : null}

      <div className="mt-7 flex items-start gap-3 rounded-[16px] bg-[var(--accent-soft)]/50 px-4 py-3 text-xs leading-4 text-[var(--accent-strong)]"><Sparkles className="mt-0.5 size-4 shrink-0" /><span><strong>Inventory intelligence is ready.</strong> Invoice recognition will suggest matches after you add catalog items; manager approval is required before stock changes.</span></div>

      <AnimatePresence>
        {wasteOpen ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setWasteOpen(false); }}>
            <motion.div role="dialog" aria-modal="true" aria-label="Record waste" className="w-full max-w-lg rounded-[22px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-6" initial={{ y: 12, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, scale: .98 }}>
              <div className="flex items-start justify-between"><div><p className="eyebrow">Inventory adjustment</p><h3 className="mt-2 text-lg font-semibold">Record waste</h3></div><Button variant="quiet" size="icon" onClick={() => setWasteOpen(false)}><X className="size-4" /></Button></div>
              <form action={addWaste} className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold">Item</span><select name="itemId" disabled={!playgroundInventoryItems.length} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">{playgroundInventoryItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!playgroundInventoryItems.length ? <span className="mt-1 block text-xs text-[var(--ink-faint)]">Add an inventory item before recording waste.</span> : null}</label>
                <label><span className="mb-1.5 block text-xs font-semibold">Quantity</span><input required name="quantity" type="number" min="0.1" step="0.1" defaultValue="1" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
                <label><span className="mb-1.5 block text-xs font-semibold">Unit</span><select name="unit" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option>ounce</option><option>pound</option><option>each</option><option>liter</option></select></label>
                <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold">Reason</span><select name="reason" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="spoilage">Spoilage</option><option value="prep_error">Prep error</option><option value="guest_return">Guest return</option><option value="damage">Damage</option><option value="other">Other</option></select></label>
                <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold">Note</span><textarea name="note" rows={3} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs" /></label>
                <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="quiet" onClick={() => setWasteOpen(false)}>Cancel</Button><Button type="submit" variant="accent"><Check className="size-3.5" /> Record adjustment</Button></div>
              </form>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </PageFrame>
  );
}
