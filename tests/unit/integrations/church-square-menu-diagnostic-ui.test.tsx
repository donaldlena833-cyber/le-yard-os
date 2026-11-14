// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { configureChurchSquareCountItemAction, sendChurchSquareCountAction } from "@/app/actions/workflows/church-square-counts";
import { getChurchSquareMenuDiagnosticAction } from "@/app/actions/workflows/church-square-menu-diagnostic";
import { ChurchSquareStockCounts } from "@/components/inventory/church-square-stock-counts";
import type { ChurchSquareMenuDiagnostic } from "@/lib/integrations/church-square-menu-diagnostic";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/workflows/church-square-menu-diagnostic", () => ({ getChurchSquareMenuDiagnosticAction: vi.fn() }));
vi.mock("@/app/actions/workflows/church-square-counts", () => ({
  configureChurchSquareCountItemAction: vi.fn(),
  listTrackedChurchSquareVariationsAction: vi.fn(),
  sendChurchSquareCountAction: vi.fn(),
}));

const scope = { organizationId: "church-organization", locationId: "church-location" };
const checkedAt = "2026-11-14T18:30:00Z";
const facts: ChurchSquareMenuDiagnostic = {
  checkedAt,
  items: [
    { key: "parisien", name: "Le Parisien", status: "matched", itemId: "parent-parisien", variations: [
      { id: "variation-regular", name: "Regular", sku: "LY-PARISIEN", tracking: "tracked", mapping: "mapped", openingCount: "confirmed" },
      { id: "variation-mini", name: "Mini", sku: null, tracking: "untracked", mapping: "unmapped", openingCount: "unrecorded" },
    ] },
    { key: "verger", name: "Le Verger", status: "missing", itemId: null, variations: [] },
    { key: "bellecour", name: "Le Bellecour", status: "ambiguous", itemId: null, variations: [] },
    { key: "bleu", name: "Le Bleu", status: "matched", itemId: "parent-bleu", variations: [] },
    { key: "rustique", name: "Le Rustique", status: "matched", itemId: "parent-rustique", variations: [
      { id: "variation-rustique", name: "Regular", sku: null, tracking: "unknown", mapping: "unknown", openingCount: "unknown" },
    ] },
    { key: "figaro", name: "Le Figaro", status: "missing", itemId: null, variations: [] },
  ],
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("exposes the catalog check only to a configuration user with the active connection", () => {
  const view = render(<ChurchSquareStockCounts items={[]} scope={scope} enabled canConfigure={false} />);
  expect(screen.queryByText("Check the six sandwich variations")).toBeNull();
  view.rerender(<ChurchSquareStockCounts items={[]} scope={scope} enabled={false} canConfigure />);
  expect(screen.queryByText("Check the six sandwich variations")).toBeNull();
  view.rerender(<ChurchSquareStockCounts items={[]} scope={scope} enabled canConfigure />);
  expect(screen.getByText("Check the six sandwich variations")).toBeTruthy();
  expect(getChurchSquareMenuDiagnosticAction).not.toHaveBeenCalled();
});

it("shows the exact parent and variation evidence and removes prior data when a later check fails", async () => {
  vi.mocked(getChurchSquareMenuDiagnosticAction)
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: facts })
    .mockResolvedValueOnce({ ok: false, persisted: false, code: "forbidden", message: "Church Street owner access is required." });
  render(<ChurchSquareStockCounts items={[]} scope={scope} enabled canConfigure />);
  const diagnostic = screen.getByText("Check the six sandwich variations").closest("details")!;
  fireEvent.click(within(diagnostic).getByText("Check the six sandwich variations"));
  fireEvent.click(within(diagnostic).getByRole("button", { name: "Check Square variations" }));
  const diagnosticPanel = within(diagnostic);
  const parent = await diagnosticPanel.findByRole("link", { name: /Open Le Parisien parent item/ });
  expect(parent.getAttribute("href")).toBe("https://app.squareup.com/dashboard/items/library/parent-parisien");
  expect(diagnosticPanel.getByText("variation-regular")).toBeTruthy();
  expect(diagnosticPanel.getByText("LY-PARISIEN")).toBeTruthy();
  expect(diagnosticPanel.getByText("Tracked · Mapped in Operations")).toBeTruthy();
  expect(diagnosticPanel.getByText("Operations physical count recorded", { exact: true })).toBeTruthy();
  expect(diagnosticPanel.getByText("Tracking off · No active Operations mapping")).toBeTruthy();
  expect(diagnosticPanel.getByText("No Operations physical count recorded")).toBeTruthy();
  expect(diagnosticPanel.getByText("Tracking unverified · Operations mapping unverified")).toBeTruthy();
  expect(diagnosticPanel.getByText("Operations physical count unverified")).toBeTruthy();
  expect(diagnosticPanel.getByText(/Multiple exact item matches/)).toBeTruthy();
  expect(diagnosticPanel.getAllByText("No exact item at the Church Street location.")).toHaveLength(2);
  expect(diagnosticPanel.getByText(/Square returned no matching variations/)).toBeTruthy();
  expect(diagnosticPanel.getByText(/have the manager or chef count the finished units/i)).toBeTruthy();
  expect(diagnosticPanel.getByText(/last checked/i).querySelector("time")?.dateTime).toBe(checkedAt);
  expect(diagnosticPanel.getAllByRole("heading")).toHaveLength(6);

  fireEvent.click(diagnosticPanel.getByRole("button", { name: "Check again" }));
  await diagnosticPanel.findByText("Church Street owner access is required.");
  expect(diagnosticPanel.queryByText("variation-regular")).toBeNull();
  expect(configureChurchSquareCountItemAction).not.toHaveBeenCalled();
  expect(sendChurchSquareCountAction).not.toHaveBeenCalled();
});
