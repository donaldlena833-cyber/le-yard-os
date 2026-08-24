"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import type { ConnectivityState } from "@/lib/connectivity/command-availability";

interface ConnectivityContextValue {
  state: ConnectivityState;
  retry: () => Promise<void>;
}

const ConnectivityContext = createContext<ConnectivityContextValue>({
  state: "online",
  retry: async () => undefined,
});

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectivityState>("online");
  const mounted = useRef(true);

  const verifyConnection = useCallback(async () => {
    if (!window.navigator.onLine) {
      setState("offline");
      return;
    }

    setState("reconnecting");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch("/api/health", {
        cache: "no-store",
        headers: { "x-le-yard-connectivity-probe": "1" },
        signal: controller.signal,
      });
      if (mounted.current) setState("online");
    } catch {
      if (mounted.current) setState("offline");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const handleOffline = () => setState("offline");
    const handleOnline = () => void verifyConnection();
    if (!window.navigator.onLine) window.queueMicrotask(handleOffline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      mounted.current = false;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [verifyConnection]);

  const value = useMemo(
    () => ({ state, retry: verifyConnection }),
    [state, verifyConnection],
  );

  return (
    <ConnectivityContext.Provider value={value}>
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityContextValue {
  return useContext(ConnectivityContext);
}

export function ConnectivityStatusNotice() {
  const { state, retry } = useConnectivity();
  if (state === "online") return null;

  return (
    <InlineNotice
      data-testid="connectivity-status"
      id="workspace-connectivity-status"
      tone={state === "offline" ? "warning" : "info"}
      announce="polite"
      icon={state === "offline" ? <WifiOff className="size-4" /> : <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />}
      title={state === "offline" ? "Working offline" : "Verifying connection"}
      action={
        state === "offline" ? (
          <Button variant="secondary" size="sm" onClick={() => void retry()}>
            Try again
          </Button>
        ) : null
      }
      className="rounded-none border-x-0 border-t-0 px-4 sm:px-6 lg:px-8"
    >
      {state === "offline"
        ? "Cached views and local drafts remain available. Network commands are paused and nothing will be posted until reconnection is verified."
        : "Cached views and drafts remain available while live commands stay paused."
      }
    </InlineNotice>
  );
}
