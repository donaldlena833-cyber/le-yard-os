"use client";

import { PackageX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { ChurchSquareStockAlert } from "@/data/read-models/church-square-stock-alerts";
import {
  formatSquareStockQuantity,
  pendingSquareStockAlerts,
  readSquareStockAlertDismissals,
} from "@/lib/integrations/square-stock-alerts";
import { useRealtimeInvalidation, type RealtimeInvalidationBinding } from "@/lib/realtime/use-realtime-invalidation";

const invalidationBindings: readonly RealtimeInvalidationBinding[] = [
  { table: "church_square_stock_invalidation_signals", scope: "location" },
];
const dismissalEvent = "le-yard-square-stock-alert-dismissed";
const sessionDismissals = new Map<string, string>();
const maxDismissals = 300;

function subscribeToDismissals(notify: () => void) {
  window.addEventListener(dismissalEvent, notify);
  return () => window.removeEventListener(dismissalEvent, notify);
}

function readDismissals(key: string): string {
  if (sessionDismissals.has(key)) return sessionDismissals.get(key)!;
  try {
    return window.sessionStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}

function persistDismissals(key: string, episodes: string[]) {
  const value = JSON.stringify([...new Set(episodes)].slice(-maxDismissals));
  sessionDismissals.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in restricted browsers. Keep dismissal for this tab.
  }
  window.dispatchEvent(new Event(dismissalEvent));
}

export function ChurchSquareStockNotifications({
  alerts, organizationId, locationId, userId,
}: {
  alerts: readonly ChurchSquareStockAlert[] | null;
  organizationId: string;
  locationId: string;
  userId: string;
}) {
  const router = useRouter();
  const refreshedAfterSubscribe = useRef(false);
  const { state } = useRealtimeInvalidation({
    enabled: true,
    channelName: `church-square-stock-${locationId}`,
    bindings: invalidationBindings,
    organizationId,
    locationId,
  });

  useEffect(() => {
    if (state === "live") {
      // An event can land between the server's first read and subscription.
      if (!refreshedAfterSubscribe.current) {
        refreshedAfterSubscribe.current = true;
        router.refresh();
      }
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [router, state]);

  const dismissKey = `le-yard-square-stock-alerts:${userId}:${locationId}`;
  const getDismissals = useCallback(() => readDismissals(dismissKey), [dismissKey]);
  const dismissalSnapshot = useSyncExternalStore(subscribeToDismissals, getDismissals, () => null);
  const dismissed = dismissalSnapshot === null ? [] : readSquareStockAlertDismissals(dismissalSnapshot);
  const pending = dismissalSnapshot === null ? [] : pendingSquareStockAlerts(alerts ?? [], dismissed);
  const sample = pending.slice(0, 3);
  return (
    <>
      <p role="status" aria-atomic="true" className="sr-only">
        {pending.length ? `Square low stock. ${sample.map((alert) => `${alert.label} has ${formatSquareStockQuantity(alert.quantity)} in stock`).join(". ")}` : ""}
      </p>
      {pending.length ? (
        <aside aria-label="Square low stock notification" className="fixed inset-x-3 top-3 z-[70] mx-auto max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 shadow-[var(--shadow-card)] sm:left-auto sm:right-5 sm:top-5 sm:mx-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PackageX aria-hidden="true" className="size-4 shrink-0 text-[var(--warning)]" />
                Square stock is low
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-[var(--ink-soft)]">
                {sample.map((alert) => (
                  <li key={alert.episode}>{alert.label} · {formatSquareStockQuantity(alert.quantity)} in stock</li>
                ))}
              </ul>
              {pending.length > sample.length ? <p className="mt-1 text-xs text-[var(--ink-faint)]">+{pending.length - sample.length} more</p> : null}
            </div>
            <Button aria-label="Dismiss stock notification" size="icon" variant="quiet" className="size-11 shrink-0"
              onClick={() => persistDismissals(dismissKey, [...dismissed, ...pending.map((alert) => alert.episode)])}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <Link className="focus-ring mt-2 inline-flex rounded-sm text-xs font-semibold text-[var(--accent-strong)] underline"
            href="/inventory#church-square-stock-heading">
            View Square stock
          </Link>
        </aside>
      ) : null}
    </>
  );
}
