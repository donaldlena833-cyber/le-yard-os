// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { lookupChurchSquareOrderEvidenceAction } from "@/app/actions/workflows/church-square-order-evidence";
import { ChurchSquareOrderWindow } from "@/components/today/church-square-order-window";
import {
  churchSquareOrderWindowPath,
  type ChurchSquareOrderWindowResponse,
} from "@/lib/integrations/church-square-order-window";

vi.mock("@/app/actions/workflows/church-square-catering", () => ({
  lookupChurchSquareCateringInvoiceAction: vi.fn(),
  saveChurchSquareCateringHandoffAction: vi.fn(),
}));
vi.mock("@/app/actions/workflows/church-square-order-evidence", () => ({
  lookupChurchSquareOrderEvidenceAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("checks a completed order independently and copies evidence without the full Square ID", async () => {
  const checkedAt = "2026-11-14T18:00:00Z";
  const id = "private-order-id-0123456789";
  vi.mocked(lookupChurchSquareOrderEvidenceAction).mockResolvedValue({
    ok: true, mode: "live", persisted: false, data: {
      reference: id.slice(-10), checkedAt,
      square: {
        source: "DOORDASH", status: "COMPLETED", createdAt: checkedAt, updatedAt: checkedAt,
        fulfillments: [{
          type: "DELIVERY", status: "COMPLETED", promisedAt: checkedAt, handoffAt: checkedAt,
          readyAt: null, completedAt: checkedAt, canceledAt: null, rejectedAt: null,
        }],
      },
      operations: { status: "observed", matches: false, updatedAt: "2026-11-14T17:50:00Z" },
    },
  });
  render(<ChurchSquareOrderWindow />);
  const lookup = within(screen.getByText("Check an exact Square order").closest("details")!);
  fireEvent.click(lookup.getByText("Check an exact Square order"));
  const input = lookup.getByLabelText("Exact Square order ID") as HTMLInputElement;
  fireEvent.change(input, { target: { value: ` ${id} ` } });
  fireEvent.click(lookup.getByRole("button", { name: "Check order" }));
  expect(await lookup.findByText("Operations has a different order revision from this Square check.")).toBeTruthy();
  expect(lookupChurchSquareOrderEvidenceAction).toHaveBeenCalledWith({ orderId: id });
  expect(input.value).toBe("");
  expect(lookup.getByText("Square source hint · DoorDash")).toBeTruthy();
  expect(lookup.getByText("Delivered").querySelector("time")?.dateTime).toBe(checkedAt);

  fireEvent.click(lookup.getByRole("button", { name: "Copy order evidence" }));
  const evidence = await lookup.findByRole("textbox", { name: "Order evidence" }) as HTMLTextAreaElement;
  expect(evidence.value).toContain("Church Street Square order ending 0123456789");
  expect(evidence.value).toContain("Operations has a different order revision");
  expect(evidence.value).not.toContain(id);

  fireEvent.change(input, { target: { value: "different-order" } });
  expect(lookup.queryByText("Square source hint · DoorDash")).toBeNull();
  expect(lookup.queryByRole("textbox", { name: "Order evidence" })).toBeNull();
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
  expect(screen.queryByRole("region", { name: "Sandwich units by Square source" })).toBeNull();
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

it("counts active pickup and delivery fulfillments at the last manual check", async () => {
  const checkedAt = "2026-11-14T18:00:00Z";
  type Order = ChurchSquareOrderWindowResponse["orders"][number];
  type Fulfillment = Order["fulfillments"][number];
  const fulfillment = (overrides: Partial<Fulfillment>): Fulfillment => ({
    type: "PICKUP", status: "RESERVED", promisedAt: null,
    readyAt: null, handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null,
    ...overrides,
  });
  const order = (reference: string, status: Order["status"], ...fulfillments: Fulfillment[]): Order => ({
    reference, source: "SQUARE_ONLINE", status, updatedAt: checkedAt, totalCents: null, fulfillments,
  });
  const fixture: ChurchSquareOrderWindowResponse = {
    checkedAt,
    hasMore: true,
    orders: [
      order("mixed", "OPEN",
        fulfillment({ status: "PROPOSED", promisedAt: checkedAt }),
        fulfillment({ promisedAt: "2026-11-14T13:15:00-05:00" }),
        fulfillment({ type: "DELIVERY", status: "PREPARED", promisedAt: "2026-11-14T18:30:00Z", readyAt: checkedAt }),
        fulfillment({ type: "DELIVERY", promisedAt: "2026-11-14T19:00:00Z" }),
      ),
      order("next", "OPEN",
        fulfillment({ promisedAt: "2026-11-14T18:15:01Z" }),
        fulfillment({ promisedAt: "2026-11-14T17:59:59Z" }),
        fulfillment({ type: "DELIVERY", promisedAt: "2026-11-14T19:00:01Z" }),
        fulfillment({ type: "DELIVERY", promisedAt: "2026-11-14T17:00:00Z" }),
        fulfillment({ type: "DELIVERY", readyAt: checkedAt }),
        fulfillment({}),
      ),
      order("excluded", "OPEN",
        fulfillment({ type: "SHIPMENT", promisedAt: checkedAt }),
        fulfillment({ type: "UNKNOWN", promisedAt: checkedAt }),
        fulfillment({ status: "UNKNOWN", promisedAt: checkedAt }),
        fulfillment({ status: "COMPLETED", promisedAt: checkedAt }),
        fulfillment({ status: "CANCELED", promisedAt: checkedAt }),
        fulfillment({ status: "FAILED", promisedAt: checkedAt }),
        fulfillment({ promisedAt: checkedAt, handoffAt: checkedAt }),
        fulfillment({ promisedAt: checkedAt, completedAt: checkedAt }),
        fulfillment({ promisedAt: checkedAt, canceledAt: checkedAt }),
        fulfillment({ promisedAt: checkedAt, rejectedAt: checkedAt }),
      ),
      order("complete", "COMPLETED", fulfillment({ promisedAt: checkedAt })),
      order("canceled", "CANCELED", fulfillment({ promisedAt: checkedAt })),
      order("draft", "DRAFT", fulfillment({ promisedAt: checkedAt })),
      order("unknown", "UNKNOWN", fulfillment({ promisedAt: checkedAt })),
    ],
  };
  const laterCheck = "2026-11-14T19:30:00Z";
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => fixture })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ checkedAt: laterCheck, hasMore: false, orders: [] }) }));
  render(<ChurchSquareOrderWindow />);
  expect(screen.queryByRole("table", { name: "Pickup and delivery due" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load orders" }));

  const demand = await screen.findByRole("table", { name: "Pickup and delivery due" });
  expect(within(demand).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Type", "Past due", "Next 15 min", "Next 30 min", "Next 60 min", "No promised time",
  ]);
  const values = (type: string) => within(within(demand).getByRole("row", { name: new RegExp(type) }))
    .getAllByRole("cell").map((cell) => cell.textContent);
  expect(values("Pickup")).toEqual(["1", "2", "3", "3", "1"]);
  expect(values("Delivery")).toEqual(["1", "0", "1", "2", "1"]);
  expect(demand.getAttribute("aria-describedby")).toContain("church-square-orders-check");
  expect(screen.getByText(/partial results/i)).toBeTruthy();
  expect(screen.getByText(/manual check of up to 50 orders.*24 hours/i)).toBeTruthy();
  expect(screen.getByText(/last checked/i).querySelector("time")?.dateTime).toBe(checkedAt);

  fireEvent.click(screen.getByRole("button", { name: "Refresh orders" }));
  await waitFor(() => expect(screen.getByText(/last checked/i).querySelector("time")?.dateTime).toBe(laterCheck));
  const refreshedDemand = screen.getByRole("table", { name: "Pickup and delivery due" });
  expect(within(refreshedDemand).getAllByRole("cell").every((cell) => cell.textContent === "0")).toBe(true);
  expect(screen.queryByText(/partial results/i)).toBeNull();
  expect(screen.getByText(/no orders in this read/i)).toBeTruthy();
});

it("compares explicit Square timing pairs by source and shows attribution gaps on a partial sample", async () => {
  const checkedAt = "2026-11-14T18:00:00Z";
  const exactTarget = "2026-11-14T17:50:00Z";
  type Order = ChurchSquareOrderWindowResponse["orders"][number];
  type Fulfillment = Order["fulfillments"][number];
  const fulfillment = (overrides: Partial<Fulfillment>): Fulfillment => ({
    type: "PICKUP", status: "COMPLETED", promisedAt: exactTarget,
    readyAt: null, handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null,
    ...overrides,
  });
  const order = (reference: string, source: Order["source"], status: Order["status"], ...fulfillments: Fulfillment[]): Order => ({
    reference, source, status, updatedAt: checkedAt, totalCents: 10000, fulfillments,
  });
  const snapshot: ChurchSquareOrderWindowResponse = {
    checkedAt, hasMore: true,
    orders: [
      order("delivery", "DOORDASH", "COMPLETED",
        fulfillment({ type: "DELIVERY", handoffAt: "2026-11-14T17:52:00Z" }),
        fulfillment({ type: "DELIVERY", readyAt: "2026-11-14T17:45:00Z", completedAt: "2026-11-14T17:48:00Z" }),
        fulfillment({ status: "FAILED", rejectedAt: "2026-11-14T17:36:00Z" })),
      order("pickup", "SQUARE_ONLINE", "OPEN", fulfillment({ handoffAt: exactTarget })),
      order("draft", "UNKNOWN", "DRAFT"),
      order("unknown", "UNKNOWN", "UNKNOWN"),
    ],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
  render(<ChurchSquareOrderWindow />);
  expect(screen.queryByRole("table", { name: "Order activity by Square source" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load orders" }));

  const table = within(await screen.findByRole("table", { name: "Order activity by Square source" }));
  const region = within(screen.getByRole("region", { name: "Order activity by Square source" }));
  const doorDash = within(table.getByRole("row", { name: /DoorDash/ }));
  const squareOnline = within(table.getByRole("row", { name: /Square Online/ }));
  expect(doorDash.getByText("0 of 1 by window start")).toBeTruthy();
  expect(doorDash.getByText("2 sampled")).toBeTruthy();
  expect(doorDash.getByText("1 with a rejection recorded")).toBeTruthy();
  expect(squareOnline.getByText("1 of 1 by window start")).toBeTruthy();
  const unknown = within(table.getByRole("row", { name: /Unknown source/ }));
  expect(unknown.getByText("2 orders")).toBeTruthy();
  expect(unknown.getByText("1 draft · 1 unknown status")).toBeTruthy();
  expect(unknown.getAllByText("No comparable times")).toHaveLength(2);
  expect(region.getByText(/4 orders in this manual sample.*may have more orders/i)).toBeTruthy();
  expect(region.getByText(/start of their respective Square windows/i)).toBeTruthy();
  expect(region.queryByText("$100.00")).toBeNull();
});

it("shows bounded completed sandwich units and each coverage gap in the shared order check", async () => {
  const checkedAt = "2026-11-14T18:00:00Z";
  const completed: ChurchSquareOrderWindowResponse["orders"] = [
    { reference: "complete", source: "UNKNOWN", status: "COMPLETED", updatedAt: checkedAt, totalCents: 2200, fulfillments: [] },
    { reference: "other", source: "DOORDASH", status: "COMPLETED", updatedAt: checkedAt, totalCents: 1300, fulfillments: [] },
    { reference: "third", source: "DOORDASH", status: "COMPLETED", updatedAt: checkedAt, totalCents: 1300, fulfillments: [] },
  ];
  const snapshot: ChurchSquareOrderWindowResponse = {
    checkedAt, hasMore: true, orders: completed, itemMix: {
      status: "ready", evaluatedOrders: 3, matchedOrders: 1, ordersWithoutLines: 1, ordersWithReturns: 1, excludedMatchedLines: 1,
      rows: [{ recipeKey: "parisien", source: "UNKNOWN", units: 2, orders: 1 }],
    },
  };
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
  vi.stubGlobal("fetch", request);
  render(<ChurchSquareOrderWindow />);
  fireEvent.click(screen.getByRole("button", { name: "Load orders" }));
  const panel = within(await screen.findByRole("region", { name: "Sandwich units by Square source" }));
  const table = within(panel.getByRole("table", { name: "Sandwich units by Square source" }));
  expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Sandwich", "Source hint", "Whole units", "Distinct completed orders"]);
  const row = within(table.getByRole("row", { name: /Le Parisien/ }));
  expect(row.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Unknown source", "2", "1"]);
  expect(panel.getByText(/six exact Regular sandwich variations.*partial sample/)).toBeTruthy();
  expect(panel.getByText(/1 of 3 completed orders.*no item lines returned: 1.*reported returns: 1.*Matching lines excluded: 1/)).toBeTruthy();
  expect(panel.queryByText(/\$22\.00/)).toBeNull();
  expect(request).toHaveBeenCalledExactlyOnceWith(churchSquareOrderWindowPath, expect.objectContaining({ cache: "no-store" }));
});

it("distinguishes an unavailable mix from a successful empty ordered sample", async () => {
  const checkedAt = "2026-11-14T18:00:00Z";
  const base = { checkedAt, hasMore: false, orders: [] } satisfies ChurchSquareOrderWindowResponse;
  const empty: ChurchSquareOrderWindowResponse = { ...base, itemMix: {
    status: "ready", evaluatedOrders: 0, matchedOrders: 0, ordersWithoutLines: 0, ordersWithReturns: 0, excludedMatchedLines: 0, rows: [],
  } };
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...base, itemMix: { status: "unavailable" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => empty }));
  render(<ChurchSquareOrderWindow />);

  fireEvent.click(screen.getByRole("button", { name: "Load orders" }));
  let panel = within(await screen.findByRole("region", { name: "Sandwich units by Square source" }));
  expect(panel.getByText(/sandwich mix could not be verified/)).toBeTruthy();
  expect(panel.queryByText(/No completed orders/)).toBeNull();
  expect(screen.getByText(/no orders in this read/i)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Refresh orders" }));
  panel = within(await screen.findByRole("region", { name: "Sandwich units by Square source" }));
  expect(panel.getByText("No completed orders in this sample.")).toBeTruthy();
  expect(panel.queryByText(/could not be verified|partial sample/)).toBeNull();
  expect(panel.queryByRole("table")).toBeNull();
});
