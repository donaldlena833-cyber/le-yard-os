"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import {
  churchSquareOrderWatchLimit, churchSquareOrderWatchPath, churchSquareOrderWatchResponse, type ChurchSquareOrderWatch,
  summarizeChurchSquareFulfillments, type ChurchSquareFulfillmentRow,
} from "@/lib/integrations/church-square-order-watch";

const refreshMs = 20_000;
const coverageLagMs = 12 * 60_000;
const visibleFulfillmentLimit = 12;
const localTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const sourceLabels: Record<string, string> = {
  DOORDASH: "DoorDash", UBER_EATS: "Uber Eats", GRUBHUB: "Grubhub", SQUARE_ONLINE: "Square Online",
  SQUARE_POS: "Square POS", SQUARE_INVOICES: "Square Invoices", UNKNOWN: "Unknown source",
};

type State = { locationId: string; status: "ready" | "unavailable" | "offline" | "forbidden"; data?: ChurchSquareOrderWatch };
const timeBands = [
  { key: "started", label: "Window started" },
  { key: "next15", label: "Next 15 minutes" },
  { key: "next30", label: "15–30 minutes" },
  { key: "next60", label: "30–60 minutes" },
  { key: "unscheduled", label: "No window time" },
] as const;

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{localTime.format(new Date(value))} ET</time>;
}

function actionText({ fulfillment: { type, status }, ready }: ChurchSquareFulfillmentRow, started: boolean) {
  if (ready) {
    if (!started) return "Marked ready";
    return type === "PICKUP" ? "Marked ready · Check pickup status" : "Marked ready · Check delivery status";
  }
  if (started) return "Check prep status";
  if (status === "PROPOSED") return "Review on register";
  return "Prep pending";
}

function OrderWatchRows({ rows, started = false }: { rows: readonly ChurchSquareFulfillmentRow[]; started?: boolean }) {
  return (
    <>
      <ul className="mt-1 divide-y divide-[var(--line)]" aria-label="Order fulfillments">
        {rows.slice(0, visibleFulfillmentLimit).map((row) => (
          <li key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-xs">
            <span className="font-semibold">{row.fulfillment.type === "PICKUP" ? "Pickup" : "Delivery"}</span>
            <span className="font-mono">{row.reference}</span>
            <span>{sourceLabels[row.source]}</span>
            <StatusPill size="sm" tone={row.ready ? "neutral" : "warning"}>{actionText(row, started)}</StatusPill>
            {row.fulfillment.promisedAt && <span className="text-[var(--ink-soft)]">Starts <Time value={row.fulfillment.promisedAt} /></span>}
          </li>
        ))}
      </ul>
      {rows.length > visibleFulfillmentLimit && <p className="text-xs text-[var(--ink-soft)]">{rows.length - visibleFulfillmentLimit} more in this group. Check the register for the full queue.</p>}
    </>
  );
}

function OrderWatchList({ data }: { data: ChurchSquareOrderWatch }) {
  const buckets = summarizeChurchSquareFulfillments(data);
  const hasFulfillments = Object.values(buckets).some(({ rows }) => rows.length > 0);
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]" tabIndex={0} role="region" aria-label="Next-hour workload">
        <table className="w-full text-left text-xs tabular-nums">
          <caption className="px-3 pb-1 pt-3 text-left text-sm font-semibold">Next-hour workload</caption>
          <thead className="bg-[var(--canvas-strong)] text-[var(--ink-soft)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Window start</th>
              <th scope="col" className="px-3 py-2 font-medium">Pickup<br />Not marked ready / Ready</th>
              <th scope="col" className="px-3 py-2 font-medium">Delivery<br />Not marked ready / Ready</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {timeBands.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row" className="px-3 py-2 font-medium">{label}</th>
                <td className="px-3 py-2">{buckets[key].pickup.needsPrep} / {buckets[key].pickup.ready}</td>
                <td className="px-3 py-2">{buckets[key].delivery.needsPrep} / {buckets[key].delivery.ready}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.catering?.status === "ready" && (
        <p className="mt-2 text-xs text-[var(--ink-soft)]">
          <Link href="/kitchen#catering-prep-title" className="focus-ring rounded font-semibold underline underline-offset-2">Today’s published catering</Link>
          {" · "}<strong>{data.catering.stillToBuild} portions still to build</strong> of {data.catering.published} published.{" "}
          <Link href="/catering" className="focus-ring rounded underline underline-offset-2">Check Catering for handoff timing</Link>.
        </p>
      )}
      {data.catering?.status === "unavailable" && <p className="mt-2 text-xs text-[var(--ink-soft)]">Today’s catering portions could not be loaded. Check Kitchen.</p>}
      {hasFulfillments ? (
        <div className="mt-3 space-y-3">
          {timeBands.filter(({ key }) => buckets[key].rows.length > 0).map(({ key, label }) => (
            <div key={key}>
              <h4 className="text-sm font-semibold">{label} · {buckets[key].rows.length}</h4>
              <OrderWatchRows rows={buckets[key].rows} started={key === "started"} />
            </div>
          ))}
          {buckets.later.rows.length > 0 && (
            <details className="border-t border-[var(--line)] pt-2">
              <summary className="focus-ring cursor-pointer rounded text-xs font-semibold">Starts later · {buckets.later.rows.length}</summary>
              <OrderWatchRows rows={buckets.later.rows} />
            </details>
          )}
        </div>
      ) : <p className="mt-3 text-sm text-[var(--ink-soft)]">The available records contain no open pickup or delivery fulfillments.</p>}
    </>
  );
}

export function ChurchSquareOrderWatchPanel({ locationId }: { locationId: string }) {
  const [state, setState] = useState<State>();
  const current = state?.locationId === locationId ? state : undefined;

  useEffect(() => {
    let active = true;
    let denied = false;
    let inFlight: AbortController | null = null;
    let timer: number | undefined;
    let requestTimeout: number | undefined;

    function update(status: State["status"], data?: ChurchSquareOrderWatch) {
      if (!active) return;
      setState((previous) => ({ locationId, status, data: data ?? (
        status !== "forbidden" && previous?.locationId === locationId ? previous.data : undefined
      ) }));
    }

    function suspend() {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      requestTimeout = undefined;
      inFlight?.abort();
      inFlight = null;
    }

    async function refresh() {
      if (!active || denied || document.hidden || inFlight) return;
      if (!navigator.onLine) {
        update("offline");
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      const controller = new AbortController();
      inFlight = controller;
      const timeout = requestTimeout = window.setTimeout(() => {
        if (inFlight !== controller) return;
        update("unavailable");
        suspend();
        if (!document.hidden && navigator.onLine) timer = window.setTimeout(refresh, refreshMs);
      }, 10_000);
      try {
        const query = new URLSearchParams({ locationId });
        const response = await fetch(`${churchSquareOrderWatchPath}?${query}`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (inFlight !== controller || controller.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) {
          denied = true;
          update("forbidden");
          return;
        }
        if (!response.ok) {
          update("unavailable");
          return;
        }
        const parsed = churchSquareOrderWatchResponse.safeParse(await response.json());
        if (inFlight === controller && !controller.signal.aborted) {
          if (parsed.success) update("ready", parsed.data);
          else update("unavailable");
        }
      } catch {
        if (inFlight === controller && !controller.signal.aborted) update("unavailable");
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) {
          requestTimeout = undefined;
          inFlight = null;
          if (!denied && !document.hidden && navigator.onLine) timer = window.setTimeout(refresh, refreshMs);
        }
      }
    }

    function visibility() {
      if (document.hidden) suspend();
      else void refresh();
    }

    function offline() {
      suspend();
      if (!denied) update("offline");
    }

    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      suspend();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [locationId]);

  if (current?.status === "forbidden") return null;
  const data = current?.data;
  const lag = data?.orderCoverageThrough ? Date.parse(data.checkedAt) - Date.parse(data.orderCoverageThrough) : Infinity;

  return (
    <section aria-labelledby="church-square-order-watch-title" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h3 id="church-square-order-watch-title" className="text-lg font-semibold">Square pickup and delivery watch</h3>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">Open fulfillments in up to {churchSquareOrderWatchLimit} orders updated in the past 24 hours. Square supplies the customer window and channel. For delivery, confirm courier pickup timing on the staffed ticket.</p>
      <div role="status" className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
        {!current && "Checking Operations for pending orders."}
        {current?.status === "unavailable" && <p>Could not refresh the order watch.{data && " Showing the last available records."}</p>}
        {current?.status === "offline" && <p>Offline.{data && " Showing the last available records."}</p>}
      </div>
      {data && (
        <>
          <div className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
            <p>Operations checked <Time value={data.checkedAt} />.</p>
            {data.orderCoverageThrough ? <p>Square order recovery through <Time value={data.orderCoverageThrough} />.</p> : <p>Square order recovery coverage is unavailable.</p>}
            {Number.isFinite(lag) && lag > coverageLagMs && <p className="text-[var(--warning)]">Square order recovery was more than 12 minutes behind at the last check. Check the register for newer orders.</p>}
            {data.hasMore && <p>Partial results. Additional open orders may be outside this view.</p>}
          </div>
          <OrderWatchList data={data} />
        </>
      )}
    </section>
  );
}
