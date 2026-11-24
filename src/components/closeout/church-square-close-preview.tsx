"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatLocalDateTime, isIsoCalendarDate } from "@/data/read-models/local-time";
import {
  churchSquareClosePreviewPath,
  churchSquareClosePreviewResponse,
  type ChurchSquareClosePreviewSnapshot,
} from "@/lib/integrations/church-square-close-preview";

type ClosePreviewProps = { locationId: string; today: string; earliestDate: string };
type State =
  | { status: "idle" | "loading" | "invalid" | "denied" | "unavailable" }
  | { status: "ready"; result: ChurchSquareClosePreviewSnapshot };

const timeZone = "America/New_York";
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const calendarDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const tenderLabels: Record<ChurchSquareClosePreviewSnapshot["payments"]["tenders"][number]["source"], string> = {
  CARD: "Card",
  CASH: "Cash",
  EXTERNAL: "External",
  BANK_ACCOUNT: "Bank account",
  WALLET: "Wallet",
  BUY_NOW_PAY_LATER: "Buy now, pay later",
  SQUARE_ACCOUNT: "Square account",
  UNKNOWN: "Unknown",
};

function money(cents: number | null) {
  return cents === null ? "Unavailable" : currency.format(cents / 100);
}

function Coverage({ coverage }: { coverage: ChurchSquareClosePreviewSnapshot["payments"]["coverage"] }) {
  const copy = {
    complete: "Reached the end of Square’s results for this date.",
    partial: "Partial results. Totals are unavailable until the full read completes.",
    unavailable: "Square activity could not be checked.",
  };
  return (
    <p className={`mt-1 text-xs ${coverage === "complete" ? "text-[var(--ink-soft)]" : "text-[var(--warning)]"}`}>
      {copy[coverage]}
    </p>
  );
}

function PreviewResults({ result }: { result: ChurchSquareClosePreviewSnapshot }) {
  const { payments, refunds } = result;
  const net = payments.coverage === "complete" && refunds.coverage === "complete" ? result.netActivityCents : null;
  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4">
      <p className="text-xs text-[var(--ink-soft)]">
        Activity dated <time dateTime={result.date}>{calendarDate.format(new Date(`${result.date}T00:00:00Z`))}</time>.
        {!result.window.dayEnded && " This New York calendar day is still in progress."}
        {" "}Offline payments may reach Square after the shift.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Payments</h3>
          <Coverage coverage={payments.coverage} />
          {payments.coverage !== "unavailable" && (
            <>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt>Completed payments including tips</dt><dd className="font-semibold tabular-nums">{money(payments.coverage === "complete" ? payments.totalCents : null)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Tips within payments</dt><dd className="tabular-nums">{money(payments.coverage === "complete" ? payments.tipCents : null)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">{payments.completed} completed of {payments.observed} observed · {payments.unresolved} unresolved · {payments.offline} offline</p>
              {payments.missingTotal > 0 && <p className="mt-1 text-xs text-[var(--warning)]">Missing reported total · {payments.missingTotal} completed</p>}
              {payments.missingOrder > 0 && <p className="mt-1 text-xs text-[var(--ink-soft)]">Missing Square order reference · {payments.missingOrder} completed</p>}
            </>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Refunds</h3>
          <Coverage coverage={refunds.coverage} />
          {refunds.coverage !== "unavailable" && (
            <>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt>Completed refunds</dt><dd className="font-semibold tabular-nums">{money(refunds.coverage === "complete" ? refunds.amountCents : null)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">{refunds.completed} completed of {refunds.observed} observed · {refunds.unresolved} unresolved</p>
              {refunds.withoutPaymentReference > 0 && <p className="mt-1 text-xs text-[var(--warning)]">Missing Square payment reference · {refunds.withoutPaymentReference} completed</p>}
              {refunds.paymentOutsideRead > 0 && <p className="mt-1 text-xs text-[var(--ink-soft)]">Payment outside this read · {refunds.paymentOutsideRead} completed. The payment may be from an earlier date.</p>}
            </>
          )}
        </div>
      </div>
      {payments.tenders.length > 0 && (
        <section aria-labelledby="church-square-close-tender-heading" className="mt-4 border-t border-[var(--line)] pt-3">
          <h3 id="church-square-close-tender-heading" className="text-sm font-semibold">Completed payments by tender</h3>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            Counts are Square payment records. A split tender can produce multiple records for one order. Refunds are shown separately.
            {payments.tenders.some(({ source }) => source === "CARD") && " Square can report gift cards under Card."}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--ink-soft)]">
                  <th scope="col" className="pr-3 py-2">Tender</th>
                  <th scope="col" className="pr-3 py-2 text-right">{payments.coverage === "complete" ? "Payments" : "Observed payments"}</th>
                  <th scope="col" className="pr-3 py-2 text-right">Total incl. tips</th>
                  <th scope="col" className="py-2 text-right">Tips</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {payments.tenders.map((tender) => (
                  <tr key={tender.source}>
                    <th scope="row" className="pr-3 py-2 font-medium">{tenderLabels[tender.source]}</th>
                    <td className="pr-3 py-2 text-right tabular-nums">{tender.completed}</td>
                    <td className="pr-3 py-2 text-right tabular-nums">{money(payments.coverage === "complete" ? tender.totalCents : null)}</td>
                    <td className="py-2 text-right tabular-nums">{money(payments.coverage === "complete" ? tender.tipCents : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <dl className="mt-4 border-t border-[var(--line)] pt-3">
        <div className="flex justify-between gap-3 text-sm font-semibold">
          <dt>Net Square activity</dt><dd className="tabular-nums">{money(net)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">
        {net === null ? "Net needs the full payment and refund read and all required amounts." : "Payments including tips minus refunds, dated by when Square created each record."}
        {" "}This can include cash and external tenders recorded in Square. Compare settlements with payout and bank records.
      </p>
    </div>
  );
}

function ClosePreview({ locationId, today, earliestDate }: ClosePreviewProps) {
  const [date, setDate] = useState(today);
  const [state, setState] = useState<State>({ status: "idle" });
  const inFlight = useRef<AbortController | null>(null);
  const dateIsValid = isIsoCalendarDate(date) && date >= earliestDate && date <= today;

  useEffect(() => () => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  async function readPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dateIsValid || inFlight.current) return;

    const request = new AbortController();
    inFlight.current = request;
    setState({ status: "loading" });
    const timeout = window.setTimeout(() => request.abort(), 20_000);
    try {
      const query = new URLSearchParams({ locationId, date });
      const response = await fetch(`${churchSquareClosePreviewPath}?${query}`, {
        cache: "no-store", credentials: "same-origin", signal: request.signal,
      });
      if (inFlight.current !== request) return;
      if (!response.ok) {
        const status = [401, 403, 404].includes(response.status) ? "denied"
          : response.status === 400 ? "invalid" : "unavailable";
        setState({ status });
        return;
      }
      const parsed = churchSquareClosePreviewResponse.safeParse(await response.json());
      if (inFlight.current === request) {
        const result = parsed.success && !request.signal.aborted && parsed.data.date === date ? parsed.data : undefined;
        setState(result ? { status: "ready", result } : { status: "unavailable" });
      }
    } catch {
      if (inFlight.current === request) setState({ status: "unavailable" });
    } finally {
      window.clearTimeout(timeout);
      if (inFlight.current === request) inFlight.current = null;
    }
  }

  return (
    <section aria-labelledby="church-square-close-preview-heading" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="church-square-close-preview-heading" className="text-lg font-semibold">Square daily close preview</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Check Church Street payment and refund activity by New York calendar date.</p>
      <form onSubmit={(event) => void readPreview(event)} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-40" htmlFor="church-square-close-preview-date">
          <span className="mb-1 block text-xs font-semibold">Date (ET)</span>
          <input
            className="focus-ring h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-sm"
            id="church-square-close-preview-date" name="date" type="date" required
            min={earliestDate} max={today} value={date}
            onChange={(event) => {
              inFlight.current?.abort();
              inFlight.current = null;
              setDate(event.target.value);
              setState({ status: "idle" });
            }}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={!dateIsValid || state.status === "loading"}>Check activity</Button>
      </form>
      <div role="status" className="mt-2 text-xs text-[var(--ink-soft)]">
        {state.status === "loading" && "Checking Square activity for the selected date."}
        {state.status === "invalid" && "Choose a date in the current seven-day window. Reload the page if the date changed."}
        {state.status === "denied" && "Church Street financial reports access is required."}
        {state.status === "unavailable" && "Square activity could not be verified. Try again."}
        {state.status === "ready" && <>Square checked <time dateTime={state.result.checkedAt}>{formatLocalDateTime(state.result.checkedAt, timeZone)} ET</time>.</>}
      </div>
      {state.status === "ready" && <PreviewResults result={state.result} />}
    </section>
  );
}

export function ChurchSquareClosePreview(props: ClosePreviewProps) {
  return <ClosePreview key={`${props.locationId}:${props.today}:${props.earliestDate}`} {...props} />;
}
