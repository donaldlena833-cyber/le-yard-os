// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChurchSquareStockCounts } from "@/components/inventory/church-square-stock-counts";
import { ChurchSquareStockNotifications } from "@/components/inventory/church-square-stock-notifications";
import { isSquareStockLow } from "@/lib/integrations/square-stock-alerts";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/realtime/use-realtime-invalidation", () => ({
  useRealtimeInvalidation: () => ({ state: "live", isRefreshing: false }),
}));
vi.mock("@/app/actions/workflows/church-square-counts", () => ({
  configureChurchSquareCountItemAction: vi.fn(),
  listTrackedChurchSquareVariationsAction: vi.fn(),
  sendChurchSquareCountAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const scope = {
  organizationId: "30000000-0000-4000-8000-000000000001",
  locationId: "30000000-0000-4000-8000-000000000002",
};
const userId = "30000000-0000-4000-8000-000000000003";
const alert = {
  id: "30000000-0000-4000-8000-000000000004",
  label: "Loaf sandwich",
  quantity: "5.00000",
  calculatedAt: "2026-11-14T11:06:00Z",
  episode: "30000000-0000-4000-8000-000000000005",
};

describe("Church Street Square low stock notification", () => {
  it("uses five as the inclusive boundary without mistaking missing quantities for zero", () => {
    for (const value of ["5.0", "0", "-0.1"]) expect(isSquareStockLow(value)).toBe(true);
    for (const value of ["5.00001", "6", "", " ", "unknown"]) expect(isSquareStockLow(value)).toBe(false);
  });

  it("dismisses one episode, keeps the inventory warning, and pops up again after a new crossing", () => {
    const { rerender } = render(
      <>
        <ChurchSquareStockNotifications {...scope} userId={userId} alerts={[alert]} />
        <ChurchSquareStockCounts scope={scope} items={[{ id: alert.id, label: alert.label }]}
          alerts={[alert]} enabled canConfigure={false} />
      </>,
    );

    const popup = screen.getByRole("complementary", { name: "Square low stock notification" });
    expect(within(popup).getByText(/Loaf sandwich.*5 in stock/)).toBeTruthy();
    fireEvent.click(within(popup).getByRole("button", { name: "Dismiss stock notification" }));
    expect(screen.queryByRole("complementary", { name: "Square low stock notification" })).toBeNull();
    expect(screen.getByText("Low stock · 5 in stock")).toBeTruthy();

    rerender(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[{ ...alert, quantity: "4" }]} />);
    expect(screen.queryByRole("complementary", { name: "Square low stock notification" })).toBeNull();

    rerender(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[]} />);
    expect(screen.queryByRole("complementary", { name: "Square low stock notification" })).toBeNull();
    rerender(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[{
      ...alert, episode: "30000000-0000-4000-8000-000000000006",
    }]} />);
    expect(screen.getByRole("complementary", { name: "Square low stock notification" })).toBeTruthy();
  });

  it("polls while a live socket is silent and drops alerts after an account switch", async () => {
    vi.useFakeTimers();
    const request = vi.fn();
    const liveAlert = { ...alert, episode: "30000000-0000-4000-8000-000000000007" };
    for (const data of [
      { ...scope, userId, alerts: [] },
      { ...scope, userId, alerts: [liveAlert] },
      { ...scope, userId, alerts: [liveAlert] },
      { ...scope, userId: "other-user", alerts: [liveAlert] },
    ]) request.mockResolvedValueOnce({ ok: true, json: async () => data });
    vi.stubGlobal("fetch", request);

    render(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(request).toHaveBeenCalledTimes(2);
    const popup = screen.getByRole("complementary", { name: "Square low stock notification" });
    expect(within(popup).getByText(/Loaf sandwich.*5 in stock/)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole("complementary", { name: "Square low stock notification" })).toBeNull();
  });
});
