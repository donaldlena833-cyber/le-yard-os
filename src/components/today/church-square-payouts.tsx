"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  churchSquarePayoutWindowDays,
  churchSquarePayoutWindowLimit,
  churchSquarePayoutWindowPath,
  churchSquarePayoutWindowResponse,
  type ChurchSquarePayoutWindowResponse,
} from "@/lib/integrations/church-square-payout-window";

type Payout = ChurchSquarePayoutWindowResponse["payouts"][number];
type State =
  | { status: "idle" | "loading" | "forbidden" | "setup-pending" | "square-permission" | "unavailable" }
  | { status: "ready"; window: ChurchSquarePayoutWindowResponse };

const statusLabels: Record<Payout["status"], string> = {
  SENT: "Sent by Square",
  PAID: "Paid by Square",
  FAILED: "Transfer failed",
  UNKNOWN: "Unknown",
};

const dateFormat = { month: "short", day: "numeric", year: "numeric" } as const;
const calendarDate = new Intl.DateTimeFormat("en-US", { ...dateFormat, timeZone: "UTC" });
const localTime = new Intl.DateTimeFormat("en-US", {
  ...dateFormat, timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
});
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });

export function ChurchSquarePayouts() {
  const [state, setState] = useState<State>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const response = await fetch(churchSquarePayoutWindowPath, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(35_000),
      });
      if ([401, 403, 404].includes(response.status)) {
        setState({ status: "forbidden" });
        return;
      }
      if (!response.ok) {
        const error = response.status === 503 ? await response.json() : null;
        if (error?.status === "setup_pending") {
          setState({ status: "setup-pending" });
        } else if (error?.status === "payout_permission_unavailable") {
          setState({ status: "square-permission" });
        } else {
          setState({ status: "unavailable" });
        }
        return;
      }
      const result = churchSquarePayoutWindowResponse.safeParse(await response.json());
      setState(result.success ? { status: "ready", window: result.data } : { status: "unavailable" });
    } catch {
      setState({ status: "unavailable" });
    }
  }

  return (
    <section aria-labelledby="church-square-payouts-title" className="mt-5 border-t border-[var(--line)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 id="church-square-payouts-title" className="font-semibold">Square payouts</h5>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Up to {churchSquarePayoutWindowLimit} Church Street transfers created by Square in the past {churchSquarePayoutWindowDays} days, newest first.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={state.status === "loading"} onClick={load}>
          {state.status === "idle" ? "Load payouts" : state.status === "loading" ? "Loading payouts…" : "Refresh payouts"}
        </Button>
      </div>
      <div role="status" className="mt-3 space-y-1 text-xs text-[var(--ink-soft)]">
        {state.status === "loading" && "Checking Square for recent payouts."}
        {state.status === "forbidden" && "Church Street financial reports access is required."}
        {state.status === "setup-pending" && "The Square payout connection is awaiting setup."}
        {state.status === "square-permission" && "Square denied payout access. Check the Square integration permissions."}
        {state.status === "unavailable" && "Square payouts are temporarily unavailable. Try refreshing."}
        {state.status === "ready" && (
          <>
            <p>
              Checked{" "}
              <time dateTime={state.window.checkedAt}>{localTime.format(new Date(state.window.checkedAt))} ET</time>.
            </p>
            {state.window.hasMore && <p>Partial results. Check Square Dashboard for the remaining transfers.</p>}
            {state.window.payouts.length === 0 && <p>No Square payouts found in this window.</p>}
          </>
        )}
      </div>
      {state.status === "ready" && state.window.payouts.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Recent Church Street Square payouts</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--ink-faint)]">
                <th scope="col" className="px-3 py-2">Payout ID</th>
                <th scope="col" className="px-3 py-2">Square status</th>
                <th scope="col" className="px-3 py-2 text-right">Amount</th>
                <th scope="col" className="px-3 py-2">Created (ET)</th>
                <th scope="col" className="px-3 py-2">Updated (ET)</th>
                <th scope="col" className="px-3 py-2">Expected arrival</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {state.window.payouts.map((payout) => (
                <tr key={payout.reference}>
                  <th scope="row" className="min-w-28 max-w-48 px-3 py-2 font-mono font-medium [overflow-wrap:anywhere]">{payout.reference}</th>
                  <td className="whitespace-nowrap px-3 py-2">{statusLabels[payout.status]}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {payout.amountCents === null ? "Unavailable" : (
                      <>
                        {money.format(payout.amountCents / 100)}
                        {payout.amountCents !== 0 && (
                          <span className="block text-[var(--ink-soft)]">{payout.amountCents > 0 ? "Deposit" : "Withdrawal"}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <time dateTime={payout.createdAt}>{localTime.format(new Date(payout.createdAt))}</time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {payout.updatedAt ? (
                      <time dateTime={payout.updatedAt}>{localTime.format(new Date(payout.updatedAt))}</time>
                    ) : "Unavailable"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {payout.arrivalDate ? (
                      <time dateTime={payout.arrivalDate}>{calendarDate.format(new Date(payout.arrivalDate))}</time>
                    ) : "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--ink-soft)]">
        Square reports transfer status, which can change after payment. Match bank transfers to the bank statement to verify receipt.
        Check marketplace settlements in each provider’s statement.
      </p>
    </section>
  );
}
