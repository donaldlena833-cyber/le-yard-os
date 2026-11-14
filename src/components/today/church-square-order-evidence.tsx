"use client";

import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { lookupChurchSquareOrderEvidenceAction } from "@/app/actions/workflows/church-square-order-evidence";
import { Button } from "@/components/ui/button";

type Evidence = Extract<Awaited<ReturnType<typeof lookupChurchSquareOrderEvidenceAction>>, { mode: "live" }>["data"];

const sourceLabels = new Map([
  ["DOORDASH", "DoorDash"],
  ["UBER_EATS", "Uber Eats"],
  ["GRUBHUB", "Grubhub"],
  ["SQUARE_ONLINE", "Square Online"],
  ["SQUARE_POS", "Square POS"],
  ["SQUARE_INVOICES", "Square Invoices"],
]);
const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", second: "2-digit",
});

function label(value: string) {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{easternTime.format(new Date(value))} ET</time>;
}

function operationsStatus(operations: Evidence["operations"]) {
  if (operations.status === "observed") {
    return operations.matches ? "Operations has a matching order record."
      : "Operations has a different order revision from this Square check.";
  }
  return operations.status === "not_observed"
    ? "Operations has no record for this order."
    : "The Operations order record could not be checked.";
}

function milestones(fulfillment: Evidence["square"]["fulfillments"][number]) {
  return [
    ["Promised", fulfillment.promisedAt],
    ["Ready", fulfillment.readyAt],
    [fulfillment.type === "DELIVERY" ? "Delivered" : fulfillment.type === "PICKUP" ? "Picked up" : "Handoff", fulfillment.handoffAt],
    ["Completed", fulfillment.completedAt === fulfillment.handoffAt ? null : fulfillment.completedAt],
    ["Canceled", fulfillment.canceledAt],
    ["Rejected", fulfillment.rejectedAt],
  ] as const;
}

function checklistEvidence({ reference, checkedAt, square, operations }: Evidence) {
  const summary = [
    `Church Street Square order ending ${reference}. Checked ${checkedAt}.`,
    `Square order ${label(square.status).toLowerCase()}. Source hint ${sourceLabels.get(square.source) ?? "Unknown"}. Updated ${square.updatedAt}.`,
    operationsStatus(operations),
    ...(operations.status === "observed" ? [`Operations record updated ${operations.updatedAt}.`] : []),
  ];
  if (square.fulfillments.length === 0) summary.push("Square returned no fulfillment details.");
  // Leave space for the staff observation in a checklist's 2,000-character notes field.
  for (const fulfillment of square.fulfillments.slice(0, 4)) {
    const times = milestones(fulfillment).flatMap(([name, value]) => value ? [`${name} ${value}`] : []);
    summary.push([`${label(fulfillment.type)} · ${label(fulfillment.status)}`, ...times].join(" · "));
  }
  if (square.fulfillments.length > 4) summary.push(`The order check shows all ${square.fulfillments.length} fulfillments.`);
  return summary.join("\n");
}

export function ChurchSquareOrderEvidence() {
  const [orderId, setOrderId] = useState("");
  const [result, setResult] = useState<Evidence>();
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState<{ result: Evidence; status: "copied" | "manual" }>();
  const [pending, startTransition] = useTransition();

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setResult(undefined);
    setCopyState(undefined);
    setMessage("Checking Square and Operations…");
    startTransition(async () => {
      try {
        const response = await lookupChurchSquareOrderEvidenceAction({ orderId: orderId.trim() });
        if (response.ok && response.mode === "live") {
          setResult(response.data);
          setOrderId("");
          setMessage("Verified this order belongs to Church Street.");
        } else {
          setMessage("message" in response ? response.message : "The Square order could not be checked.");
        }
      } catch {
        setMessage("The Square order could not be checked. Try again.");
      }
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(checklistEvidence(result));
      setCopyState({ result, status: "copied" });
    } catch {
      setCopyState({ result, status: "manual" });
    }
  }

  const copyStatus = copyState?.result === result ? copyState?.status : undefined;

  return (
    <details className="mt-5 rounded-2xl border border-[var(--line)] p-4">
      <summary className="cursor-pointer text-sm font-semibold">Check an exact Square order</summary>
      <p className="mt-2 text-xs text-[var(--ink-soft)]">Enter the full Square order ID to check the order and its Operations record. Look for the ID in the order details in Square Dashboard.</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={lookup}>
        <label className="grid min-w-52 flex-1 gap-1 text-xs font-semibold">
          Exact Square order ID
          <input required disabled={pending} value={orderId} maxLength={192} spellCheck={false} autoComplete="off"
            className="focus-ring rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 font-mono"
            onChange={(event) => {
              setOrderId(event.target.value);
              setResult(undefined);
              setMessage("");
              setCopyState(undefined);
            }} />
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>Check order</Button>
      </form>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
      {result && (
        <div className="mt-3 space-y-2 text-sm">
          <p>Square order ending <span className="font-mono">{result.reference}</span> · {label(result.square.status)}</p>
          <p>Square source hint · {sourceLabels.get(result.square.source) ?? "Unknown"}</p>
          {result.square.createdAt && <p>Square created <Time value={result.square.createdAt} /></p>}
          <p>Square updated <Time value={result.square.updatedAt} /></p>
          <p>{operationsStatus(result.operations)}</p>
          {result.operations.status === "observed" && <p>Operations record updated <Time value={result.operations.updatedAt} />.</p>}
          {result.square.fulfillments.length ? (
            <ul className="space-y-2 border-l border-[var(--line)] pl-3 text-xs">
              {result.square.fulfillments.map((fulfillment, index) => (
                <li key={index}>
                  <p className="font-medium">{label(fulfillment.type)} · {label(fulfillment.status)}</p>
                  {milestones(fulfillment).map(([name, value]) => value && <p key={name}>{name} <Time value={value} /></p>)}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs">Square returned no fulfillment details.</p>}
          <p className="text-xs text-[var(--ink-soft)]">Checked <Time value={result.checkedAt} />. Confirm the channel in its own order view. Record what staff saw on the kitchen ticket, whether the mock allergy note arrived, and the actual pickup or courier handoff in the first-shift checklist.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="quiet" size="sm" onClick={() => void copy()}>Copy order evidence</Button>
            <Link href="/tasks?tab=checklists" className="focus-ring rounded text-xs font-semibold underline">Open Checklists</Link>
          </div>
          <p role="status" className="text-xs text-[var(--ink-soft)]">
            {copyStatus === "copied" && "Order evidence copied."}
            {copyStatus === "manual" && "Select and copy the evidence below."}
          </p>
          {copyStatus === "manual" && (
            <label className="grid gap-1 text-xs font-semibold">
              Order evidence
              <textarea readOnly rows={4} value={checklistEvidence(result)}
                className="focus-ring rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2 font-mono font-normal" />
            </label>
          )}
        </div>
      )}
    </details>
  );
}
