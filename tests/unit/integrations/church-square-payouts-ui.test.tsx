// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSquareReconciliation } from "@/components/today/church-square-reconciliation";
import {
  churchSquarePayoutWindowPath,
  type ChurchSquarePayoutWindowResponse,
} from "@/lib/integrations/church-square-payout-window";

const checkedAt = "2026-11-14T02:00:00Z";
const depositId = "SQUARE-PAYOUT-FULL-REFERENCE-DEPOSIT";
const emptyWindow: ChurchSquarePayoutWindowResponse = { checkedAt, hasMore: false, payouts: [] };

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
