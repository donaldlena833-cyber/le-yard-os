"use client";

import { useState } from "react";
import { ChurchSquareCateringInvoice } from "@/components/today/church-square-catering-invoice";
import { ChurchSquareReconciliation } from "@/components/today/church-square-reconciliation";
import { Button } from "@/components/ui/button";
import {
  churchSquareDemandHorizons,
  churchSquareOrderWindowHours,
  churchSquareOrderWindowLimit,
  churchSquareOrderWindowPath,
  churchSquareOrderWindowResponse,
  summarizeChurchSquareFulfillmentDemand,
  type ChurchSquareOrderWindowResponse,
} from "@/lib/integrations/church-square-order-window";
import { summarizeChurchSquareSources } from "@/lib/integrations/church-square-source-summary";

type Order = ChurchSquareOrderWindowResponse["orders"][number];
type Fulfillment = Order["fulfillments"][number];
type State =
  | { status: "idle" | "loading" | "forbidden" | "setup_pending" | "unavailable" }
  | { status: "ready"; window: ChurchSquareOrderWindowResponse };

const sources: Record<Order["source"], string> = {
  DOORDASH: "DoorDash",
  UBER_EATS: "Uber Eats",
  GRUBHUB: "Grubhub",
  SQUARE_ONLINE: "Square Online",
  SQUARE_POS: "Square POS",
  SQUARE_INVOICES: "Square Invoices",
  UNKNOWN: "Unknown",
};

const statuses: Record<Order["status"], string> = {
  OPEN: "Open",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
  DRAFT: "Draft",
  UNKNOWN: "Unknown",
};

const fulfillmentTypes: Record<Fulfillment["type"], string> = {
  PICKUP: "Pickup",
  DELIVERY: "Delivery",
  SHIPMENT: "Shipment",
  UNKNOWN: "Fulfillment",
};

const fulfillmentStatuses: Record<Fulfillment["status"], string> = {
  PROPOSED: "Proposed",
  RESERVED: "Reserved",
  PREPARED: "Ready",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
  FAILED: "Failed",
  UNKNOWN: "Status unavailable",
};

const scheduledLabels: Record<Fulfillment["type"], string> = {
  PICKUP: "Pickup window",
  DELIVERY: "Scheduled delivery",
  SHIPMENT: "Scheduled shipment",
  UNKNOWN: "Scheduled",
};

const handoffLabels: Record<Fulfillment["type"], string> = {
  PICKUP: "Picked up",
  DELIVERY: "Delivered",
  SHIPMENT: "Shipped",
  UNKNOWN: "Handoff",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const localTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function SquareFulfillmentDemand({ window }: { window: ChurchSquareOrderWindowResponse }) {
  const demand = summarizeChurchSquareFulfillmentDemand(window);

  return (
    <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 sm:p-4">
      <h4 id="church-square-demand-title" className="text-sm font-semibold">Pickup and delivery due</h4>
      <p id="church-square-demand-scope" className="mt-1 text-xs text-[var(--ink-soft)]">
        Counts cover pending fulfillments at the last manual check, including orders already ready for pickup or delivery. Time windows use Square’s promised times and overlap.
        {window.hasMore && " Partial results. More orders may fall within this window."}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table aria-labelledby="church-square-demand-title" aria-describedby="church-square-demand-scope church-square-orders-bounds church-square-orders-check" className="w-full text-xs">
          <thead className="text-[var(--ink-soft)]">
            <tr className="border-b border-[var(--line)]">
              <th scope="col" className="py-2 pr-1 text-left sm:pr-2">Type</th>
              <th scope="col" className="px-1 py-2 text-right sm:px-2">Past due</th>
              {churchSquareDemandHorizons.map((minutes) => (
                <th key={minutes} scope="col" className="px-1 py-2 text-right sm:px-2">Next {minutes} min</th>
              ))}
              <th scope="col" className="py-2 pl-1 text-right sm:pl-2">No promised time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)] tabular-nums">
            {(["PICKUP", "DELIVERY"] as const).map((type) => (
              <tr key={type}>
                <th scope="row" className="py-2 pr-2 text-left font-medium">{fulfillmentTypes[type]}</th>
                <td className="px-2 py-2 text-right">{demand[type].pastDue}</td>
                {churchSquareDemandHorizons.map((minutes) => (
                  <td key={minutes} className="px-2 py-2 text-right">{demand[type].upcoming[minutes]}</td>
                ))}
                <td className="py-2 pl-2 text-right">{demand[type].noPromisedTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceTiming({ timing }: { timing: ReturnType<typeof summarizeChurchSquareSources>[number]["pickup"] }) {
  return (
    <>
      <p className="font-medium tabular-nums">{timing.comparable ? `${timing.byTarget} of ${timing.comparable} by window start` : "No comparable times"}</p>
      <p className="mt-0.5 text-[var(--ink-soft)]">{timing.fulfillmentCount} sampled</p>
    </>
  );
}

function SquareSourceActivity({ window }: { window: ChurchSquareOrderWindowResponse }) {
  const rows = summarizeChurchSquareSources(window);
  return (
    <section aria-labelledby="church-square-sources-title" className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 sm:p-4">
      <h4 id="church-square-sources-title" className="text-sm font-semibold">Order activity by Square source</h4>
      <p id="church-square-sources-context" className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
        {window.orders.length} {window.orders.length === 1 ? "order" : "orders"} in this manual sample. Square provides source hints. Orders without a recognized hint appear as Unknown source.
        {window.hasMore && " Square may have more orders in this window."}
      </p>
      <p id="church-square-sources-timing" className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
        Timing compares reported pickup and delivery with the start of their respective Square windows. Rejections can overlap order states.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table aria-labelledby="church-square-sources-title" aria-describedby="church-square-sources-context church-square-sources-timing church-square-orders-bounds church-square-orders-check" className="w-full text-left text-xs">
          <thead className="border-b border-[var(--line)] text-[var(--ink-soft)]">
            <tr>
              <th scope="col" className="py-2 pr-2">Source hint</th>
              <th scope="col" className="px-2 py-2">Orders</th>
              <th scope="col" className="px-2 py-2">Pickup timing</th>
              <th scope="col" className="py-2 pl-2">Delivery timing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {rows.map((row) => (
              <tr key={row.source} className="align-top">
                <th scope="row" className="py-2 pr-2 font-medium">{row.source === "UNKNOWN" ? "Unknown source" : sources[row.source]}</th>
                <td className="px-2 py-2">
                  <p className="font-medium tabular-nums">{row.orderCount} {row.orderCount === 1 ? "order" : "orders"}</p>
                  <p className="mt-0.5 text-[var(--ink-soft)]">{row.open} open · {row.completed} completed · {row.canceled} canceled</p>
                  {(row.draft > 0 || row.unknownStatus > 0) && <p className="mt-0.5 text-[var(--ink-soft)]">{row.draft} draft · {row.unknownStatus} unknown status</p>}
                  {row.rejectedOrders > 0 && <p className="mt-0.5 text-[var(--ink-soft)]">{row.rejectedOrders} with a rejection recorded</p>}
                </td>
                <td className="px-2 py-2"><SourceTiming timing={row.pickup} /></td>
                <td className="py-2 pl-2"><SourceTiming timing={row.delivery} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrderFulfillmentSummary({ fulfillments }: { fulfillments: Order["fulfillments"] }) {
  if (!fulfillments.length) return <span className="text-[var(--ink-faint)]">Unavailable</span>;

  return (
    <ul className="min-w-40 space-y-2">
      {fulfillments.map((fulfillment, index) => {
        const milestones = [
          [scheduledLabels[fulfillment.type], fulfillment.promisedAt],
          ["Ready", fulfillment.readyAt],
          [handoffLabels[fulfillment.type], fulfillment.handoffAt],
          ["Completed", fulfillment.completedAt === fulfillment.handoffAt ? null : fulfillment.completedAt],
          ["Canceled", fulfillment.canceledAt],
          ["Rejected", fulfillment.rejectedAt],
        ] as const;
        return (
          <li key={index}>
            <div className="font-medium">
              {fulfillmentTypes[fulfillment.type]} · {fulfillmentStatuses[fulfillment.status]}
            </div>
            {milestones.map(([label, at]) => at && (
              <div key={label} className="mt-0.5 whitespace-nowrap text-[var(--ink-soft)]">
                {label} <time dateTime={at}>{localTime.format(new Date(at))}</time>
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

export function ChurchSquareOrderWindow() {
  const [state, setState] = useState<State>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const response = await fetch(churchSquareOrderWindowPath, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(27_000),
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        setState({ status: "forbidden" });
        return;
      }
      const body: unknown = await response.json();
      if (!response.ok) {
        const setupPending = response.status === 503
          && typeof body === "object" && body !== null && "status" in body && body.status === "setup_pending";
        setState({ status: setupPending ? "setup_pending" : "unavailable" });
        return;
      }
      const result = churchSquareOrderWindowResponse.safeParse(body);
      setState(result.success ? { status: "ready", window: result.data } : { status: "unavailable" });
    } catch {
      setState({ status: "unavailable" });
    }
  }

  return (
    <section aria-labelledby="church-square-orders-title" className="mt-9 border-y border-[var(--line)] py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="church-square-orders-title" className="text-xl font-semibold">Church Street Square orders</h3>
          <p id="church-square-orders-bounds" className="mt-1 text-sm text-[var(--ink-soft)]">Manual check of up to {churchSquareOrderWindowLimit} orders updated in the previous {churchSquareOrderWindowHours} hours.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={state.status === "loading"} onClick={load}>
          {state.status === "loading" ? "Checking Square…" : state.status === "idle" ? "Load orders" : "Refresh orders"}
        </Button>
      </div>
      <div id="church-square-orders-check" role="status" className="mt-3 text-xs text-[var(--ink-faint)]">
        {state.status === "loading" && "Checking for recent order updates."}
        {state.status === "forbidden" && "This order view requires access to Church Street financial reports."}
        {state.status === "setup_pending" && "The Square order connection is awaiting setup."}
        {state.status === "unavailable" && "Square orders could not be loaded. Try refreshing."}
        {state.status === "ready" && (
          <>
            Last checked <time dateTime={state.window.checkedAt}>{localTime.format(new Date(state.window.checkedAt))} ET</time>
            {state.window.orders.length === 0 && " · Square returned no orders in this read."}
          </>
        )}
      </div>
      {state.status === "ready" && <SquareFulfillmentDemand window={state.window} />}
      {state.status === "ready" && state.window.orders.length > 0 && <SquareSourceActivity window={state.window} />}
      {state.status === "ready" && state.window.orders.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--ink-faint)]">
                <th scope="col" className="px-3 py-2">Order ID suffix</th>
                <th scope="col" className="px-3 py-2">Source hint</th>
                <th scope="col" className="px-3 py-2">Order state</th>
                <th scope="col" className="px-3 py-2">Fulfillment (ET)</th>
                <th scope="col" className="px-3 py-2 text-right">Recorded total</th>
                <th scope="col" className="px-3 py-2 text-right">Updated (ET)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {state.window.orders.map((order, index) => (
                <tr key={`${order.reference}-${index}`}>
                  <th scope="row" className="whitespace-nowrap px-3 py-2 font-mono font-medium">{order.reference}</th>
                  <td className="px-3 py-2">{sources[order.source]}</td>
                  <td className="px-3 py-2">{statuses[order.status]}</td>
                  <td className="px-3 py-2"><OrderFulfillmentSummary fulfillments={order.fulfillments} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {order.totalCents === null ? "—" : money.format(order.totalCents / 100)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <time dateTime={order.updatedAt}>{localTime.format(new Date(order.updatedAt))}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ChurchSquareReconciliation />
      <ChurchSquareCateringInvoice />
    </section>
  );
}
