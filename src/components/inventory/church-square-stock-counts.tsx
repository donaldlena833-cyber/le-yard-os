"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureChurchSquareCountItemAction, listTrackedChurchSquareVariationsAction, sendChurchSquareCountAction } from "@/app/actions/workflows/church-square-counts";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { ChurchSquareCountItem } from "@/data/read-models/church-square-counts";
import type { ChurchSquareStockAlert } from "@/data/read-models/church-square-stock-alerts";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { formatSquareStockQuantity, isSquareStockLow } from "@/lib/integrations/square-stock-alerts";
import { ChurchSquareMenuDiagnostic } from "./church-square-menu-diagnostic";
import { AcknowledgeStockAlertButton, StockAcknowledgmentReceipt, stockAcknowledgment, stockAcknowledgmentScope, useStockAcknowledgments } from "./church-square-stock-acknowledgment";
import { useLiveChurchSquareStockAlerts } from "./church-square-stock-notifications";

type LocationScope = { organizationId: string; locationId: string };

const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
});

function StockTime({ value }: { value: string }) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  return <time dateTime={value}>{easternTime.format(time)} ET</time>;
}

function CountItem({ item, scope, enabled, alert, alertScope }: {
  item: ChurchSquareCountItem; scope: LocationScope; enabled: boolean; alert?: ChurchSquareStockAlert; alertScope?: string;
}) {
  const router = useRouter();
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [unconfirmed, setUnconfirmed] = useState<{ requestId: string; quantity: string; reason: string }>();
  const acknowledgments = useStockAcknowledgments(alertScope);
  const savedStock = item.squareInStockQuantity != null && item.squareInStockCalculatedAt
    ? { quantity: item.squareInStockQuantity, calculatedAt: item.squareInStockCalculatedAt }
    : null;
  const squareStock = alert && (!savedStock || Date.parse(alert.calculatedAt) > Date.parse(savedStock.calculatedAt))
    ? alert
    : savedStock;
  const stockIsLow = squareStock ? isSquareStockLow(squareStock.quantity) : false;
  const visibleAlert = alert && squareStock && stockIsLow
    && Date.parse(alert.calculatedAt) === Date.parse(squareStock.calculatedAt) ? alert : undefined;
  const receipt = visibleAlert ? stockAcknowledgment(visibleAlert, acknowledgments) : undefined;

  const pending = item.pendingRequestId && item.pendingReason && item.pendingQuantity != null
    ? { requestId: item.pendingRequestId, quantity: String(item.pendingQuantity), reason: item.pendingReason }
    : unconfirmed;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !enabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = { quantity: String(data.get("quantity") ?? ""), reason: String(data.get("reason") ?? "").trim() };
    const count = pending ?? { ...payload, requestId: requestIdFor(item.id, payload) };
    setSaving(true);
    setMessage("");
    try {
      const result = await sendChurchSquareCountAction({ ...scope, itemId: item.id, ...count });
      if (!result.ok || result.mode !== "live") {
        setMessage(result.message);
      } else if (result.data.status === "confirmed") {
        setMessage(result.data.currentQuantity == null ? "Square confirmed this count."
          : `Square confirmed this count. Square in-stock quantity at confirmation was ${formatSquareStockQuantity(String(result.data.currentQuantity))}.`);
        setUnconfirmed(undefined);
        rotateRequestId(item.id);
        form.reset();
      } else if (result.data.status === "rejected") {
        setMessage("This count was never sent. Confirm that tracking is on in Square, then take a fresh count.");
        setUnconfirmed(undefined);
        rotateRequestId(item.id);
      } else {
        setUnconfirmed(count);
        setMessage(result.data.status === "recovery_required" ? "Square confirmation is still pending. Ask a manager to check inventory history."
          : "Square confirmation is pending. Check this same count again.");
      }
    } catch {
      setUnconfirmed(count);
      setMessage("The connection dropped before Square confirmation. Check this same count again.");
    } finally {
      setSaving(false);
      router.refresh();
    }
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{item.label}</h3>
        {stockIsLow && squareStock ? (
          <StatusPill size="sm" tone="warning">
            Low stock · {formatSquareStockQuantity(squareStock.quantity)} in stock
          </StatusPill>
        ) : null}
      </div>
      {visibleAlert && (receipt ? <StockAcknowledgmentReceipt receipt={receipt} /> : alertScope ? (
        <div className="mt-2"><AcknowledgeStockAlertButton alert={visibleAlert} scopeKey={alertScope} key={visibleAlert.episode} /></div>
      ) : null)}
      <p className="mt-1 text-xs text-[var(--ink-soft)]">
        {squareStock
          ? <>Latest Square in-stock quantity · {formatSquareStockQuantity(squareStock.quantity)} · calculated <StockTime value={squareStock.calculatedAt} /></>
          : "No Square in-stock observation yet."}
      </p>
      {item.lastConfirmedQuantity != null ? (
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          Last confirmed physical count · {item.lastConfirmedQuantity}
          {item.lastConfirmedObservedAt && !Number.isNaN(Date.parse(item.lastConfirmedObservedAt)) && (
            <> · observed in Operations <StockTime value={item.lastConfirmedObservedAt} /></>
          )}
        </p>
      ) : null}
      <form onSubmit={(event) => void submit(event)} className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        {pending ? (
          <p className="text-sm sm:col-span-2">Pending Square confirmation for {pending.quantity} units</p>
        ) : (
          <>
            <label className="grid gap-1 text-xs font-semibold">Units on hand
              <input className="focus-ring rounded-md border border-[var(--line)] px-2 py-2" name="quantity" inputMode="numeric"
                pattern="0|[1-9][0-9]{0,5}" maxLength={6} required disabled={!enabled || saving} />
            </label>
            <label className="grid gap-1 text-xs font-semibold">Reason for count
              <input className="focus-ring rounded-md border border-[var(--line)] px-2 py-2" name="reason"
                placeholder="Restocked, counted before service, or ran out" maxLength={160} required disabled={!enabled || saving} />
            </label>
          </>
        )}
        <Button type="submit" disabled={!enabled || saving} variant="accent">
          {saving ? "Checking Square…" : pending ? "Check pending count" : "Send count to Square"}
        </Button>
      </form>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
    </li>
  );
}

export function ChurchSquareStockCounts({ items, scope, enabled, canConfigure, alerts, alertUserId }: {
  items: ChurchSquareCountItem[]; scope: LocationScope; enabled: boolean; canConfigure: boolean;
  alerts?: readonly ChurchSquareStockAlert[] | null;
  alertUserId?: string;
}) {
  const router = useRouter();
  const [refreshingStock, startStockRefresh] = useTransition();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [variations, setVariations] = useState<{ id: string; label: string }[]>();
  const alertScope = alertUserId ? stockAcknowledgmentScope(scope.organizationId, scope.locationId, alertUserId) : undefined;
  const liveAlerts = useLiveChurchSquareStockAlerts(alertScope);
  const currentAlerts = liveAlerts?.alerts ?? alerts;
  const alertsByItem = new Map(currentAlerts?.map((alert) => [alert.id, alert]));

  async function loadVariations() {
    if (saving || !enabled || !canConfigure) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await listTrackedChurchSquareVariationsAction(scope);
      if (result.ok && result.mode === "live") {
        setVariations(result.data);
      } else setMessage(result.message);
    } catch {
      setMessage("Could not fetch tracked items from Square. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !enabled || !canConfigure) return;
    const form = event.currentTarget;
    const variationId = String(new FormData(form).get("variationId") ?? "").trim();
    setSaving(true);
    setMessage("");
    try {
      const result = await configureChurchSquareCountItemAction({ ...scope, variationId });
      if (result.ok && result.mode === "live") {
        setMessage(`${result.data.label} is ready for physical counts.`);
        setVariations((previous) => previous?.filter((variation) => variation.id !== variationId));
        form.reset();
        router.refresh();
      } else setMessage(result.message);
    } catch {
      setMessage("Could not confirm the Square item was added. Refresh the list before trying again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-[1520px] px-4 sm:px-6 lg:px-8" aria-labelledby="church-square-stock-heading">
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="church-square-stock-heading" className="text-lg font-medium">Square stock counts</h2>
            <p className="mt-1 text-sm text-[var(--ink-faint)]">Count sellable units now. A confirmed zero can mark a tracked item sold out. For temporary holds or modifiers, use Square’s availability controls.</p>
          </div>
          {items.length > 0 && (
            <Button type="button" size="sm" variant="quiet" disabled={refreshingStock} aria-busy={refreshingStock}
              aria-describedby="church-square-stock-refresh-detail" onClick={() => startStockRefresh(() => router.refresh())}>
              {refreshingStock ? "Refreshing stock…" : "Refresh Square stock"}
            </Button>
          )}
        </div>
        {items.length > 0 && <p id="church-square-stock-refresh-detail" className="mt-2 text-xs text-[var(--ink-soft)]">
          Refresh loads the latest Square observations synced to Operations.
        </p>}
        {liveAlerts && (
          <div className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
            {liveAlerts.state === "denied" && <p>Operations stock alert access is unavailable.</p>}
            {liveAlerts.state === "unavailable" && (
              <p>Could not refresh Operations stock alerts.{currentAlerts && " Showing the last available alert view."}</p>
            )}
            {liveAlerts.lastCheckedAt && <p>Last Operations alert check <StockTime value={liveAlerts.lastCheckedAt} />.</p>}
          </div>
        )}
        {!enabled ? <p className="mt-2 text-sm">Waiting for the Church Street Square connection.</p> : null}
        {items.length ? <ul className="mt-2 divide-y divide-[var(--line)]">
          {items.map((item) => <CountItem key={item.id} item={item} scope={scope} enabled={enabled} alert={alertsByItem.get(item.id)} alertScope={alertScope} />)}
        </ul> : <p className="mt-2 text-sm">No items are set up for Square counts yet.</p>}
        {enabled && <ChurchSquareMenuDiagnostic key={scope.locationId} showCatalogDetails={canConfigure} />}
        {canConfigure && enabled ? (
          <details className="mt-4 border-t border-[var(--line)] pt-3">
            <summary className="cursor-pointer text-sm font-semibold">Set up a tracked Square item</summary>
            {variations?.length ? (
              <form onSubmit={(event) => void configure(event)} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-semibold">Tracked item in Square
                  <select name="variationId" defaultValue="" required className="focus-ring rounded-md border border-[var(--line)] px-2 py-2">
                    <option value="" disabled>Select an item</option>
                    {variations.map((variation) => <option key={variation.id} value={variation.id}>{variation.label}</option>)}
                  </select>
                </label>
                <Button type="submit" variant="quiet" disabled={saving}>{saving ? "Verifying…" : "Add tracked item"}</Button>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" variant="quiet" disabled={saving} onClick={() => void loadVariations()}>
                  {saving ? "Checking Square…" : "Find tracked items in Square"}
                </Button>
                {variations ? <p className="text-sm">No new tracked items found. Enable stock tracking after taking a physical count in Square.</p> : null}
              </div>
            )}
            <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
