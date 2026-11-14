// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSquareOrderWindow } from "@/components/today/church-square-order-window";
import {
  churchSquareOrderWindowPath,
  type ChurchSquareOrderWindowResponse,
} from "@/lib/integrations/church-square-order-window";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows several fulfillments and labels only the Square milestones that are present", async () => {
  const checkedAt = "2026-11-14T18:00:00Z";
  const fixture: ChurchSquareOrderWindowResponse = {
    checkedAt,
    hasMore: false,
    orders: [{
      reference: "mixed",
      source: "SQUARE_ONLINE",
      status: "OPEN",
      updatedAt: checkedAt,
      totalCents: 1200,
      fulfillments: [{
        type: "DELIVERY", status: "PREPARED",
        promisedAt: "2026-11-14T18:30:00Z", readyAt: "2026-11-14T18:00:00Z",
        handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null,
      }, {
        type: "PICKUP", status: "COMPLETED",
        promisedAt: null, readyAt: null,
        handoffAt: "2026-11-14T17:45:00Z", completedAt: "2026-11-14T17:45:00Z",
        canceledAt: null, rejectedAt: null,
      }],
    }, {
      reference: "missing",
      source: "UNKNOWN",
      status: "UNKNOWN",
      updatedAt: checkedAt,
      totalCents: null,
      fulfillments: [],
    }],
  };
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture });
  vi.stubGlobal("fetch", request);
  render(<ChurchSquareOrderWindow />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load orders" }));
  const mixed = await screen.findByRole("row", { name: /mixed/ });
  expect(request).toHaveBeenCalledWith(churchSquareOrderWindowPath, expect.objectContaining({ cache: "no-store" }));
  expect(within(mixed).getByText("Delivery · Ready")).toBeTruthy();
  expect(within(mixed).getByText("Scheduled delivery").querySelector("time")?.dateTime).toBe("2026-11-14T18:30:00Z");
  expect(within(mixed).getByText("Ready", { exact: true }).querySelector("time")?.dateTime).toBe("2026-11-14T18:00:00Z");
  expect(within(mixed).getByText("Pickup · Completed")).toBeTruthy();
  expect(within(mixed).getByText("Picked up").querySelector("time")?.dateTime).toBe("2026-11-14T17:45:00Z");
  expect(within(mixed).queryByText("Completed", { exact: true })).toBeNull();
  expect(within(mixed).queryByText(/Delivered|ETA/)).toBeNull();
  expect(within(screen.getByRole("row", { name: /missing/ })).getByText("Unavailable")).toBeTruthy();
});
