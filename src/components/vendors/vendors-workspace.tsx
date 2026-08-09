"use client";

import { ArrowUpRight, PackageOpen, Search, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoIds, demoWorkspace } from "@/lib/demo";
import { formatMoney } from "@/lib/utils";

const playgroundVendors = demoWorkspace.vendors;
const playgroundInventoryItems = demoWorkspace.inventoryItems.filter((item) =>
  item.locationSettings.some((setting) => setting.locationId === demoIds.locations.garden && setting.active),
);
const playgroundInventoryPrices = demoWorkspace.inventoryPrices;
const playgroundPurchaseOrders = demoWorkspace.purchaseOrders.filter(
  (order) => order.locationId === demoIds.locations.garden,
);

export function VendorsWorkspace() {
  const workspace = useWorkspaceContext();
  // These fixtures are visibly synthetic and exist only in demo mode.
  const vendors = playgroundVendors;
  const inventoryItems = playgroundInventoryItems;
  const inventoryPrices = playgroundInventoryPrices;
  const purchaseOrders = playgroundPurchaseOrders;
  const [query, setQuery] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState(vendors[0]?.id ?? "");
  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) ?? vendors[0];
  const filteredVendors = useMemo(
    () => vendors.filter((vendor) => `${vendor.name} ${vendor.contactName}`.toLowerCase().includes(query.trim().toLowerCase())),
    [query, vendors],
  );
  const vendorPrices = inventoryPrices.filter((price) => price.vendorId === selectedVendor?.id);
  const activeOrders = purchaseOrders.filter(
    (order) => order.vendorId === selectedVendor?.id && !["received", "cancelled"].includes(order.status),
  );

  return (
    <PageFrame width="full" className="max-w-[1400px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="positive" dot>Purchasing context</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">Le Yard · {workspace.persona === "chef" ? "Chef view" : "Back office"}</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Vendors & prices</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">Compare current food costs, review recent price movement, and see open orders before building the kitchen plan.</p>
        </div>
        <Button variant="secondary" size="sm" disabled><Truck className="size-3.5" /> Add vendor</Button>
      </div>

      <section className="mt-6 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Active vendors" value={String(vendors.filter((vendor) => vendor.active).length)} detail="Synthetic directory" />
        <Metric label="Price records" value={String(inventoryPrices.length)} detail="Synthetic price history" />
        <Metric label="Open orders" value={String(purchaseOrders.filter((order) => !["received", "cancelled"].includes(order.status)).length)} detail={`${purchaseOrders.length} synthetic orders`} />
        <Metric label="Primary room" value="Le Yard" detail="858 9th Ave" />
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[.72fr_1.28fr]">
        <section>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <SectionHeading eyebrow="Purchasing list" title="Vendors" detail="Add a vendor to inspect current pricing." className="mb-0" />
            <label className="relative block sm:w-56">
              <span className="sr-only">Search vendors</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vendors" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-[13px] outline-none focus:border-[var(--accent)]" />
            </label>
          </div>
          <div className="mt-4 border-y border-[var(--line)]">
            {filteredVendors.map((vendor) => (
              <button type="button" key={vendor.id} onClick={() => setSelectedVendorId(vendor.id)} className={`flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)] ${vendor.id === selectedVendor?.id ? "bg-[var(--paper)]" : ""}`}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><PackageOpen className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{vendor.name.replace(" — Demo", "")}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{vendor.contactName} · {vendor.paymentTerms}</span></span>
                <StatusPill tone={vendor.active ? "positive" : "neutral"}>{vendor.active ? "Active" : "Inactive"}</StatusPill>
              </button>
            ))}
            {!filteredVendors.length ? <p className="px-4 py-8 text-center text-[13px] text-[var(--ink-faint)]">No vendors yet. Add one when purchasing is ready.</p> : null}
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Selected vendor" title={selectedVendor?.name.replace(" — Demo", "") ?? "No vendor selected"} detail={selectedVendor ? `${selectedVendor.contactName} · ${selectedVendor.paymentTerms}` : "Vendor pricing will appear here after you add a vendor."} />
          <div className="border-y border-[var(--line)]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-[var(--canvas-strong)] px-3 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Food item</span><span>Unit</span><span className="text-right">Latest price</span></div>
            {vendorPrices.map((price) => {
              const item = inventoryItems.find((candidate) => candidate.id === price.itemId);
              return <div key={price.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-[var(--line)] px-3 py-4"><div><p className="text-[13px] font-semibold">{item?.name ?? "Inventory item"}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Effective {price.effectiveOn}</p></div><span className="text-xs text-[var(--ink-faint)]">/{price.unit}</span><span className="numeric text-sm font-semibold">{formatMoney(price.unitCostCents)}</span></div>;
            })}
            {!vendorPrices.length ? <p className="px-4 py-10 text-center text-[13px] text-[var(--ink-faint)]">No verified price records for this vendor yet.</p> : null}
          </div>
          <div className="mt-6">
            <SectionHeading eyebrow="Open orders" title={`${activeOrders.length} order${activeOrders.length === 1 ? "" : "s"} in motion`} detail="Order totals come from the purchasing record." />
            {activeOrders.length ? <div className="border-y border-[var(--line)]">{activeOrders.map((order) => <div key={order.id} className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><Truck className="size-4 text-[var(--ink-faint)]" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{order.orderNumber}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{order.lines.length} line items · expected {order.expectedOn}</p></div><span className="numeric text-xs font-semibold">{formatMoney(order.totalCents)}</span><ArrowUpRight className="size-3.5 text-[var(--ink-faint)]" /></div>)}</div> : <p className="border-y border-[var(--line)] px-3 py-5 text-[13px] text-[var(--ink-faint)]">No open orders with this vendor.</p>}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
