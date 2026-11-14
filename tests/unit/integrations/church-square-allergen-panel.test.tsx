// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getChurchSquareAllergenDiagnosticAction } from "@/app/actions/workflows/church-square-allergen-diagnostic";
import { ChurchSquareAllergenPanel } from "@/components/kitchen/church-square-allergen-panel";
import type { ChurchSquareAllergenDiagnostic } from "@/lib/integrations/church-square-allergen-diagnostic";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

vi.mock("@/app/actions/workflows/church-square-allergen-diagnostic", () => ({ getChurchSquareAllergenDiagnosticAction: vi.fn() }));

const checkedAt = "2026-11-14T13:05:00Z";
const evidence: ChurchIngredientEvidence[] = [
  ["10-inch baguette", "Contains wheat", "May contain sesame"],
  ["French-style ham", "See retained label", "See supplier statement"],
  ["cultured butter", "Contains milk", "Supplier did not report other cross-contact"],
].map(([ingredientKey, allergenNotes, crossContactNotes], index) => ({
  ingredientKey, status: "reviewed", supplierSku: `SKU-${index + 1}`, sourceReference: `Sheet ${index + 1}`,
  allergenNotes, crossContactNotes, storageRule: "See supplier file", openedRule: "See batch worksheet",
  preppedRule: "See chef review", revision: index + 1, updatedAt: checkedAt, reviewedAt: checkedAt, reviewerName: "Kitchen lead",
}));

const formula: ChurchSandwichFormula = {
  recipeKey: "parisien", revision: 2, reviewReference: "Bench 14B", reviewerName: "Kitchen lead", current: true, reviewedAt: checkedAt,
  measurements: {
    "10-inch baguette": { quantity: 1, measuredInput: 10, measuredUsable: 9, evidenceRevision: 1, yieldBasis: "whole_each" },
    "French-style ham": { quantity: 72, measuredInput: 500, measuredUsable: 450, evidenceRevision: 2, yieldBasis: "weighed_usable_grams" },
    "cultured butter": { quantity: 16, measuredInput: 250, measuredUsable: 250, evidenceRevision: 3, yieldBasis: "weighed_usable_grams" },
  },
};

const snapshot: ChurchSquareAllergenDiagnostic = { checkedAt, items: [
  { key: "parisien", name: "Le Parisien", status: "matched", itemId: "square-parisien", variationIds: ["variation"], allergens: { status: "configured", standard: ["WHEAT"], custom: ["Chèvre"] } },
  { key: "verger", name: "Le Verger", status: "matched", itemId: "square-verger", variationIds: [], allergens: { status: "empty", standard: [], custom: [] } },
  { key: "bellecour", name: "Le Bellecour", status: "missing", itemId: null, variationIds: [], allergens: null },
  { key: "bleu", name: "Le Bleu", status: "ambiguous", itemId: null, variationIds: [], allergens: null },
  { key: "rustique", name: "Le Rustique", status: "matched", itemId: "square-rustique", variationIds: ["variation"], allergens: { status: "unsupported", standard: [], custom: [] } },
  { key: "figaro", name: "Le Figaro", status: "matched", itemId: "square-figaro", variationIds: ["variation"], allergens: { status: "unavailable", standard: [], custom: [] } },
] };

function openRow(name: string) {
  const label = screen.getByText(name, { exact: true });
  fireEvent.click(label);
  return within(label.closest("details")!);
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("checks Square only on request and preserves the six distinct catalog outcomes", async () => {
  vi.mocked(getChurchSquareAllergenDiagnosticAction).mockResolvedValue({ ok: true, mode: "live", persisted: false, data: snapshot });
  render(<ChurchSquareAllergenPanel formulas={[]} evidence={[]} />);
  expect(getChurchSquareAllergenDiagnosticAction).not.toHaveBeenCalled();
  expect(screen.getAllByText("Supplier comparison pending")).toHaveLength(6);
  expect(screen.getByText(/POS tile and online display checks are pending/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  const parisien = openRow("Le Parisien");
  expect(await parisien.findByText("WHEAT")).toBeTruthy();
  expect(parisien.getByText("Chèvre")).toBeTruthy();
  expect(screen.getByText("2 native tags").closest("summary")).toBeTruthy();
  expect(screen.getByText("No native tags").closest("summary")).toBeTruthy();
  expect(screen.getByText("Field unavailable").closest("summary")).toBeTruthy();
  expect(parisien.getByRole("link", { name: /Open Le Parisien/ }).getAttribute("href")).toMatch(/square-parisien$/);
  expect(screen.getByRole("status").querySelector("time")?.dateTime).toBe(checkedAt);
  expect(openRow("Le Verger").getByText(/returned no native allergen tags/)).toBeTruthy();
  expect(openRow("Le Bellecour").getByText(/returned no exact Church Street item match/)).toBeTruthy();
  expect(openRow("Le Bleu").getByText(/returned multiple exact Church Street matches/)).toBeTruthy();
  expect(openRow("Le Rustique").getByText(/could not be confirmed for this Square product type/)).toBeTruthy();
  expect(openRow("Le Figaro").getByText(/native allergen fields were unavailable/)).toBeTruthy();
  expect(getChurchSquareAllergenDiagnosticAction).toHaveBeenCalledTimes(1);
});

it("shows direct supplier evidence separately from cross-contact and withdraws them after a revision change", () => {
  const view = render(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} />);
  const parisien = openRow("Le Parisien");
  expect(parisien.getByText("Manual comparison pending")).toBeTruthy();
  expect(parisien.getAllByText("Allergens listed by supplier")[0].closest("div")?.textContent).toContain("Contains wheat");
  expect(parisien.getAllByText("Supplier cross-contact statement")[0].closest("div")?.textContent).toContain("May contain sesame");
  expect(parisien.getByText("SKU-1 · Sheet 1")).toBeTruthy();
  const changed = evidence.map((row) => row.ingredientKey === "10-inch baguette" ? { ...row, revision: 2 } : row);
  view.rerender(<ChurchSquareAllergenPanel formulas={[formula]} evidence={changed} />);
  expect(parisien.getByText("Supplier comparison pending")).toBeTruthy();
  expect(parisien.getByText(/Recheck the signed recipe/)).toBeTruthy();
  expect(parisien.queryByText("May contain sesame")).toBeNull();
});

it("clears old native tags when a repeat lookup cannot be completed", async () => {
  vi.mocked(getChurchSquareAllergenDiagnosticAction)
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: snapshot })
    .mockRejectedValueOnce(new Error("offline"));
  render(<ChurchSquareAllergenPanel formulas={[]} evidence={[]} />);
  const parisien = openRow("Le Parisien");
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  expect(await parisien.findByText("WHEAT")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square tags again" }));
  expect(await parisien.findByText("Square tags are unavailable for this check.")).toBeTruthy();
  expect(parisien.queryByText("WHEAT")).toBeNull();
});
