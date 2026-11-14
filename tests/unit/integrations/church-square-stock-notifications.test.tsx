// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeChurchSquareStockAlertAction } from "@/app/actions/workflows/church-square-stock-alerts";
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
vi.mock("@/app/actions/workflows/church-square-stock-alerts", () => ({ acknowledgeChurchSquareStockAlertAction: vi.fn() }));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refresh.mockClear();
  vi.mocked(acknowledgeChurchSquareStockAlertAction).mockReset();
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
  acknowledgedAt: null,
  acknowledgedByName: null,
};
const receipt = { acknowledgedAt: "2026-11-14T11:07:00Z", acknowledgedByName: "Prep lead" };

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
    fireEvent.click(within(popup).getByRole("button", { name: "Hide stock notification in this tab" }));
    expect(acknowledgeChurchSquareStockAlertAction).not.toHaveBeenCalled();
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

  it("shares the saved acknowledgment across the popup and persistent warning without clearing low stock", async () => {
    const first = { ...alert, episode: "30000000-0000-4000-8000-000000000010" };
    const second = { ...alert, id: "30000000-0000-4000-8000-000000000011", label: "Le Parisien", episode: "30000000-0000-4000-8000-000000000012" };
    vi.mocked(acknowledgeChurchSquareStockAlertAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: receipt });
    const view = (alerts: typeof alert[]) => <>
      <ChurchSquareStockNotifications {...scope} userId={userId} alerts={alerts} />
      <ChurchSquareStockCounts scope={scope} items={[{ id: first.id, label: first.label }, { id: second.id, label: second.label }]}
        alerts={alerts} alertUserId={userId} enabled canConfigure={false} />
    </>;
    const { rerender } = render(view([first, second]));
    const popup = screen.getByRole("complementary", { name: "Square low stock notification" });
    fireEvent.click(within(popup).getByRole("button", { name: "Acknowledge low stock for Loaf sandwich" }));
    const acknowledged = await screen.findByText(/Acknowledged by Prep lead/);
    expect(acknowledged.querySelector("time")?.dateTime).toBe(receipt.acknowledgedAt);
    expect(acknowledgeChurchSquareStockAlertAction).toHaveBeenCalledExactlyOnceWith({ itemId: first.id, episodeId: first.episode });
    expect(within(popup).queryByText(/Loaf sandwich/)).toBeNull();
    expect(within(popup).getByText(/Le Parisien.*5 in stock/)).toBeTruthy();
    expect(screen.getAllByText("Low stock · 5 in stock")).toHaveLength(2);
    rerender(view([{ ...first, quantity: "2" }, second]));
    expect(screen.getByText("Low stock · 2 in stock")).toBeTruthy();
    expect(within(popup).queryByText(/Loaf sandwich/)).toBeNull();
    rerender(view([{ ...first, episode: "30000000-0000-4000-8000-000000000013" }, second]));
    expect(within(popup).getByText(/Loaf sandwich.*5 in stock/)).toBeTruthy();
  });

  it("keeps the unacknowledged popup visible when saving was rejected", async () => {
    const stale = { ...alert, episode: "30000000-0000-4000-8000-000000000014" };
    vi.mocked(acknowledgeChurchSquareStockAlertAction).mockRejectedValue(new Error("Network"));
    render(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[stale]} />);
    const popup = screen.getByRole("complementary", { name: "Square low stock notification" });
    fireEvent.click(within(popup).getByRole("button", { name: "Acknowledge low stock for Loaf sandwich" }));
    expect(await within(popup).findByText(/Acknowledgment could not be confirmed/)).toBeTruthy();
    expect(within(popup).getByText(/Loaf sandwich.*5 in stock/)).toBeTruthy();
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

  it("suppresses the popup after a shared acknowledgment arrives in foreground polling", async () => {
    vi.useFakeTimers();
    const liveAlert = { ...alert, episode: "30000000-0000-4000-8000-000000000015" };
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ...scope, userId, alerts: [liveAlert] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...scope, userId, alerts: [{ ...liveAlert, ...receipt }] }) });
    vi.stubGlobal("fetch", request);
    render(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[liveAlert]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("complementary", { name: "Square low stock notification" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole("complementary", { name: "Square low stock notification" })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
