// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectivityProvider,
  ConnectivityStatusNotice,
} from "@/components/providers/connectivity-provider";
import {
  getCommandAvailability,
} from "@/lib/connectivity/command-availability";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("central connectivity command gate", () => {
  it("allows cached and queue-safe work while pausing network commands", () => {
    expect(getCommandAvailability("read_only_cache", "offline").available).toBe(true);
    expect(getCommandAvailability("queue_safe", "offline").available).toBe(true);
    expect(getCommandAvailability("requires_network", "offline")).toEqual({
      available: false,
      reason: "Unavailable offline. Reconnect before running this command.",
    });
    expect(getCommandAvailability("requires_network", "reconnecting").available).toBe(false);
    expect(getCommandAvailability("requires_network", "online").available).toBe(true);
  });

  it("announces offline state and verifies the application before clearing it", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    render(
      <ConnectivityProvider>
        <ConnectivityStatusNotice />
      </ConnectivityProvider>,
    );
    expect(await screen.findByText("Working offline")).toBeTruthy();

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Verifying connection")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("connectivity-status")).toBeNull());
    expect(fetchSpy).toHaveBeenCalledWith("/api/health", expect.objectContaining({ cache: "no-store" }));
  });
});
