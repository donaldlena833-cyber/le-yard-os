"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import {
  churchSquareOrderWatchLimit, churchSquareOrderWatchPath, churchSquareOrderWatchResponse, type ChurchSquareOrderWatch,
} from "@/lib/integrations/church-square-order-watch";

const refreshMs = 20_000;
const coverageLagMs = 12 * 60_000;
const nextWindowMs = 15 * 60_000;
const visibleFulfillmentLimit = 12;
const localTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const sourceLabels: Record<string, string> = {
  DOORDASH: "DoorDash", UBER_EATS: "Uber Eats", GRUBHUB: "Grubhub", SQUARE_ONLINE: "Square Online",
  SQUARE_POS: "Square POS", SQUARE_INVOICES: "Square Invoices", UNKNOWN: "Unknown source",
};

type State = { locationId: string; status: "ready" | "unavailable" | "offline" | "forbidden"; data?: ChurchSquareOrderWatch };
type Fulfillment = ChurchSquareOrderWatch["orders"][number]["fulfillments"][number];

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{localTime.format(new Date(value))} ET</time>;
}

function markedReady({ status, readyAt }: Fulfillment) {
  return status === "PREPARED" || readyAt !== null;
}

function actionText(fulfillment: Fulfillment, started: boolean) {
  const { type, status } = fulfillment;
  if (markedReady(fulfillment)) {
    if (!started) return "Marked ready";
    return type === "PICKUP" ? "Marked ready · Check pickup status" : "Marked ready · Check delivery status";
  }
  if (started) return "Check prep status";
  if (status === "PROPOSED") return "Review on register";
  return "Prep pending";
}

function OrderWatchList({ data }: { data: ChurchSquareOrderWatch }) {
  const checkedAt = Date.parse(data.checkedAt);
  const rows = data.orders.flatMap(({ reference, source, fulfillments }, orderIndex) => fulfillments.flatMap((fulfillment, index) => {
    if (fulfillment.handoffAt || fulfillment.completedAt || fulfillment.canceledAt || fulfillment.rejectedAt) return [];
    const scheduled = fulfillment.promisedAt ? Date.parse(fulfillment.promisedAt) : null;
    return [{ reference, source, fulfillment, scheduled, key: `${reference}:${orderIndex}:${index}` }];
  }));
  const groups = [
    { label: "Window started", rows: rows.filter(({ scheduled }) => scheduled !== null && scheduled <= checkedAt) },
    { label: "Next 15 minutes", rows: rows.filter(({ scheduled }) => scheduled !== null && scheduled > checkedAt && scheduled <= checkedAt + nextWindowMs) },
    { label: "No window time", rows: rows.filter(({ scheduled }) => scheduled === null) },
  ];
  const later = rows.filter(({ scheduled }) => scheduled !== null && scheduled > checkedAt + nextWindowMs);

  function renderRows(group: typeof rows) {
    return (
      <>
        <ul className="mt-1 divide-y divide-[var(--line)]" aria-label="Order fulfillments">
          {[...group].sort((left, right) => (left.scheduled ?? Infinity) - (right.scheduled ?? Infinity))
            .slice(0, visibleFulfillmentLimit).map(({ key, reference, source, fulfillment, scheduled }) => (
              <li key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-xs">
                <span className="font-semibold">{fulfillment.type === "PICKUP" ? "Pickup" : "Delivery"}</span>
                <span className="font-mono">{reference}</span>
                <span>{sourceLabels[source] ?? "Unknown source"}</span>
                <StatusPill size="sm" tone={markedReady(fulfillment) ? "neutral" : "warning"}>{actionText(fulfillment, scheduled !== null && scheduled <= checkedAt)}</StatusPill>
                {fulfillment.promisedAt && <span className="text-[var(--ink-soft)]">Starts <Time value={fulfillment.promisedAt} /></span>}
              </li>
            ))}
        </ul>
        {group.length > visibleFulfillmentLimit && <p className="text-xs text-[var(--ink-soft)]">{group.length - visibleFulfillmentLimit} more in this group. Check the register for the full queue.</p>}
      </>
    );
  }

  return (
    <>
      {groups.some((group) => group.rows.length > 0) ? (
        <div className="mt-3 space-y-3">
          {groups.filter((group) => group.rows.length > 0).map(({ label, rows: group }) => (
            <div key={label}>
              <h4 className="text-sm font-semibold">{label} · {group.length}</h4>
              {renderRows(group)}
            </div>
          ))}
        </div>
      ) : <p className="mt-3 text-sm text-[var(--ink-soft)]">The available records contain no open fulfillments with a started, near-term or missing window.</p>}
      {later.length > 0 && (
        <details className="mt-3 border-t border-[var(--line)] pt-2">
          <summary className="focus-ring cursor-pointer rounded text-xs font-semibold">Starts later · {later.length}</summary>
          {renderRows(later)}
        </details>
      )}
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
      <p className="mt-1 text-xs text-[var(--ink-soft)]">Open pickup and delivery fulfillments in up to {churchSquareOrderWatchLimit} orders updated in the past 24 hours. Times are the start of Square’s reported windows. Match the staffed ticket before starting prep.</p>
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
