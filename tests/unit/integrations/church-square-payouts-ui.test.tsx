// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSquareReconciliation } from "@/components/today/church-square-reconciliation";
import {
  churchSquarePayoutEntriesPath,
  churchSquarePayoutWindowPath,
  type ChurchSquarePayoutWindowResponse,
} from "@/lib/integrations/church-square-payout-window";

const checkedAt = "2026-11-14T02:00:00Z";
const depositId = "SQUARE-PAYOUT-FULL-REFERENCE-DEPOSIT";
const emptyWindow: ChurchSquarePayoutWindowResponse = { checkedAt, hasMore: false, payouts: [] };
const detailWindow: ChurchSquarePayoutWindowResponse = { ...emptyWindow, payouts: [
  { reference: depositId, status: "PAID", amountCents: 1500, createdAt: checkedAt, updatedAt: checkedAt, arrivalDate: "2026-11-14" },
  { reference: "other-payout", status: "PAID", amountCents: 2000, createdAt: checkedAt, updatedAt: checkedAt, arrivalDate: "2026-11-14" },
] };
const transferEntries = {
  reference: depositId, checkedAt, payoutType: "BATCH", amountCents: 1500, hasMore: false,
  entries: [{ reference: "entry-a", type: "CHARGE", effectiveAt: checkedAt, grossCents: 1520, feeCents: 20, netCents: 1500 }],
  netTotalCents: 1500, differenceCents: 0,
};

function renderPayouts() {
  render(<ChurchSquareReconciliation />);
  const reconciliation = screen.getByRole("region", { name: "Square reconciliation" });
  return within(within(reconciliation).getByRole("region", { name: "Square payouts" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("loads the capped Square sample on demand and preserves transfer status, sign, and date meanings", async () => {
  const fixture: ChurchSquarePayoutWindowResponse = {
    checkedAt,
    hasMore: true,
    payouts: [
      { reference: depositId, status: "PAID", amountCents: 12345, createdAt: checkedAt, updatedAt: checkedAt, arrivalDate: "2026-11-14" },
      { reference: "withdrw8", status: "SENT", amountCents: -501, createdAt: checkedAt, updatedAt: null, arrivalDate: null },
      { reference: "missing8", status: "FAILED", amountCents: null, createdAt: checkedAt, updatedAt: null, arrivalDate: null },
    ],
  };
  const request = vi.fn().mockResolvedValue(Response.json(fixture));
  vi.stubGlobal("fetch", request);
  const payouts = renderPayouts();

  expect(request).not.toHaveBeenCalled();
  fireEvent.click(payouts.getByRole("button", { name: "Load payouts" }));
  const table = await payouts.findByRole("table", { name: "Recent Church Street Square payouts" });
  expect(request).toHaveBeenCalledExactlyOnceWith(churchSquarePayoutWindowPath, expect.objectContaining({
    cache: "no-store", credentials: "same-origin",
  }));
  expect(payouts.getByText(/partial results/i)).toBeTruthy();
  expect(payouts.getByText(/bank statement to verify receipt/i)).toBeTruthy();
  expect(payouts.getByText(/marketplace settlements/i)).toBeTruthy();
  expect(payouts.getByRole("status").textContent).toMatch(/Nov 13, 2026.*9:00 PM ET/);

  expect(within(table).getByRole("columnheader", { name: "Payout ID" })).toBeTruthy();
  const deposit = within(within(table).getByRole("row", { name: new RegExp(depositId) }));
  expect(deposit.getByText("Paid by Square")).toBeTruthy();
  expect(deposit.getByText("+$123.45")).toBeTruthy();
  expect(deposit.getByText("Deposit")).toBeTruthy();
  expect(deposit.getByText("Nov 14, 2026").getAttribute("datetime")).toBe("2026-11-14");
  const withdrawal = within(within(table).getByRole("row", { name: /withdrw8/ }));
  expect(withdrawal.getByText("Sent by Square")).toBeTruthy();
  expect(withdrawal.getByText("-$5.01")).toBeTruthy();
  expect(withdrawal.getByText("Withdrawal")).toBeTruthy();
  const missing = within(within(table).getByRole("row", { name: /missing8/ }));
  expect(missing.getByText("Transfer failed")).toBeTruthy();
  expect(missing.getAllByText("Unavailable")).toHaveLength(3);
});

it("distinguishes an empty read from denied access and Square or network failures", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json(emptyWindow))
    .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ status: "payout_permission_unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "setup_pending" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ unrelated: [] }))
    .mockRejectedValueOnce(new Error("Offline"));
  vi.stubGlobal("fetch", request);
  const payouts = renderPayouts();

  const cases = [
    ["Load payouts", /no square payouts found/i],
    ["Refresh payouts", /financial reports access is required/i],
    ["Refresh payouts", /square denied payout access/i],
    ["Refresh payouts", /awaiting setup/i],
    ["Refresh payouts", /temporarily unavailable/i],
    ["Refresh payouts", /temporarily unavailable/i],
    ["Refresh payouts", /temporarily unavailable/i],
  ] as const;
  for (const [button, result] of cases) {
    fireEvent.click(payouts.getByRole("button", { name: button }));
    expect(await payouts.findByText(result)).toBeTruthy();
    expect(payouts.queryByRole("table")).toBeNull();
  }
});

it("reads entries for one selected transfer and confirms only a complete Square match", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json(detailWindow))
    .mockResolvedValueOnce(Response.json(transferEntries))
    .mockResolvedValueOnce(Response.json({ ...transferEntries, amountCents: 2000, differenceCents: -500 }))
    .mockResolvedValueOnce(Response.json({ ...transferEntries, hasMore: true, netTotalCents: null, differenceCents: null }));
  vi.stubGlobal("fetch", request);
  const payouts = renderPayouts();
  fireEvent.click(payouts.getByRole("button", { name: "Load payouts" }));
  const view = await payouts.findByRole("button", { name: `View payout entries for ${depositId}` });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(view);
  const region = within(await payouts.findByRole("region", { name: "Payout entries" }));
  expect(await region.findByText("Square entries match transfer.")).toBeTruthy();
  expect(region.getByText(/Use the bank statement to verify receipt/)).toBeTruthy();
  expect(request).toHaveBeenLastCalledWith(churchSquarePayoutEntriesPath(depositId), expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  const row = within(region.getByRole("row", { name: /entry-a/ }));
  expect(row.getByRole("cell", { name: "charge" })).toBeTruthy();
  expect(row.getByRole("cell", { name: "+$15.20" })).toBeTruthy();
  expect(row.getByRole("cell", { name: "+$0.20" })).toBeTruthy();
  expect(row.getByRole("cell", { name: "+$15.00" })).toBeTruthy();

  fireEvent.click(view);
  expect(await region.findByText(/Difference, entries minus transfer: -\$5\.00/)).toBeTruthy();
  expect(region.queryByText(/Square entries match transfer/)).toBeNull();
  fireEvent.click(view);
  expect(await region.findByText(/Partial entry list/)).toBeTruthy();
  expect(region.queryByText(/Square entries match transfer|Total net entry amount/)).toBeNull();
  fireEvent.click(region.getByRole("button", { name: "Close entries" }));
  expect(payouts.queryByRole("region", { name: "Payout entries" })).toBeNull();
});

it("cancels previous detail on transfer switch and list refresh, retaining a simple transfer's empty state", async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json(detailWindow))
    .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json({ ...transferEntries, reference: "other-payout", payoutType: "SIMPLE", amountCents: 2000, entries: [], netTotalCents: null, differenceCents: null }))
    .mockReturnValueOnce(new Promise<Response>(() => {}))
    .mockResolvedValueOnce(Response.json(emptyWindow));
  vi.stubGlobal("fetch", request);
  const payouts = renderPayouts();
  fireEvent.click(payouts.getByRole("button", { name: "Load payouts" }));
  const first = await payouts.findByRole("button", { name: `View payout entries for ${depositId}` });
  fireEvent.click(first);
  fireEvent.click(payouts.getByRole("button", { name: "View payout entries for other-payout" }));
  const detail = within(payouts.getByRole("region", { name: "Payout entries" }));
  expect(await detail.findByText(/simple transfer.*no itemized entries/)).toBeTruthy();
  expect((request.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => { finish(Response.json(transferEntries)); });
  expect(detail.queryByText(depositId)).toBeNull();

  fireEvent.click(first);
  fireEvent.click(payouts.getByRole("button", { name: "Refresh payouts" }));
  expect((request.mock.calls[3][1].signal as AbortSignal).aborted).toBe(true);
  expect(await payouts.findByText(/No Square payouts found/)).toBeTruthy();
  expect(payouts.queryByRole("region", { name: "Payout entries" })).toBeNull();
});
