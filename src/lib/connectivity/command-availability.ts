import type { ActionOfflinePolicy } from "@/lib/actions/action-registry";

export type ConnectivityState = "online" | "offline" | "reconnecting";

export interface CommandAvailability {
  available: boolean;
  reason: string | null;
}

export function getCommandAvailability(
  offlinePolicy: ActionOfflinePolicy,
  connectivity: ConnectivityState,
): CommandAvailability {
  if (offlinePolicy !== "requires_network" || connectivity === "online") {
    return { available: true, reason: null };
  }

  return {
    available: false,
    reason:
      connectivity === "reconnecting"
        ? "Unavailable while Le Yard OS verifies the restored connection."
        : "Unavailable offline. Reconnect before running this command.",
  };
}
