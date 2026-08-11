"use client";

import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { RealtimeOperationalTable } from "@/lib/realtime/publication-contract";
import { createClient } from "@/lib/supabase/client";

export type RealtimeSyncState =
  "disabled" | "connecting" | "live" | "reconnecting" | "offline";

export type RealtimeInvalidationScope = "organization" | "location";

export interface RealtimeInvalidationBinding {
  table: RealtimeOperationalTable;
  events?: readonly ("INSERT" | "UPDATE")[];
  scope: RealtimeInvalidationScope;
}

export interface RealtimeInvalidationResult {
  state: RealtimeSyncState;
  isRefreshing: boolean;
}

interface RealtimeInvalidationOptions {
  enabled: boolean;
  channelName: string;
  bindings: readonly RealtimeInvalidationBinding[];
  organizationId: string;
  locationId: string;
  coalesceMs?: number;
  staleWhileHiddenMs?: number;
}

const defaultInvalidationEvents = ["INSERT", "UPDATE"] as const;

function bindingFilter(
  binding: RealtimeInvalidationBinding,
  organizationId: string,
  locationId: string,
) {
  if (binding.scope === "organization") {
    return `organization_id=eq.${organizationId}`;
  }
  if (binding.scope === "location") {
    return `location_id=eq.${locationId}`;
  }
  return `organization_id=eq.${organizationId}`;
}

/**
 * Treats Realtime as a scoped invalidation signal while the server read model
 * remains authoritative. Event bursts collapse into one route refresh, and a
 * reconnect or long-hidden tab refreshes once to recover changes it may have
 * missed while the channel was unavailable.
 *
 * `bindings` must be module-level or otherwise referentially stable so ordinary
 * component renders do not tear down and recreate the channel.
 */
export function useRealtimeInvalidation({
  enabled,
  channelName,
  bindings,
  organizationId,
  locationId,
  coalesceMs = 300,
  staleWhileHiddenMs = 30_000,
}: RealtimeInvalidationOptions): RealtimeInvalidationResult {
  const router = useRouter();
  const [connection, setConnection] = useState<{
    channelName: string;
    state: RealtimeSyncState;
  }>(() => ({
    channelName,
    state: enabled ? "connecting" : "disabled",
  }));
  const [isRefreshing, startRefreshTransition] = useTransition();

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let subscribedOnce = false;
    let refreshTimer: number | null = null;
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    let currentState: RealtimeSyncState = navigator.onLine
      ? "connecting"
      : "offline";

    const updateState = (next: RealtimeSyncState) => {
      currentState = next;
      if (active) setConnection({ channelName, state: next });
    };

    const scheduleRefresh = () => {
      if (!active || refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!active) return;
        if (!navigator.onLine) {
          updateState("offline");
          return;
        }
        startRefreshTransition(() => router.refresh());
      }, coalesceMs);
    };

    const supabase = createClient();
    let channel = supabase.channel(channelName);

    for (const binding of bindings) {
      // Filtered DELETE events are not tenant-safe in Postgres Changes because
      // Supabase cannot apply RLS/filter predicates to deleted rows. Operational
      // records use lifecycle transitions, so invalidation listens only to the
      // INSERT/UPDATE events the browser can scope authoritatively.
      for (const event of binding.events ?? defaultInvalidationEvents) {
        channel = channel.on(
          "postgres_changes",
          {
            event,
            schema: "public",
            table: binding.table,
            filter: bindingFilter(binding, organizationId, locationId),
            select: ["id"],
          },
          scheduleRefresh,
        );
      }
    }

    channel.subscribe((status) => {
      if (!active) return;
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        const recovering = subscribedOnce || currentState !== "connecting";
        subscribedOnce = true;
        updateState("live");
        if (recovering) scheduleRefresh();
        return;
      }
      if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
        status === REALTIME_SUBSCRIBE_STATES.CLOSED
      ) {
        updateState(navigator.onLine ? "reconnecting" : "offline");
      }
    });

    const handleOffline = () => updateState("offline");
    const handleOnline = () => {
      updateState("reconnecting");
      scheduleRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenFor >= staleWhileHiddenMs || currentState !== "live") {
        scheduleRefresh();
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [
    bindings,
    channelName,
    coalesceMs,
    enabled,
    locationId,
    organizationId,
    router,
    staleWhileHiddenMs,
  ]);

  const state = !enabled
    ? "disabled"
    : connection.channelName === channelName
      ? connection.state
      : "connecting";
  return { state, isRefreshing };
}
