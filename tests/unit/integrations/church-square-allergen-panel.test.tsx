// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getChurchSquareAllergenDiagnosticAction } from "@/app/actions/workflows/church-square-allergen-diagnostic";
import { recordChurchSandwichRegisterCheckAction } from "@/app/actions/workflows/church-sandwich-register-check";
import { ChurchSquareAllergenPanel } from "@/components/kitchen/church-square-allergen-panel";
import type { ChurchSquareAllergenDiagnostic } from "@/lib/integrations/church-square-allergen-diagnostic";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";
import type { ChurchSandwichRegisterCheck } from "@/lib/kitchen/church-sandwich-register-check";

vi.mock("@/app/actions/workflows/church-square-allergen-diagnostic", () => ({ getChurchSquareAllergenDiagnosticAction: vi.fn() }));
vi.mock("@/app/actions/workflows/church-sandwich-register-check", () => ({ recordChurchSandwichRegisterCheckAction: vi.fn() }));

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
  { key: "parisien", name: "Le Parisien", status: "matched", itemId: "square-parisien", catalogVersion: "1794661500000", variationIds: ["variation"], allergens: { status: "configured", standard: ["GLUTEN", "TREE_NUTS"], custom: ["Walnut"] } },
  { key: "verger", name: "Le Verger", status: "matched", itemId: "square-verger", catalogVersion: "1794661500000", variationIds: [], allergens: { status: "empty", standard: [], custom: [] } },
  { key: "bellecour", name: "Le Bellecour", status: "missing", itemId: null, variationIds: [], allergens: null },
  { key: "bleu", name: "Le Bleu", status: "ambiguous", itemId: null, variationIds: [], allergens: null },
  { key: "rustique", name: "Le Rustique", status: "matched", itemId: "square-rustique", catalogVersion: "1794661500000", variationIds: ["variation"], allergens: { status: "unsupported", standard: [], custom: [] } },
  { key: "figaro", name: "Le Figaro", status: "matched", itemId: "square-figaro", catalogVersion: null, variationIds: ["variation"], allergens: { status: "unavailable", standard: [], custom: [] } },
] };

const registerCheck: ChurchSandwichRegisterCheck = {
  id: "50980468-467c-49ff-b847-5234df530de0", recipeKey: "parisien", formulaRevision: 2,
  squareItemId: "square-parisien", squareCatalogVersion: "1794661500000", outcome: "matched",
  device: "Front counter", reference: "Register log #13", recordedAt: checkedAt, recordedByName: "Shift lead",
};

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
  render(<ChurchSquareAllergenPanel formulas={[]} evidence={[]} registerChecks={[]} />);
  expect(getChurchSquareAllergenDiagnosticAction).not.toHaveBeenCalled();
  expect(screen.getAllByText("Supplier comparison pending")).toHaveLength(6);
  expect(screen.getByText(/guest menu display and whether a mock allergy note reached the kitchen separately/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  const parisien = openRow("Le Parisien");
  const categories = await parisien.findByText("Standard Square categories");
  expect(within(categories.parentElement!).getByText("GLUTEN, TREE_NUTS")).toBeTruthy();
  const names = parisien.getByText("Exact custom ingredient names");
  expect(within(names.parentElement!).getByText("Walnut")).toBeTruthy();
  expect(within(names.parentElement!).queryByText(/wheat|pistachio/i)).toBeNull();
  expect(screen.getByText("3 native tags").closest("summary")).toBeTruthy();
  expect(screen.getByText("No native tags").closest("summary")).toBeTruthy();
  expect(screen.getByText("Field unavailable").closest("summary")).toBeTruthy();
  expect(parisien.getByRole("link", { name: /Open Le Parisien/ }).getAttribute("href")).toMatch(/square-parisien$/);
  expect(screen.getByRole("status").querySelector("time")?.dateTime).toBe(checkedAt);
  expect(openRow("Le Verger").getByText(/returned no native allergen tags/)).toBeTruthy();
  expect(openRow("Le Bellecour").getByText(/returned no exact Church Street item match/)).toBeTruthy();
  expect(openRow("Le Bleu").getByText(/returned multiple exact Church Street matches/)).toBeTruthy();
  expect(openRow("Le Rustique").getByText(/could not be confirmed for this Square product type/)).toBeTruthy();
  expect(openRow("Le Figaro").getByText(/native allergen fields were unavailable/)).toBeTruthy();
  expect(screen.queryByRole("heading", { name: /Register checklist/ })).toBeNull();
  expect(getChurchSquareAllergenDiagnosticAction).toHaveBeenCalledTimes(1);
});

it("shows direct supplier evidence separately from cross-contact and withdraws them after a revision change", () => {
  const view = render(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={[]} />);
  const parisien = openRow("Le Parisien");
  expect(parisien.getByText("Manual comparison pending")).toBeTruthy();
  expect(parisien.getAllByText("Allergens listed by supplier")[0].closest("div")?.textContent).toContain("Contains wheat");
  expect(parisien.getAllByText("Supplier cross-contact statement")[0].closest("div")?.textContent).toContain("May contain sesame");
  expect(parisien.getByText("SKU-1 · Sheet 1")).toBeTruthy();
  const changed = evidence.map((row) => row.ingredientKey === "10-inch baguette" ? { ...row, revision: 2 } : row);
  view.rerender(<ChurchSquareAllergenPanel formulas={[formula]} evidence={changed} registerChecks={[]} />);
  expect(parisien.getByText("Supplier comparison pending")).toBeTruthy();
  expect(parisien.getByText(/Recheck the signed recipe/)).toBeTruthy();
  expect(parisien.queryByText("May contain sesame")).toBeNull();
});

it("clears old native tags when a repeat lookup cannot be completed", async () => {
  vi.mocked(getChurchSquareAllergenDiagnosticAction)
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: snapshot })
    .mockRejectedValueOnce(new Error("offline"));
  render(<ChurchSquareAllergenPanel formulas={[]} evidence={[]} registerChecks={[]} />);
  const parisien = openRow("Le Parisien");
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  expect(await parisien.findByText("GLUTEN, TREE_NUTS")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square tags again" }));
  expect(await parisien.findByText("Square tags are unavailable for this check.")).toBeTruthy();
  expect(parisien.queryByText("GLUTEN, TREE_NUTS")).toBeNull();
});

it("records only an issue or unavailable tile when Square returns an empty field", async () => {
  const match = snapshot.items[0];
  if (match.status !== "matched") throw new Error("Expected matched test item");
  const empty = { ...snapshot, items: [{ ...match, allergens: { status: "empty" as const, standard: [], custom: [] } }] };
  const unsupported = { ...snapshot, items: [{ ...match, allergens: { status: "unsupported" as const, standard: [], custom: [] } }] };
  vi.mocked(getChurchSquareAllergenDiagnosticAction)
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: empty })
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: unsupported });
  const view = render(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={[]} />);
  const parisien = openRow("Le Parisien");
  expect(parisien.queryByRole("heading", { name: /Register checklist/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  const checklist = await parisien.findByRole("heading", { name: "Register checklist" });
  const steps = within(checklist.parentElement!).getAllByRole("listitem").map((step) => step.textContent);
  expect(steps[0]).toMatch(/Church Street register, press and hold the Le Parisien menu tile/);
  expect(steps[1]).toMatch(/direct allergen details with signed recipe r2.*GLUTEN leaves the grain unspecified.*TREE_NUTS leaves the nut unspecified.*empty field/);
  expect(steps[2]).toMatch(/separate supplier cross-contact.*person in charge/);
  expect(steps[3]).toMatch(/Square’s item editor.*item description is intact.*register tile and each public menu.*same signed recipe and supplier labels/);
  expect(parisien.getByText(/10-inch baguette · label r1/)).toBeTruthy();
  expect(parisien.getByText(/French-style ham · label r2/)).toBeTruthy();
  expect(parisien.getByText(/cultured butter · label r3/)).toBeTruthy();
  expect(parisien.getByRole("link", { name: /Open Le Parisien/ }).getAttribute("href")).toMatch(/square-parisien$/);
  expect(parisien.getByRole("option", { name: "Missing or different tags" })).toBeTruthy();
  expect(parisien.getByRole("option", { name: "Tile or allergen details unavailable" })).toBeTruthy();
  expect(parisien.queryByRole("option", { name: "Matched the signed recipe" })).toBeNull();

  view.rerender(<ChurchSquareAllergenPanel formulas={[{ ...formula, current: false }]} evidence={evidence} registerChecks={[]} />);
  expect(parisien.queryByRole("heading", { name: /Register checklist/ })).toBeNull();
  view.rerender(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={[]} />);
  expect(parisien.getByRole("heading", { name: /Register checklist/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square tags again" }));
  expect(await parisien.findByText(/could not be confirmed for this Square product type/)).toBeTruthy();
  expect(parisien.queryByRole("heading", { name: /Register checklist/ })).toBeNull();
  expect(parisien.getByRole("option", { name: "Tile or allergen details unavailable" })).toBeTruthy();
  expect(parisien.queryByRole("option", { name: "Missing or different tags" })).toBeNull();
  expect(parisien.queryByRole("option", { name: "Matched the signed recipe" })).toBeNull();
});

it("binds a confirmed register match to the exact recipe, item and catalog version, and retains one request ID on retry", async () => {
  vi.mocked(getChurchSquareAllergenDiagnosticAction).mockResolvedValue({ ok: true, mode: "live", persisted: false, data: snapshot });
  vi.mocked(recordChurchSandwichRegisterCheckAction)
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: true, data: registerCheck });
  render(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={[]} />);
  const parisien = openRow("Le Parisien");
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  await parisien.findByRole("form", { name: "Record the Le Parisien register check" });
  fireEvent.change(parisien.getByRole("combobox", { name: "Tile result" }), { target: { value: "matched" } });
  fireEvent.change(parisien.getByRole("textbox", { name: "Register device label" }), { target: { value: " Front counter " } });
  fireEvent.change(parisien.getByRole("textbox", { name: "Evidence or follow-up reference" }), { target: { value: " Register log #13 " } });
  fireEvent.click(parisien.getByRole("button", { name: "Save register check" }));
  expect(await parisien.findByText(/Confirm you compared this physical tile/)).toBeTruthy();
  expect(recordChurchSandwichRegisterCheckAction).not.toHaveBeenCalled();

  fireEvent.click(parisien.getByRole("checkbox", { name: /I checked the physical register tile/ }));
  fireEvent.click(parisien.getByRole("button", { name: "Save register check" }));
  expect(await parisien.findByText(/register check could not be confirmed/)).toBeTruthy();
  const request = vi.mocked(recordChurchSandwichRegisterCheckAction).mock.calls[0][0];
  expect(request).toEqual({
    requestId: expect.stringMatching(/^[0-9a-f-]+$/),
    recipeKey: "parisien", formulaRevision: 2, squareItemId: "square-parisien", squareCatalogVersion: "1794661500000",
    outcome: "matched", device: "Front counter", reference: "Register log #13",
  });
  fireEvent.click(parisien.getByRole("button", { name: "Save register check" }));
  expect(await parisien.findByText("Register check recorded.")).toBeTruthy();
  expect(recordChurchSandwichRegisterCheckAction).toHaveBeenNthCalledWith(2, request);
  expect(parisien.getByText("Tile matched").closest("summary")).toBeTruthy();
  expect(parisien.getByText(/Recorded by Shift lead/).querySelector("time")?.dateTime).toBe(checkedAt);
  expect(parisien.getByText("Reference · Register log #13")).toBeTruthy();
});

it("shows saved evidence without treating it as current after a Square or supplier change", async () => {
  const match = snapshot.items[0];
  if (match.status !== "matched") throw new Error("Expected matched test item");
  const changed = { ...snapshot, items: [{ ...match, catalogVersion: "1794661500001" }] };
  vi.mocked(getChurchSquareAllergenDiagnosticAction)
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: snapshot })
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: changed });
  const view = render(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={[registerCheck]} />);
  const parisien = openRow("Le Parisien");
  expect(parisien.getByText("Recheck Square catalog")).toBeTruthy();
  expect(parisien.getByText(/Tile matched · Front counter · Signed recipe r2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  expect(await parisien.findByText("Tile matched")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square tags again" }));
  expect(await parisien.findByText("Square item or version changed")).toBeTruthy();
  expect(parisien.queryByText("Tile matched")).toBeNull();
  expect(parisien.getByText("Reference · Register log #13")).toBeTruthy();

  const held = evidence.map((row) => row.ingredientKey === "10-inch baguette" ? { ...row, status: "hold" as const } : row);
  view.rerender(<ChurchSquareAllergenPanel formulas={[formula]} evidence={held} registerChecks={[registerCheck]} />);
  expect(parisien.getByText("Recipe or labels changed")).toBeTruthy();
  expect(parisien.queryByRole("form")).toBeNull();
  expect(parisien.getByText("Reference · Register log #13")).toBeTruthy();
});

it("withholds evidence entry when the register history or catalog version is unavailable", async () => {
  const match = snapshot.items[0];
  if (match.status !== "matched") throw new Error("Expected matched test item");
  vi.mocked(getChurchSquareAllergenDiagnosticAction)
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: snapshot })
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: false, data: { ...snapshot, items: [{ ...match, catalogVersion: null }] } });
  const view = render(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={null} />);
  const parisien = openRow("Le Parisien");
  fireEvent.click(screen.getByRole("button", { name: "Check Square allergen tags" }));
  expect(await parisien.findByRole("heading", { name: "Register checklist" })).toBeTruthy();
  expect(screen.getByText(/Register check records could not be loaded/)).toBeTruthy();
  expect(parisien.queryByRole("form")).toBeNull();

  view.rerender(<ChurchSquareAllergenPanel formulas={[formula]} evidence={evidence} registerChecks={[]} />);
  expect(parisien.getByRole("form")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check Square tags again" }));
  expect(await parisien.findByText(/Square did not return a catalog version/)).toBeTruthy();
  expect(parisien.queryByRole("form")).toBeNull();
});
