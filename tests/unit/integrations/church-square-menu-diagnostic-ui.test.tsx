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
    {
      key: "parisien", name: "Le Parisien", status: "matched", itemId: "parent-parisien",
      presentation: { itemPhotoCount: 2, description: "present" }, variations: [
        { id: "variation-regular", name: "Regular", sku: "LY-PARISIEN", tracking: "tracked", mapping: "mapped", openingCount: "confirmed",
          presentation: { photoCount: 1, sellability: "sellable", soldOut: { status: "sold_out", validUntil: "2026-11-14T19:15:00Z" } } },
        { id: "variation-mini", name: "Mini", sku: null, tracking: "untracked", mapping: "unmapped", openingCount: "unrecorded",
          presentation: { photoCount: 0, sellability: "not_sellable", soldOut: { status: "clear" } } },
      ],
    },
    { key: "verger", name: "Le Verger", status: "missing", itemId: null, variations: [] },
    { key: "bellecour", name: "Le Bellecour", status: "ambiguous", itemId: null, variations: [] },
    { key: "bleu", name: "Le Bleu", status: "matched", itemId: "parent-bleu",
      presentation: { itemPhotoCount: 0, description: "missing" }, variations: [] },
    {
      key: "rustique", name: "Le Rustique", status: "matched", itemId: "parent-rustique",
      presentation: { itemPhotoCount: null, description: "unverified" }, variations: [
        { id: "variation-rustique", name: "Regular", sku: null, tracking: "default_off", mapping: "unknown", openingCount: "unknown",
          presentation: { photoCount: null, sellability: "unspecified", soldOut: { status: "unverified" } } },
      ],
    },
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
  expect(diagnosticPanel.getByText("Tracking off by default · Operations mapping unverified")).toBeTruthy();
  expect(diagnosticPanel.getByText("Operations physical count unverified")).toBeTruthy();
  expect(diagnosticPanel.getByText(/Multiple exact item matches/)).toBeTruthy();
  expect(diagnosticPanel.getAllByText("No exact item at the Church Street location.")).toHaveLength(2);
  expect(diagnosticPanel.getByText(/Square returned no matching variations/)).toBeTruthy();
  expect(diagnosticPanel.getByText(/have the manager or chef count the finished units/i)).toBeTruthy();
  expect(diagnosticPanel.getByText(/last checked/i).querySelector("time")?.dateTime).toBe(checkedAt);
  expect(diagnosticPanel.getAllByRole("heading")).toHaveLength(6);
  expect(diagnosticPanel.getByText(/photo counts are square catalog references/i)).toBeTruthy();
  expect(diagnosticPanel.getByText(/verify the actual photos and descriptions on the register and guest menu/i)).toBeTruthy();
  expect(diagnosticPanel.getByText(/check ordering availability in each channel/i)).toBeTruthy();
  const parisien = within(parent.closest("li")!);
  expect(parisien.getByText("Item photos").nextElementSibling?.textContent).toBe("2");
  expect(parisien.getByText("Description").nextElementSibling?.textContent).toBe("Present");
  const regular = within(parisien.getByText("variation-regular").closest("li")!);
  expect(regular.getByText("Variation photos").nextElementSibling?.textContent).toBe("1");
  expect(regular.getByText("Square sellable flag").nextElementSibling?.textContent).toBe("Yes");
  const regularSoldOut = regular.getByText("Church Street sold-out flag").nextElementSibling;
  expect(regularSoldOut?.textContent).toMatch(/^Flagged sold out/);
  expect(regularSoldOut?.querySelector("time")?.dateTime).toBe("2026-11-14T19:15:00Z");
  const mini = within(parisien.getByText("variation-mini").closest("li")!);
  expect(mini.getByText("Variation photos").nextElementSibling?.textContent).toBe("0");
  expect(mini.getByText("Square sellable flag").nextElementSibling?.textContent).toBe("No");
  expect(mini.getByText("Church Street sold-out flag").nextElementSibling?.textContent).toBe("No sold-out flag");
  const bleu = within(diagnosticPanel.getByRole("heading", { name: "Le Bleu" }).closest("li")!);
  expect(bleu.getByText("Item photos").nextElementSibling?.textContent).toBe("0");
  expect(bleu.getByText("Description").nextElementSibling?.textContent).toBe("Missing");
  const rustique = within(diagnosticPanel.getByRole("heading", { name: "Le Rustique" }).closest("li")!);
  expect(rustique.getByText("Item photos").nextElementSibling?.textContent).toBe("Unverified");
  expect(rustique.getByText("Description").nextElementSibling?.textContent).toBe("Unverified");
  expect(rustique.getByText("Variation photos").nextElementSibling?.textContent).toBe("Unverified");
  expect(rustique.getByText("Square sellable flag").nextElementSibling?.textContent).toBe("Unspecified");
  expect(rustique.getByText("Church Street sold-out flag").nextElementSibling?.textContent).toBe("Unverified");

  fireEvent.click(diagnosticPanel.getByRole("button", { name: "Check again" }));
  await diagnosticPanel.findByText("Church Street owner access is required.");
  expect(diagnosticPanel.queryByText("variation-regular")).toBeNull();
  expect(configureChurchSquareCountItemAction).not.toHaveBeenCalled();
  expect(sendChurchSquareCountAction).not.toHaveBeenCalled();
});
