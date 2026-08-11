// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  removeChannel: vi.fn(),
  channel: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  changeCallbacks: [] as Array<() => void>,
  statusCallback: null as null | ((status: string) => void),
  createFailure: false,
  createAttempts: 0,
}));
const router = vi.hoisted(() => ({ refresh: mocks.refresh }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    mocks.createAttempts += 1;
    if (mocks.createFailure) throw new Error("Realtime unavailable");
    const channel = {
      on: mocks.on,
      subscribe: mocks.subscribe,
    };
    mocks.on.mockImplementation(
      (_kind: string, _binding: unknown, callback: () => void) => {
        mocks.changeCallbacks.push(callback);
        return channel;
      },
    );
    mocks.subscribe.mockImplementation((callback: (status: string) => void) => {
      mocks.statusCallback = callback;
      return channel;
    });
    mocks.channel.mockReturnValue(channel);
    return {
      channel: mocks.channel,
      removeChannel: mocks.removeChannel,
    };
  },
}));

const bindings = [
  { table: "tasks", scope: "organization" },
  { table: "checklist_runs", scope: "location" },
] satisfies readonly RealtimeInvalidationBinding[];

function Harness() {
  const sync = useRealtimeInvalidation({
    enabled: true,
    channelName: "operations:test",
    bindings,
    organizationId: "org-1",
    locationId: "location-1",
  });
  return <RealtimeSyncStatus {...sync} />;
}

const noPostgresBindings = [] as const;
const reservationBroadcastEvents = ["INSERT", "UPDATE", "DELETE"] as const;

function PrivateBroadcastHarness() {
  const sync = useRealtimeInvalidation({
    enabled: true,
    channelName: "reservations:org-1:location-1",
    bindings: noPostgresBindings,
    broadcastEvents: reservationBroadcastEvents,
    privateChannel: true,
    organizationId: "org-1",
    locationId: "location-1",
  });
  return <RealtimeSyncStatus {...sync} />;
}

describe("coalesced Realtime invalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.changeCallbacks.length = 0;
    mocks.statusCallback = null;
    mocks.createFailure = false;
    mocks.createAttempts = 0;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("scopes subscriptions and collapses an event burst into one refresh", () => {
    render(<Harness />);

    expect(screen.getByText("Connecting live updates")).toBeTruthy();
    expect(mocks.on).toHaveBeenNthCalledWith(
      1,
      "postgres_changes",
      expect.objectContaining({
        table: "tasks",
        filter: "organization_id=eq.org-1",
        select: ["id"],
      }),
      expect.any(Function),
    );
    expect(mocks.on).toHaveBeenNthCalledWith(
      2,
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        table: "tasks",
        filter: "organization_id=eq.org-1",
        select: ["id"],
      }),
      expect.any(Function),
    );
    expect(mocks.on).toHaveBeenNthCalledWith(
      3,
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        table: "checklist_runs",
        filter: "location_id=eq.location-1",
        select: ["id"],
      }),
      expect.any(Function),
    );

    act(() => mocks.statusCallback?.("SUBSCRIBED"));
    expect(screen.queryByText("Connecting live updates")).toBeNull();

    act(() => {
      mocks.changeCallbacks[0]?.();
      mocks.changeCallbacks[2]?.();
      mocks.changeCallbacks[0]?.();
      vi.advanceTimersByTime(299);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("marks stale states and refreshes once after reconnect", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<Harness />);
    act(() => mocks.statusCallback?.("SUBSCRIBED"));

    act(() => mocks.statusCallback?.("CHANNEL_ERROR"));
    expect(screen.getByText("Reconnecting live updates")).toBeTruthy();

    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("You are offline")).toBeTruthy();
    expect(screen.getByText(/Displayed records may be stale/)).toBeTruthy();

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
      mocks.statusCallback?.("SUBSCRIBED");
      vi.advanceTimersByTime(300);
    });

    expect(mocks.channel).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("You are offline")).toBeNull();
  });

  it("tears down the channel and cancels queued work", () => {
    const view = render(<Harness />);
    act(() => mocks.changeCallbacks[0]?.());

    view.unmount();
    act(() => vi.advanceTimersByTime(300));

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("coalesces bounded private broadcasts without subscribing to row payloads", () => {
    render(<PrivateBroadcastHarness />);

    expect(mocks.channel).toHaveBeenCalledWith(
      "reservations:org-1:location-1",
      { config: { private: true } },
    );
    expect(mocks.on).toHaveBeenCalledTimes(3);
    for (const [index, event] of reservationBroadcastEvents.entries()) {
      expect(mocks.on).toHaveBeenNthCalledWith(
        index + 1,
        "broadcast",
        { event },
        expect.any(Function),
      );
    }
    expect(mocks.on).not.toHaveBeenCalledWith(
      "postgres_changes",
      expect.anything(),
      expect.any(Function),
    );

    act(() => {
      mocks.changeCallbacks[0]?.();
      mocks.changeCallbacks[1]?.();
      mocks.changeCallbacks[2]?.();
      vi.advanceTimersByTime(300);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the authoritative snapshot visible when the realtime client is unavailable", () => {
    mocks.createFailure = true;
    render(<Harness />);

    expect(screen.getByText("Reconnecting live updates")).toBeTruthy();
    expect(screen.getByText(/Displayed records may be stale/)).toBeTruthy();
    expect(mocks.on).not.toHaveBeenCalled();
  });

  it("retries a failed initial setup and refreshes after recovery", () => {
    mocks.createFailure = true;
    const view = render(<Harness />);

    expect(mocks.createAttempts).toBe(1);
    expect(screen.getByText("Reconnecting live updates")).toBeTruthy();

    mocks.createFailure = false;
    act(() => vi.advanceTimersByTime(1_000));
    expect(mocks.createAttempts).toBe(2);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.statusCallback?.("SUBSCRIBED");
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("Reconnecting live updates")).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    view.unmount();
    act(() => vi.advanceTimersByTime(30_000));
    expect(mocks.createAttempts).toBe(2);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("waits while offline and reconnects immediately when the browser returns", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<Harness />);

    expect(screen.getByText("You are offline")).toBeTruthy();
    act(() => vi.advanceTimersByTime(30_000));
    expect(mocks.createAttempts).toBe(0);

    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(mocks.createAttempts).toBe(1);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.statusCallback?.("SUBSCRIBED");
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("You are offline")).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
