"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  churchSquarePayoutEntriesPath,
  churchSquarePayoutEntriesResponse,
  churchSquarePayoutWindowDays,
  churchSquarePayoutWindowLimit,
  churchSquarePayoutWindowPath,
  churchSquarePayoutWindowResponse,
  type ChurchSquarePayoutEntriesResponse,
  type ChurchSquarePayoutWindowResponse,
} from "@/lib/integrations/church-square-payout-window";

type Payout = ChurchSquarePayoutWindowResponse["payouts"][number];
type State =
  | { status: "idle" | "loading" | "forbidden" | "setup-pending" | "square-permission" | "unavailable" }
  | { status: "ready"; window: ChurchSquarePayoutWindowResponse };
type EntryState =
  | { status: "loading" | "forbidden" | "missing" | "unavailable"; reference: string }
  | { status: "ready"; reference: string; detail: ChurchSquarePayoutEntriesResponse };

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

function amount(cents: number | null) {
  return cents === null ? "Unavailable" : money.format(cents / 100);
}

function PayoutEntries({ state, close }: { state: EntryState; close: () => void }) {
  return (
    <section id="church-square-payout-entries" aria-labelledby="church-square-payout-entries-title" className="mt-3 rounded-2xl border border-[var(--line)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h6 id="church-square-payout-entries-title" className="text-sm font-semibold">Payout entries</h6>
          <p className="break-all font-mono text-xs text-[var(--ink-soft)]">{state.reference}</p>
        </div>
        <Button variant="quiet" size="sm" onClick={close}>Close entries</Button>
      </div>
      <div role="status" className="mt-2 text-xs text-[var(--ink-soft)]">
        {state.status === "loading" && "Checking Square for this transfer’s entries."}
        {state.status === "forbidden" && "Church Street financial reports access is required for this transfer."}
        {state.status === "missing" && "This transfer is outside the current Church Street payout list. Refresh payouts to check again."}
        {state.status === "unavailable" && "Square entries for this transfer could not be verified. Select the transfer again to retry."}
        {state.status === "ready" && <>Entries checked <time dateTime={state.detail.checkedAt}>{localTime.format(new Date(state.detail.checkedAt))} ET</time>.</>}
      </div>
      {state.status === "ready" && <PayoutEntryBreakdown detail={state.detail} />}
    </section>
  );
}

function PayoutEntryBreakdown({ detail }: { detail: ChurchSquarePayoutEntriesResponse }) {
  const complete = !detail.hasMore && detail.entries.length > 0 && detail.entries.every(({ netCents }) => netCents !== null);
  const netTotal = complete ? detail.netTotalCents : null;
  const difference = netTotal !== null && detail.payoutType === "BATCH" && detail.amountCents !== null ? detail.differenceCents : null;
  return (
    <>
      <div className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
        <p>Square transfer amount {amount(detail.amountCents)}. Use the bank statement to verify receipt.</p>
        {detail.hasMore && <p>Partial entry list. Check Square Dashboard for the remaining entries.</p>}
        {detail.entries.length === 0 && <p>{detail.payoutType === "SIMPLE"
          ? "Square reports a simple transfer. It has no itemized entries."
          : "Square returned no entries for this transfer."}</p>}
        {netTotal !== null && <p>Total net entry amount {amount(netTotal)}.</p>}
        {difference === 0 && <p className="font-semibold text-[var(--positive)]">Square entries match transfer.</p>}
        {difference !== null && difference !== 0 && <p className="font-semibold text-[var(--warning)]">Difference, entries minus transfer: {amount(difference)}.</p>}
        {difference === null && detail.entries.length > 0 && (
          <p>{detail.hasMore ? "A complete entry list is required to compare totals."
            : detail.payoutType !== "BATCH" ? "Square’s entry-total comparison applies to batch transfers."
            : "This batch needs all net entry amounts and the transfer amount to compare totals."}</p>
        )}
      </div>
      {detail.entries.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Square payout entry amounts</caption>
            <thead className="border-b border-[var(--line)] text-[var(--ink-soft)]">
              <tr>
                <th scope="col" className="py-2 pr-2">Entry ID</th>
                <th scope="col" className="px-2 py-2">Square activity</th>
                <th scope="col" className="px-2 py-2">Square order</th>
                <th scope="col" className="px-2 py-2">Balance affected (ET)</th>
                <th scope="col" className="px-2 py-2 text-right">Gross</th>
                <th scope="col" className="px-2 py-2 text-right">Fees</th>
                <th scope="col" className="py-2 pl-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] tabular-nums">
              {detail.entries.map((entry) => (
                <tr key={entry.reference}>
                  <th scope="row" className="min-w-24 max-w-40 break-all py-2 pr-2 font-mono font-medium">{entry.reference}</th>
                  <td className="px-2 py-2 capitalize">{entry.type?.toLowerCase().replaceAll("_", " ") ?? "Unknown"}</td>
                  <td className="px-2 py-2 text-[var(--ink-soft)]">
                    {entry.orderEvidence?.status === "linked" ? (
                      <>Ends in <span className="font-mono">{entry.orderEvidence.orderReference.slice(-10)}</span></>
                    ) : entry.orderEvidence?.status === "unlinked" ? "No usable order link"
                      : entry.orderEvidence?.status === "unavailable" ? "Order check unavailable" : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">{entry.effectiveAt ? <time dateTime={entry.effectiveAt}>{localTime.format(new Date(entry.effectiveAt))}</time> : "Unavailable"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{amount(entry.grossCents)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{amount(entry.feeCents)}</td>
                  <td className="whitespace-nowrap py-2 pl-2 text-right">{amount(entry.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ChurchSquarePayouts() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [entryState, setEntryState] = useState<EntryState | null>(null);
  const activeEntries = useRef<AbortController | null>(null);
  useEffect(() => () => activeEntries.current?.abort(), []);

  function closeEntries() {
    activeEntries.current?.abort();
    activeEntries.current = null;
    setEntryState(null);
  }

  async function loadEntries(reference: string) {
    activeEntries.current?.abort();
    const controller = new AbortController();
    activeEntries.current = controller;
    const timeout = window.setTimeout(() => {
      if (activeEntries.current !== controller) return;
      controller.abort();
      activeEntries.current = null;
      setEntryState({ status: "unavailable", reference });
    }, 35_000);
    setEntryState({ status: "loading", reference });
    try {
      const response = await fetch(churchSquarePayoutEntriesPath(reference), { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (activeEntries.current !== controller || controller.signal.aborted) return;
      if (response.status === 404) {
        setEntryState({ status: "missing", reference });
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setEntryState({ status: "forbidden", reference });
        return;
      }
      if (!response.ok) throw new Error("Payout entries unavailable");
      const parsed = churchSquarePayoutEntriesResponse.safeParse(await response.json());
      if (activeEntries.current !== controller || controller.signal.aborted) return;
      setEntryState(parsed.success && parsed.data.reference === reference
        ? { status: "ready", reference, detail: parsed.data }
        : { status: "unavailable", reference });
    } catch {
      if (activeEntries.current === controller && !controller.signal.aborted) setEntryState({ status: "unavailable", reference });
    } finally {
      window.clearTimeout(timeout);
      if (activeEntries.current === controller) activeEntries.current = null;
    }
  }

  async function load() {
    closeEntries();
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
                <th scope="col" className="px-3 py-2">Entries</th>
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
                  <td className="whitespace-nowrap px-3 py-2">
                    <Button variant="quiet" size="sm" aria-label={`View payout entries for ${payout.reference}`}
                      aria-controls={entryState?.reference === payout.reference ? "church-square-payout-entries" : undefined}
                      aria-expanded={entryState?.reference === payout.reference}
                      disabled={entryState?.status === "loading" && entryState.reference === payout.reference}
                      onClick={() => void loadEntries(payout.reference)}>View entries</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entryState && <PayoutEntries state={entryState} close={closeEntries} />}
      <p className="mt-2 text-xs text-[var(--ink-soft)]">
        Square reports transfer status, which can change after payment. Match bank transfers to the bank statement to verify receipt.
        Check marketplace settlements in each provider’s statement.
      </p>
    </section>
  );
}
