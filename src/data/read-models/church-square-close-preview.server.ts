import "server-only";
import { addIsoDays, isIsoCalendarDate, localDateKey, zonedLocalToIso } from "@/data/read-models/local-time";
import {
  churchSquareClosePreviewDateCount, churchSquareCloseTenderSources, type ChurchSquareClosePreviewSnapshot,
} from "@/lib/integrations/church-square-close-preview";
import type { ChurchSquarePayment, ChurchSquareRefund } from "@/lib/integrations/church-square-order-projection";
import type { ChurchSquareOrderClient, ChurchSquareOrderWindow } from "@/lib/integrations/church-square-orders.server";

const timeZone = "America/New_York";
const pageLimit = 3;

export function churchSquareCloseDates(now: Date) {
  const today = localDateKey(now, timeZone);
  return { today, earliestDate: addIsoDays(today, 1 - churchSquareClosePreviewDateCount) };
}

export function churchSquareCloseWindow(date: string, now: Date) {
  const { today, earliestDate } = churchSquareCloseDates(now);
  if (!isIsoCalendarDate(date) || date < earliestDate || date > today) return null;
  const from = zonedLocalToIso(date, "00:00", timeZone);
  const midnight = zonedLocalToIso(addIsoDays(date, 1), "00:00", timeZone);
  if (!from || !midnight) return null;
  const dayEnded = date < today;
  return { from, to: dayEnded ? midnight : now.toISOString(), dayEnded };
}

type Resource = ChurchSquarePayment | ChurchSquareRefund;
type Read<T extends Resource> = { coverage: "complete" | "partial" | "unavailable"; records: T[] };

async function readPages<T extends Resource>(
  window: ChurchSquareOrderWindow,
  list: (query: ChurchSquareOrderWindow) => Promise<{ records: T[]; nextCursor: string | null }>,
): Promise<Read<T>> {
  const records = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | undefined;

  for (let i = 0; i < pageLimit; i += 1) {
    let page;
    try {
      page = await list({ ...window, cursor });
    } catch {
      return { coverage: i === 0 ? "unavailable" : "partial", records: [...records.values()] };
    }
    for (const record of page.records) {
      const previous = records.get(record.id);
      const delta = previous ? Date.parse(record.updatedAt) - Date.parse(previous.updatedAt) : 1;
      if (previous && (Date.parse(previous.createdAt) !== Date.parse(record.createdAt)
          || (delta === 0 && JSON.stringify(previous) !== JSON.stringify(record)))) {
        return { coverage: "unavailable", records: [] };
      }
      if (delta > 0) records.set(record.id, record);
    }
    if (!page.nextCursor) return { coverage: "complete", records: [...records.values()] };
    if (cursors.has(page.nextCursor)) break;
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { coverage: "partial", records: [...records.values()] };
}

function totalNonnegative(values: (number | null)[]) {
  let result = 0;
  for (const value of values) {
    if (value === null || value < 0) return null;
    result += value;
  }
  return Number.isSafeInteger(result) ? result : null;
}

function totalPaymentTips(payments: ChurchSquarePayment[]) {
  return totalNonnegative(payments.map(({ tipCents, amountCents, totalCents }) =>
    tipCents ?? (amountCents !== null && totalCents !== null && amountCents === totalCents ? 0 : null)));
}

function summarizeTenders(
  payments: ChurchSquarePayment[],
  complete: boolean,
): ChurchSquareClosePreviewSnapshot["payments"]["tenders"] {
  return churchSquareCloseTenderSources.flatMap((source) => {
    const matching = payments.filter((payment) => payment.source === source);
    if (matching.length === 0) return [];
    return [{
      source,
      completed: matching.length,
      totalCents: complete ? totalNonnegative(matching.map(({ totalCents }) => totalCents)) : null,
      tipCents: complete ? totalPaymentTips(matching) : null,
    }];
  });
}

export async function loadChurchSquareClosePreview(
  client: Pick<ChurchSquareOrderClient, "listPayments" | "listRefunds">,
  date: string,
  now: Date,
  window: NonNullable<ReturnType<typeof churchSquareCloseWindow>>,
): Promise<ChurchSquareClosePreviewSnapshot> {
  const signal = AbortSignal.timeout(17_000);
  const query = { from: window.from, to: window.to, direction: "ASC" } as const;
  const [payments, refunds] = await Promise.all([
    readPages(query, async (page) => {
      const { payments, nextCursor } = await client.listPayments(page, signal);
      return { records: payments, nextCursor };
    }),
    readPages(query, async (page) => {
      const { refunds, nextCursor } = await client.listRefunds(page, signal);
      return { records: refunds, nextCursor };
    }),
  ]);
  const completedPayments = payments.records.filter(({ status }) => status === "COMPLETED");
  const completedRefunds = refunds.records.filter(({ status }) => status === "COMPLETED");
  const paymentIds = new Set(payments.records.map(({ id }) => id));
  const paymentTotal = payments.coverage === "complete" ? totalNonnegative(completedPayments.map(({ totalCents }) => totalCents)) : null;
  const tips = payments.coverage === "complete" ? totalPaymentTips(completedPayments) : null;
  const refundTotal = refunds.coverage === "complete" ? totalNonnegative(completedRefunds.map(({ amountCents }) => amountCents)) : null;

  return {
    date,
    checkedAt: now.toISOString(),
    window,
    payments: {
      coverage: payments.coverage, observed: payments.records.length, completed: completedPayments.length,
      unresolved: payments.records.filter(({ status }) => status === "PENDING" || status === "APPROVED" || status === "UNKNOWN").length,
      offline: completedPayments.filter(({ isOffline, offlineCreatedAt }) => isOffline || offlineCreatedAt).length,
      missingTotal: completedPayments.filter(({ totalCents }) => totalCents === null || totalCents < 0).length,
      missingOrder: completedPayments.filter(({ orderId }) => !orderId).length,
      totalCents: paymentTotal, tipCents: tips,
      tenders: summarizeTenders(completedPayments, payments.coverage === "complete"),
    },
    refunds: {
      coverage: refunds.coverage, observed: refunds.records.length, completed: completedRefunds.length,
      unresolved: refunds.records.filter(({ status }) => status === "PENDING" || status === "UNKNOWN").length,
      withoutPaymentReference: completedRefunds.filter(({ paymentId }) => !paymentId).length,
      paymentOutsideRead: completedRefunds.filter(({ paymentId }) => paymentId && !paymentIds.has(paymentId)).length,
      amountCents: refundTotal,
    },
    netActivityCents: paymentTotal === null || refundTotal === null ? null : paymentTotal - refundTotal,
  };
}
