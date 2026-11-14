"use client";

import { useState } from "react";
import { ChurchSquareReconciliation } from "@/components/today/church-square-reconciliation";
import { Button } from "@/components/ui/button";
import {
  churchSquareOrderWindowHours,
  churchSquareOrderWindowPath,
  churchSquareOrderWindowResponse,
  type ChurchSquareOrderWindowResponse,
} from "@/lib/integrations/church-square-order-window";

type Order = ChurchSquareOrderWindowResponse["orders"][number];
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

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const localTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

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
          <p className="mt-1 text-sm text-[var(--ink-soft)]">Orders updated in the past {churchSquareOrderWindowHours} hours.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={state.status === "loading"} onClick={load}>
          {state.status === "loading" ? "Checking Square…" : state.status === "idle" ? "Load orders" : "Refresh orders"}
        </Button>
      </div>
      <div role="status" className="mt-3 text-xs text-[var(--ink-faint)]">
        {state.status === "loading" && "Checking for recent order updates."}
        {state.status === "forbidden" && "This order view requires access to Church Street financial reports."}
        {state.status === "setup_pending" && "The Square order connection is awaiting setup."}
        {state.status === "unavailable" && "Square orders could not be loaded. Try refreshing."}
        {state.status === "ready" && (
          <>
            {state.window.orders.length === 0 ? "No recent orders returned by Square." : "Checked"}{" "}
            <time dateTime={state.window.checkedAt}>{localTime.format(new Date(state.window.checkedAt))} ET</time>
            {state.window.hasMore && " · More results are available in Square."}
          </>
        )}
      </div>
      {state.status === "ready" && state.window.orders.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--ink-faint)]">
                <th scope="col" className="px-3 py-2">Order ID suffix</th>
                <th scope="col" className="px-3 py-2">Source hint</th>
                <th scope="col" className="px-3 py-2">Order state</th>
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
    </section>
  );
}
