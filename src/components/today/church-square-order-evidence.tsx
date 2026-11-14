"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState, useTransition } from "react";
import {
  lookupChurchSquareOrderEvidenceAction,
  recoverChurchSquareOrderEvidenceAction,
  saveChurchSquareMarketplaceLinkAction,
} from "@/app/actions/workflows/church-square-order-evidence";
import { ChurchSquareMarketplaceLinkForm, marketplaceChannels, marketplaceEvidenceLabels, type MarketplaceLinkInput } from "./church-square-marketplace-link";
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
const captureLabels = {
  webhook: "Signed Square webhook",
  scheduled: "Scheduled Square scan",
  manual: "Manual Square recovery",
} as const;
const receiptStates = {
  pending: "Pending verification",
  verified: "Verified",
  needs_review: "Needs review",
} as const;
const receiptKinds = [
  ["order", "Order"],
  ["payment", "Linked payment"],
] as const;
const squareEventTypes = new Set([
  "order.created", "order.updated", "order.fulfillment.updated",
  "payment.created", "payment.updated",
]);
type Receipt = NonNullable<NonNullable<Evidence["receipts"]>[typeof receiptKinds[number][0]]>;
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

function captureLabel(operations: Extract<Evidence["operations"], { status: "observed" }>) {
  return operations.source ? captureLabels[operations.source]
    : operations.recoveredAt ? captureLabels.manual : "Unknown";
}

function receiptEventLabel(eventType: string) {
  return squareEventTypes.has(eventType) ? eventType : "Square event";
}

function SignedReceipt({ kind, receipt }: { kind: string; receipt: Receipt | null }) {
  return (
    <div>
      <dt className="font-medium">{kind} webhook</dt>
      {!receipt ? <dd>No signed receipt recorded.</dd> : (
        <dd>
          <p>{receiptEventLabel(receipt.eventType)} · {receiptStates[receipt.state]}</p>
          <p>Square created <Time value={receipt.squareCreatedAt} /></p>
          <p>Operations received <Time value={receipt.receivedAt} /></p>
          {receipt.processedAt && <p>Operations processed <Time value={receipt.processedAt} /></p>}
        </dd>
      )}
    </div>
  );
}

function needsRecovery({ canRecover, operations }: Evidence) {
  return canRecover && (operations.status === "not_observed" || (operations.status === "observed" && !operations.matches));
}

function canSaveMarketplaceLink({ canLinkMarketplace, marketplace, operations }: Evidence) {
  return canLinkMarketplace && operations.status === "observed" && operations.matches
    && (marketplace?.status === "unlinked" || (marketplace?.status === "linked" && marketplace.link?.evidence === "merchant_order"));
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

function checklistEvidence({ reference, checkedAt, square, operations, receipts, marketplace }: Evidence) {
  const summary = [
    `Church Street Square order ending ${reference}. Checked ${checkedAt}.`,
    `Square order ${label(square.status).toLowerCase()}. Source hint ${sourceLabels.get(square.source) ?? "Unknown"}. Updated ${square.updatedAt}.`,
    operationsStatus(operations),
    ...(operations.status === "observed" ? [`Operations record updated ${operations.updatedAt}.`] : []),
  ];
  if (operations.status === "observed") {
    const saved = operations.savedAt ? ` · saved ${operations.savedAt}` : "";
    summary.push(`Operations revision source ${captureLabel(operations)}${saved}.`);
    if (operations.recoveredAt) summary.push(`Operations record recovered manually ${operations.recoveredAt}.`);
  }
  if (receipts) {
    for (const [key, kind] of receiptKinds) {
      const receipt = receipts[key];
      if (receipt) {
        const processed = receipt.processedAt ? ` · processed ${receipt.processedAt}` : "";
        summary.push(`${kind} webhook ${receiptEventLabel(receipt.eventType)} · ${receiptStates[receipt.state]}`
          + ` · Square created ${receipt.squareCreatedAt} · received ${receipt.receivedAt}${processed}.`);
      } else {
        summary.push(`${kind} webhook has no signed receipt recorded.`);
      }
    }
  } else {
    summary.push("Signed receipt evidence unavailable.");
  }
  if (marketplace?.status === "linked" && marketplace.link) {
    const link = marketplace.link;
    summary.push(`${marketplaceChannels[link.channel]} · ${marketplaceEvidenceLabels[link.evidence]} · first recorded ${link.recordedAt}.`);
  }
  if (square.fulfillments.length === 0) summary.push("Square returned no fulfillment details.");
  // Leave space for the staff observation in a checklist's 2,000-character notes field.
  const copiedFulfillments = receipts ? 2 : marketplace?.status === "linked" ? 3 : 4;
  for (const fulfillment of square.fulfillments.slice(0, copiedFulfillments)) {
    const times = milestones(fulfillment).flatMap(([name, value]) => value ? [`${name} ${value}`] : []);
    summary.push([`${label(fulfillment.type)} · ${label(fulfillment.status)}`, ...times].join(" · "));
  }
  if (square.fulfillments.length > copiedFulfillments) summary.push(`The order check shows all ${square.fulfillments.length} fulfillments.`);
  return summary.join("\n");
}

export function ChurchSquareOrderEvidence() {
  const [orderId, setOrderId] = useState("");
  const [result, setResult] = useState<Evidence>();
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState<{ result: Evidence; status: "copied" | "manual" }>();
  const [pending, startTransition] = useTransition();
  const checkedOrder = useRef<{ id: string; evidence: Evidence } | null>(null);

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const id = orderId.trim();
    checkedOrder.current = null;
    setResult(undefined);
    setCopyState(undefined);
    setMessage("Checking Square and Operations…");
    startTransition(async () => {
      try {
        const response = await lookupChurchSquareOrderEvidenceAction({ orderId: id });
        if (response.ok && response.mode === "live") {
          checkedOrder.current = { id, evidence: response.data };
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

  function recover() {
    const order = checkedOrder.current;
    if (pending || !result || order?.evidence !== result || !needsRecovery(result)) return;
    setCopyState(undefined);
    setMessage("Checking Square again and recovering the order…");
    startTransition(async () => {
      try {
        const response = await recoverChurchSquareOrderEvidenceAction({
          orderId: order.id,
          checkedRevision: result.square.updatedAt,
          checkedVersion: result.square.version,
        });
        if (response.ok && response.mode === "live") {
          const recovered = response.data;
          checkedOrder.current = { id: order.id, evidence: recovered };
          setResult(recovered);
          const operations = recovered.operations;
          setMessage(operations.status === "observed" && operations.matches
            ? operations.recoveredAt ? "Order recovered into Operations." : "Operations already has this order revision."
            : "Recovery could not confirm a matching order record. Check the order again.");
        } else {
          if (!response.ok && (response.code === "stale" || response.code === "forbidden")) {
            checkedOrder.current = null;
            setResult(undefined);
          }
          setMessage("message" in response ? response.message : "The Square order could not be recovered.");
        }
      } catch {
        setMessage("The Square order could not be recovered. Try again.");
      }
    });
  }

  function saveMarketplaceLink(input: MarketplaceLinkInput) {
    const order = checkedOrder.current;
    if (pending || !result || order?.evidence !== result || !canSaveMarketplaceLink(result)) return;
    setCopyState(undefined);
    setMessage("Checking the Square order and recording the marketplace link…");
    startTransition(async () => {
      try {
        const response = await saveChurchSquareMarketplaceLinkAction({
          ...input,
          orderId: order.id,
          checkedRevision: result.square.updatedAt,
          checkedVersion: result.square.version,
        });
        if (response.ok && response.mode === "live" && response.persisted) {
          checkedOrder.current = { id: order.id, evidence: response.data };
          setResult(response.data);
          setMessage(response.data.marketplace?.status === "linked" ? "Marketplace link recorded."
            : "Marketplace link could not be read back. Check the exact Square order again.");
        } else {
          if (!response.ok && (response.code === "stale" || response.code === "forbidden")) {
            checkedOrder.current = null;
            setResult(undefined);
          }
          setMessage("message" in response ? response.message : "The marketplace link could not be recorded.");
        }
      } catch {
        setMessage("The marketplace link could not be confirmed. Try again.");
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
  const marketplaceLink = result?.marketplace?.status === "linked" ? result.marketplace.link : undefined;

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
              checkedOrder.current = null;
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
          {result.operations.status === "observed" && (
            <>
              <p>Operations record updated <Time value={result.operations.updatedAt} />.</p>
              <p>{result.operations.source || result.operations.recoveredAt
                ? `Operations first saved this revision via ${captureLabel(result.operations)}`
                : "Operations revision source unknown"}
                {result.operations.savedAt && <> · <Time value={result.operations.savedAt} /></>}.
              </p>
              {result.operations.recoveredAt && <p>Operations record recovered manually <Time value={result.operations.recoveredAt} />.</p>}
            </>
          )}
          {result.receipts ? (
            <section className="space-y-2 border-l border-[var(--line)] pl-3 text-xs">
              <h5 className="font-semibold">First signed webhooks received</h5>
              <dl className="grid gap-2 sm:grid-cols-2">
                <SignedReceipt kind="Order" receipt={result.receipts.order} />
                <SignedReceipt kind="Linked payment" receipt={result.receipts.payment} />
              </dl>
              <p className="text-[var(--ink-soft)]">Record when the order first appears on Today separately during the rehearsal.</p>
            </section>
          ) : <p className="text-xs text-[var(--ink-soft)]">Signed receipt evidence unavailable.</p>}
          {result.marketplace && (
            <section className="space-y-2 border-l border-[var(--line)] pl-3 text-xs">
              <h5 className="font-semibold">Marketplace order evidence</h5>
              {marketplaceLink ? (
                <div className="space-y-1">
                  <p>{marketplaceChannels[marketplaceLink.channel]} · {marketplaceEvidenceLabels[marketplaceLink.evidence]}</p>
                  <p>Store ending <span className="font-mono">{marketplaceLink.storeReference.slice(-10)}</span> · Order ending{" "}
                    <span className="font-mono">{marketplaceLink.orderReference.slice(-10)}</span></p>
                  <p>First recorded <Time value={marketplaceLink.recordedAt} />.</p>
                </div>
              ) : <p>{result.marketplace.status === "unlinked" ? "No marketplace link recorded."
                : "Marketplace link could not be checked."}</p>}
              {canSaveMarketplaceLink(result) && (
                <ChurchSquareMarketplaceLinkForm key={marketplaceLink ? marketplaceLink.evidence : "unlinked"}
                  statementChannel={marketplaceLink?.channel} onSave={saveMarketplaceLink} disabled={pending} />
              )}
            </section>
          )}
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
            {needsRecovery(result) && (
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={recover}>Recover order into Operations</Button>
            )}
            <Button type="button" variant="quiet" size="sm" disabled={pending} onClick={() => void copy()}>Copy order evidence</Button>
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
