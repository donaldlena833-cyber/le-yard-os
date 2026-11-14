"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  churchSquareReconciliationPath,
  churchSquareReconciliationResponse,
  type ChurchSquareReconciliationResponse,
} from "@/lib/integrations/church-square-reconciliation";

type Resource = ChurchSquareReconciliationResponse["resources"][number];
type State =
  | { status: "idle" | "loading" | "forbidden" | "unavailable" }
  | { status: "ready"; snapshot: ChurchSquareReconciliationResponse };

const resourceLabels = { order: "Order", payment: "Payment", refund: "Refund", invoice: "Invoice" } as const;
const depositLabels: Record<NonNullable<Resource["depositState"]>, string> = {
  not_requested: "No deposit requested",
  unknown: "Verify the deposit in Square",
  unpaid: "Awaiting deposit",
  partial: "Deposit partially received",
  satisfied: "Deposit received. Review prep and staffing.",
  review_required: "Review the invoice and deposit in Square",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const localTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const calendarDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
});

function formatAmount(cents: number | null) {
  return cents === null ? "—" : money.format(cents / 100);
}

export function ChurchSquareReconciliation() {
  const [state, setState] = useState<State>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const response = await fetch(churchSquareReconciliationPath, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const forbidden = response.status === 401 || response.status === 403 || response.status === 404;
        setState({ status: forbidden ? "forbidden" : "unavailable" });
        return;
      }
      const result = churchSquareReconciliationResponse.safeParse(await response.json());
      setState(result.success ? { status: "ready", snapshot: result.data } : { status: "unavailable" });
    } catch {
      setState({ status: "unavailable" });
    }
  }

  return (
    <section aria-labelledby="church-square-reconciliation-title" className="mt-5 border-t border-[var(--line)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id="church-square-reconciliation-title" className="font-semibold">Square reconciliation</h4>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Up to 30 verified records that Square updated in the past seven days.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={state.status === "loading"} onClick={load}>
          {state.status === "idle" ? "Load reconciliation" : state.status === "loading" ? "Loading…" : "Refresh reconciliation"}
        </Button>
      </div>
      <div role="status" className="mt-3 text-xs text-[var(--ink-soft)]">
        {state.status === "loading" && "Loading recent updates."}
        {state.status === "forbidden" && "Church Street financial reports access is required."}
        {state.status === "unavailable" && "Reconciliation is temporarily unavailable. Try refreshing."}
        {state.status === "ready" && (
          <ul className="space-y-1">
            <li>{state.snapshot.pending} {state.snapshot.pending === 1 ? "update is" : "updates are"} awaiting verification.</li>
            <li>
              {state.snapshot.needsReview} {state.snapshot.needsReview === 1 ? "update needs" : "updates need"} review.
              {state.snapshot.needsReview > 0 && " Compare the affected activity with the Square Dashboard."}
            </li>
            {state.snapshot.resources.length === 0 && <li>No verified records in this window.</li>}
          </ul>
        )}
      </div>
      {state.status === "ready" && state.snapshot.resources.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--ink-faint)]">
                <th scope="col" className="px-3 py-2">Record ID suffix</th>
                <th scope="col" className="px-3 py-2">Order ID suffix</th>
                <th scope="col" className="px-3 py-2">Square status</th>
                <th scope="col" className="px-3 py-2 text-right">Record amount</th>
                <th scope="col" className="px-3 py-2">Invoice deposit</th>
                <th scope="col" className="px-3 py-2 text-right">Updated (ET)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {state.snapshot.resources.map((resource, index) => (
                <tr key={`${resource.kind}-${resource.reference}-${index}`}>
                  <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium">
                    {resourceLabels[resource.kind]} <span className="font-mono">{resource.reference}</span>
                  </th>
                  <td className="px-3 py-2 font-mono">{resource.orderReference ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{resource.status?.toLowerCase().replaceAll("_", " ") ?? "Unknown"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatAmount(resource.amountCents)}</td>
                  <td className="px-3 py-2">
                    {resource.depositState ? depositLabels[resource.depositState] : "—"}
                    {resource.depositCompletedCents !== null && resource.depositDueCents !== null && (
                      <div className="mt-1 whitespace-nowrap tabular-nums">
                        {formatAmount(resource.depositCompletedCents)} received of {formatAmount(resource.depositDueCents)} due
                      </div>
                    )}
                    {resource.serviceDate && (
                      <div className="mt-1 whitespace-nowrap">
                        Service <time dateTime={resource.serviceDate}>{calendarDate.format(new Date(resource.serviceDate))}</time>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <time dateTime={resource.updatedAt}>{localTime.format(new Date(resource.updatedAt))}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
