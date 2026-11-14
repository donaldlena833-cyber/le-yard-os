// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendChurchSquareCountAction } from "@/app/actions/workflows/church-square-counts";
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
  vi.mocked(sendChurchSquareCountAction).mockReset();
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

  it("keeps Inventory and the popup in sync even when the route props stay stale", async () => {
    vi.useFakeTimers();
    const initial = { ...alert, episode: "30000000-0000-4000-8000-000000000016" };
    const next = { ...initial, episode: "30000000-0000-4000-8000-000000000017" };
    const request = vi.fn();
    for (const alerts of [[], [initial], [{ ...initial, ...receipt, quantity: "4" }], [], [next]]) {
      request.mockResolvedValueOnce({ ok: true, json: async () => ({ ...scope, userId, alerts }) });
    }
    vi.stubGlobal("fetch", request);
    render(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[]}>
      <ChurchSquareStockCounts scope={scope} items={[{ id: initial.id, label: initial.label }]}
        alerts={[initial]} alertUserId={userId} enabled canConfigure={false} />
    </ChurchSquareStockNotifications>);

    expect(screen.getByText("Low stock · 5 in stock")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText("Low stock · 5 in stock")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText("Low stock · 5 in stock")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Square low stock notification" })).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText("Low stock · 4 in stock")).toBeTruthy();
    expect(screen.getByText(/Acknowledged by Prep lead/)).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Square low stock notification" })).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByText(/Low stock ·/)).toBeNull();
    expect(screen.queryByText(/Acknowledged by/)).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText("Low stock · 5 in stock")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Square low stock notification" })).toBeTruthy();
  });

  it("distinguishes Operations check time, Square count time, and the physical observation", async () => {
    vi.useFakeTimers();
    const readAt = "2026-11-14T13:05:00.000Z";
    const observedAt = "2026-11-14T10:50:00Z";
    vi.setSystemTime(new Date(readAt));
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...scope, userId, alerts: [alert] }) })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...scope, userId, alerts: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", request);
    render(<ChurchSquareStockNotifications {...scope} userId={userId} alerts={[alert]}>
      <ChurchSquareStockCounts scope={scope} items={[{ id: alert.id, label: alert.label, lastConfirmedQuantity: 0, lastConfirmedObservedAt: observedAt }]}
        alerts={[alert]} alertUserId={userId} enabled canConfigure={false} />
    </ChurchSquareStockNotifications>);
    const inventory = within(screen.getByRole("region", { name: "Square stock counts" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(inventory.getByText(/Last Operations alert check/).querySelector("time")?.dateTime).toBe(readAt);
    expect(inventory.getByText(/Latest Square in-stock quantity/).querySelector("time")?.dateTime).toBe(alert.calculatedAt);
    expect(inventory.getByText(/Last confirmed physical count · 0/).querySelector("time")?.dateTime).toBe(observedAt);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(inventory.getByText(/Could not refresh Operations stock alerts.*last available alert view/)).toBeTruthy();
    expect(inventory.getByText(/Last Operations alert check/).querySelector("time")?.dateTime).toBe(readAt);
    expect(inventory.getByText("Low stock · 5 in stock")).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(inventory.queryByText(/Could not refresh/)).toBeNull();
    expect(inventory.queryByText(/Latest Square in-stock quantity/)).toBeNull();
    expect(inventory.getByText(/Last Operations alert check/).querySelector("time")?.dateTime).toBe("2026-11-14T13:05:20.000Z");

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(inventory.getByText(/Operations stock alert access is unavailable/)).toBeTruthy();
    expect(inventory.queryByText(/Last Operations alert check/)).toBeNull();
    expect(inventory.getByText(/Last confirmed physical count · 0/)).toBeTruthy();
  });

  it("shows the synced Square in-stock quantity to count staff even above the alert threshold", () => {
    const observedAt = "2026-11-14T10:50:00Z";
    const calculatedAt = "2026-11-14T10:55:00Z";
    const item = { id: alert.id, label: alert.label, lastConfirmedQuantity: 10, lastConfirmedObservedAt: observedAt };
    const view = (quantity: string | null, timestamp: string | null, alerts: typeof alert[] = []) =>
      <ChurchSquareStockCounts scope={scope} items={[{ ...item, squareInStockQuantity: quantity, squareInStockCalculatedAt: timestamp }]}
        alerts={alerts} enabled canConfigure={false} />;
    const { rerender } = render(view("9.00000", calculatedAt, [{ ...alert, calculatedAt: observedAt }]));
    expect(screen.getByText(/Latest Square in-stock quantity · 9 · calculated/).querySelector("time")?.dateTime).toBe(calculatedAt);
    expect(screen.getByText(/Last confirmed physical count · 10/).querySelector("time")?.dateTime).toBe(observedAt);
    expect(screen.queryByText(/Low stock ·/)).toBeNull();

    rerender(view("9", calculatedAt, [{ ...alert, quantity: "0.00000" }]));
    expect(screen.getByText(/Latest Square in-stock quantity · 0 · calculated/).querySelector("time")?.dateTime).toBe(alert.calculatedAt);
    rerender(view("0.00000", calculatedAt));
    expect(screen.getByText(/Latest Square in-stock quantity · 0 · calculated/)).toBeTruthy();
    rerender(view(null, null));
    expect(screen.getByText("No Square in-stock observation yet.")).toBeTruthy();
    expect(screen.queryByText(/Latest Square in-stock quantity/)).toBeNull();
    expect(screen.getByText(/Last confirmed physical count · 10/)).toBeTruthy();
    const reload = screen.getByRole("button", { name: "Refresh Square stock" });
    expect(reload.getAttribute("aria-describedby")).toBe(
      screen.getByText("Refresh loads the latest Square observations synced to Operations.").id,
    );
    fireEvent.click(reload);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<ChurchSquareStockCounts scope={scope} items={[]} enabled canConfigure={false} />);
    expect(screen.queryByRole("button", { name: "Refresh Square stock" })).toBeNull();
  });

  it("labels the Square in-stock quantity independently of the submitted physical count", async () => {
    vi.mocked(sendChurchSquareCountAction).mockResolvedValue({
      ok: true, mode: "live", persisted: true, data: { status: "confirmed", currentQuantity: "0.00000" },
    });
    render(<ChurchSquareStockCounts scope={scope} items={[{ id: alert.id, label: alert.label }]} enabled canConfigure={false} />);
    fireEvent.change(screen.getByLabelText("Units on hand"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Reason for count"), { target: { value: "Counted before service" } });
    fireEvent.click(screen.getByRole("button", { name: "Send count to Square" }));
    expect(await screen.findByText("Square confirmed this count. Square in-stock quantity at confirmation was 0.")).toBeTruthy();
    expect(sendChurchSquareCountAction).toHaveBeenCalledExactlyOnceWith({
      ...scope, itemId: alert.id, quantity: "3", reason: "Counted before service", requestId: expect.any(String),
    });
  });
});
