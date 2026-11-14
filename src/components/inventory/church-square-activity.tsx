import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const receipt = z.object({
  type: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  receivedAt: z.iso.datetime({ offset: true }),
});

const labels: Record<string, string> = {
  "inventory.count.updated": "Stock count updated",
  "order.created": "Order created",
  "order.updated": "Order updated",
  "payment.created": "Payment recorded",
  "payment.updated": "Payment updated",
  "refund.created": "Refund recorded",
  "refund.updated": "Refund updated",
  "invoice.published": "Invoice published",
  "invoice.updated": "Invoice updated",
  "invoice.payment_made": "Invoice payment recorded",
  "invoice.refunded": "Invoice refunded",
  "invoice.canceled": "Invoice canceled",
};
const time = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export async function ChurchSquareActivity({ locationId, configured }: { locationId: string; configured: boolean }) {
  let events: z.infer<typeof receipt>[] | null = null;
  if (configured) {
    const client = await createClient();
    const { data, error } = await client.rpc("list_church_square_webhook_receipts", { p_location_id: locationId });
    const parsed = z.array(receipt).max(20).safeParse(data);
    if (!error && parsed.success) events = parsed.data;
  }

  return (
    <section className="mx-auto mt-6 max-w-[1520px] px-4 sm:px-6 lg:px-8" aria-labelledby="church-square-activity-heading">
      <details className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
        <summary className="cursor-pointer"><h2 className="inline text-lg font-medium" id="church-square-activity-heading">Square connection activity</h2></summary>
        {!configured ? <p className="mt-2 text-sm text-[var(--ink-faint)]">Waiting for Square event delivery to be configured.</p>
        : events === null ? <p className="mt-2 text-sm text-[var(--ink-faint)]">Could not load Square event receipts. Refresh to try again.</p>
        : !events.length ? <p className="mt-2 text-sm text-[var(--ink-faint)]">No Square events received yet.</p>
        : <>
          <p className="mt-2 text-sm text-[var(--ink-faint)]">Last received {time.format(new Date(events[0].receivedAt))} New York time. These are delivery receipts; orders and payments still need to be reconciled.</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {events.map((event, index) => <li key={`${event.receivedAt}:${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{labels[event.type] ?? "Square activity"}</span>
              <time dateTime={event.receivedAt} title={`Occurred ${time.format(new Date(event.createdAt))}`}>{time.format(new Date(event.receivedAt))}</time>
            </li>)}
          </ul>
        </>}
      </details>
    </section>
  );
}
