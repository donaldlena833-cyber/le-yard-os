"use client";

import { useSyncExternalStore, useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeChurchSquareStockAlertAction } from "@/app/actions/workflows/church-square-stock-alerts";
import { Button } from "@/components/ui/button";
import type { ChurchSquareStockAlert } from "@/data/read-models/church-square-stock-alerts";

type Receipt = { acknowledgedAt: string; acknowledgedByName: string };
type Receipts = ReadonlyMap<string, Receipt>;

const receiptsByScope = new Map<string, Receipts>();
const emptyReceipts: Receipts = new Map();
const updateEvent = "le-yard-square-stock-acknowledged";
const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

function subscribe(notify: () => void) {
  window.addEventListener(updateEvent, notify);
  return () => window.removeEventListener(updateEvent, notify);
}

export function stockAcknowledgmentScope(organizationId: string, locationId: string, userId: string) {
  return `${organizationId}:${locationId}:${userId}`;
}

export function useStockAcknowledgments(scopeKey: string | undefined) {
  return useSyncExternalStore(subscribe, () => scopeKey ? receiptsByScope.get(scopeKey) ?? emptyReceipts : emptyReceipts, () => emptyReceipts);
}

export function stockAcknowledgment(alert: ChurchSquareStockAlert, receipts: Receipts) {
  if (alert.acknowledgedAt && alert.acknowledgedByName) {
    return { acknowledgedAt: alert.acknowledgedAt, acknowledgedByName: alert.acknowledgedByName };
  }
  return receipts.get(alert.episode);
}

export function StockAcknowledgmentReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <p className="mt-1 text-xs text-[var(--ink-soft)]">
      Acknowledged by {receipt.acknowledgedByName} · <time dateTime={receipt.acknowledgedAt}>{time.format(new Date(receipt.acknowledgedAt))} ET</time>
    </p>
  );
}

export function AcknowledgeStockAlertButton({ alert, scopeKey }: { alert: ChurchSquareStockAlert; scopeKey: string }) {
  const { refresh } = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function acknowledge() {
    if (saving || receiptsByScope.get(scopeKey)?.has(alert.episode)) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await acknowledgeChurchSquareStockAlertAction({ itemId: alert.id, episodeId: alert.episode });
      if (result.ok && result.mode === "live" && result.persisted) {
        const receipts = new Map(receiptsByScope.get(scopeKey));
        receipts.set(alert.episode, result.data);
        if (receipts.size > 300) receipts.delete(receipts.keys().next().value!);
        receiptsByScope.set(scopeKey, receipts);
        window.dispatchEvent(new Event(updateEvent));
        refresh();
      } else {
        setMessage("message" in result ? result.message : "Acknowledgment could not be saved. Try again.");
        refresh();
      }
    } catch {
      setMessage("Acknowledgment could not be confirmed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Button variant="quiet" size="sm" disabled={saving}
        aria-label={`Acknowledge low stock for ${alert.label}`} onClick={() => void acknowledge()}>
        {saving ? "Saving…" : "Acknowledge"}
      </Button>
      {message && <p role="status" className="mt-1 text-xs text-[var(--ink-soft)]">{message}</p>}
    </div>
  );
}
