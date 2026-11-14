"use client";

import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import {
  lookupChurchSquareCateringInvoiceAction,
  saveChurchSquareCateringHandoffAction,
} from "@/app/actions/workflows/church-square-catering";
import { Button } from "@/components/ui/button";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";

type Invoice = Extract<Awaited<ReturnType<typeof lookupChurchSquareCateringInvoiceAction>>, { mode: "live" }>["data"];

const depositLabels = {
  not_requested: "No deposit requested",
  unknown: "Deposit status unavailable",
  unpaid: "Awaiting deposit",
  partial: "Deposit partially paid",
  satisfied: "Square records the requested deposit as paid",
  review_required: "Deposit needs review in Square",
} satisfies Record<Invoice["deposit"]["state"], string>;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });

export function ChurchSquareCateringInvoice() {
  const [invoiceId, setInvoiceId] = useState("");
  const [invoice, setInvoice] = useState<Invoice>();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, startTransition] = useTransition();
  const { requestIdFor } = useStableRequestIds();

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvoice(undefined);
    setSaved(false);
    setMessage("Checking Square…");
    startTransition(async () => {
      try {
        const result = await lookupChurchSquareCateringInvoiceAction({ invoiceId });
        if (result.ok && result.mode === "live") {
          setInvoice(result.data);
          setMessage("Square invoice verified for Church Street.");
        } else {
          setMessage("message" in result ? result.message : "The Square invoice could not be checked.");
        }
      } catch {
        setMessage("The Square invoice could not be checked. Try again.");
      }
    });
  }

  function saveHandoff() {
    if (!invoice) return;
    const payload = { invoiceId, invoiceUpdatedAt: invoice.updatedAt };
    setMessage("Rechecking the invoice…");
    startTransition(async () => {
      try {
        const result = await saveChurchSquareCateringHandoffAction({
          ...payload,
          requestId: requestIdFor("church-square-catering-handoff", payload),
        });
        if (result.ok && result.mode === "live" && result.persisted) {
          setSaved(true);
          setMessage("Review handoff saved in Manager Log.");
        } else {
          setMessage("message" in result ? result.message : "The review handoff could not be saved.");
        }
      } catch {
        setMessage("The review handoff could not be saved. Try again.");
      }
    });
  }

  return (
    <details className="mt-5 rounded-2xl border border-[var(--line)] p-4">
      <summary className="cursor-pointer text-sm font-semibold">Verify a catering invoice</summary>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={lookup}>
        <label className="grid min-w-52 flex-1 gap-1 text-xs font-semibold">
          Exact Square invoice ID
          <input required disabled={busy} value={invoiceId} maxLength={192} spellCheck={false} autoComplete="off"
            placeholder="inv:…"
            className="focus-ring rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 font-mono"
            onChange={(event) => {
              setInvoiceId(event.target.value);
              setInvoice(undefined);
              setMessage("");
              setSaved(false);
            }} />
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>Check invoice</Button>
      </form>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
      {invoice && (
        <div className="mt-3 space-y-2 text-sm">
          <p>Invoice ending <span className="font-mono">{invoice.invoiceReference}</span> · order ending <span className="font-mono">{invoice.orderReference}</span></p>
          <p>Invoice {invoice.status.toLowerCase().replaceAll("_", " ")} · {depositLabels[invoice.deposit.state]}</p>
          {invoice.deposit.dueCents !== null && invoice.deposit.completedCents !== null && (
            <p>{usd.format(invoice.deposit.completedCents / 100)} recorded against {usd.format(invoice.deposit.dueCents / 100)} requested.</p>
          )}
          {invoice.serviceDate && <p>Service date <time dateTime={invoice.serviceDate}>{date.format(new Date(invoice.serviceDate))}</time></p>}
          <p className="text-xs text-[var(--ink-faint)]">Square updated <time dateTime={invoice.updatedAt}>{time.format(new Date(invoice.updatedAt))} ET</time>.</p>
          {invoice.canLog && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="quiet" size="sm" disabled={busy || saved} onClick={saveHandoff}>Save review handoff</Button>
              {saved && <Link href="/service" className="text-xs font-semibold underline">Open Manager Log</Link>}
            </div>
          )}
        </div>
      )}
    </details>
  );
}
