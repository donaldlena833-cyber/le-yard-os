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
  broadcastEvents?: readonly string[];
  privateChannel?: boolean;
  organizationId: string;
  locationId: string;
  coalesceMs?: number;
  staleWhileHiddenMs?: number;
}

const defaultInvalidationEvents = ["INSERT", "UPDATE"] as const;
const noBroadcastEvents: readonly string[] = [];

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
  broadcastEvents = noBroadcastEvents,
  privateChannel = false,
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
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    let connectionGeneration = 0;
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    let currentState: RealtimeSyncState = navigator.onLine
      ? "connecting"
      : "offline";
    let currentConnection: {
      generation: number;
      supabase: ReturnType<typeof createClient>;
      channel: ReturnType<ReturnType<typeof createClient>["channel"]>;
    } | null = null;

    const updateState = (next: RealtimeSyncState) => {
      currentState = next;
      if (active) {
        setConnection((current) =>
          current.channelName === channelName && current.state === next
            ? current
            : { channelName, state: next },
        );
      }
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

    const clearRetry = () => {
      if (retryTimer === null) return;
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const removeCurrentChannel = () => {
      const connection = currentConnection;
      currentConnection = null;
      if (connection) void connection.supabase.removeChannel(connection.channel);
    };

    const retryDelay = () =>
      Math.min(1_000 * 2 ** Math.min(retryAttempt, 5), 30_000);

    const scheduleReconnect = () => {
      if (!active || !navigator.onLine || retryTimer !== null) return;
      updateState("reconnecting");
      const delay = retryDelay();
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!active || !navigator.onLine || currentConnection) return;
      clearRetry();

      let realtimeClient: {
        supabase: ReturnType<typeof createClient>;
        channel: ReturnType<ReturnType<typeof createClient>["channel"]>;
      } | null = null;
      try {
        const supabase = createClient();
        if (!supabase || typeof supabase.channel !== "function")
          throw new Error("Realtime client unavailable");
        realtimeClient = {
          supabase,
          channel: supabase.channel(
            channelName,
            privateChannel ? { config: { private: true } } : undefined,
          ),
        };
      } catch {
        realtimeClient = null;
      }

      if (!realtimeClient) {
        scheduleReconnect();
        return;
      }

      const { supabase } = realtimeClient;
      let { channel } = realtimeClient;
      const generation = ++connectionGeneration;

      try {
        for (const binding of bindings) {
          // Filtered DELETE events are not tenant-safe in Postgres Changes
          // because Supabase cannot apply RLS/filter predicates to deleted rows.
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

        for (const event of broadcastEvents) {
          channel = channel.on("broadcast", { event }, scheduleRefresh);
        }
      } catch {
        void supabase.removeChannel(channel);
        scheduleReconnect();
        return;
      }

      currentConnection = { generation, supabase, channel };
      try {
        channel.subscribe((status) => {
          if (!active || currentConnection?.generation !== generation) return;
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            const recovering = subscribedOnce || currentState !== "connecting";
            subscribedOnce = true;
            retryAttempt = 0;
            clearRetry();
            updateState("live");
            if (recovering) scheduleRefresh();
            return;
          }
          if (
            status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
            status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
            status === REALTIME_SUBSCRIBE_STATES.CLOSED
          ) {
            removeCurrentChannel();
            if (!navigator.onLine) {
              updateState("offline");
              return;
            }
            scheduleReconnect();
          }
        });
      } catch {
        removeCurrentChannel();
        scheduleReconnect();
      }
    };

    const handleOffline = () => {
      clearRetry();
      removeCurrentChannel();
      updateState("offline");
    };
    const handleOnline = () => {
      updateState("reconnecting");
      scheduleRefresh();
      connect();
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
    if (navigator.onLine) connect();
    else updateState("offline");

    return () => {
      active = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      clearRetry();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      removeCurrentChannel();
    };
  }, [
    bindings,
    broadcastEvents,
    channelName,
    coalesceMs,
    enabled,
    locationId,
    organizationId,
    privateChannel,
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
