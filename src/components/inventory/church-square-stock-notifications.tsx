"use client";

import { PackageX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { ChurchSquareStockAlert } from "@/data/read-models/church-square-stock-alerts";
import {
  formatSquareStockQuantity,
  pendingSquareStockAlerts,
  readSquareStockAlertDismissals,
} from "@/lib/integrations/square-stock-alerts";
import { useRealtimeInvalidation, type RealtimeInvalidationBinding } from "@/lib/realtime/use-realtime-invalidation";
import { AcknowledgeStockAlertButton, stockAcknowledgment, stockAcknowledgmentScope, useStockAcknowledgments } from "./church-square-stock-acknowledgment";

const invalidationBindings: readonly RealtimeInvalidationBinding[] = [
  { table: "church_square_stock_invalidation_signals", scope: "location" },
];
const dismissalEvent = "le-yard-square-stock-alert-dismissed";
const sessionDismissals = new Map<string, string>();
const maxDismissals = 300;
const pollIntervalMs = 10_000;
const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
});

type AlertStatus = {
  organizationId: string;
  locationId: string;
  userId: string;
  alerts: ChurchSquareStockAlert[];
};

type StockAlertSnapshot = {
  scopeKey: string;
  alerts?: ChurchSquareStockAlert[];
  state: "ready" | "unavailable" | "denied";
  lastCheckedAt?: string;
};

const StockAlertSnapshotContext = createContext<StockAlertSnapshot | undefined>(undefined);

export function useLiveChurchSquareStockAlerts(scopeKey: string | undefined) {
  const snapshot = useContext(StockAlertSnapshotContext);
  return snapshot && snapshot.scopeKey === scopeKey ? snapshot : undefined;
}

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
  alerts, organizationId, locationId, userId, children,
}: {
  alerts: readonly ChurchSquareStockAlert[] | null;
  organizationId: string;
  locationId: string;
  userId: string;
  children?: ReactNode;
}) {
  const { refresh } = useRouter();
  const scopeKey = stockAcknowledgmentScope(organizationId, locationId, userId);
  const receipts = useStockAcknowledgments(scopeKey);
  const foregroundCheck = useRef<{ scopeKey: string; invalidate: () => void } | null>(null);
  const renderedAlerts = useRef<readonly ChurchSquareStockAlert[] | null>(alerts);
  const [snapshot, setSnapshot] = useState<StockAlertSnapshot>();
  const currentSnapshot = snapshot?.scopeKey === scopeKey ? snapshot : undefined;
  const currentAlerts = currentSnapshot?.alerts ?? alerts;

  useEffect(() => { renderedAlerts.current = currentAlerts; }, [currentAlerts]);

  const invalidate = useCallback(() => {
    const current = foregroundCheck.current;
    if (current?.scopeKey === scopeKey) current.invalidate();
  }, [scopeKey]);

  useEffect(() => {
    let active = true;
    let activeRequest: AbortController | null = null;
    let trailingCheck = false;
    let timeout: number | undefined;

    function unavailable() {
      setSnapshot((previous) => {
        if (previous?.scopeKey !== scopeKey) return { scopeKey, state: "unavailable" };
        return previous.state === "ready" ? { ...previous, state: "unavailable" } : previous;
      });
    }
    function applyAlerts(next: ChurchSquareStockAlert[], state: "ready" | "denied") {
      const nextKey = JSON.stringify(next);
      const changed = nextKey !== JSON.stringify(renderedAlerts.current);
      renderedAlerts.current = next;
      const lastCheckedAt = state === "ready" ? new Date().toISOString() : undefined;
      setSnapshot({ scopeKey, alerts: next, state, lastCheckedAt });
      if (changed) refresh();
    }
    function finish(controller: AbortController) {
      if (activeRequest !== controller) return;
      activeRequest = null;
      window.clearTimeout(timeout);
      if (trailingCheck) void checkStatus();
    }

    async function checkStatus(immediate = false) {
      if (!active || document.hidden || !navigator.onLine) return;
      if (activeRequest) {
        if (immediate) trailingCheck = true;
        return;
      }
      trailingCheck = false;
      const controller = new AbortController();
      activeRequest = controller;
      const isCurrent = () => active && activeRequest === controller && !controller.signal.aborted;
      timeout = window.setTimeout(() => {
        if (!isCurrent()) return;
        unavailable();
        controller.abort();
        finish(controller);
      }, 8_000);
      try {
        const response = await fetch("/api/integrations/square/stock-alerts", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (response.status === 401 || response.status === 403) {
          applyAlerts([], "denied");
          return;
        }
        if (!response.ok) {
          unavailable();
          return;
        }
        const result = await response.json() as AlertStatus;
        if (!isCurrent()) return;
        if (result.organizationId !== organizationId || result.locationId !== locationId || result.userId !== userId) {
          applyAlerts([], "denied");
          return;
        }
        if (!Array.isArray(result.alerts)) {
          unavailable();
          return;
        }
        applyAlerts(result.alerts, "ready");
      } catch {
        // Keep the last confirmed state and retry on the next foreground check.
        if (isCurrent()) unavailable();
      } finally {
        finish(controller);
      }
    }

    const invalidate = () => { void checkStatus(true); };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) invalidate();
    };
    const offline = () => {
      trailingCheck = false;
      unavailable();
      if (activeRequest) {
        activeRequest.abort();
        finish(activeRequest);
      }
    };
    foregroundCheck.current = { scopeKey, invalidate };
    void checkStatus();
    const timer = window.setInterval(() => { void checkStatus(); }, pollIntervalMs);
    document.addEventListener("visibilitychange", invalidate);
    window.addEventListener("focus", invalidate);
    window.addEventListener("online", invalidate);
    window.addEventListener("offline", offline);
    window.addEventListener("pageshow", restored);
    return () => {
      active = false;
      foregroundCheck.current = null;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", invalidate);
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("online", invalidate);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pageshow", restored);
      activeRequest?.abort();
      activeRequest = null;
    };
  }, [locationId, organizationId, refresh, scopeKey, userId]);

  useRealtimeInvalidation({
    enabled: true,
    channelName: `church-square-stock-${locationId}`,
    bindings: invalidationBindings,
    organizationId,
    locationId,
    onInvalidate: invalidate,
  });

  const dismissKey = `le-yard-square-stock-alerts:${userId}:${locationId}`;
  const getDismissals = useCallback(() => readDismissals(dismissKey), [dismissKey]);
  const dismissalSnapshot = useSyncExternalStore(subscribeToDismissals, getDismissals, () => null);
  const dismissed = dismissalSnapshot === null ? [] : readSquareStockAlertDismissals(dismissalSnapshot);
  const unacknowledged = (currentAlerts ?? []).filter((alert) => !stockAcknowledgment(alert, receipts));
  const pending = dismissalSnapshot === null ? [] : pendingSquareStockAlerts(unacknowledged, dismissed);
  const sample = pending.slice(0, 3);
  const delayed = currentSnapshot?.state === "unavailable";
  return (
    <StockAlertSnapshotContext.Provider value={currentSnapshot}>
      {children}
      <p role="status" aria-atomic="true" className="sr-only">
        {pending.length ? `Square low stock. ${sample.map((alert) => `${alert.label} has ${formatSquareStockQuantity(alert.quantity)} in stock`).join(". ")}${delayed ? ". Stock alert check delayed." : ""}` : ""}
      </p>
      {pending.length ? (
        <aside aria-label="Square low stock notification" className="fixed inset-x-3 top-3 z-[70] mx-auto max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 shadow-[var(--shadow-card)] sm:left-auto sm:right-5 sm:top-5 sm:mx-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PackageX aria-hidden="true" className="size-4 shrink-0 text-[var(--warning)]" />
                Square stock is low
              </div>
            </div>
            <Button aria-label="Hide stock notification in this tab" title="Hide in this tab" size="icon" variant="quiet" className="size-11 shrink-0"
              onClick={() => persistDismissals(dismissKey, [...dismissed, ...pending.map((alert) => alert.episode)])}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {delayed && <p className="mt-1 text-xs text-[var(--ink-soft)]">
            Stock alert check delayed. Showing the last available alerts.
            {currentSnapshot.lastCheckedAt && <> Checked <time dateTime={currentSnapshot.lastCheckedAt}>{easternTime.format(new Date(currentSnapshot.lastCheckedAt))} ET</time>.</>}
          </p>}
          <ul className="mt-1 space-y-1 text-xs text-[var(--ink-soft)]">
            {sample.map((alert) => (
              <li className="flex items-center justify-between gap-2" key={alert.episode}>
                <span className="min-w-0 break-words">{alert.label} · {formatSquareStockQuantity(alert.quantity)} in stock</span>
                <AcknowledgeStockAlertButton alert={alert} scopeKey={scopeKey} />
              </li>
            ))}
          </ul>
          {pending.length > sample.length ? <p className="mt-1 text-xs text-[var(--ink-faint)]">+{pending.length - sample.length} more</p> : null}
          <Link className="focus-ring mt-2 inline-flex rounded-sm text-xs font-semibold text-[var(--accent-strong)] underline"
            href="/inventory#church-square-stock-heading">
            View Square stock
          </Link>
        </aside>
      ) : null}
    </StockAlertSnapshotContext.Provider>
  );
}
