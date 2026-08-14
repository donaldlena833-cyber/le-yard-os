import { InlineNotice } from "@/components/ui/inline-notice";
import type { RealtimeInvalidationResult } from "@/lib/realtime/use-realtime-invalidation";
import { cn } from "@/lib/utils";

export function RealtimeSyncStatus({
  state,
  isRefreshing,
  className,
}: RealtimeInvalidationResult & { className?: string }) {
  if (state === "disabled" || (state === "live" && !isRefreshing)) {
    return null;
  }

  const title =
    state === "offline"
      ? "You are offline"
      : state === "reconnecting"
        ? "Reconnecting live updates"
        : isRefreshing
          ? "Refreshing latest data"
          : "Connecting live updates";
  const detail =
    state === "offline"
      ? "Displayed records may be stale. Protected actions remain online-only."
      : state === "reconnecting"
        ? "Displayed records may be stale until the connection is restored."
        : isRefreshing
          ? "Checking the server-authoritative record for changes."
          : "The current server snapshot remains available while the live channel connects.";

  return (
    <InlineNotice
      tone={state === "offline" ? "warning" : "info"}
      announce={state === "connecting" ? "off" : "polite"}
      className={cn("mt-4", className)}
      data-realtime-sync-state={state}
      title={title}
    >
      {detail}
    </InlineNotice>
  );
}
