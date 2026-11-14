// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSquareOrderWatchPanel } from "@/components/today/church-square-order-watch";
import { churchSquareOrderWatchPath, type ChurchSquareOrderWatch } from "@/lib/integrations/church-square-order-watch";

const locationId = "1ab42097-12a0-4ff0-8ed3-7bced0187c94";
const checkedAt = "2026-11-14T18:00:00.000Z";
const readyAt = "2026-11-14T17:55:00.000Z";

type Fulfillment = ChurchSquareOrderWatch["orders"][number]["fulfillments"][number];
const fulfillment = (overrides: Partial<Fulfillment>): Fulfillment => ({
  type: "PICKUP", status: "RESERVED", promisedAt: null, readyAt: null,
  handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null, ...overrides,
});
const snapshot: ChurchSquareOrderWatch = {
  checkedAt, orderCoverageThrough: "2026-11-14T17:47:59.000Z", hasMore: true,
  orders: [{ reference: "counter-1", source: "SQUARE_ONLINE", status: "OPEN", updatedAt: checkedAt, fulfillments: [
    fulfillment({ promisedAt: checkedAt, readyAt }),
    fulfillment({ type: "DELIVERY", promisedAt: "2026-11-14T17:58:00.000Z" }),
    fulfillment({ type: "DELIVERY", status: "PREPARED", promisedAt: "2026-11-14T18:15:00.000Z" }),
    fulfillment({ promisedAt: "2026-11-14T18:15:00.001Z" }),
  ] }, { reference: "market-2", source: "UNKNOWN", status: "OPEN", updatedAt: checkedAt, fulfillments: [
    fulfillment({ type: "DELIVERY", status: "PROPOSED" }),
  ] }],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows started, next 15 minute and missing windows with actions tied to actual readiness", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(checkedAt));
  const request = vi.fn().mockResolvedValue(Response.json(snapshot));
  vi.stubGlobal("fetch", request);
  render(<ChurchSquareOrderWatchPanel locationId={locationId} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(request).toHaveBeenCalledExactlyOnceWith(`${churchSquareOrderWatchPath}?locationId=${locationId}`, expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  const region = within(screen.getByRole("region", { name: "Square pickup and delivery watch" }));
  const started = within(region.getByRole("heading", { name: "Window started · 2" }).parentElement!);
  expect(started.getByText("Marked ready · Check pickup status")).toBeTruthy();
  expect(started.getByText("Check prep status")).toBeTruthy();
  expect(started.getAllByText("counter-1")).toHaveLength(2);
  const next = within(region.getByRole("heading", { name: "Next 15 minutes · 1" }).parentElement!);
  expect(next.getByText("Marked ready")).toBeTruthy();
  expect(next.getByText(/Starts/).querySelector("time")?.dateTime).toBe("2026-11-14T18:15:00.000Z");
  const missing = within(region.getByRole("heading", { name: "No window time · 1" }).parentElement!);
  expect(missing.getByText("Unknown source")).toBeTruthy();
  expect(missing.getByText("Review on register")).toBeTruthy();
  expect(region.getByText("Starts later · 1").closest("details")?.open).toBe(false);
  expect(region.getByText(/recovery was more than 12 minutes behind at the last check/)).toBeTruthy();
  expect(region.getByText(/Partial results/)).toBeTruthy();
});

it("keeps the last data after a failed refresh and stops access-denied polling", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(checkedAt));
  const request = vi.fn().mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}, { status: 403 }));
  vi.stubGlobal("fetch", request);
  render(<ChurchSquareOrderWatchPanel locationId={locationId} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByText(/Could not refresh the order watch.*last available records/)).toBeTruthy();
  expect(screen.getByText("Marked ready · Check pickup status")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.queryByRole("region", { name: "Square pickup and delivery watch" })).toBeNull();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(40_000);
  });
  expect(request).toHaveBeenCalledTimes(3);
});

it("pauses while hidden, catches up on visibility, and labels an empty snapshot without recovery coverage", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const empty = { ...snapshot, hasMore: false, orderCoverageThrough: null, orders: [] };
  const request = vi.fn().mockResolvedValue(Response.json(empty));
  vi.stubGlobal("fetch", request);
  render(<ChurchSquareOrderWatchPanel locationId={locationId} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
  expect(request).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(request).toHaveBeenCalledOnce();
  expect(screen.getByText(/recovery coverage is unavailable/)).toBeTruthy();
  expect(screen.getByText(/The available records contain no open fulfillments/)).toBeTruthy();
});
